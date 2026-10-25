import 'fake-indexeddb/auto';
// Installing a data release, phase by phase, with a crash or a fault at each
// one. The promise under test is the acceptance line of DATA-002: wherever an
// install stops, the release the device had before still boots, offline.
// `reboot()` is the crash: a fresh copy of every module over the same
// database, exactly what a reload after a killed tab sees.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VALID_PATHS, validMirror } from '../../tests-fixtures/dataMirror';

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

// A release can pass every shape check and still be one the app cannot build
// a registry from. Real normalization is lenient enough that no small fixture
// breaks it, so this stands in for whatever a future release changes: a race
// named "Crash" makes the build throw.
vi.mock('./normalize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./normalize')>();
  return {
    ...actual,
    normalizeDataset: (files: ReadonlyMap<string, unknown>) => {
      const races = files.get('races.json') as { race?: Array<{ name?: unknown }> } | undefined;
      if (races?.race?.some((r) => r.name === 'Crash')) throw new Error('cannot normalize');
      return actual.normalizeDataset(files);
    },
  };
});

import { DATA_TAG } from './config';

const NEXT = 'v2.33.0';
const AFTER = 'v2.34.0';

/**
 * A complete, valid mirror whose races are named after the tag, so a test can
 * tell which release a body came from. `perTag` overrides files per release.
 */
const releases =
  (perTag: Record<string, Record<string, unknown>> = {}) =>
  (tag: string, path: string): Promise<unknown> =>
    validMirror({ 'races.json': { race: [{ name: `Elf ${tag}` }] }, ...perTag[tag] })(tag, path);

/** Every fetch made for `tag` so far. */
const fetchesFor = (tag: string) => fetchFile.mock.calls.filter(([t]) => t === tag);

async function reboot() {
  vi.resetModules();
  const [{ db }, { dataCacheRepo }, { dataStatusStore }, loader, registry] = await Promise.all([
    import('@/db/db'),
    import('@/db/dataCacheRepo'),
    import('@/stores/dataStatus'),
    import('./loader'),
    import('./registry'),
  ]);
  return { db, dataCacheRepo, dataStatusStore, loader, registry };
}

type Started = Awaited<ReturnType<typeof reboot>>;

/** A fresh device pinned to the build's release, with all of it downloaded. */
async function installedDevice(): Promise<Started> {
  const started = await reboot();
  await Promise.all(started.db.tables.map((t) => t.clear()));
  await started.db.settings.put({ key: 'dataTag', value: DATA_TAG });
  await started.loader.downloadAllPacks();
  return started;
}

/** Boot to the end of the background drain. */
async function bootToDone(started: Started): Promise<void> {
  await started.loader.initDataLayer();
  await vi.waitFor(() => expect(started.dataStatusStore.getState().phase).toBe('done'));
}

async function rollbackRecord(started: Started): Promise<unknown> {
  return (await started.db.settings.get('dataTagRollback'))?.value;
}

async function storedTag(started: Started): Promise<unknown> {
  return (await started.db.settings.get('dataTag'))?.value;
}

beforeEach(() => {
  fetchFile.mockReset();
  fetchFile.mockImplementation(releases());
  // The update check asks GitHub for releases; an empty list is no update.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('[]'))),
  );
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 0));
});

describe('phase B: staging the download', () => {
  it('boots the release it had after a crash mid-download, and sweeps the staged rows', async () => {
    // A release still on probation, so the sweep has a rollback target to
    // keep as well as the active one, then a second install killed partway.
    const first = await installedDevice();
    await first.loader.updateToTag(NEXT);
    fetchFile.mockImplementation((tag: string, path: string) =>
      tag === AFTER && path === 'spells/spells-phb.json'
        ? new Promise(() => undefined)
        : releases()(tag, path),
    );
    void first.loader.updateToTag(AFTER);
    await vi.waitFor(() =>
      expect(fetchesFor(AFTER).some(([, p]) => p === 'spells/spells-phb.json')).toBe(true),
    );
    expect((await first.dataCacheRepo.cachedPaths(AFTER)).size).toBeGreaterThan(0);
    fetchFile.mockClear();

    const next = await reboot();
    await bootToDone(next);

    expect(next.loader.getActiveTag()).toBe(NEXT);
    expect(fetchesFor(NEXT)).toHaveLength(0);
    expect((await next.dataCacheRepo.cachedPaths(AFTER)).size).toBe(0);
    // The release a rollback would need survives the sweep.
    const kept = await next.dataCacheRepo.cachedPaths(DATA_TAG);
    expect(VALID_PATHS.every((p) => kept.has(p))).toBe(true);
  });
});

describe('phase C: validating what was staged', () => {
  it('refuses to swap when a staged file never reached the disk', async () => {
    const started = await installedDevice();
    // A write that reports success and stores nothing: the per-file loop
    // believes the release is staged; only the check against the cache knows.
    const put = started.dataCacheRepo.putFile.bind(started.dataCacheRepo);
    vi.spyOn(started.dataCacheRepo, 'putFile').mockImplementation((row) =>
      row.tag === NEXT && row.path === 'books.json' ? Promise.resolve() : put(row),
    );

    await expect(started.loader.updateToTag(NEXT)).rejects.toThrow('release is incomplete');
    expect(started.loader.getActiveTag()).toBe(DATA_TAG);
    expect(await storedTag(started)).toBe(DATA_TAG);
    expect(await rollbackRecord(started)).toBeUndefined();
  });
});

describe('phase D: the swap', () => {
  it('commits the tag and its bookkeeping together or not at all', async () => {
    const started = await installedDevice();
    vi.spyOn(started.db.dataMeta, 'put').mockRejectedValueOnce(new Error('disk full'));

    await expect(started.loader.updateToTag(NEXT)).rejects.toThrow('disk full');

    // Written one after another, settings had already said NEXT by the time
    // the bookkeeping failed, and the next launch booted a release the
    // installer had given up on.
    expect(await storedTag(started)).toBe(DATA_TAG);
    expect(await rollbackRecord(started)).toBeUndefined();
    expect(started.loader.getActiveTag()).toBe(DATA_TAG);
    const next = await reboot();
    await bootToDone(next);
    expect(next.loader.getActiveTag()).toBe(DATA_TAG);
  });
});

describe('phase E: installed, not yet confirmed', () => {
  it('keeps the release it replaced, and records it as the way back', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);

    expect(started.loader.getActiveTag()).toBe(NEXT);
    expect(await rollbackRecord(started)).toEqual({ prev: DATA_TAG, to: NEXT, boots: 0 });
    const kept = await started.dataCacheRepo.cachedPaths(DATA_TAG);
    expect(VALID_PATHS.every((p) => kept.has(p))).toBe(true);
  });

  it('goes back after two launches that never built a registry, without the network', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);

    for (const boots of [1, 2]) {
      const launch = await reboot();
      await bootToDone(launch);
      expect(launch.loader.getActiveTag()).toBe(NEXT);
      expect(await rollbackRecord(launch)).toEqual({ prev: DATA_TAG, to: NEXT, boots });
    }
    fetchFile.mockReset();
    fetchFile.mockRejectedValue(new Error('offline'));

    const third = await reboot();
    // Read before anything else runs: the way back is taken inside tag
    // resolution, so even the very first file read is the old release's.
    await expect(third.loader.getFile('races.json')).resolves.toEqual({
      race: [{ name: `Elf ${DATA_TAG}` }],
    });
    expect(third.loader.getActiveTag()).toBe(DATA_TAG);
    expect(await storedTag(third)).toBe(DATA_TAG);
    expect(await rollbackRecord(third)).toBeUndefined();
    expect(third.dataStatusStore.getState().rolledBackFrom).toBe(NEXT);
    await bootToDone(third);
    expect(fetchFile).not.toHaveBeenCalled();
    // Reported as what it is, not as a failure: the app is working.
    expect(third.dataStatusStore.getState()).toMatchObject({ phase: 'done', failedTag: undefined });
  });

  it('goes back at once when the new release cannot be built', async () => {
    fetchFile.mockImplementation(
      releases({ [NEXT]: { 'races.json': { race: [{ name: 'Crash' }] } } }),
    );
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);

    // The caller is answered from the release the app went back to, rather
    // than with the error that sent it there.
    const reg = await started.registry.getRegistry();
    expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${DATA_TAG}`]);
    expect(started.loader.getActiveTag()).toBe(DATA_TAG);
    expect(await storedTag(started)).toBe(DATA_TAG);
    expect(await rollbackRecord(started)).toBeUndefined();
    expect(started.dataStatusStore.getState().rolledBackFrom).toBe(NEXT);
  });

  it('stays put when the release it would go back to is no longer whole', async () => {
    fetchFile.mockImplementation(
      releases({ [NEXT]: { 'races.json': { race: [{ name: 'Crash' }] } } }),
    );
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await started.db.dataFiles.delete(`${DATA_TAG}:races.json`);

    // Going back to a release missing its essentials trades a version that may
    // work for one that, offline, certainly will not.
    await expect(started.registry.getRegistry()).rejects.toThrow('cannot normalize');
    expect(started.loader.getActiveTag()).toBe(NEXT);
    expect(await storedTag(started)).toBe(NEXT);
    expect(started.dataStatusStore.getState().rolledBackFrom).toBeUndefined();
  });

  it('keeps the last confirmed release through a second install', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await started.loader.updateToTag(AFTER);

    // NEXT never proved itself, so DATA_TAG is still the way back, and NEXT is
    // the one swept.
    expect(await rollbackRecord(started)).toEqual({ prev: DATA_TAG, to: AFTER, boots: 0 });
    expect((await started.dataCacheRepo.cachedPaths(NEXT)).size).toBe(0);
    expect((await started.dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(VALID_PATHS.length);
  });
});

describe('phase F: confirming', () => {
  it('confirms on the first registry built under the new release', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    const next = await reboot();
    await bootToDone(next);
    // A launch alone proves nothing: it is counted, not confirmed.
    expect(await rollbackRecord(next)).toEqual({ prev: DATA_TAG, to: NEXT, boots: 1 });

    const reg = await next.registry.getRegistry();
    expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${NEXT}`]);

    await vi.waitFor(async () => expect(await rollbackRecord(next)).toBeUndefined());
    await vi.waitFor(async () =>
      expect((await next.dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(0),
    );
    // Confirmed for good: later launches no longer count towards a rollback.
    for (let i = 0; i < 3; i++) {
      const launch = await reboot();
      await bootToDone(launch);
      expect(launch.loader.getActiveTag()).toBe(NEXT);
    }
  });

  it('sweeps the old release on a later launch when the confirm stopped short of it', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    // The record is gone; the sweep after it never ran.
    vi.spyOn(started.dataCacheRepo, 'deleteTagsExcept').mockRejectedValueOnce(new Error('closed'));
    await started.registry.getRegistry();
    await vi.waitFor(async () => expect(await rollbackRecord(started)).toBeUndefined());
    expect((await started.dataCacheRepo.cachedPaths(DATA_TAG)).size).toBeGreaterThan(0);

    const next = await reboot();
    await bootToDone(next);
    await vi.waitFor(async () =>
      expect((await next.dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(0),
    );
    expect(next.loader.getActiveTag()).toBe(NEXT);
  });
});

describe('the fetch gate', () => {
  it('queues an install behind the fetches already holding the gate', async () => {
    const held: Array<() => void> = [];
    const HELD = ['items.json', 'magicvariants.json', 'variantrules.json', 'books.json'];
    fetchFile.mockImplementation((tag: string, path: string) =>
      tag === DATA_TAG && HELD.includes(path)
        ? new Promise((resolve) => held.push(() => resolve(releases()(tag, path))))
        : releases()(tag, path),
    );
    const started = await reboot();
    await Promise.all(started.db.tables.map((t) => t.clear()));
    await started.db.settings.put({ key: 'dataTag', value: DATA_TAG });
    const reads = HELD.map((p) => started.loader.getFile(p));
    await vi.waitFor(() => expect(held).toHaveLength(HELD.length));

    const installing = started.loader.updateToTag(NEXT);
    // Waiting on the gate's own queue, not on a guess about microtasks: once
    // the install is in it, it has provably reached the gate and stopped.
    await vi.waitFor(() => expect(started.loader.fetchesWaiting()).toBe(1));
    expect(fetchesFor(NEXT)).toHaveLength(0);

    held.shift()?.();
    await installing;
    expect(started.loader.getActiveTag()).toBe(NEXT);
    for (const release of held) release();
    await Promise.all(reads);
  });
});

describe('progress', () => {
  it('counts files an install finds already staged', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    fetchFile.mockClear();

    // Back to the release kept for rollback: every file is already on disk.
    await started.loader.updateToTag(DATA_TAG);

    expect(fetchesFor(DATA_TAG)).toHaveLength(0);
    const { filesDone, filesTotal } = started.dataStatusStore.getState();
    expect(filesTotal).toBe(VALID_PATHS.length);
    expect(filesDone).toBe(filesTotal);
  });
});

describe('reading a cached index', () => {
  it('skips entries that do not name a plain file instead of following them', async () => {
    fetchFile.mockImplementation(
      releases({
        [DATA_TAG]: {
          'class/index.json': { Fighter: 'class-fighter.json', Evil: '../x.json', Odd: 3 },
        },
      }),
    );
    const started = await reboot();
    await Promise.all(started.db.tables.map((t) => t.clear()));
    await started.db.settings.put({ key: 'dataTag', value: DATA_TAG });

    const ids = await started.loader.allPackIds();
    expect(ids.filter((p) => p.startsWith('class:'))).toEqual(['class:fighter']);
    await expect(started.loader.filesForPack('class:evil')).resolves.toEqual([]);
    await expect(started.loader.filesForPack('class:fighter')).resolves.toEqual([
      'class/class-fighter.json',
    ]);
  });
});

describe('the registry across a tag change', () => {
  it('does not leave a build of one release current once the tag has moved on', async () => {
    // The signature is the file list alone, and releases share their file
    // lists. A build that read one release and finished after the tag moved
    // (an install, or a rollback, which nobody follows with an invalidation)
    // was left current, and served as the release now live.
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    let release = (): void => undefined;
    const filesByTag = started.dataCacheRepo.filesByTag.bind(started.dataCacheRepo);
    const read = vi
      .spyOn(started.dataCacheRepo, 'filesByTag')
      .mockImplementationOnce(async (tag) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return filesByTag(tag);
      });
    const reading = started.registry.getRegistry();
    await vi.waitFor(() => expect(read).toHaveBeenCalled());

    await started.loader.updateToTag(AFTER);
    release();
    await reading;

    const now = await started.registry.getRegistry();
    expect(now.byType('race').map((r) => r.name)).toEqual([`Elf ${AFTER}`]);
  });
});
