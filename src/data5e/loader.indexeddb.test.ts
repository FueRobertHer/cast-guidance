import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every file the installer asks for comes from here, so a test can decide
// exactly which fetch fails and what the rest return.
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

import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { dataStatusStore } from '@/stores/dataStatus';
import { DATA_TAG } from './config';
import { ensureTypePacks, getActiveTag, repairTypePacks, updateToTag } from './loader';

/** A dataset complete enough to pass the installer's sanity check. */
const wholeMirror = (_tag: string, path: string): Promise<unknown> =>
  Promise.resolve(path === 'races.json' ? { race: [{ name: 'Elf' }] } : {});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  // Pin the tag the way an installed app has it. Without a pinned tag,
  // `restoreActiveTag` asks the mirror for the latest release, which is a bare
  // `fetch` this file's source mock does not intercept: a real request to
  // api.github.com from the unit suite, and a 15-second block on a network
  // that swallows it.
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  fetchFile.mockReset();
  dataStatusStore.setState({
    phase: 'idle',
    packs: {},
    filesDone: 0,
    filesTotal: 0,
    error: undefined,
    failedTag: undefined,
  });
});

describe('updateToTag failure reporting', () => {
  it('reports a failed download as an error against the tag that failed', async () => {
    fetchFile.mockRejectedValue(new Error('offline'));

    await expect(updateToTag('v2.33.0')).rejects.toThrow('offline');

    const s = dataStatusStore.getState();
    // Leaving `phase` at 'working' was the old behavior: the settings page read
    // "Download queue: working" forever and the banner showed a progress bar
    // for an install that had already given up.
    expect(s.phase).toBe('error');
    expect(s.error).toContain('offline');
    expect(s.failedTag).toBe('v2.33.0');
    // The install failed, so the old data is still the live data.
    expect(getActiveTag()).toBe(DATA_TAG);
  });

  it('reports an incompatible tag the same way, but offers no retry for it', async () => {
    await expect(updateToTag('v3.0.0')).rejects.toThrow('not compatible');
    // A version this build cannot read will never install, so a Retry button
    // for it would only repeat the same refusal.
    expect(dataStatusStore.getState()).toMatchObject({ phase: 'error', failedTag: undefined });
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('reports a dataset that arrives empty rather than installing it', async () => {
    fetchFile.mockImplementation((_tag: string, path: string) =>
      Promise.resolve(path === 'races.json' ? { race: [] } : {}),
    );

    await expect(updateToTag('v2.33.0')).rejects.toThrow('sanity check');
    expect(dataStatusStore.getState().failedTag).toBe('v2.33.0');
    expect(getActiveTag()).toBe(DATA_TAG);
  });

  it('starts each attempt from zero instead of inheriting the failed run', async () => {
    fetchFile.mockRejectedValue(new Error('offline'));
    await expect(updateToTag('v2.33.0')).rejects.toThrow();
    const afterFailure = dataStatusStore.getState().filesTotal;
    expect(afterFailure).toBeGreaterThan(0);

    await expect(updateToTag('v2.33.0')).rejects.toThrow();
    expect(dataStatusStore.getState().filesTotal).toBe(afterFailure);
  });

  it('drops a recorded failure when a later phase replaces it', async () => {
    fetchFile.mockRejectedValue(new Error('offline'));
    await expect(updateToTag('v2.33.0')).rejects.toThrow();
    expect(dataStatusStore.getState().failedTag).toBe('v2.33.0');

    // A plain download failure is not that install's failure: leaving the tag
    // behind made the banner offer to install v2.33.0 for an unrelated error.
    dataStatusStore.getState().setPhase('error', 'HTTP 502');
    expect(dataStatusStore.getState().failedTag).toBeUndefined();
  });

  // Last: a successful install moves the module's active tag, which the
  // failure cases above assert is untouched.
  it('clears the failure once the install succeeds', async () => {
    fetchFile.mockRejectedValueOnce(new Error('offline'));
    await expect(updateToTag('v2.33.0')).rejects.toThrow();
    expect(dataStatusStore.getState().failedTag).toBe('v2.33.0');

    fetchFile.mockImplementation(wholeMirror);
    await updateToTag('v2.33.0');

    expect(dataStatusStore.getState()).toMatchObject({ phase: 'done', failedTag: undefined });
    expect(getActiveTag()).toBe('v2.33.0');
    expect((await db.settings.get('dataTag'))?.value).toBe('v2.33.0');
  });
});

describe('repairTypePacks', () => {
  /** Put a wrong body in the cache under a path the repair should replace. */
  async function poison(tag: string, path: string, pack: string): Promise<void> {
    await dataCacheRepo.putFile({
      key: dataCacheRepo.key(tag, path),
      tag,
      path,
      pack,
      json: { poisoned: true },
      bytes: 10,
      fetchedAt: 1,
    });
  }

  it('replaces a cached body an ordinary retry would never fetch again', async () => {
    // The case the retry cannot reach: the file is cached, so `ensurePack`
    // finds nothing missing and returns at once, however wrong the body is.
    fetchFile.mockImplementation(wholeMirror);
    await ensureTypePacks('race');
    const tag = getActiveTag();
    await poison(tag, 'races.json', 'essentials');

    await repairTypePacks('race');

    const after = await dataCacheRepo.getFile(tag, 'races.json');
    expect((after?.json as { race: Array<{ name: string }> }).race).toEqual([{ name: 'Elf' }]);
  });

  it('repairs the dynamic packs, not just the ones named after their files', async () => {
    // `packsForType` speaks in pack ids (`spells:phb`), while a cached row
    // records the group its path belongs to (`spells`). A repair that matched
    // one vocabulary against the other left every spell and class file
    // untouched: the two biggest sections the button is offered on.
    fetchFile.mockImplementation((_tag: string, path: string) =>
      Promise.resolve(
        path === 'spells/index.json'
          ? { PHB: 'spells-phb.json' }
          : path === 'spells/spells-phb.json'
            ? { spell: [{ name: 'Fireball' }] }
            : path === 'races.json'
              ? { race: [{ name: 'Elf' }] }
              : {},
      ),
    );
    await ensureTypePacks('spell');
    const tag = getActiveTag();
    await poison(tag, 'spells/spells-phb.json', 'spells');

    await repairTypePacks('spell');

    const after = await dataCacheRepo.getFile(tag, 'spells/spells-phb.json');
    expect((after?.json as { spell: Array<{ name: string }> }).spell).toEqual([
      { name: 'Fireball' },
    ]);
  });

  it('leaves the cache alone when it cannot re-download', async () => {
    // Every type's pack list starts with `essentials`, the files the whole app
    // reads. Clearing those and then failing to fetch them, which is exactly
    // what pressing this offline used to do, left the device with nothing.
    fetchFile.mockImplementation(wholeMirror);
    await ensureTypePacks('race');
    const tag = getActiveTag();
    const before = (await dataCacheRepo.cachedPaths(tag)).size;
    expect(before).toBeGreaterThan(0);

    fetchFile.mockRejectedValue(new Error('Failed to fetch'));
    await expect(repairTypePacks('race')).rejects.toThrow('Failed to fetch');

    expect((await dataCacheRepo.cachedPaths(tag)).size).toBe(before);
    const races = await dataCacheRepo.getFile(tag, 'races.json');
    expect(races).toBeDefined();
  });

  it('leaves the cached files of another type alone', async () => {
    fetchFile.mockImplementation(wholeMirror);
    await ensureTypePacks('race');
    const tag = getActiveTag();
    await dataCacheRepo.putFile({
      key: dataCacheRepo.key(tag, 'items.json'),
      tag,
      path: 'items.json',
      pack: 'items-full',
      json: { item: [{ name: 'Keep me' }] },
      bytes: 10,
      fetchedAt: 1,
    });

    await repairTypePacks('race');

    const items = await dataCacheRepo.getFile(tag, 'items.json');
    expect((items?.json as { item: Array<{ name: string }> }).item).toEqual([{ name: 'Keep me' }]);
  });

  // Last in the file: a successful install moves `activeTag`, and the module
  // memoizes tag resolution, so nothing after it would see the pinned tag.
  it('cannot write the old release over the one an install just staged', async () => {
    // `activeTag` is module state an install moves. A repair that started
    // before the install and lands after it must not put the old release's
    // body under the new tag's key: that is straight over what the installer
    // staged and sanity-checked, and nothing downstream would ever know.
    let release = (_json: unknown): void => undefined;
    const held = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    let holdTheRepair = false;
    fetchFile.mockImplementation((tag: string, path: string) => {
      if (holdTheRepair && tag === DATA_TAG && path === 'races.json') return held;
      if (path === 'races.json') {
        return Promise.resolve({ race: [{ name: tag === DATA_TAG ? 'OLD-Elf' : 'NEW-Elf' }] });
      }
      return Promise.resolve({});
    });
    await ensureTypePacks('race');

    holdTheRepair = true;
    const repairing = repairTypePacks('race');
    await updateToTag('v2.33.0');
    expect(getActiveTag()).toBe('v2.33.0');
    const staged = await dataCacheRepo.getFile('v2.33.0', 'races.json');
    expect((staged?.json as { race: Array<{ name: string }> }).race).toEqual([{ name: 'NEW-Elf' }]);

    release({ race: [{ name: 'OLD-Elf' }] });
    await repairing;

    const after = await dataCacheRepo.getFile('v2.33.0', 'races.json');
    expect((after?.json as { race: Array<{ name: string }> }).race).toEqual([{ name: 'NEW-Elf' }]);
  });
});
