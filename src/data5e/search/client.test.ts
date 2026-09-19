// @vitest-environment jsdom
// The search index is the one piece of app state that is both derived and
// cached: it can be rebuilt from the registry at any time, and it is stored in
// IndexedDB so that it usually isn't. That combination is what makes a bad
// cached index worth handling, rather than a failure to report: the docs are
// still there, so nothing about the user's data is lost by throwing the cache
// away and building it again.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchWorkerRequest, SearchWorkerResponse } from './protocol';

const { indexes } = vi.hoisted(() => ({
  indexes: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    where: vi.fn(),
  },
}));

vi.mock('@/db/db', () => ({ db: { searchIndexes: indexes } }));
vi.mock('../loader', () => ({ getActiveTag: () => 'tag1' }));

/** A worker whose answers the test writes, including the ones it never sends. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: SearchWorkerRequest[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent<SearchWorkerResponse>) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessageerror: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Set<(ev: Event) => void>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(msg: SearchWorkerRequest): void {
    this.posted.push(msg);
  }

  addEventListener(type: string, fn: (ev: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (ev: Event) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** What the real worker sends back. */
  reply(data: SearchWorkerResponse): void {
    const ev = new MessageEvent('message', { data });
    this.onmessage?.(ev as MessageEvent<SearchWorkerResponse>);
    for (const fn of this.listeners.get('message') ?? []) fn(ev);
  }

  /** What a worker that died sends instead: an error event, and nothing else. */
  die(message = 'failed to load worker script'): void {
    const ev = new ErrorEvent('error', { message });
    this.onerror?.(ev);
    for (const fn of this.listeners.get('error') ?? []) fn(ev);
  }

  /** The last request it was given, which is the one under test. */
  get last(): SearchWorkerRequest | undefined {
    return this.posted[this.posted.length - 1];
  }
}

const registry = { byType: () => [], get: () => undefined } as never;
const KEY = 'tag1|official|';

/** Settle the client's own awaits (the Dexie reads) without advancing timers. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Let queued microtasks run. `searchAll` awaits the ready promise before it
 * posts anything, so the query only reaches the worker a few ticks after the
 * call, and this works under fake timers where `flush` would not.
 */
async function tick(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let client: typeof import('./client');

beforeEach(async () => {
  vi.resetModules();
  vi.useRealTimers();
  FakeWorker.instances = [];
  indexes.get.mockReset().mockResolvedValue(undefined);
  indexes.put.mockReset().mockResolvedValue('k');
  indexes.delete.mockReset().mockResolvedValue(undefined);
  indexes.where.mockReset().mockReturnValue({
    startsWith: () => ({ delete: () => Promise.resolve(0) }),
  });
  vi.stubGlobal('Worker', FakeWorker);
  client = await import('./client');
});

/** Build the index from scratch and leave it ready, as a served app would be. */
async function buildReady(signature = 'sig'): Promise<FakeWorker> {
  const ready = client.ensureSearchIndex(registry, signature);
  await flush();
  const w = FakeWorker.instances[0] as FakeWorker;
  w.reply({ kind: 'ready', serialized: '{"index":1}' });
  await ready;
  return w;
}

describe('a cached index that will not decode', () => {
  it('is thrown away and built again from the registry', async () => {
    indexes.get.mockResolvedValue({ key: `${KEY}x`, json: '{truncated' });
    const ready = client.ensureSearchIndex(registry, 'sig');
    await flush();
    const w = FakeWorker.instances[0] as FakeWorker;
    expect(w.last?.kind).toBe('load');

    w.reply({ kind: 'error', phase: 'load', message: 'Unexpected end of JSON input' });
    await flush();

    // The poisoned row is gone, and the index the app needs is being built from
    // docs the registry still holds. Before this, the same row failed the same
    // way on every retry and reload, and search stayed dead until the data tag
    // moved.
    expect(indexes.delete).toHaveBeenCalledWith(expect.stringContaining(KEY));
    expect(w.last?.kind).toBe('build');

    w.reply({ kind: 'ready', serialized: '{"index":1}' });
    await expect(ready).resolves.toBeUndefined();
    expect(indexes.put).toHaveBeenCalledWith({
      key: expect.stringContaining(KEY),
      json: '{"index":1}',
    });
  });

  it('keeps the cache when the failure was the build, not the cached bytes', async () => {
    // Nothing about a failed build says the stored index is bad, and deleting
    // it would cost a working index to punish an unrelated failure.
    indexes.get.mockResolvedValue(undefined);
    const ready = client.ensureSearchIndex(registry, 'sig');
    await flush();
    const w = FakeWorker.instances[0] as FakeWorker;
    w.reply({ kind: 'error', phase: 'build', message: 'out of memory' });

    await expect(ready).rejects.toThrow('out of memory');
    expect(indexes.delete).not.toHaveBeenCalled();
  });

  it('only retries the build once, so a failing rebuild still reports', async () => {
    indexes.get.mockResolvedValue({ key: `${KEY}x`, json: '{truncated' });
    const ready = client.ensureSearchIndex(registry, 'sig');
    await flush();
    const w = FakeWorker.instances[0] as FakeWorker;
    w.reply({ kind: 'error', phase: 'load', message: 'bad json' });
    await flush();
    w.reply({ kind: 'error', phase: 'build', message: 'still broken' });

    await expect(ready).rejects.toThrow('still broken');
    expect(w.posted.map((m) => m.kind)).toEqual(['load', 'build']);
  });
});

describe('a worker that stops answering', () => {
  it('fails the build it was given rather than hanging on it', async () => {
    const ready = client.ensureSearchIndex(registry, 'sig');
    await flush();
    const w = FakeWorker.instances[0] as FakeWorker;
    w.die('Failed to fetch dynamically imported module');

    await expect(ready).rejects.toThrow('Failed to fetch dynamically imported module');
    expect(w.terminated).toBe(true);
  });

  it('is replaced on the next attempt instead of reused', async () => {
    // A dead worker never answers again, so keeping the handle turned one
    // failure into a 30-second timeout on every later build, for the session.
    const first = client.ensureSearchIndex(registry, 'sig');
    await flush();
    (FakeWorker.instances[0] as FakeWorker).die();
    await expect(first).rejects.toThrow();

    const second = client.ensureSearchIndex(registry, 'sig');
    await flush();
    expect(FakeWorker.instances).toHaveLength(2);
    const fresh = FakeWorker.instances[1] as FakeWorker;
    expect(fresh.last?.kind).toBe('build');
    fresh.reply({ kind: 'ready', serialized: '{"index":1}' });
    await expect(second).resolves.toBeUndefined();
  });

  it('settles the queries it was holding instead of leaving them dangling', async () => {
    const w = await buildReady();
    vi.useFakeTimers();
    const hits = client.searchAll('fire');
    await tick();
    w.die();
    // No timer is advanced: a result that depends on the query timeout would
    // never arrive here, which is the point.
    await expect(hits).resolves.toEqual({ hits: [], hiddenCount: 0 });
  });
});

describe('two builds asked for at once', () => {
  it('does not let the first index answer for the second signature', async () => {
    // The registry identity changes on every homebrew save, and the hook
    // rebuilds when it does. A `ready` message says nothing about which
    // request it answers, so overlapping builds used to resolve each other:
    // both callers took the first index, and the second signature's cache row
    // was written holding the first signature's index. That row decodes
    // perfectly, so nothing downstream could ever notice it was the wrong
    // corpus.
    const first = client.ensureSearchIndex(registry, 'sigA');
    // Flushed before the second is asked for, so the first is already at the
    // worker: too late to drop, which is the case serializing exists for.
    await flush();
    const w = FakeWorker.instances[0] as FakeWorker;
    expect(w.posted).toHaveLength(1);

    const second = client.ensureSearchIndex(registry, 'sigB');
    await flush();
    // The second waits rather than joining the first at the worker.
    expect(w.posted).toHaveLength(1);

    w.reply({ kind: 'ready', serialized: 'INDEX_A' });
    await first;
    await flush();

    // Only now is the second build even asked for.
    expect(w.posted).toHaveLength(2);
    w.reply({ kind: 'ready', serialized: 'INDEX_B' });
    await second;

    const stored = indexes.put.mock.calls.map(([r]) => r as { key: string; json: string });
    expect(stored.map((r) => r.json)).toEqual(['INDEX_A', 'INDEX_B']);
    // Two signatures, two keys, and neither holds the other's index.
    expect(new Set(stored.map((r) => r.key)).size).toBe(2);
  });

  it('drops a queued build that a newer signature superseded', async () => {
    // What serializing costs if every queued request is honoured. The
    // signature is the sorted list of cached paths, so a background drain
    // moves it once per file that lands: an install used to queue a full
    // corpus build per file and run every one, each walking the registry,
    // cloning the doc set to the worker and writing an index back, with search
    // staying unready until the last of them drained. Only the newest can
    // produce a row anybody reads.
    const superseded = [
      client.ensureSearchIndex(registry, 'sig1'),
      client.ensureSearchIndex(registry, 'sig2'),
      client.ensureSearchIndex(registry, 'sig3'),
    ];
    const current = client.ensureSearchIndex(registry, 'sig4');
    await flush();

    const w = FakeWorker.instances[0] as FakeWorker;
    expect(w.posted).toHaveLength(1);

    // The dropped ones settle rather than hanging: a caller still waiting on
    // one gets the same answer as waiting on the build that replaced it.
    await expect(Promise.all(superseded)).resolves.toEqual([undefined, undefined, undefined]);

    w.reply({ kind: 'ready', serialized: 'INDEX_4' });
    await current;

    // One build, one row, and it is the one the app will ask for next.
    const stored = indexes.put.mock.calls.map(([r]) => r as { key: string; json: string });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.json).toBe('INDEX_4');
  });

  it('does not drop a queued build because the worker ahead of it died', async () => {
    // A worker death is not a newer signature. Reading it as one would settle
    // the queued build with no index built and nothing to press: its caller
    // would be told the index is ready and get nothing back from every query.
    const first = client.ensureSearchIndex(registry, 'sigA');
    await flush();
    const dead = FakeWorker.instances[0] as FakeWorker;
    expect(dead.posted).toHaveLength(1);

    const second = client.ensureSearchIndex(registry, 'sigB');
    await flush();
    dead.die();
    await expect(first).rejects.toThrow();
    await flush();

    // The replacement worker is asked for the build that was waiting.
    expect(FakeWorker.instances).toHaveLength(2);
    const fresh = FakeWorker.instances[1] as FakeWorker;
    expect(fresh.last?.kind).toBe('build');

    fresh.reply({ kind: 'ready', serialized: 'INDEX_B' });
    await second;
    const stored = indexes.put.mock.calls.map(([r]) => r as { json: string });
    expect(stored.map((r) => r.json)).toEqual(['INDEX_B']);
  });

  it('does not pay for the docs of a build it is going to drop', async () => {
    // `docsFrom` walks the whole registry. A request that will be dropped
    // should not walk it, which is why the message is built after the queue
    // has confirmed the request is still the current one.
    let walks = 0;
    const counted = {
      byType: () => {
        walks++;
        return [];
      },
      get: () => undefined,
    } as never;

    client.ensureSearchIndex(counted, 'sigX');
    const current = client.ensureSearchIndex(counted, 'sigY');
    await flush();

    const w = FakeWorker.instances[0] as FakeWorker;
    expect(w.posted).toHaveLength(1);
    const walksForOneBuild = walks;

    w.reply({ kind: 'ready', serialized: 'INDEX_Y' });
    await current;

    // The walk happened once, for the build that ran.
    expect(walksForOneBuild).toBeGreaterThan(0);
    expect(walks).toBe(walksForOneBuild);
  });
});

describe('a second failure from a worker already replaced', () => {
  it('leaves the worker that replaced it alone', async () => {
    // A dying worker can report more than once (an error, then a message it
    // can no longer decode), and the handlers set up at construction outlive
    // the worker they were made for. Acting on the second report would
    // terminate the healthy replacement and leave a search box that says it is
    // ready and answers nothing.
    const first = client.ensureSearchIndex(registry, 'sigA');
    await flush();
    const dead = FakeWorker.instances[0] as FakeWorker;
    dead.die();
    await expect(first).rejects.toThrow();

    const retried = client.ensureSearchIndex(registry, 'sigA');
    await flush();
    const live = FakeWorker.instances[1] as FakeWorker;
    live.reply({ kind: 'ready', serialized: '{"index":1}' });
    await retried;

    const told = vi.fn();
    client.onSearchIndexLost(told);
    dead.die('and again');

    expect(live.terminated).toBe(false);
    expect(told).not.toHaveBeenCalled();
    const hits = client.searchAll('fire');
    await tick();
    const sent = live.last;
    expect(sent?.kind).toBe('query');
    live.reply({
      kind: 'results',
      id: sent?.kind === 'query' ? sent.id : 0,
      hits: [],
      hiddenCount: 0,
    });
    await expect(hits).resolves.toEqual({ hits: [], hiddenCount: 0 });
  });
});

describe('losing the worker', () => {
  it('tells the view, so the retry it already offers comes back', async () => {
    const w = await buildReady();
    const told = vi.fn();
    const stop = client.onSearchIndexLost(told);

    w.die();

    expect(told).toHaveBeenCalledTimes(1);
    stop();
    // A second loss reaches nobody once the view is gone.
    (FakeWorker.instances[0] as FakeWorker).die();
    expect(told).toHaveBeenCalledTimes(1);
  });
});

describe('a query the worker refuses', () => {
  it('settles empty as soon as the refusal arrives', async () => {
    const w = await buildReady();
    vi.useFakeTimers();
    const hits = client.searchAll('fire');
    await tick();
    const sent = w.last;
    expect(sent?.kind).toBe('query');

    w.reply({
      kind: 'error',
      phase: 'query',
      id: sent?.kind === 'query' ? sent.id : 0,
      message: 'cannot read record',
    });

    // With fake timers stopped, resolving at all proves it is the refusal that
    // settled this and not the five-second fallback.
    await expect(hits).resolves.toEqual({ hits: [], hiddenCount: 0 });
  });

  it('leaves the index usable for the next query', async () => {
    const w = await buildReady();
    const first = client.searchAll('fire');
    await tick();
    const sent = w.last;
    w.reply({
      kind: 'error',
      phase: 'query',
      id: sent?.kind === 'query' ? sent.id : 0,
      message: 'cannot read record',
    });
    await first;

    const second = client.searchAll('bolt');
    await tick();
    const next = w.last;
    expect(next?.kind).toBe('query');
    w.reply({
      kind: 'results',
      id: next?.kind === 'query' ? next.id : 0,
      hits: [
        {
          id: 'spell:fireball|phb',
          type: 'spell',
          uid: 'fireball|phb',
          name: 'Fireball',
          source: 'PHB',
        },
      ],
      hiddenCount: 0,
    });
    await expect(second).resolves.toEqual({
      hits: [
        {
          id: 'spell:fireball|phb',
          type: 'spell',
          uid: 'fireball|phb',
          name: 'Fireball',
          source: 'PHB',
        },
      ],
      hiddenCount: 0,
    });
  });
});
