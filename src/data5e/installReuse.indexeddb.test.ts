import 'fake-indexeddb/auto';
// An update downloads what the release changed and copies the rest from the
// release on the device. The promise under test: the result is the same release
// a full download would have produced, and anything uncertain about what changed
// costs bytes, never correctness.
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

import { DATA_TAG } from './config';

const NEXT = 'v2.33.0';

/** Races named after the release, so a body says which release it came from. */
const releases = (tag: string, path: string): Promise<unknown> =>
  validMirror({ 'races.json': { race: [{ name: `Elf ${tag}` }] } })(tag, path);

const fetchesFor = (tag: string) => fetchFile.mock.calls.filter(([t]) => t === tag);

/** What GitHub answers for the comparison, for every fetch that is not a release list. */
function answerComparison(answer: () => Promise<Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('/compare/') ? answer() : Promise.resolve(new Response('[]')),
    ),
  );
}

const comparison = (status: string, ...paths: string[]) =>
  Promise.resolve(
    new Response(JSON.stringify({ status, files: paths.map((p) => ({ filename: `data/${p}` })) })),
  );

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

/** A device pinned to the build's release, with all of it downloaded. */
async function installedDevice() {
  const started = await reboot();
  await Promise.all(started.db.tables.map((t) => t.clear()));
  await started.db.settings.put({ key: 'dataTag', value: DATA_TAG });
  await started.loader.downloadAllPacks();
  fetchFile.mockClear();
  return started;
}

beforeEach(() => {
  fetchFile.mockReset();
  fetchFile.mockImplementation(releases);
  answerComparison(() => comparison('ahead', 'races.json'));
});

describe('an update whose changes GitHub can list', () => {
  it('downloads only what changed, and ends up with the whole release', async () => {
    const { db, dataCacheRepo, dataStatusStore, loader } = await installedDevice();

    await loader.updateToTag(NEXT);

    expect(fetchesFor(NEXT).map(([, path]) => path)).toEqual(['races.json']);
    expect(loader.getActiveTag()).toBe(NEXT);
    expect((await db.settings.get('dataTag'))?.value).toBe(NEXT);
    const onDisk = await dataCacheRepo.cachedPaths(NEXT);
    expect([...onDisk].sort()).toEqual([...VALID_PATHS].sort());
    // The changed file is the new release's, a copied one the same as before.
    expect((await dataCacheRepo.getFile(NEXT, 'races.json'))?.json).toEqual({
      race: [{ name: `Elf ${NEXT}` }],
    });
    const copied = await dataCacheRepo.getFile(NEXT, 'feats.json');
    expect(copied?.tag).toBe(NEXT);
    expect(copied?.key).toBe(dataCacheRepo.key(NEXT, 'feats.json'));
    expect(copied?.json).toEqual((await dataCacheRepo.getFile(DATA_TAG, 'feats.json'))?.json);
    // The bar reaches full, copies included.
    const { filesDone, filesTotal } = dataStatusStore.getState();
    expect(filesDone).toBe(filesTotal);
  });

  it('builds a registry and confirms the install like any other', async () => {
    const { dataCacheRepo, loader, registry, db } = await installedDevice();

    await loader.updateToTag(NEXT);
    const built = await registry.getRegistry();

    expect(built.get('race', `Elf ${NEXT}`)).toBeDefined();
    expect(built.get('feat', 'Alert', 'PHB')).toBeDefined();
    expect((await db.settings.get('dataTagRollback'))?.value).toBeUndefined();
    await vi.waitFor(async () => expect((await dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(0));
  });

  it('keeps the old release whole until the new one is confirmed', async () => {
    const { dataCacheRepo, loader } = await installedDevice();

    await loader.updateToTag(NEXT);

    expect((await dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(VALID_PATHS.length);
    expect((await dataCacheRepo.getFile(DATA_TAG, 'races.json'))?.json).toEqual({
      race: [{ name: `Elf ${DATA_TAG}` }],
    });
  });

  it('downloads nothing when no file the app reads changed', async () => {
    answerComparison(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ahead', files: [{ filename: 'js/render.js' }] })),
      ),
    );
    const { dataCacheRepo, loader } = await installedDevice();

    await loader.updateToTag(NEXT);

    expect(fetchesFor(NEXT)).toEqual([]);
    expect(loader.getActiveTag()).toBe(NEXT);
    expect((await dataCacheRepo.cachedPaths(NEXT)).size).toBe(VALID_PATHS.length);
  });

  it('downloads a file the old release never finished fetching', async () => {
    const { db, dataCacheRepo, loader } = await installedDevice();
    await db.dataFiles.delete(dataCacheRepo.key(DATA_TAG, 'books.json'));

    await loader.updateToTag(NEXT);

    expect(
      fetchesFor(NEXT)
        .map(([, path]) => path)
        .sort(),
    ).toEqual(['books.json', 'races.json']);
    expect((await dataCacheRepo.cachedPaths(NEXT)).size).toBe(VALID_PATHS.length);
  });

  it('downloads a local copy that fails the checks rather than failing the install', async () => {
    const { db, dataCacheRepo, loader } = await installedDevice();
    await db.dataFiles.update(dataCacheRepo.key(DATA_TAG, 'feats.json'), {
      json: { nothing: 'useful' },
    });

    await loader.updateToTag(NEXT);

    expect(fetchesFor(NEXT).map(([, path]) => path)).toContain('feats.json');
    expect((await dataCacheRepo.getFile(NEXT, 'feats.json'))?.json).toEqual({
      feat: [{ name: 'Alert', source: 'PHB' }],
    });
    expect(loader.getActiveTag()).toBe(NEXT);
  });

  it('leaves the old release live and nothing staged if a changed file fails', async () => {
    fetchFile.mockImplementation((tag: string, path: string) =>
      tag === NEXT && path === 'races.json'
        ? Promise.reject(new Error('HTTP 503'))
        : releases(tag, path),
    );
    const { dataCacheRepo, dataStatusStore, loader } = await installedDevice();

    await expect(loader.updateToTag(NEXT)).rejects.toThrow('HTTP 503');

    expect(loader.getActiveTag()).toBe(DATA_TAG);
    expect((await dataCacheRepo.cachedPaths(NEXT)).size).toBe(0);
    expect((await dataCacheRepo.cachedPaths(DATA_TAG)).size).toBe(VALID_PATHS.length);
    expect(dataStatusStore.getState().failedTag).toBe(NEXT);
  });
});

describe('an update whose changes cannot be known', () => {
  it.each([
    ['GitHub refuses', () => Promise.resolve(new Response('{}', { status: 403 }))],
    ['the network fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['it is a downgrade', () => comparison('behind')],
    ['the histories split', () => comparison('diverged', 'races.json')],
    ['the list is not there', () => comparison('ahead')],
  ])('downloads the whole release when %s', async (_label, answer) => {
    answerComparison(answer);
    const { dataCacheRepo, loader } = await installedDevice();

    await loader.updateToTag(NEXT);

    expect(fetchesFor(NEXT).length).toBe(VALID_PATHS.length);
    expect(loader.getActiveTag()).toBe(NEXT);
    expect((await dataCacheRepo.getFile(NEXT, 'races.json'))?.json).toEqual({
      race: [{ name: `Elf ${NEXT}` }],
    });
  });
});
