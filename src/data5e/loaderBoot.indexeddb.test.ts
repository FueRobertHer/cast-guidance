import 'fake-indexeddb/auto';
// What "is there an update?" costs. The answer used to arrive at the very end
// of boot: the check was hung off the tail of the background download queue,
// so it waited for the whole compendium to finish arriving and never ran at
// all if one pack failed on the way. These tests hold the queue open, or break
// it, and expect the answer anyway.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// A deadline the suite can afford to wait out.
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  BOOT_TAG_RESOLVE_TIMEOUT_MS: 20,
}));

import { DATA_TAG, TAG_LIST_TTL_MS } from './config';

/** Every release list request the loader makes. */
const tagsFetch = vi.fn();

/** A `fetch` answer shaped like GitHub's tag listing. */
const tagList = (...names: string[]) => ({
  ok: true,
  json: () => Promise.resolve(names.map((name) => ({ name }))),
});

/** A mirror complete enough to boot against, with one class and one spell pack. */
const wholeMirror = (_tag: string, path: string): Promise<unknown> =>
  Promise.resolve(
    path === 'races.json'
      ? { race: [{ name: 'Elf' }] }
      : path === 'class/index.json'
        ? { Fighter: 'class-fighter.json' }
        : path === 'spells/index.json'
          ? { PHB: 'spells-phb.json' }
          : {},
  );

/**
 * A loader with no memory of the last test. Tag resolution, the release list
 * and the "already started" latch are all module state that boot sets once, so
 * every test needs its own copy of the module graph, and the database and
 * status store it closed over rather than the ones this file imported.
 */
async function reboot() {
  vi.resetModules();
  const [{ db }, { dataCacheRepo }, { dataStatusStore }, loader] = await Promise.all([
    import('@/db/db'),
    import('@/db/dataCacheRepo'),
    import('@/stores/dataStatus'),
    import('./loader'),
  ]);
  return { db, dataCacheRepo, dataStatusStore, loader };
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
  tagsFetch.mockResolvedValue(tagList('v2.33.0', DATA_TAG));
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

    await vi.waitFor(() => expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'));
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

    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('error'));
    // A download that failed says nothing about whether a newer release exists.
    await vi.waitFor(() => expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'));
  });

  it('skips the request entirely on a fresh install', async () => {
    const { dataStatusStore, loader } = await boot();

    void loader.initDataLayer();

    // A fresh install resolves to the newest release there is, so the check has
    // its answer already: one request for both, and nothing to prompt about.
    await vi.waitFor(() => expect(loader.getActiveTag()).toBe('v2.33.0'));
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'));
    expect(tagsFetch).toHaveBeenCalledOnce();
    expect(dataStatusStore.getState().updateAvailableTag).toBeUndefined();
  });

  it('does not re-read the whole cache once per pack on a warm boot', async () => {
    const first = await boot([{ key: 'dataTag', value: DATA_TAG }]);
    await first.loader.initDataLayer();
    await vi.waitFor(() => expect(first.dataStatusStore.getState().phase).toBe('done'));
    fetchFile.mockClear();

    // Same device, second launch: everything is already on disk.
    const { dataCacheRepo, dataStatusStore, loader } = await reboot();
    const scan = vi.spyOn(dataCacheRepo, 'cachedPaths');
    await loader.initDataLayer();
    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'));

    expect(fetchFile).not.toHaveBeenCalled();
    // Working out what a pack is missing means scanning the cache's keys, and
    // the queue asks that of every pack: forty-odd scans of the whole
    // compendium, on a launch with nothing left to download. Two now, one for
    // essentials and one shared by the rest of the queue.
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('does not let a slow release list hold up a fresh install', async () => {
    // Reachable, just not quickly. Every data read is gated behind tag
    // resolution, so waiting this out leaves the app with nothing on screen.
    tagsFetch.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(tagList('v2.33.0', DATA_TAG)), 200)),
    );
    const { db, dataStatusStore, loader } = await boot();

    void loader.initDataLayer();

    await vi.waitFor(() => expect(dataStatusStore.getState().phase).toBe('done'));
    // Installed the pin rather than waiting, and downloaded under it.
    expect(loader.getActiveTag()).toBe(DATA_TAG);
    expect(await db.dataFiles.get(`${DATA_TAG}:races.json`)).toBeDefined();
    // The list still lands, and the release it names is still offered: the
    // request the deadline gave up on is the same one the check is waiting for.
    await vi.waitFor(() => expect(dataStatusStore.getState().updateAvailableTag).toBe('v2.33.0'));
    expect(tagsFetch).toHaveBeenCalledOnce();
  });
});
