import 'fake-indexeddb/auto';
// What "is there an update?" costs. The answer used to arrive at the very end
// of boot: the check was hung off the tail of the background download queue,
// so it waited for the whole compendium to finish arriving and never ran at
// all if one pack failed on the way. These tests hold the queue open, or break
// it, and expect the answer anyway.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchFile } = vi.hoisted(() => ({ fetchFile: vi.fn() }));
vi.mock('./source', () => ({
  GithubTagSource: class {
    readonly tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    fetchFile(path: string): Promise<unknown> {
      return fetchFile(this.tag, path) as Promise<unknown>;
    }
  },
}));

// A deadline the suite can afford to wait out, with room on both sides: a
// prompt list must beat it even on a loaded runner (at 20 ms a fresh install
// sometimes fell back to the pinned release), and a slow one must miss it. And
// a landing window it never reaches, so every flush a test sees is one the
// loader asked for.
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  BOOT_TAG_RESOLVE_TIMEOUT_MS: 500,
  LANDING_FLUSH_MS: 60_000,
}));
/** How long a "slow" release list takes: well past the mocked deadline. */
const SLOW_LIST_MS = 2_000;

import { QUOTA_GUIDANCE } from '@/lib/storageErrors';
import { validMirror } from '../../tests-fixtures/dataMirror';
import { injectIdbFault, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { DATA_TAG, MAX_TAG_LIST_BYTES, TAG_LIST_TTL_MS } from './config';
import { ESSENTIALS_FILES } from './packs';

const VALID_ESSENTIALS = ESSENTIALS_FILES.length;

// IndexedDB under fake-indexeddb is slow on a loaded runner: the default
// one-second wait was enough locally and flaked in CI under the coverage gate.
// Ten seconds also covers the slow release list below, and stays well inside
// the 15 second test timeout, so a real hang still fails.
const WAIT = { timeout: 10_000 };

/** Every release list request the loader makes. */
const tagsFetch = vi.fn();

/**
 * A `fetch` answer shaped like GitHub's tag listing. A real `Response`, since
 * the loader reads it through a byte-bounded stream, and so a new one per
 * request: a body can only be read once.
 */
const tagList = (...names: string[]) =>
  new Response(JSON.stringify(names.map((name) => ({ name }))));

/** Answer every release list request with a fresh listing of `names`. */
const serveTags = (...names: string[]) =>
  tagsFetch.mockImplementation(() => Promise.resolve(tagList(...names)));

/** A mirror complete enough to boot and install against, with one class and one spell pack. */
const wholeMirror = validMirror();

/** The database the last `reboot` opened, closed by the next one. */
let previousDb: { close(): void } | undefined;

/**
 * A loader with no memory of the last test. Tag resolution, the release list
 * and the "already started" latch are all module state that boot sets once, so
 * every test needs its own copy of the module graph, and the database and
 * status store it closed over rather than the ones this file imported.
 */
async function reboot() {
  // The app being relaunched: the last one's connection goes with it. Left
  // open, a loader still writing from the last test (a failed pack's
  // siblings are mid-download) lands rows after this test's `boot` has
  // cleared the tables, so this test starts with files it never fetched and
  // counts its writes wrong. Closed with auto-open off, those writes reject.
  previousDb?.close();
  vi.resetModules();
  const [{ db }, { dataCacheRepo }, { dataStatusStore }, loader, landing] = await Promise.all([
    import('@/db/db'),
    import('@/db/dataCacheRepo'),
    import('@/stores/dataStatus'),
    import('./loader'),
    import('./landing'),
  ]);
  previousDb = db;
  return { db, dataCacheRepo, dataStatusStore, loader, landing };
}

/** A fresh loader over an empty device. */
async function boot(settings: Array<{ key: string; value: unknown }> = []) {
  const started = await reboot();
  await Promise.all(started.db.tables.map((t) => t.clear()));
  for (const row of settings) await started.db.settings.put(row);
  return started;
}

beforeEach(() => {
  fetchFile.mockReset();
  fetchFile.mockImplementation(wholeMirror);
  tagsFetch.mockReset();
  serveTags('v2.33.0', DATA_TAG);
  vi.stubGlobal('fetch', tagsFetch);
  // Node has no `requestIdleCallback`, so the background queue would fall back
  // to a quarter-second timer per pack and every drain here would outlast its
  // own assertions. This is a browser's behavior on an idle main thread: the
  // callback runs, just not in this task.
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 0));
});

describe('the release list', () => {
  it('answers from the remembered list instead of asking again', async () => {
    const { loader } = await boot([
      { key: 'dataTag', value: DATA_TAG },
      { key: 'dataTagList', value: { tags: ['v2.33.0', DATA_TAG], checkedAt: Date.now() } },
    ]);

    await expect(loader.listAvailableTags()).resolves.toEqual(['v2.33.0', DATA_TAG]);
    // The point of remembering it: releases are weeks apart, so a boot inside
    // the window can have its answer out of IndexedDB and prompt immediately.
    expect(tagsFetch).not.toHaveBeenCalled();
  });

  it('asks again once the remembered list is old', async () => {
    const { db, loader } = await boot([
      { key: 'dataTag', value: DATA_TAG },
      {
        key: 'dataTagList',
        value: { tags: ['v2.32.0'], checkedAt: Date.now() - TAG_LIST_TTL_MS - 1 },
      },
    ]);

    await expect(loader.listAvailableTags()).resolves.toEqual(['v2.33.0', DATA_TAG]);
    expect(tagsFetch).toHaveBeenCalledOnce();
    const stored = (await db.settings.get('dataTagList'))?.value as { tags: string[] };
    expect(stored.tags).toEqual(['v2.33.0', DATA_TAG]);
  });

  it('asks again when someone presses the button, however fresh the list is', async () => {
    const { loader } = await boot([
      { key: 'dataTag', value: DATA_TAG },
      { key: 'dataTagList', value: { tags: ['v2.32.0'], checkedAt: Date.now() } },
    ]);

    // Someone who asked to check now is owed a live answer, not this morning's.
    await expect(loader.listAvailableTags({ maxAgeMs: 0 })).resolves.toEqual(['v2.33.0', DATA_TAG]);
    expect(tagsFetch).toHaveBeenCalledOnce();
  });

  it('filters a remembered list to what this build can still install', async () => {
    // Written by an older build against a newer schema major: the list outlives
    // the app version that fetched it, so the filter has to run on the way out
    // as well as on the way in.
    const { loader } = await boot([
      { key: 'dataTag', value: DATA_TAG },
      { key: 'dataTagList', value: { tags: ['v3.0.0', 'v2.33.0'], checkedAt: Date.now() } },
    ]);

    await expect(loader.listAvailableTags()).resolves.toEqual(['v2.33.0']);
    expect(tagsFetch).not.toHaveBeenCalled();
  });
});

describe('the boot-time update check', () => {
  it('answers before the download queue has finished', async () => {
    // The class pack never arrives, so the queue cannot drain: if the check
    // still rode on the tail of it, nothing would ever be announced.
    fetchFile.mockImplementation((tag: string, path: string) =>
      path === 'class/class-fighter.json' ? new Promise(() => undefined) : wholeMirror(tag, path),
    );
    const { dataStatusStore, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    void loader.initDataLayer();

    await vi.waitFor(
      () => expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'),
      WAIT,
    );
    expect(dataStatusStore.getState().phase).toBe('working');
  });

  it('answers even when a pack fails on the way', async () => {
    fetchFile.mockImplementation((tag: string, path: string) =>
      path === 'class/class-fighter.json'
        ? Promise.reject(new Error('offline'))
        : wholeMirror(tag, path),
    );
    const { dataStatusStore, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    void loader.initDataLayer();

    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('error'), WAIT);
    // A download that failed says nothing about whether a newer release exists.
    await vi.waitFor(
      () => expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'),
      WAIT,
    );
  });

  it('asks once on a fresh install and serves the check from the same answer', async () => {
    const { db, dataStatusStore, loader } = await boot();

    void loader.initDataLayer();

    // A fresh install takes the newest release there is, so there is nothing to
    // prompt about, and the check reads the list resolution just wrote rather
    // than asking for it again.
    await vi.waitFor(() => expect(loader.getActiveTag()).toBe('v2.33.0'), WAIT);
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'), WAIT);
    expect(tagsFetch).toHaveBeenCalledOnce();
    expect(dataStatusStore.getState().updateAvailableTag).toBeUndefined();
    expect((await db.settings.get('dataTag'))?.value).toBe('v2.33.0');
  });

  it('does not re-read the whole cache once per pack on a warm boot', async () => {
    const first = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    await first.loader.initDataLayer();
    await vi.waitFor(() => expect(first.dataStatusStore.getState().phase).toBe('done'), WAIT);
    fetchFile.mockClear();

    // Same device, second launch: everything is already on disk.
    const { dataCacheRepo, dataStatusStore, loader } = await reboot();
    const scan = vi.spyOn(dataCacheRepo, 'cachedPaths');
    await loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'), WAIT);

    expect(fetchFile).not.toHaveBeenCalled();
    // Working out what a pack is missing means scanning the cache's keys, and
    // the queue asked that of every pack: forty-odd scans of the whole
    // compendium, on a launch with nothing left to download. One now, for
    // essentials. The queue's own shared snapshot is taken only once it knows
    // it has something to drain, which here it does not.
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it('pins the release it settled on when the list arrives too late', async () => {
    // The deadline path used to pin nothing at all. The boot downloaded the
    // whole compendium under the fallback, and the next launch, finding nothing
    // pinned, resolved to the newer release and downloaded all of it again,
    // sweeping the first copy away as a stale tag. Silently, too: the release
    // the user had just been offered, and could have declined, installed itself.
    tagsFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(tagList('v2.33.0', DATA_TAG)), SLOW_LIST_MS),
        ),
    );
    const first = await boot();
    await first.loader.initDataLayer();
    await vi.waitFor(() => expect(first.dataStatusStore.getState().phase).toBe('done'), WAIT);
    expect((await first.db.settings.get('dataTag'))?.value).toBe(DATA_TAG);
    // The list landed and was remembered, so the next launch has it for free.
    await vi.waitFor(
      () => expect(first.dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'),
      WAIT,
    );
    fetchFile.mockClear();

    const { dataStatusStore, loader } = await reboot();
    await loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'), WAIT);

    // Still on the release it installed, and still only offering the other one.
    expect(loader.getActiveTag()).toBe(DATA_TAG);
    expect(fetchFile).not.toHaveBeenCalled();
    expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0');
  });

  it('treats a remembered list with nothing installable in it as no answer', async () => {
    // The case the compatibility filter exists for: a list written by the
    // previous app build, against a schema major this one cannot read. Filtering
    // it to empty and calling that the answer suppressed the request that would
    // have found the tags this build can install.
    const { loader } = await boot([
      { key: 'dataTag', value: DATA_TAG },
      { key: 'dataTagList', value: { tags: ['v3.0.0', 'v4.1.0'], checkedAt: Date.now() } },
    ]);

    await expect(loader.listAvailableTags()).resolves.toEqual(['v2.33.0', DATA_TAG]);
    expect(tagsFetch).toHaveBeenCalledOnce();
  });

  it('refuses a release list far larger than one could be, unparsed', async () => {
    tagsFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([{ name: 'x'.repeat(MAX_TAG_LIST_BYTES) }]))),
    );
    const { db, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    await expect(loader.listAvailableTags({ maxAgeMs: 0 })).rejects.toThrow(/byte limit/);
    expect(await db.settings.get('dataTagList')).toBeUndefined();
  });

  it('does not remember an answer with nothing installable in it', async () => {
    // A mirror carrying only releases this build cannot read, or a captive
    // portal answering 200 with something else entirely, would otherwise own
    // the next six hours of checks.
    serveTags('v3.0.0');
    const { db, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    await expect(loader.listAvailableTags()).resolves.toEqual([]);
    expect(await db.settings.get('dataTagList')).toBeUndefined();

    serveTags('v2.33.0', DATA_TAG);
    await expect(loader.listAvailableTags()).resolves.toEqual(['v2.33.0', DATA_TAG]);
  });

  it('stops offering a release once it is installed', async () => {
    const { dataStatusStore, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    void loader.initDataLayer();
    await vi.waitFor(
      () => expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'),
      WAIT,
    );

    await loader.updateToTag('v2.33.0');

    // Only the toast's own button used to clear this, so installing from the
    // settings picker left the toast advertising the version now live.
    expect(dataStatusStore.getState().updateAvailableTag).toBeUndefined();
  });

  it('cannot write a file fetched under the old release under the new one', async () => {
    // Reachable now that the offer can be taken while the queue is still
    // fetching: the write used to read the active tag after its own round trip,
    // so a file in flight when an install swapped tags landed under the new
    // tag's key, over the body the installer had staged and sanity-checked.
    let release = (_json: unknown): void => undefined;
    const held = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    fetchFile.mockImplementation((tag: string, path: string) =>
      path === 'items.json'
        ? tag === DATA_TAG
          ? held
          : Promise.resolve({ item: [{ name: 'NEW' }] })
        : wholeMirror(tag, path),
    );
    const { db, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    const inFlight = loader.getFile('items.json');
    await loader.updateToTag('v2.33.0');
    expect(loader.getActiveTag()).toBe('v2.33.0');

    release({ item: [{ name: 'OLD' }] });
    await expect(inFlight).resolves.toEqual({ item: [{ name: 'OLD' }] });

    const staged = await db.dataFiles.get(`v2.33.0:items.json`);
    expect((staged?.json as { item: Array<{ name: string }> }).item).toEqual([{ name: 'NEW' }]);
  });

  it('does not let a slow release list hold up a fresh install', async () => {
    // Reachable, just not quickly. Every data read is gated behind tag
    // resolution, so waiting this out leaves the app with nothing on screen.
    tagsFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(tagList('v2.33.0', DATA_TAG)), SLOW_LIST_MS),
        ),
    );
    const { db, dataStatusStore, loader } = await boot();

    void loader.initDataLayer();

    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'), WAIT);
    // Installed the pin rather than waiting, and downloaded under it.
    expect(loader.getActiveTag()).toBe(DATA_TAG);
    expect(await db.dataFiles.get(`${DATA_TAG}:races.json`)).toBeDefined();
    // The list still lands, and the release it names is still offered: the
    // request the deadline gave up on is the same one the check is waiting for.
    await vi.waitFor(
      () => expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'),
      WAIT,
    );
    expect(tagsFetch).toHaveBeenCalledOnce();
  });
});

describe('telling the registry what landed (DATA-003)', () => {
  it('hands over what a boot downloaded by the time it reports done, in a few batches', async () => {
    const { dataStatusStore, landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    const bumps = vi.fn();
    landing.subscribeRevision(bumps);
    // Read at the moment the phase moves, which is when the pages showing
    // "still downloading" stop saying so.
    let revisionAtDone = -1;
    dataStatusStore.subscribe((s, prev) => {
      if (s.phase === 'done' && prev.phase !== 'done') revisionAtDone = landing.getRevision();
    });

    void loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'), WAIT);

    // Every file the drain wrote, with the timer nowhere near firing.
    expect(landing.getLandedCount()).toBeGreaterThan(10);
    expect(revisionAtDone).toBe(landing.getLandedCount());
    // Essentials, then the end of the drain: not one per file.
    expect(bumps.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('hands over essentials as soon as they are in, while the drain goes on', async () => {
    // The first screen is waiting on essentials. The class pack never
    // arrives, so the drain cannot finish and only the essentials flush can
    // hand them over before the landing window would.
    fetchFile.mockImplementation((tag: string, path: string) =>
      path === 'class/class-fighter.json' ? new Promise(() => undefined) : wholeMirror(tag, path),
    );
    const { dataStatusStore, landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    void loader.initDataLayer();

    await vi.waitFor(() => expect(landing.getRevision()).toBe(VALID_ESSENTIALS), WAIT);
    expect(dataStatusStore.getState().phase).toBe('working');
  });

  it('hands over the essentials that did land when the rest of them failed', async () => {
    const { dataStatusStore, landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    // One essentials file fails, but only once every other one has landed, so
    // there is something on disk for the failure to strand.
    let othersIn = (): void => undefined;
    const allOthers = new Promise<void>((resolve) => {
      othersIn = resolve;
    });
    landing.subscribeLanded(() => {
      if (landing.getLandedCount() === VALID_ESSENTIALS - 1) othersIn();
    });
    fetchFile.mockImplementation((tag: string, path: string) =>
      path === 'feats.json'
        ? allOthers.then(() => Promise.reject(new Error('offline')))
        : wholeMirror(tag, path),
    );

    void loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('error'), WAIT);

    expect(landing.getRevision()).toBe(VALID_ESSENTIALS - 1);
  });

  it('hands over what landed before a drain failed', async () => {
    fetchFile.mockImplementation((tag: string, path: string) =>
      path === 'spells/spells-phb.json'
        ? Promise.reject(new Error('offline'))
        : wholeMirror(tag, path),
    );
    const { dataStatusStore, landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    void loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('error'), WAIT);

    // The class and item packs landed after essentials were handed over, and
    // before the spell pack failed: the error must not strand them.
    expect(landing.getLandedCount()).toBeGreaterThan(VALID_ESSENTIALS);
    expect(landing.getRevision()).toBe(landing.getLandedCount());
  });

  it('hands over the files of a type before telling the page they are in', async () => {
    const { landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    await loader.ensureTypePacks('spell');

    expect(landing.getLandedCount()).toBeGreaterThan(0);
    expect(landing.getRevision()).toBe(landing.getLandedCount());
  });

  it('hands over what did land for a type whose download failed', async () => {
    fetchFile.mockImplementation((tag: string, path: string) =>
      path.startsWith('spells/spells-')
        ? Promise.reject(new Error('offline'))
        : wholeMirror(tag, path),
    );
    const { landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    await expect(loader.ensureTypePacks('spell')).rejects.toThrow('offline');

    // Essentials made it, and the page that asked is about to show the error
    // over whatever the registry has: it should have those.
    expect(landing.getLandedCount()).toBeGreaterThan(0);
    expect(landing.getRevision()).toBe(landing.getLandedCount());
  });

  it('hands over a full download before it resolves', async () => {
    const { landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    await loader.downloadAllPacks();

    expect(landing.getLandedCount()).toBeGreaterThan(10);
    expect(landing.getRevision()).toBe(landing.getLandedCount());
  });

  it('hands over what landed before a full download failed', async () => {
    fetchFile.mockImplementation((tag: string, path: string) =>
      path === 'spells/spells-phb.json'
        ? Promise.reject(new Error('offline'))
        : wholeMirror(tag, path),
    );
    const { landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);

    await expect(loader.downloadAllPacks()).rejects.toThrow('offline');

    expect(landing.getLandedCount()).toBeGreaterThan(VALID_ESSENTIALS);
    expect(landing.getRevision()).toBe(landing.getLandedCount());
  });

  it('tells every consumer to read again when a release is installed', async () => {
    const { landing, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    await loader.downloadAllPacks();
    const before = landing.getRevision();

    await loader.updateToTag('v2.33.0');

    // Nothing landed in the active release (the install staged its own), and
    // the whole release changed anyway.
    expect(landing.getRevision()).toBeGreaterThan(before);
    expect(landing.getRevision()).toBe(landing.getLandedCount());
  });
});

// The banner and the settings page show `error` as stored, so a full device
// has to be put into words where the loader catches it (TEST-002). Each of the
// four places that record a failure is driven here by a real refused write.
describe('a full device while game data downloads', () => {
  afterEach(removeIdbFaults);

  it('says what to do when essentials cannot be stored at boot', async () => {
    const { db, dataStatusStore, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    const fault = await injectIdbFault(db, { tables: ['dataFiles'] });

    void loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('error'), WAIT);

    expect(fault.hits).toBeGreaterThan(0);
    expect(dataStatusStore.getState().packs.essentials).not.toBe('ready');
    expect(dataStatusStore.getState().error).toBe(QUOTA_GUIDANCE);
  });

  it('says what to do when a later pack cannot be stored in the background drain', async () => {
    const { db, dataStatusStore, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    // Essentials go in; the first file of the drain is refused. That count
    // holds only on an empty cache, so check it is one.
    expect(await db.dataFiles.count()).toBe(0);
    const fault = await injectIdbFault(db, { tables: ['dataFiles'], skip: VALID_ESSENTIALS });

    void loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('error'), WAIT);

    expect(fault.hits).toBeGreaterThan(0);
    expect(dataStatusStore.getState().packs.essentials).toBe('ready');
    expect(dataStatusStore.getState().error).toBe(QUOTA_GUIDANCE);
  });

  it('says what to do when a requested full download cannot be stored', async () => {
    const { db, dataStatusStore, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    await injectIdbFault(db, { tables: ['dataFiles'] });

    await expect(loader.downloadAllPacks()).rejects.toMatchObject({ name: 'QuotaExceededError' });

    expect(dataStatusStore.getState().error).toBe(QUOTA_GUIDANCE);
  });

  it('says what to do when a new release cannot be stored', async () => {
    const { db, dataStatusStore, loader } = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    await injectIdbFault(db, { tables: ['dataFiles'] });

    await expect(loader.updateToTag('v2.33.0')).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });

    expect(dataStatusStore.getState()).toMatchObject({
      phase: 'error',
      error: QUOTA_GUIDANCE,
      failedTag: 'v2.33.0',
    });
  });
});
