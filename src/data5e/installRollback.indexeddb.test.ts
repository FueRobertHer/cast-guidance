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
// named "Crash" makes the official build throw, and a homebrew feat named
// "Crash" makes the homebrew merge throw.
vi.mock('./normalize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./normalize')>();
  return {
    ...actual,
    normalizeDataset: (files: ReadonlyMap<string, unknown>) => {
      const races = files.get('races.json') as { race?: Array<{ name?: unknown }> } | undefined;
      if (races?.race?.some((r) => r.name === 'Crash')) throw new Error('cannot normalize');
      return actual.normalizeDataset(files);
    },
    mergeHomebrew: (...args: Parameters<typeof actual.mergeHomebrew>) => {
      for (const json of args[1].values()) {
        const feats = json.feat as Array<{ name?: unknown }> | undefined;
        if (feats?.some((f) => f.name === 'Crash')) throw new Error('cannot merge');
      }
      actual.mergeHomebrew(...args);
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
  const [{ db }, { dataCacheRepo }, { dataStatusStore }, loader, registry, landing] =
    await Promise.all([
      import('@/db/db'),
      import('@/db/dataCacheRepo'),
      import('@/stores/dataStatus'),
      import('./loader'),
      import('./registry'),
      import('./landing'),
    ]);
  return { db, dataCacheRepo, dataStatusStore, loader, registry, landing };
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

describe('phase C: validating a resumed install', () => {
  it('holds a file found already staged to the same check as a download', async () => {
    const started = await installedDevice();
    // Left by an earlier attempt or an older build: nothing re-fetches a
    // staged row, so the check on the download path alone never saw it.
    await started.db.dataFiles.put({
      key: `${NEXT}:races.json`,
      tag: NEXT,
      path: 'races.json',
      pack: 'essentials',
      json: { race: [] },
      bytes: 11,
      fetchedAt: 1,
    });

    await expect(started.loader.updateToTag(NEXT)).rejects.toThrow('failed validation');
    expect(started.loader.getActiveTag()).toBe(DATA_TAG);
    expect(await storedTag(started)).toBe(DATA_TAG);
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
    expect(await rollbackRecord(started)).toEqual({ prev: DATA_TAG, to: NEXT, starts: 0 });
    const kept = await started.dataCacheRepo.cachedPaths(DATA_TAG);
    expect(VALID_PATHS.every((p) => kept.has(p))).toBe(true);
  });

  it('does not count launches that build no registry against the release', async () => {
    // A homebrew page, or a reload on a missing route, builds no registry and
    // says nothing about the data. Counted as launches, three of them rolled
    // back a release that was working perfectly.
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);

    for (let i = 0; i < 4; i++) {
      const launch = await reboot();
      await bootToDone(launch);
      expect(launch.loader.getActiveTag()).toBe(NEXT);
    }
    expect(await rollbackRecord(started)).toEqual({ prev: DATA_TAG, to: NEXT, starts: 0 });
  });

  it('goes back after two sessions whose builds never finished, without the network', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);

    // Each session starts a build (twice, as two screens would) that never
    // gets to publish: what a release that crashes the app looks like from
    // the next launch.
    for (const starts of [1, 2]) {
      const session = await reboot();
      const read = vi
        .spyOn(session.dataCacheRepo, 'filesByTag')
        .mockReturnValue(new Promise(() => undefined));
      void session.registry.getRegistry();
      // Two screens reading the same data share one build, so the second is
      // kept from joining the first: builds that do not share (one started
      // after an invalidation, or after another file landed) must still be
      // counted as one start between them.
      session.registry.invalidateRegistry();
      void session.registry.getRegistry();
      // Both builds are past the count and stuck reading, so the record now
      // says everything this session will ever say: one start, not two.
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(await rollbackRecord(session)).toEqual({ prev: DATA_TAG, to: NEXT, starts });
      expect(session.loader.getActiveTag()).toBe(NEXT);
    }
    fetchFile.mockReset();
    fetchFile.mockRejectedValue(new Error('offline'));

    const third = await reboot();
    // The caller gets the release the app went back to.
    const reg = await third.registry.getRegistry();
    expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${DATA_TAG}`]);
    expect(third.loader.getActiveTag()).toBe(DATA_TAG);
    expect(await storedTag(third)).toBe(DATA_TAG);
    expect(await rollbackRecord(third)).toBeUndefined();
    expect(third.dataStatusStore.getState().rolledBackFrom).toBe(NEXT);
    await bootToDone(third);
    expect(fetchFile).not.toHaveBeenCalled();
    // Reported as what it is, not as a failure: the app is working.
    expect(third.dataStatusStore.getState()).toMatchObject({ phase: 'done', failedTag: undefined });
  });

  it('goes back before anything reads it when the new release has lost its essentials', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await started.db.dataFiles.where('tag').equals(NEXT).delete();
    fetchFile.mockReset();
    fetchFile.mockRejectedValue(new Error('offline'));

    const next = await reboot();
    // Decided inside tag resolution, so even the very first file read is the
    // old release's, and offline is no obstacle.
    await expect(next.loader.getFile('races.json')).resolves.toEqual({
      race: [{ name: `Elf ${DATA_TAG}` }],
    });
    const reg = await next.registry.getRegistry();
    expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${DATA_TAG}`]);
    expect(next.loader.getActiveTag()).toBe(DATA_TAG);
    // No "could not start" notice: it did not fail to start.
    expect(next.dataStatusStore.getState().rolledBackFrom).toBeUndefined();
    const kept = await next.dataCacheRepo.cachedPaths(DATA_TAG);
    expect(VALID_PATHS.every((p) => kept.has(p))).toBe(true);
    expect(fetchFile).not.toHaveBeenCalled();
    // Evicted is not broken: the release is not rejected, and stays on offer
    // for a download that brings its files back.
    expect(await next.db.settings.get('dataTagRejected')).toBeUndefined();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify([{ name: NEXT }, { name: DATA_TAG }]))),
      ),
    );
    await next.loader.checkForDataUpdate();
    expect(next.dataStatusStore.getState().updateAvailableTag).toBe(NEXT);
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

  it('tells every consumer to read again when it goes back', async () => {
    // Pages holding a registry (or the error) of the release just left would
    // otherwise keep it until something else happened to land.
    fetchFile.mockImplementation(
      releases({ [NEXT]: { 'races.json': { race: [{ name: 'Crash' }] } } }),
    );
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    const before = started.landing.getRevision();

    await started.registry.getRegistry();

    expect(started.loader.getActiveTag()).toBe(DATA_TAG);
    expect(started.landing.getRevision()).toBeGreaterThan(before);
    expect(started.landing.getRevision()).toBe(started.landing.getLandedCount());
  });

  it('answers every concurrent build of a release that cannot be built from the one it went back to', async () => {
    fetchFile.mockImplementation(
      releases({ [NEXT]: { 'races.json': { race: [{ name: 'Crash' }] } } }),
    );
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);

    const regs = await Promise.all([
      started.registry.getRegistry(),
      started.registry.getRegistry(),
    ]);
    for (const reg of regs) {
      expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${DATA_TAG}`]);
    }
    expect(started.loader.getActiveTag()).toBe(DATA_TAG);
  });

  /** Save an enabled homebrew file holding `json`, through the module set in use now. */
  async function addBrew(json: Record<string, unknown>): Promise<void> {
    const { homebrewRepo } = await import('@/db/homebrewRepo');
    const brew = await homebrewRepo.createEditable('Brew', 'HB');
    await homebrewRepo.saveEditable(brew.id, {
      _meta: { sources: [{ json: 'HB', abbreviation: 'HB', full: 'Brew' }] },
      ...json,
    });
  }

  it('does not go back over a homebrew file that breaks the merge, however many sessions', async () => {
    // The official release is fine; going back would not fix the brew, and
    // would cost the user the update they asked for. The start counter used
    // to finish only on a publish, which a failing merge never reached, so two
    // sessions later the healthy release was rolled back and rejected anyway.
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await addBrew({ feat: [{ name: 'Crash', source: 'HB' }] });

    for (let i = 0; i < 4; i++) {
      const session = await reboot();
      await expect(session.registry.getRegistry()).rejects.toThrow('cannot merge');
      expect(session.loader.getActiveTag()).toBe(NEXT);
      expect(session.dataStatusStore.getState().rolledBackFrom).toBeUndefined();
    }
    expect(await storedTag(started)).toBe(NEXT);
    expect(await started.db.settings.get('dataTagRejected')).toBeUndefined();
  });

  it('builds over homebrew that used to make the merge throw, session after session', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await addBrew({
      race: [
        {
          name: 'Drake',
          source: 'HB',
          // A quote in a variable broke the JSON the template is spliced into.
          _versions: [
            {
              _abstract: { name: 'Drake ({{color}})' },
              _implementations: [{ _variables: { color: 'Red "Classic"' } }],
            },
          ],
        },
      ],
      // Valid JSON that `String()` refuses with a TypeError.
      feat: [{ name: { toString: 1 }, source: 'HB', _copy: null }],
    });

    for (let i = 0; i < 3; i++) {
      const session = await reboot();
      const reg = await session.registry.getRegistry();
      expect(reg.byType('race').map((r) => r.name)).toContain('Drake (Red "Classic")');
      expect(session.loader.getActiveTag()).toBe(NEXT);
    }
    expect(await storedTag(started)).toBe(NEXT);
    expect(await started.db.settings.get('dataTagRejected')).toBeUndefined();
  });

  it('decides an exhausted release once for every build waiting on it', async () => {
    // Two screens asking at once: the second used to find the start already
    // claimed, skip the decision, and build (and confirm) the release the
    // first was in the middle of rejecting.
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await started.db.settings.put({
      key: 'dataTagRollback',
      value: { prev: DATA_TAG, to: NEXT, starts: 2 },
    });

    const next = await reboot();
    const [a, b] = await Promise.all([next.registry.getRegistry(), next.registry.getRegistry()]);

    expect(a.byType('race').map((r) => r.name)).toEqual([`Elf ${DATA_TAG}`]);
    expect(b.byType('race').map((r) => r.name)).toEqual([`Elf ${DATA_TAG}`]);
    expect(next.loader.getActiveTag()).toBe(DATA_TAG);
    expect(await storedTag(next)).toBe(DATA_TAG);
    const kept = await next.dataCacheRepo.cachedPaths(DATA_TAG);
    expect(VALID_PATHS.every((p) => kept.has(p))).toBe(true);
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
    expect(await rollbackRecord(started)).toEqual({ prev: DATA_TAG, to: AFTER, starts: 0 });
    expect((await started.dataCacheRepo.cachedPaths(NEXT)).size).toBe(0);
    expect((await started.dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(VALID_PATHS.length);
  });

  it('leaves a release another tab just installed alone when sweeping', async () => {
    // Two tabs: this one resolved the old release before the other installed
    // a new one. Sweeping by its own view alone deleted the release the other
    // tab had just installed, and the next launch booted a tag with no rows.
    const stale = await installedDevice();
    const installer = await reboot();
    await installer.loader.updateToTag(NEXT);
    // Confirmed in the installing tab, so no rollback record names NEXT.
    await installer.registry.getRegistry();
    await vi.waitFor(async () => expect(await rollbackRecord(installer)).toBeUndefined());

    // The old tab finishes its drain, which ends in a sweep.
    await bootToDone(stale);

    const kept = await stale.dataCacheRepo.cachedPaths(NEXT);
    expect(VALID_PATHS.every((p) => kept.has(p))).toBe(true);
    const next = await reboot();
    await bootToDone(next);
    expect(next.loader.getActiveTag()).toBe(NEXT);
  });
});

describe('phase F: confirming', () => {
  it('confirms on the first registry built under the new release', async () => {
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    const next = await reboot();
    await bootToDone(next);
    // A launch alone proves nothing, and counts for nothing either.
    expect(await rollbackRecord(next)).toEqual({ prev: DATA_TAG, to: NEXT, starts: 0 });

    const reg = await next.registry.getRegistry();
    expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${NEXT}`]);

    await vi.waitFor(async () => expect(await rollbackRecord(next)).toBeUndefined());
    await vi.waitFor(async () =>
      expect((await next.dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(0),
    );
    // Confirmed for good: later builds no longer count towards a rollback.
    for (let i = 0; i < 3; i++) {
      const launch = await reboot();
      await launch.registry.getRegistry();
      expect(launch.loader.getActiveTag()).toBe(NEXT);
    }
  });

  it('confirms in the session that installed, over a registry it already had', async () => {
    // Releases share their file lists, so a signature of paths alone found the
    // old release's registry still current after the swap, served it, and
    // never built the one that confirms the install.
    const started = await installedDevice();
    await started.registry.getRegistry();
    await started.loader.updateToTag(NEXT);

    const reg = await started.registry.getRegistry();
    expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${NEXT}`]);
    await vi.waitFor(async () => expect(await rollbackRecord(started)).toBeUndefined());
  });

  it('does not confirm on a registry built without the essentials', async () => {
    // A page can ask for the registry before essentials are on disk. A build
    // of nothing proves nothing, and its confirm swept the only release there
    // was to go back to.
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await started.db.dataFiles.delete(`${NEXT}:races.json`);

    // The registry waits for a confirm to be recorded before it returns, so
    // one that should not have happened has happened by now.
    await started.registry.getRegistry();

    expect(await rollbackRecord(started)).toMatchObject({ prev: DATA_TAG, to: NEXT });
    const kept = await started.dataCacheRepo.cachedPaths(DATA_TAG);
    expect(VALID_PATHS.every((p) => kept.has(p))).toBe(true);
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

describe('the registry at launch', () => {
  it('waits for tag resolution before reading the cache', async () => {
    // It reads the cache directly, not through `getFile`, so a launch whose
    // first read was the registry built whatever release the module started
    // on rather than the one installed.
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await started.registry.getRegistry();
    await vi.waitFor(async () =>
      expect((await started.dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(0),
    );

    const next = await reboot();
    const reg = await next.registry.getRegistry();
    expect(reg.byType('race').map((r) => r.name)).toEqual([`Elf ${NEXT}`]);
  });
});

describe('after a rollback', () => {
  /** A device that installed NEXT and went back from it. */
  async function rolledBack(): Promise<Started> {
    fetchFile.mockImplementation(
      releases({ [NEXT]: { 'races.json': { race: [{ name: 'Crash' }] } } }),
    );
    const started = await installedDevice();
    await started.loader.updateToTag(NEXT);
    await started.registry.getRegistry();
    expect(started.loader.getActiveTag()).toBe(DATA_TAG);
    return started;
  }

  /** Answer the release list with `names`, newest first. */
  const serveTags = (...names: string[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(names.map((name) => ({ name })))))),
    );

  it('stops offering the release it went back from', async () => {
    await rolledBack();
    serveTags(NEXT, DATA_TAG);

    const next = await reboot();
    await next.loader.checkForDataUpdate();
    expect(next.dataStatusStore.getState().updateAvailableTag).toBeUndefined();
  });

  it('offers a newer release once there is one', async () => {
    await rolledBack();
    serveTags(AFTER, NEXT, DATA_TAG);

    const next = await reboot();
    await next.loader.checkForDataUpdate();
    expect(next.dataStatusStore.getState().updateAvailableTag).toBe(AFTER);
  });

  it('keeps saying why across a reload until it is dismissed', async () => {
    await rolledBack();

    const next = await reboot();
    await bootToDone(next);
    expect(next.dataStatusStore.getState().rolledBackFrom).toBe(NEXT);
    await next.loader.dismissRollbackNotice();
    expect(next.dataStatusStore.getState().rolledBackFrom).toBeUndefined();

    const after = await reboot();
    await bootToDone(after);
    expect(after.dataStatusStore.getState().rolledBackFrom).toBeUndefined();
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
