import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { jsonByteSize } from '@/lib/byteSize';
import { runWhenIdle } from '@/lib/idle';
import { Semaphore } from '@/lib/semaphore';
import { singleFlight } from '@/lib/singleFlight';
import { dataStatusStore } from '@/stores/dataStatus';
import {
  BOOT_TAG_RESOLVE_TIMEOUT_MS,
  DATA_TAG,
  FETCH_CONCURRENCY,
  isCompatibleTag,
  TAG_LIST_TIMEOUT_MS,
  TAG_LIST_TTL_MS,
  TAGS_API_URL,
} from './config';
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
  // release instead of the build's pinned DATA_TAG. Every data read is gated
  // behind this, so it sits in front of the first screen's content: bounded,
  // because a mirror that is merely slow (rather than unreachable) should not
  // hold the app empty. Asked live, because the answer decides what this
  // device installs: a remembered list is fine for noticing a release weeks
  // later, not for choosing the one to download now.
  const tags = await withDeadline(listAvailableTags({ maxAgeMs: 0 }), BOOT_TAG_RESOLVE_TIMEOUT_MS);
  const latest = tags?.[0];
  if (latest !== undefined && latest !== activeTag) {
    activeTag = latest;
    source = new GithubTagSource(activeTag);
  }
  // Pinned whichever way it went, the newest release or the build's own
  // fallback. Recording only the former left a boot that missed the deadline
  // with no pin at all: it downloaded the whole compendium under the fallback,
  // and the next launch, finding nothing pinned, resolved to the newer release
  // and downloaded all of it again, sweeping the first copy away as a stale
  // tag. Worse, silently: the release the user had been offered and could have
  // declined installed itself on the next open. A pin they can be prompted to
  // update is the honest record of what is on the device.
  await db.settings.put({ key: 'dataTag', value: activeTag });
}

/**
 * Resolve `promise`, or `undefined` if it takes longer than `ms` or fails.
 * The promise keeps running: its result is single-flighted and cached, so a
 * late answer is not wasted, it just misses this deadline.
 */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise.catch(() => undefined), deadline]).finally(() =>
    clearTimeout(timer),
  );
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
      // Tag and source captured together before the fetch, exactly as
      // `refetchFile` does and for the same reason: an install can flip both
      // while this is in flight, and reading them afterwards wrote one
      // release's body under another release's key, over the body the
      // installer had just staged and sanity-checked. Nothing downstream
      // would ever know. A file fetched for a tag that has since been left
      // behind is simply not written: it is the caller's answer, not cache.
      const tag = activeTag;
      const from = source;
      const json = await from.fetchFile(path);
      if (activeTag === tag) {
        await dataCacheRepo.putFile({
          key: dataCacheRepo.key(tag, path),
          tag,
          path,
          pack: packOfPath(path),
          json,
          bytes: jsonByteSize(json),
          fetchedAt: Date.now(),
        });
      }
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

/** Packs recorded complete under the active tag, or an empty set. */
async function completedPacks(): Promise<Set<string>> {
  const tag = activeTag;
  try {
    const meta = await dataCacheRepo.getMeta();
    return new Set(meta?.tag === tag ? meta.completedPacks : []);
  } catch {
    // Unreadable bookkeeping costs a re-check, never a skipped download.
    return new Set();
  }
}

/**
 * Download every missing file of a pack; marks it complete in dataMeta.
 *
 * `cached` is the caller's own view of what is already on disk. Working out
 * what a pack is missing means scanning the cache's keys, and a caller that
 * walks many packs (the boot drain, or the thirty-odd spell packs behind one
 * library screen) was paying for that scan once per pack to read the same
 * answer every time. Pack file lists are disjoint, so one snapshot taken
 * before the walk stays accurate for every pack in it.
 */
export function ensurePack(pack: PackId, cached?: Set<string>): Promise<void> {
  return singleFlight(packInflight, pack, async () => {
    await ensureTagReady();
    const status = dataStatusStore.getState();
    const all = await filesForPack(pack);
    const onDisk = cached ?? (await dataCacheRepo.cachedPaths(activeTag));
    const missing = all.filter((p) => !onDisk.has(p));
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
    // Started here rather than at the tail of the drain below. It is one small
    // request that shares no budget with the download queue, and hanging it
    // off the end meant the app could not say whether a new release existed
    // until the entire compendium had finished arriving, and never said so at
    // all if one pack failed on the way. Not awaited: nothing here needs the
    // answer, and the toast appears whenever it lands.
    void checkForDataUpdate();
    await ensurePack('essentials');
    const done = await completedPacks();
    const packs = (await allPackIds()).filter((p) => p !== 'essentials' && !done.has(p));
    const finish = () => {
      dataStatusStore.getState().setPhase('done');
      void navigator.storage?.persist?.().catch(() => undefined);
      void pruneStaleTags();
    };
    // A warm boot has nothing left to drain, and used to spend an idle
    // callback per pack discovering that one pack at a time before it would
    // admit it was done.
    if (packs.length === 0) {
      finish();
      return;
    }
    // One key scan shared by the whole drain, taken after essentials so it
    // includes what that just fetched, and after the check above so a launch
    // with nothing to download does not scan the compendium for no reader.
    const onDisk = await dataCacheRepo.cachedPaths(activeTag);
    const drainNext = () => {
      const next = packs.shift();
      if (!next) {
        finish();
        return;
      }
      void ensurePack(next, onDisk)
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
  // Essentials first and alone: the dynamic pack lists are read out of the
  // indexes it carries, so the rest cannot be resolved until it is here.
  await ensurePack('essentials');
  const packs = (await packsForType(type)).filter((p) => p !== 'essentials');
  // Taken after essentials, so it sees what that just fetched, and shared by
  // the fan-out below: a spell screen ensures every spell pack there is, and
  // each of those used to scan the cache's keys for itself.
  const onDisk = await dataCacheRepo.cachedPaths(activeTag);
  await Promise.all(packs.map((p) => ensurePack(p, onDisk)));
}

/** Fetch one file again and overwrite what is cached, cache hit or not. */
async function refetchFile(path: string): Promise<void> {
  // The tag and its source are captured together, before the fetch, so the
  // body written always matches the row it is written into however long the
  // fetch takes. The check after it is about a tag that has been left behind:
  // `updateToTag` sweeps the old tag's rows once it has swapped, and a late
  // repair would otherwise put one back, stranded under a version nothing
  // reads until the next boot cleans it up again.
  const tag = activeTag;
  const from = source;
  const json = await fetchGate.run(() => from.fetchFile(path));
  if (activeTag !== tag) return;
  await dataCacheRepo.putFile({
    key: dataCacheRepo.key(tag, path),
    tag,
    path,
    pack: packOfPath(path),
    json,
    bytes: jsonByteSize(json),
    fetchedAt: Date.now(),
  });
}

/**
 * Download this type's files again and overwrite them.
 *
 * For the case the ordinary retry cannot reach: `ensurePack` decides what to
 * fetch from what is missing, so a file that is cached is never fetched again
 * however wrong its contents are (a truncated write, a body cached from a
 * failing proxy). This asks for every file regardless.
 *
 * It overwrites rather than clearing first, which matters more than it sounds:
 * every type's pack list starts with `essentials`, the thirteen files the
 * whole app reads. Deleting those and then failing to re-download them, which
 * is precisely what happens if the repair is pressed offline, would leave the
 * device with nothing at all. Nothing is removed here, so a repair that cannot
 * reach the network leaves the app exactly as it found it.
 *
 * Essentials goes first because it holds the indexes the other pack lists are
 * read from: a corrupt index would otherwise get to decide what a repair is
 * allowed to repair.
 */
export async function repairTypePacks(type: string): Promise<void> {
  // Before `activeTag` is read, so the rows are written under the installed
  // tag rather than whichever one this session happened to start with.
  await ensureTagReady();
  // Deliberately not reported through `dataStatusStore`: those counters belong
  // to the background queue, and a run in progress resets them. Borrowing them
  // made the shared banner read "13/5" for an install that had fetched
  // nothing, and left its total short of its own count. A repair is a local,
  // asked-for action, and the page that asked shows its own progress.
  await Promise.all(ESSENTIALS_FILES.map((path) => refetchFile(path)));
  const packs = (await packsForType(type)).filter((p) => p !== 'essentials');
  const lists = await Promise.all(packs.map((p) => filesForPack(p)));
  await Promise.all([...new Set(lists.flat())].map((path) => refetchFile(path)));
}

/** The settings key the release list is remembered under, with its timestamp. */
const TAG_LIST_SETTING = 'dataTagList';

interface TagListCache {
  tags: string[];
  checkedAt: number;
}

/** The remembered release list, if it is still inside `maxAgeMs`. */
async function readTagListCache(maxAgeMs: number): Promise<string[] | undefined> {
  if (maxAgeMs <= 0) return undefined;
  try {
    const value = (await db.settings.get(TAG_LIST_SETTING))?.value as Partial<TagListCache> | null;
    if (value === null || typeof value !== 'object') return undefined;
    const { tags, checkedAt } = value;
    if (!Array.isArray(tags) || typeof checkedAt !== 'number') return undefined;
    if (Date.now() - checkedAt > maxAgeMs) return undefined;
    // Compatibility is a property of this build, not of the list: a list
    // written before the app updated can hold tags this build must not offer,
    // so it is filtered on the way out as well as on the way in.
    const usable = tags.filter((t): t is string => typeof t === 'string' && isCompatibleTag(t));
    // Nothing usable is a miss, not an answer. Returning the empty list
    // suppressed the request that would have found the usable tags, which is
    // precisely the case the filter above exists for: a list written by the
    // previous app build, against a schema major this one cannot read.
    return usable.length > 0 ? usable : undefined;
  } catch {
    // An unreadable cache is a cache miss, not a failure.
    return undefined;
  }
}

async function fetchTagList(): Promise<string[]> {
  const res = await fetch(TAGS_API_URL, {
    signal: AbortSignal.timeout(TAG_LIST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const tags = (await res.json()) as Array<{ name?: string }>;
  return tags
    .map((t) => t.name)
    .filter((n): n is string => typeof n === 'string')
    .filter((n) => isCompatibleTag(n))
    .slice(0, 15);
}

/** Shared so a boot's tag resolution and its update check make one request. */
const tagListInflight = new Map<string, Promise<string[]>>();

/**
 * Compatible tags available on the mirror (newest first, top 15). Tags of a
 * different schema major, which this build cannot parse safely, are filtered
 * out rather than offered blindly.
 *
 * Answered from the remembered list while that is younger than `maxAgeMs`.
 * Releases are weeks apart and this is not a CDN endpoint but GitHub's API,
 * rate-limited per address and uncached, so asking on every boot spent a
 * round-trip (and a slice of that budget) to re-learn what the last boot
 * already knew. Pass `maxAgeMs: 0` for a user who explicitly asked to check
 * now: they are owed a real answer, not yesterday's.
 */
export async function listAvailableTags({
  maxAgeMs = TAG_LIST_TTL_MS,
}: {
  maxAgeMs?: number;
} = {}): Promise<string[]> {
  const remembered = await readTagListCache(maxAgeMs);
  if (remembered !== undefined) return remembered;
  return singleFlight(tagListInflight, 'tags', async () => {
    const tags = await fetchTagList();
    try {
      // An empty answer is not worth remembering: a mirror with nothing this
      // build can install, or a captive portal answering 200 with something
      // else entirely, would otherwise own the next six hours of checks.
      if (tags.length > 0) {
        await db.settings.put({
          key: TAG_LIST_SETTING,
          value: { tags, checkedAt: Date.now() } satisfies TagListCache,
        });
      }
    } catch {
      // A list we cannot write down is still good for this session.
    }
    return tags;
  });
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
    status.setUpdateAvailableTag(undefined);
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
    // The offer is spent whichever route took it: only the toast's own button
    // used to clear this, so installing from the settings picker left the
    // toast advertising the version that was now live ("v2.33.0 is available
    // (current: v2.33.0)"), with an Update button that did nothing.
    status.setUpdateAvailableTag(undefined);
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
