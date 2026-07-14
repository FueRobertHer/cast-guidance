import { db } from '@/db/db';
import { getActiveTag } from '../loader';
import type { EntityRegistry, EntityType } from '../normalize';
import type { SearchDoc, SearchWorkerRequest, SearchWorkerResponse } from './protocol';

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

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
let indexedSignature = '';
let queryId = 0;
const pending = new Map<number, (hits: SearchDoc[]) => void>();

function getWorker(): Worker {
  if (worker === null) {
    worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<SearchWorkerResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'results') {
        pending.get(msg.id)?.(msg.hits);
        pending.delete(msg.id);
      }
    };
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

/** Build (or rehydrate) the index for the given registry + cache signature. */
export function ensureSearchIndex(registry: EntityRegistry, signature: string): Promise<void> {
  if (signature === indexedSignature && readyPromise !== null) return readyPromise;
  indexedSignature = signature;
  const key = `${getActiveTag()}|official|${hashString(signature)}`;

  const attempt = (async () => {
    const w = getWorker();
    const cached = await db.searchIndexes.get(key);
    // Reject on worker error or timeout so callers (useSearchState) can show an
    // error + retry instead of an index that silently never becomes ready.
    const serialized = await new Promise<string | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        w.removeEventListener('message', onReady);
        reject(new Error('search index build timed out'));
      }, BUILD_TIMEOUT_MS);
      const onReady = (ev: MessageEvent<SearchWorkerResponse>) => {
        if (ev.data.kind === 'ready') {
          clearTimeout(timer);
          w.removeEventListener('message', onReady);
          resolve(ev.data.serialized);
        } else if (ev.data.kind === 'error') {
          clearTimeout(timer);
          w.removeEventListener('message', onReady);
          reject(new Error(ev.data.message || 'search worker failed'));
        }
      };
      w.addEventListener('message', onReady);
      send(
        cached
          ? { kind: 'load', serialized: cached.json }
          : { kind: 'build', docs: docsFrom(registry) },
      );
    });
    if (!cached && serialized !== undefined) {
      // Keep only the latest index for this tag.
      await db.searchIndexes.where('key').startsWith(`${getActiveTag()}|official|`).delete();
      await db.searchIndexes.put({ key, json: serialized });
    }
  })();

  readyPromise = attempt;
  // On failure, clear state so a retry with the same signature re-attempts
  // instead of returning the already-rejected promise.
  attempt.catch(() => {
    if (readyPromise === attempt) {
      readyPromise = null;
      indexedSignature = '';
    }
  });
  return attempt;
}

export async function searchAll(q: string, limit = 30): Promise<SearchDoc[]> {
  if (readyPromise === null) return [];
  // A failed index build shouldn't turn a query into an unhandled rejection.
  try {
    await readyPromise;
  } catch {
    return [];
  }
  return new Promise((resolve) => {
    const id = ++queryId;
    pending.set(id, resolve);
    send({ kind: 'query', id, q, limit });
  });
}
