import { dataCacheRepo } from '@/db/dataCacheRepo';
import { runWhenIdle } from '@/lib/idle';
import { dataStatusStore } from '@/stores/dataStatus';
import { DATA_TAG, FETCH_CONCURRENCY } from './config';
import {
  classPackId,
  ESSENTIALS_FILES,
  ITEMS_FULL_FILES,
  LIBRARY_EXTRAS_FILES,
  type PackId,
  spellsPackId,
} from './packs';
import { GithubTagSource } from './source';

const source = new GithubTagSource(DATA_TAG);

/** In-flight de-dupe so concurrent callers share one fetch per file. */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Get one parsed data file: IndexedDB first, network on miss (then cached).
 * This is the single entry point every other data5e module reads through.
 */
export async function getFile(path: string): Promise<unknown> {
  const cached = await dataCacheRepo.getFile(DATA_TAG, path);
  if (cached) return cached.json;

  const existing = inflight.get(path);
  if (existing) return existing;

  const promise = (async () => {
    const status = dataStatusStore.getState();
    status.fileStarted(path);
    try {
      const json = await source.fetchFile(path);
      await dataCacheRepo.putFile({
        key: dataCacheRepo.key(DATA_TAG, path),
        tag: DATA_TAG,
        path,
        pack: packOfPath(path),
        json,
        bytes: 0,
        fetchedAt: Date.now(),
      });
      return json;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, promise);
  return promise;
}

function packOfPath(path: string): string {
  if ((ESSENTIALS_FILES as string[]).includes(path)) return 'essentials';
  if ((ITEMS_FULL_FILES as string[]).includes(path)) return 'items-full';
  if ((LIBRARY_EXTRAS_FILES as string[]).includes(path)) return 'library-extras';
  if (path.startsWith('class/')) return 'class';
  if (path.startsWith('spells/')) return 'spells';
  return 'other';
}

/** Resolve the file list of a pack. Dynamic packs read their index (via cache). */
export async function filesForPack(pack: PackId): Promise<string[]> {
  if (pack === 'essentials') return [...ESSENTIALS_FILES];
  if (pack === 'items-full') return [...ITEMS_FULL_FILES];
  if (pack === 'library-extras') return [...LIBRARY_EXTRAS_FILES];
  if (pack.startsWith('class:')) {
    const index = await getFile('class/index.json');
    const key = pack.slice('class:'.length);
    if (index !== null && typeof index === 'object') {
      for (const [k, v] of Object.entries(index)) {
        if (k.toLowerCase() === key && typeof v === 'string') return [`class/${v}`];
      }
    }
    return [];
  }
  if (pack.startsWith('spells:')) {
    const index = await getFile('spells/index.json');
    const key = pack.slice('spells:'.length);
    if (index !== null && typeof index === 'object') {
      for (const [k, v] of Object.entries(index)) {
        if (k.toLowerCase() === key && typeof v === 'string') return [`spells/${v}`];
      }
    }
    return [];
  }
  return [];
}

async function fetchAll(paths: string[]): Promise<void> {
  const queue = [...paths];
  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const path = queue.shift();
      if (path === undefined) return;
      await getFile(path);
      dataStatusStore.getState().fileDone();
    }
  });
  await Promise.all(workers);
}

/** Download every missing file of a pack; marks it complete in dataMeta. */
export async function ensurePack(pack: PackId): Promise<void> {
  const status = dataStatusStore.getState();
  const all = await filesForPack(pack);
  const cached = await dataCacheRepo.cachedPaths(DATA_TAG);
  const missing = all.filter((p) => !cached.has(p));
  if (missing.length === 0) {
    await dataCacheRepo.markPackComplete(DATA_TAG, pack);
    status.setPack(pack, 'ready');
    return;
  }
  status.setPack(pack, 'downloading');
  status.addTotal(missing.length);
  await fetchAll(missing);
  await dataCacheRepo.markPackComplete(DATA_TAG, pack);
  status.setPack(pack, 'ready');
}

/** All dynamic pack ids, resolvable once essentials (the two indexes) exist. */
export async function allPackIds(): Promise<PackId[]> {
  const classIndex = await getFile('class/index.json');
  const spellsIndex = await getFile('spells/index.json');
  const classPacks = Object.keys(
    classIndex !== null && typeof classIndex === 'object' ? classIndex : {},
  ).map(classPackId);
  const spellPacks = Object.keys(
    spellsIndex !== null && typeof spellsIndex === 'object' ? spellsIndex : {},
  ).map(spellsPackId);
  return ['essentials', ...classPacks, 'items-full', ...spellPacks, 'library-extras'];
}

let backgroundStarted = false;

/**
 * Boot entry: make essentials available, then drain every remaining pack in
 * idle time so the app becomes fully offline-capable (~2.3 MB total wire).
 */
export async function initDataLayer(): Promise<void> {
  if (backgroundStarted) return;
  backgroundStarted = true;
  const status = dataStatusStore.getState();
  status.setPhase('working');
  try {
    await ensurePack('essentials');
    const packs = (await allPackIds()).filter((p) => p !== 'essentials');
    const drainNext = () => {
      const next = packs.shift();
      if (!next) {
        dataStatusStore.getState().setPhase('done');
        void navigator.storage?.persist?.().catch(() => undefined);
        return;
      }
      void ensurePack(next)
        .then(() => runWhenIdle(drainNext))
        .catch((err: unknown) => {
          dataStatusStore
            .getState()
            .setPhase('error', err instanceof Error ? err.message : String(err));
        });
    };
    runWhenIdle(drainNext);
  } catch (err) {
    status.setPhase('error', err instanceof Error ? err.message : String(err));
  }
}

/** Re-arm and restart the background queue after an error. */
export function retryDataLayer(): void {
  backgroundStarted = false;
  void initDataLayer();
}

/** Sanity/UI helper: full-file inventory of what a complete install looks like. */
export async function verifyFullOffline(): Promise<{ cached: number; total: number }> {
  const packs = await allPackIds();
  const lists = await Promise.all(packs.map((p) => filesForPack(p)));
  const all = new Set(lists.flat());
  const cached = await dataCacheRepo.cachedPaths(DATA_TAG);
  let have = 0;
  for (const p of all) if (cached.has(p)) have++;
  return { cached: have, total: all.size };
}
