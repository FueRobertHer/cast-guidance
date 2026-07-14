import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { runWhenIdle } from '@/lib/idle';
import { Semaphore } from '@/lib/semaphore';
import { singleFlight } from '@/lib/singleFlight';
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

// The active tag can differ from the build-time pin after a user-driven data
// update; it's restored from settings at boot.
let activeTag = DATA_TAG;
let source = new GithubTagSource(activeTag);

export function getActiveTag(): string {
  return activeTag;
}

async function restoreActiveTag(): Promise<void> {
  const row = await db.settings.get('dataTag');
  if (typeof row?.value === 'string' && row.value !== activeTag) {
    activeTag = row.value;
    source = new GithubTagSource(activeTag);
  }
}

/**
 * One global gate for every network fetch (indexes, pack files, on-demand
 * reads) so total wire concurrency stays within the limit no matter how many
 * packs are being ensured in parallel. Keyed to the active tag so a
 * `getFile`/`ensurePack` batch and a background drain share the same budget.
 */
const fetchGate = new Semaphore(FETCH_CONCURRENCY);

/** In-flight de-dupe so concurrent callers share one fetch per file. */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Get one parsed data file: IndexedDB first, network on miss (then cached).
 * This is the single entry point every other data5e module reads through.
 * The cache hit path is unmetered; only real network fetches take a permit.
 */
export async function getFile(path: string): Promise<unknown> {
  const cached = await dataCacheRepo.getFile(activeTag, path);
  if (cached) return cached.json;

  return singleFlight(inflight, path, () =>
    fetchGate.run(async () => {
      const status = dataStatusStore.getState();
      status.fileStarted(path);
      const json = await source.fetchFile(path);
      await dataCacheRepo.putFile({
        key: dataCacheRepo.key(activeTag, path),
        tag: activeTag,
        path,
        pack: packOfPath(path),
        json,
        bytes: 0,
        fetchedAt: Date.now(),
      });
      return json;
    }),
  );
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
  // No local worker pool: `getFile` takes a global permit, so launching every
  // fetch at once still keeps wire concurrency within FETCH_CONCURRENCY across
  // all packs being ensured in parallel.
  await Promise.all(
    paths.map(async (path) => {
      await getFile(path);
      dataStatusStore.getState().fileDone();
    }),
  );
}

/** De-dupe concurrent `ensurePack(samePack)` so progress is counted once. */
const packInflight = new Map<PackId, Promise<void>>();

/** Download every missing file of a pack; marks it complete in dataMeta. */
export function ensurePack(pack: PackId): Promise<void> {
  return singleFlight(packInflight, pack, async () => {
    const status = dataStatusStore.getState();
    const all = await filesForPack(pack);
    const cached = await dataCacheRepo.cachedPaths(activeTag);
    const missing = all.filter((p) => !cached.has(p));
    if (missing.length === 0) {
      await dataCacheRepo.markPackComplete(activeTag, pack);
      status.setPack(pack, 'ready');
      return;
    }
    status.setPack(pack, 'downloading');
    status.addTotal(missing.length);
    await fetchAll(missing);
    await dataCacheRepo.markPackComplete(activeTag, pack);
    status.setPack(pack, 'ready');
  });
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
    await restoreActiveTag();
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

/** Ensure every pack an entity type draws from (e.g. all spell sources). */
export async function ensureTypePacks(type: string): Promise<void> {
  await ensurePack('essentials');
  if (type === 'spell') {
    const packs = (await allPackIds()).filter((p) => p.startsWith('spells:'));
    await Promise.all(packs.map((p) => ensurePack(p)));
    return;
  }
  if (type === 'class' || type === 'subclass' || type.endsWith('Feature')) {
    const packs = (await allPackIds()).filter((p) => p.startsWith('class:'));
    await Promise.all(packs.map((p) => ensurePack(p)));
    return;
  }
  if (type === 'item' || type === 'itemGroup' || type === 'magicvariant') {
    await ensurePack('items-full');
    return;
  }
  if (type === 'variantrule' || type === 'book') {
    await ensurePack('library-extras');
  }
}

/** Tags available on the mirror (newest first, top 15). */
export async function listAvailableTags(): Promise<string[]> {
  const res = await fetch('https://api.github.com/repos/5etools-mirror-3/5etools-src/tags', {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const tags = (await res.json()) as Array<{ name?: string }>;
  return tags
    .map((t) => t.name)
    .filter((n): n is string => typeof n === 'string')
    .slice(0, 15);
}

/**
 * Install a different data tag: download everything under the new keyspace
 * (old data stays live until the swap), sanity-check, flip, delete old rows.
 */
export async function updateToTag(newTag: string): Promise<void> {
  if (newTag === activeTag) return;
  const oldTag = activeTag;
  const newSource = new GithubTagSource(newTag);
  const status = dataStatusStore.getState();
  status.setPhase('working');

  const fetchNew = async (path: string): Promise<unknown> => {
    const cached = await dataCacheRepo.getFile(newTag, path);
    if (cached) return cached.json;
    status.fileStarted(path);
    const json = await newSource.fetchFile(path);
    await dataCacheRepo.putFile({
      key: dataCacheRepo.key(newTag, path),
      tag: newTag,
      path,
      pack: packOfPath(path),
      json,
      bytes: 0,
      fetchedAt: Date.now(),
    });
    status.fileDone();
    return json;
  };

  // Static packs + indexes, then everything the indexes list.
  const staticFiles = [...ESSENTIALS_FILES, ...ITEMS_FULL_FILES, ...LIBRARY_EXTRAS_FILES];
  status.addTotal(staticFiles.length);
  for (const path of staticFiles) await fetchNew(path);
  const classIndex = (await fetchNew('class/index.json')) as Record<string, unknown>;
  const spellsIndex = (await fetchNew('spells/index.json')) as Record<string, unknown>;
  const dynamic = [
    ...Object.values(classIndex ?? {}).map((f) => `class/${String(f)}`),
    ...Object.values(spellsIndex ?? {}).map((f) => `spells/${String(f)}`),
  ].filter((p) => p.endsWith('.json'));
  status.addTotal(dynamic.length);
  for (const path of dynamic) await fetchNew(path);

  // Sanity: essentials must parse into non-empty entity arrays.
  const races = (await dataCacheRepo.getFile(newTag, 'races.json'))?.json as
    | { race?: unknown[] }
    | undefined;
  if (!Array.isArray(races?.race) || races.race.length === 0) {
    throw new Error(`tag ${newTag} failed sanity check (races.json empty) — keeping ${oldTag}`);
  }

  // Atomic-enough swap: settings first, then in-memory, then cleanup.
  await db.settings.put({ key: 'dataTag', value: newTag });
  await dataCacheRepo.setMeta({
    id: 'installed',
    tag: newTag,
    completedPacks: [],
    installedAt: Date.now(),
  });
  activeTag = newTag;
  source = newSource;
  await dataCacheRepo.deleteTag(oldTag);
  status.setPhase('done');
}

/** Sanity/UI helper: full-file inventory of what a complete install looks like. */
export async function verifyFullOffline(): Promise<{ cached: number; total: number }> {
  const packs = await allPackIds();
  const lists = await Promise.all(packs.map((p) => filesForPack(p)));
  const all = new Set(lists.flat());
  const cached = await dataCacheRepo.cachedPaths(activeTag);
  let have = 0;
  for (const p of all) if (cached.has(p)) have++;
  return { cached: have, total: all.size };
}
