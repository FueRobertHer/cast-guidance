import { db } from '@/db/db';
import { getActiveTag } from '../loader';
import type { EntityRegistry, EntityType } from '../normalize';
import type {
  SearchDoc,
  SearchErrorPhase,
  SearchSourceFilter,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from './protocol';

/** Types worth surfacing in global search. */
const SEARCHABLE: EntityType[] = [
  'race',
  'subrace',
  'background',
  'feat',
  'optionalfeature',
  'item',
  'baseitem',
  'spell',
  'class',
  'subclass',
  'condition',
  'disease',
  'status',
  'action',
  'skill',
  'sense',
  'language',
  'variantrule',
  'book',
];

export interface SearchResult {
  hits: SearchDoc[];
  /** Matches the source filter dropped, so callers can offer to show them. */
  hiddenCount: number;
}

const EMPTY_RESULT: SearchResult = { hits: [], hiddenCount: 0 };

/** A failure the worker reported about itself, tagged with what it was doing. */
class SearchWorkerError extends Error {
  readonly phase: SearchErrorPhase;
  constructor(message: string, phase: SearchErrorPhase) {
    super(message);
    this.name = 'SearchWorkerError';
    this.phase = phase;
  }
}

let worker: Worker | null = null;
/**
 * Bumped every time the worker is replaced. A request holds the generation it
 * was sent under, so a stale timeout cannot terminate the healthy worker that
 * replaced its own.
 */
let workerGeneration = 0;
let readyPromise: Promise<void> | null = null;
let indexedSignature = '';
/**
 * The signature of the most recent index request, written only by
 * {@link ensureSearchIndex}. Deliberately not `indexedSignature`, which
 * `recycleWorker` and the failure path both clear: a queued request would then
 * read a worker death as "a newer signature replaced me" and drop itself,
 * resolving its caller with no index built and no error to show.
 */
let wantedSignature = '';
let queryId = 0;
const pending = new Map<number, (result: SearchResult) => void>();

/** Settle every in-flight query empty. Used when the worker can no longer answer. */
function settlePending(): void {
  for (const [id, resolve] of pending) {
    resolve(EMPTY_RESULT);
    pending.delete(id);
  }
}

/** Called when the worker is lost, so a view can drop to its error + retry. */
const lost = new Set<() => void>();

/** Subscribe to worker loss. Returns the unsubscribe. */
export function onSearchIndexLost(fn: () => void): () => void {
  lost.add(fn);
  return () => {
    lost.delete(fn);
  };
}

/**
 * Throw the worker away so the next request builds a fresh one.
 *
 * A worker that failed to start, died, or stopped answering never recovers,
 * and the handle stays cached forever: without this, one dead worker turns
 * every later build into a 30-second timeout and every query into a 5-second
 * one, for the rest of the session. Resetting the signature is part of it:
 * the next `ensureSearchIndex` has to re-attempt rather than hand back the
 * promise that was settled against the corpse.
 *
 * `generation` is the worker the caller was talking to. A late timeout from a
 * request that belonged to a worker already replaced would otherwise terminate
 * the live one and null a newer `readyPromise`, leaving a search box that says
 * it is ready and answers nothing.
 */
function recycleWorker(generation: number): void {
  if (generation !== workerGeneration) return;
  if (worker !== null) {
    worker.terminate();
    worker = null;
  }
  workerGeneration++;
  readyPromise = null;
  indexedSignature = '';
  settlePending();
  // Nothing else is watching the worker, so the view that offers the retry has
  // to be told: without this the search box stays enabled, keeps saying it is
  // ready, and answers every query with nothing.
  for (const fn of [...lost]) fn();
}

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<SearchWorkerResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'results') {
        pending.get(msg.id)?.({ hits: msg.hits, hiddenCount: msg.hiddenCount });
        pending.delete(msg.id);
      } else if (msg.kind === 'error' && msg.phase === 'query' && msg.id !== undefined) {
        // A record the index cannot read is one query's problem, not the app's.
        // The answer already came back, so the caller settles now rather than
        // spinning out the full query timeout over it.
        pending.get(msg.id)?.(EMPTY_RESULT);
        pending.delete(msg.id);
      }
    };
    // A worker that dies (a chunk that won't load offline, an OOM kill) or is
    // handed a message it cannot decode reports it here and nowhere else.
    const generation = workerGeneration;
    worker.onerror = () => recycleWorker(generation);
    worker.onmessageerror = () => recycleWorker(generation);
  }
  return worker;
}

function send(msg: SearchWorkerRequest): void {
  getWorker().postMessage(msg);
}

function docsFrom(registry: EntityRegistry): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const seen = new Set<string>();
  for (const type of SEARCHABLE) {
    for (const e of registry.byType(type)) {
      const name = typeof e.name === 'string' ? e.name : undefined;
      const source = typeof e.source === 'string' ? e.source : '?';
      if (name === undefined) continue;
      const uid = `${name}|${source}`.toLowerCase();
      const id = `${type}:${uid}`;
      if (seen.has(id)) continue;
      seen.add(id);
      docs.push({ id, type, uid, name, source });
    }
  }
  return docs;
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** A build/load that produces no ready/error within this window is failed. */
const BUILD_TIMEOUT_MS = 30_000;

/**
 * Send one index request and wait for the worker to finish it.
 *
 * Rejects on every way the request can fail rather than only the one the
 * worker is well enough to report: a reported error, a worker that died
 * mid-request, and silence. Callers (`useSearchState`) can then show an error
 * and a retry instead of an index that silently never becomes ready.
 */
interface IndexOutcome {
  serialized: string | undefined;
  /**
   * The worker that answered. Captured where the request was posted rather
   * than read back after the await: a worker can die between its own `ready`
   * and the caller resuming, and reading it late reports the replacement.
   */
  generation: number;
}

function sendIndexRequest(msg: SearchWorkerRequest): Promise<IndexOutcome> {
  const w = getWorker();
  const generation = workerGeneration;
  return new Promise<IndexOutcome>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onDead);
      w.removeEventListener('messageerror', onDead);
    };
    const timer = setTimeout(() => {
      stop();
      // Nothing came back in thirty seconds, so nothing will: the next attempt
      // deserves a worker that might answer.
      recycleWorker(generation);
      reject(new Error('search index build timed out'));
    }, BUILD_TIMEOUT_MS);
    const onMessage = (ev: MessageEvent<SearchWorkerResponse>) => {
      if (ev.data.kind === 'ready') {
        stop();
        resolve({ serialized: ev.data.serialized, generation });
      } else if (ev.data.kind === 'error' && ev.data.phase !== 'query') {
        stop();
        reject(new SearchWorkerError(ev.data.message || 'search worker failed', ev.data.phase));
      }
    };
    const onDead = (ev: Event) => {
      stop();
      recycleWorker(generation);
      reject(
        new Error(
          ev instanceof ErrorEvent && ev.message !== '' ? ev.message : 'the search worker stopped',
        ),
      );
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onDead);
    w.addEventListener('messageerror', onDead);
    w.postMessage(msg);
  });
}

/** One index request at a time, in the order they were asked for. */
let indexQueue: Promise<unknown> = Promise.resolve();

/**
 * A queued request whose signature stopped being the current one. Carried as a
 * rejection rather than a resolve so no caller mistakes it for a finished
 * build and writes a cache row for it.
 */
class SupersededError extends Error {
  constructor() {
    super('a newer search index was requested');
    this.name = 'SupersededError';
  }
}

/**
 * Queue an index request behind whatever the worker is already doing, and drop
 * it if a newer one has been asked for by the time its turn comes.
 *
 * Serializing is what makes an untagged `ready` unambiguous. A `ready` message
 * says nothing about which request it answers, so two builds in flight at once
 * resolve each other: the registry changes while the first build is still
 * running (every homebrew save invalidates it), the first `ready` settles both
 * callers, and the second signature's cache row is written holding the first
 * signature's index. That row decodes perfectly, so nothing downstream can
 * notice, and the app serves a stale corpus until the data tag moves.
 *
 * Dropping is what keeps serializing affordable. The signature is the sorted
 * list of cached paths, so a background drain moves it once per file that
 * lands: without this, a install queued a full corpus build per file and every
 * one of them ran, each walking the registry, cloning the whole doc set to the
 * worker and writing a serialized index back to IndexedDB, with search staying
 * unready until the last of them drained. Only the newest signature can
 * produce a row anybody will read, so the rest are not worth the worker's
 * time.
 *
 * `build` is a thunk rather than a message for the same reason: `docsFrom`
 * walks the entire registry, and a request that will be dropped should not pay
 * for it. It runs only once the request is confirmed current.
 */
function requestIndex(
  build: () => SearchWorkerRequest,
  stillWanted: () => boolean,
): Promise<IndexOutcome> {
  const run = async () => {
    if (!stillWanted()) throw new SupersededError();
    return sendIndexRequest(build());
  };
  const queued = indexQueue.then(run, run);
  indexQueue = queued.catch(() => undefined);
  return queued;
}

/** Build (or rehydrate) the index for the given registry + cache signature. */
export function ensureSearchIndex(registry: EntityRegistry, signature: string): Promise<void> {
  if (signature === indexedSignature && readyPromise !== null) return readyPromise;
  indexedSignature = signature;
  const key = `${getActiveTag()}|official|${hashString(signature)}`;

  // This attempt is worth running for as long as its signature is the one
  // being asked for, and no longer.
  wantedSignature = signature;
  const stillWanted = () => signature === wantedSignature;

  // The worker generation that answered this attempt's request. The index
  // lives inside that worker, so a restore below is only meaningful while it
  // is still the one `getWorker` hands out.
  let builtUnder = -1;

  const attempt = (async () => {
    const cached = await db.searchIndexes.get(key);
    if (cached !== undefined) {
      try {
        builtUnder = (
          await requestIndex(() => ({ kind: 'load', serialized: cached.json }), stillWanted)
        ).generation;
        return;
      } catch (err) {
        if (err instanceof SupersededError) return;
        // A cached index that will not decode is the one failure search can
        // repair by itself, and the only one worth repairing here: the docs it
        // was built from are still in the registry, so the poisoned row goes
        // and the index is built again below. Before this, a half-written or
        // format-shifted cache entry failed the same way on every retry and
        // every reload, and search stayed dead until the data tag changed.
        if (!(err instanceof SearchWorkerError) || err.phase !== 'load') throw err;
        await db.searchIndexes.delete(key);
      }
    }
    let serialized: string | undefined;
    try {
      const outcome = await requestIndex(
        () => ({ kind: 'build', docs: docsFrom(registry) }),
        stillWanted,
      );
      serialized = outcome.serialized;
      builtUnder = outcome.generation;
    } catch (err) {
      // A newer signature is already in flight, so there is nothing to report
      // and nothing to retry: resolving hands this attempt's waiters the same
      // answer they would get from waiting on the one that replaced it.
      if (err instanceof SupersededError) return;
      throw err;
    }
    if (serialized !== undefined) {
      // Keep only the latest index for this tag.
      await db.searchIndexes.where('key').startsWith(`${getActiveTag()}|official|`).delete();
      await db.searchIndexes.put({ key, json: serialized });
    }
  })();

  readyPromise = attempt;
  attempt.then(
    () => {
      // `recycleWorker` nulls `readyPromise` for the worker it buried, but a
      // request queued behind that worker goes on to succeed on its
      // replacement, and nothing else puts the index it built back within
      // reach. Without this, `searchAll` sees a null `readyPromise` and
      // answers every query empty for the rest of the session while
      // `useSearchState`, whose promise resolved, reports the index ready.
      //
      // All three guards are load-bearing. `stillWanted` keeps a superseded
      // attempt, which resolves having built nothing, from installing itself.
      // The null check keeps it from displacing a newer attempt already in
      // flight (a signature can return to one it has left, so `stillWanted`
      // alone would let the first, abandoned attempt back in). And the
      // generation check keeps a worker that died after answering from being
      // restored anyway: the index went with it, so pointing `searchAll` at a
      // resolved promise would send every query to a fresh, empty worker to
      // time out, which is worse than short-circuiting.
      if (stillWanted() && readyPromise === null && builtUnder === workerGeneration) {
        readyPromise = attempt;
        indexedSignature = signature;
      }
    },
    // On failure, clear state so a retry with the same signature re-attempts
    // instead of returning the already-rejected promise.
    () => {
      if (readyPromise === attempt) {
        readyPromise = null;
        indexedSignature = '';
      }
    },
  );
  return attempt;
}

/** A query with no worker response within this window resolves empty. */
const QUERY_TIMEOUT_MS = 5000;

export async function searchAll(
  q: string,
  opts: { limit?: number; sources?: SearchSourceFilter } = {},
): Promise<SearchResult> {
  if (readyPromise === null) return EMPTY_RESULT;
  // A failed index build shouldn't turn a query into an unhandled rejection.
  try {
    await readyPromise;
  } catch {
    return EMPTY_RESULT;
  }
  const id = ++queryId;
  // Supersede any in-flight queries: settle them empty so a slower, older
  // response can't win, and no resolver is left dangling.
  settlePending();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(EMPTY_RESULT);
    }, QUERY_TIMEOUT_MS);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    send({ kind: 'query', id, q, limit: opts.limit ?? 30, sources: opts.sources });
  });
}
