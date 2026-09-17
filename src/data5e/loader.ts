import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { jsonByteSize } from '@/lib/byteSize';
import { runWhenIdle } from '@/lib/idle';
import { Semaphore } from '@/lib/semaphore';
import { singleFlight } from '@/lib/singleFlight';
import { dataStatusStore } from '@/stores/dataStatus';
import { DATA_TAG, FETCH_CONCURRENCY, isCompatibleTag } from './config';
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
  if (typeof row?.value === 'string') {
    if (row.value !== activeTag) {
      activeTag = row.value;
      source = new GithubTagSource(activeTag);
    }
    return;
  }
  // No tag pinned yet (a fresh install), so grab the latest compatible
  // release instead of the build's pinned DATA_TAG. Best-effort: if the
  // mirror's tag list can't be reached (offline), fall back to the pin.
  try {
    const tags = await listAvailableTags();
    const latest = tags[0];
    if (latest !== undefined && latest !== activeTag) {
      activeTag = latest;
      source = new GithubTagSource(activeTag);
    }
  } catch {
    return;
  }
  await db.settings.put({ key: 'dataTag', value: activeTag });
}

/**
 * Gate every read behind tag resolution. Without this, anything that calls
 * `getFile` during boot races `restoreActiveTag` (which now makes a network
 * round-trip on a fresh install) and caches rows under the build's pinned
 * `DATA_TAG` before the real tag is known. Those rows are then dead weight:
 * the app re-downloads the whole compendium under the resolved tag.
 */
let tagReady: Promise<void> | undefined;

function ensureTagReady(): Promise<void> {
  tagReady ??= restoreActiveTag();
  return tagReady;
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
  await ensureTagReady();
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
        bytes: jsonByteSize(json),
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
    await ensureTagReady();
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
 * True while `updateToTag` is staging a new tag's files. Rows under that tag
 * are live work-in-progress even though it isn't `activeTag` yet, so the
 * stale-tag sweep must stand down until the swap completes.
 */
let installingTag: string | undefined;

/**
 * Drop cached files belonging to any tag that isn't the active one. Only
 * `updateToTag` used to clean up after itself, so rows stranded by an
 * interrupted update, or by a boot that resolved to a different tag than it
 * started with, sat in IndexedDB forever, roughly doubling storage use.
 */
async function pruneStaleTags(): Promise<void> {
  if (installingTag !== undefined) return;
  try {
    await dataCacheRepo.deleteOtherTags(activeTag);
  } catch {
    // Best-effort housekeeping; a failure just means we retry next boot.
  }
}

/**
 * Boot entry: make essentials available, then drain every remaining pack in
 * idle time so the app becomes fully offline-capable (~2.3 MB total wire).
 */
export async function initDataLayer(): Promise<void> {
  if (backgroundStarted) return;
  backgroundStarted = true;
  const status = dataStatusStore.getState();
  status.beginRun();
  try {
    await ensureTagReady();
    await ensurePack('essentials');
    const packs = (await allPackIds()).filter((p) => p !== 'essentials');
    const drainNext = () => {
      const next = packs.shift();
      if (!next) {
        dataStatusStore.getState().setPhase('done');
        void navigator.storage?.persist?.().catch(() => undefined);
        void pruneStaleTags();
        runWhenIdle(() => void checkForDataUpdate());
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

/**
 * Download every remaining pack now, awaited, for a user who asked for it
 * rather than waiting on idle time. The background drain gets there on its
 * own, but "on its own, eventually, unless it failed" is not something a
 * settings page can honestly report, so an explicit request gets an explicit
 * promise: it resolves when the compendium is complete and rejects with the
 * reason it is not.
 */
export async function downloadAllPacks(): Promise<void> {
  const status = dataStatusStore.getState();
  // Join a run that is already counting rather than zeroing its totals: the
  // boot drain keeps calling `fileDone()` either way, and a reset under it
  // produced "23/8" and a progress bar past its own width.
  if (dataStatusStore.getState().phase === 'working') status.setPhase('working');
  else status.beginRun();
  try {
    await ensureTagReady();
    await ensurePack('essentials');
    for (const pack of (await allPackIds()).filter((p) => p !== 'essentials')) {
      await ensurePack(pack);
    }
    status.setPhase('done');
  } catch (err) {
    status.setPhase('error', err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Every pack an entity type draws from (e.g. all spell sources). */
export async function packsForType(type: string): Promise<PackId[]> {
  if (type === 'spell') {
    return ['essentials', ...(await allPackIds()).filter((p) => p.startsWith('spells:'))];
  }
  if (type === 'class' || type === 'subclass' || type.endsWith('Feature')) {
    return ['essentials', ...(await allPackIds()).filter((p) => p.startsWith('class:'))];
  }
  if (type === 'item' || type === 'itemGroup' || type === 'magicvariant') {
    return ['essentials', 'items-full'];
  }
  if (type === 'variantrule' || type === 'book') return ['essentials', 'library-extras'];
  return ['essentials'];
}

/** Ensure every pack an entity type draws from. */
export async function ensureTypePacks(type: string): Promise<void> {
  const packs = await packsForType(type);
  await ensurePack('essentials');
  await Promise.all(packs.map((p) => ensurePack(p)));
}

/**
 * Download this type's packs again from scratch.
 *
 * For the case the ordinary retry cannot reach: the files are cached, so
 * nothing is missing and `ensurePack` returns immediately, but what is in them
 * is not what the app needs (a truncated write, a body cached from a failing
 * proxy). Dropping the files is what turns the next fetch back on.
 *
 * Forgetting the in-flight entries is the other half, and not an optimisation:
 * `ensurePack` decides what is missing when it starts, and de-dupes on the
 * pack id. A repair during the background drain, which is exactly when someone
 * is browsing, would otherwise delete the files and then join a download that
 * had already decided there was nothing to fetch, leaving the cache emptier
 * than it found it.
 */
export async function repairTypePacks(type: string): Promise<void> {
  // Before `activeTag` is read: every other entry point resolves the installed
  // tag first, and a delete aimed at the tag this session happens to start
  // with would clear files belonging to a version the app is not using.
  await ensureTagReady();
  const packs = await packsForType(type);
  await dataCacheRepo.deletePacks(activeTag, packs);
  for (const pack of packs) packInflight.delete(pack);
  await ensureTypePacks(type);
}

/**
 * Compatible tags available on the mirror (newest first, top 15). Tags of a
 * different schema major — which this build cannot parse safely — are filtered
 * out rather than offered blindly.
 */
export async function listAvailableTags(): Promise<string[]> {
  const res = await fetch('https://api.github.com/repos/5etools-mirror-3/5etools-src/tags', {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const tags = (await res.json()) as Array<{ name?: string }>;
  return tags
    .map((t) => t.name)
    .filter((n): n is string => typeof n === 'string')
    .filter((n) => isCompatibleTag(n))
    .slice(0, 15);
}

/**
 * Boot-time check: flag the store if a newer compatible release exists so
 * the UI can prompt the user to install it. Best-effort: offline or a
 * flaky mirror just means no prompt this session, not an error.
 */
export async function checkForDataUpdate(): Promise<void> {
  try {
    const tags = await listAvailableTags();
    const latest = tags[0];
    if (latest !== undefined && latest !== activeTag) {
      dataStatusStore.getState().setUpdateAvailableTag(latest);
    }
  } catch {
    // ignore: retried next boot
  }
}

/**
 * Install a different data tag: download everything under the new keyspace
 * (old data stays live until the swap), sanity-check, flip, delete old rows.
 */
export async function updateToTag(newTag: string): Promise<void> {
  const status = dataStatusStore.getState();
  if (newTag === activeTag) {
    // Already installed, by this call or another route, so the recorded
    // failure for it is over: leaving it up would show an error about a
    // version that is now the live one, behind a retry that does nothing.
    if (status.failedTag === newTag) status.setPhase('done');
    return;
  }
  const oldTag = activeTag;
  const newSource = new GithubTagSource(newTag);
  status.beginRun();

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
      bytes: jsonByteSize(json),
      fetchedAt: Date.now(),
    });
    status.fileDone();
    return json;
  };

  try {
    // Hard gate: never activate a tag this build cannot represent, even if a
    // caller passes one directly (defense in depth beyond the filtered list).
    // Inside the try so the refusal reaches the UI the same way a failed
    // download does, rather than only the caller that happened to await.
    if (!isCompatibleTag(newTag)) {
      throw new Error(
        `data version ${newTag} is not compatible with this app (expected ${DATA_TAG.replace(/\.\d+\.\d+$/, '.x')})`,
      );
    }
    // Claimed only once the tag is one we would really install: an incompatible
    // one used to take this slot and then release it in the `finally`, which
    // let the stale-tag sweep run over a concurrent install's staged rows.
    installingTag = newTag;

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
    status.setPhase('done');
  } catch (err) {
    // The old data is still live and still works; what is broken is this
    // install. Recording which tag failed is what lets the banner offer to
    // retry the install instead of re-arming the background queue, which
    // would report success while leaving the update undone. `setPhase` clears
    // the tag, so it is re-armed after, and only for a tag a retry could
    // actually install: a version this build cannot read never will.
    status.setPhase('error', err instanceof Error ? err.message : String(err));
    if (isCompatibleTag(newTag)) status.setFailedTag(newTag);
    throw err;
  } finally {
    // Whether we swapped or bailed, `activeTag` is now the one to keep, so
    // this drops the old rows on success and the half-downloaded new ones on
    // failure, instead of leaving either stranded. Only our own claim is
    // released; a concurrent install still holding the slot keeps the sweep
    // off its staged rows.
    if (installingTag === newTag) installingTag = undefined;
    await pruneStaleTags();
  }
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
