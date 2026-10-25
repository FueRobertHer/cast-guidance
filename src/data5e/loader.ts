import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { readJsonBounded } from '@/lib/boundedRead';
import { jsonByteSize } from '@/lib/byteSize';
import { assertJsonWithinLimits, DATA_FILE_LIMITS, ValidationError } from '@/lib/guards';
import { runWhenIdle } from '@/lib/idle';
import { Semaphore } from '@/lib/semaphore';
import { singleFlight } from '@/lib/singleFlight';
import { dataStatusStore } from '@/stores/dataStatus';
import {
  BOOT_TAG_RESOLVE_TIMEOUT_MS,
  DATA_TAG,
  FETCH_CONCURRENCY,
  isCompatibleTag,
  MAX_TAG_LIST_BYTES,
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
import { assertComplete, indexEntries, requiredFiles, validateDataFile } from './validate';

// The active tag can differ from the build-time pin after a user-driven data
// update; it's restored from settings at boot.
let activeTag = DATA_TAG;
let source = new GithubTagSource(activeTag);

export function getActiveTag(): string {
  return activeTag;
}

/**
 * The settings key that holds an install still on probation: the release it
 * replaced (`prev`, whose rows are kept), the release installed (`to`), and
 * how many registry builds have started on `to` without its official build
 * ever succeeding. Written in the same transaction as the swap and removed in the
 * same transaction as a rollback, so it can never disagree with `dataTag`.
 */
const ROLLBACK_SETTING = 'dataTagRollback';

interface RollbackRecord {
  prev: string;
  to: string;
  starts: number;
}

/**
 * The release a rollback left behind, kept so the app stops offering it and
 * can say why the version moved backwards until someone has read that.
 */
const REJECTED_SETTING = 'dataTagRejected';

interface RejectedRecord {
  tag: string;
  dismissed: boolean;
}

/**
 * Sessions whose first registry build under a release on probation may start
 * and never finish its official build before the app gives up on it. A build that starts and
 * never finishes is what a release that crashes the app looks like from the
 * next launch. Counted per build rather than per launch, because plenty of
 * launches (a homebrew page, a reload on a missing route) build no registry
 * at all and say nothing about the data. Two, not one: a session can also
 * end for reasons that have nothing to do with the data (the tab closed, the
 * device slept), and going back costs the user the update they asked for.
 */
const MAX_UNPUBLISHED_STARTS = 2;

/** A stored rollback record, or undefined for anything that is not one. */
function parseRollback(value: unknown): RollbackRecord | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const { prev, to, starts } = value as Partial<RollbackRecord>;
  if (typeof prev !== 'string' || typeof to !== 'string') return undefined;
  if (typeof starts !== 'number' || !Number.isFinite(starts) || starts < 0) return undefined;
  return { prev, to, starts };
}

async function readRollback(): Promise<RollbackRecord | undefined> {
  return parseRollback((await db.settings.get(ROLLBACK_SETTING))?.value);
}

/** The stored rejected release, or undefined for anything that is not one. */
async function readRejected(): Promise<RejectedRecord | undefined> {
  const value = (await db.settings.get(REJECTED_SETTING))?.value;
  if (value === null || typeof value !== 'object') return undefined;
  const { tag, dismissed } = value as Partial<RejectedRecord>;
  if (typeof tag !== 'string') return undefined;
  return { tag, dismissed: dismissed === true };
}

/** Whether every essentials file of `tag` is on disk. */
async function hasEssentials(tag: string): Promise<boolean> {
  const onDisk = await dataCacheRepo.cachedPaths(tag);
  return ESSENTIALS_FILES.every((p) => onDisk.has(p));
}

/**
 * The tag whose first successful official build would confirm it, mirrored
 * from the rollback record so the registry can ask on every build without a
 * read.
 */
let pendingTag: string | undefined;

/**
 * This session's decision about its first build under a release on
 * probation: counted, or rolled back. One promise per tag that every build
 * waits on, so a second build cannot slip past while the first is still
 * deciding and build (and confirm) a release that is about to be rejected.
 */
let startDecision: { tag: string; wentBack: Promise<boolean> } | undefined;

/**
 * Pick up a release still on probation at launch. Runs inside tag
 * resolution, so nothing has read a file under the tag yet, and reads nothing
 * but the local database: a release that cannot start must be escapable
 * offline. The one thing decided here is a release whose essentials are gone
 * (evicted, or deleted by hand) while the release it replaced still has its
 * own: nothing could be built from it, and the way back is right there.
 */
async function checkPendingTag(): Promise<void> {
  try {
    const rejected = await readRejected();
    if (rejected !== undefined && !rejected.dismissed) {
      dataStatusStore.getState().setRolledBackFrom(rejected.tag);
    }
  } catch {
    // The notice is a courtesy; an unreadable one just is not shown.
  }
  let rollback: RollbackRecord | undefined;
  try {
    rollback = await readRollback();
  } catch {
    // An unreadable record is no record: this launch stays where it is.
    return;
  }
  if (rollback === undefined) return;
  try {
    if (rollback.to !== activeTag) {
      // About some other install, unless one has swapped since the read.
      await db.transaction('rw', db.settings, async () => {
        const stored = (await db.settings.get('dataTag'))?.value;
        const current = await readRollback();
        if (current !== undefined && current.to !== stored) {
          await db.settings.delete(ROLLBACK_SETTING);
        }
      });
      return;
    }
    if (!(await hasEssentials(rollback.to)) && (await hasEssentials(rollback.prev))) {
      // Not rejected: the release lost its files, it did not fail to start,
      // so it stays on offer for a download that brings them back.
      await rollBack(rollback, { reject: false });
      return;
    }
    pendingTag = activeTag;
  } catch {
    // Left for the next launch to look at again.
  }
}

/**
 * Go back to the release `rollback` replaced. Only if that release's
 * essentials are all still on disk: going back to a release that has to be
 * downloaded again trades a version that may work for one that, offline,
 * certainly will not. Otherwise the record is dropped and the app stays put,
 * since there is nothing left to go back to. Resolves whether it went back.
 *
 * `reject` records the release as one this device went back from, so the
 * update check stops offering it and the notice outlives a reload; it is for
 * a release that failed, not one that was merely evicted. Only a rejected
 * release raises the rollback notice.
 */
async function rollBack(
  rollback: RollbackRecord,
  { reject }: { reject: boolean },
): Promise<boolean> {
  const { prev, to } = rollback;
  try {
    if (!(await hasEssentials(prev))) {
      pendingTag = undefined;
      await db.settings.delete(ROLLBACK_SETTING);
      return false;
    }
    const wentBack = await db.transaction('rw', db.settings, db.dataMeta, async () => {
      // Re-read under the transaction: an install that swapped since the
      // caller looked owns both keys now.
      const current = await db.settings.get('dataTag');
      if (current?.value !== to || (await readRollback())?.to !== to) return false;
      await db.settings.put({ key: 'dataTag', value: prev });
      await db.dataMeta.put({
        id: 'installed',
        tag: prev,
        completedPacks: [],
        installedAt: Date.now(),
      });
      await db.settings.delete(ROLLBACK_SETTING);
      if (reject) {
        await db.settings.put({
          key: REJECTED_SETTING,
          value: { tag: to, dismissed: false } satisfies RejectedRecord,
        });
      }
      return true;
    });
    if (!wentBack) return false;
  } catch {
    return false;
  }
  pendingTag = undefined;
  activeTag = prev;
  source = new GithubTagSource(prev);
  // The notice says the release could not start, which is untrue of one
  // whose files were evicted; that one is simply offered again.
  if (reject) dataStatusStore.getState().setRolledBackFrom(to);
  return true;
}

/** Put the rollback notice away, on this launch and the ones after it. */
export async function dismissRollbackNotice(): Promise<void> {
  dataStatusStore.getState().setRolledBackFrom(undefined);
  try {
    await db.transaction('rw', db.settings, async () => {
      const rejected = await readRejected();
      if (rejected !== undefined && !rejected.dismissed) {
        await db.settings.put({
          key: REJECTED_SETTING,
          value: { ...rejected, dismissed: true } satisfies RejectedRecord,
        });
      }
    });
  } catch {
    // Shown again on the next launch, which is the honest failure.
  }
}

/**
 * Called by the registry when it is about to build under `tag`. The first
 * build of each session under a release on probation is counted, in one
 * transaction with the read that decides it; a release that already has
 * {@link MAX_UNPUBLISHED_STARTS} builds started and none finished goes back
 * instead. Resolves true when the caller must read the active tag again
 * before building: because this went back, or because the tag it read has
 * been left behind meanwhile.
 */
export async function noteRegistryBuildStarting(tag: string): Promise<boolean> {
  if (activeTag !== tag) return true;
  if (pendingTag !== tag) return false;
  // Shared, so concurrent builds in one session count once (one session that
  // never finishes is one failed start, however many screens asked for the
  // registry during it) and all of them wait for the same answer.
  if (startDecision?.tag !== tag) startDecision = { tag, wentBack: decideStart(tag) };
  await startDecision.wentBack;
  return activeTag !== tag;
}

async function decideStart(tag: string): Promise<boolean> {
  let exhausted: RollbackRecord | undefined;
  try {
    exhausted = await db.transaction('rw', db.settings, async () => {
      const rollback = await readRollback();
      if (rollback?.to !== tag) return undefined;
      if (rollback.starts >= MAX_UNPUBLISHED_STARTS) return rollback;
      await db.settings.put({
        key: ROLLBACK_SETTING,
        value: { ...rollback, starts: rollback.starts + 1 } satisfies RollbackRecord,
      });
      return undefined;
    });
  } catch {
    // An uncounted start is not counted; the next session's is.
    return false;
  }
  return exhausted === undefined ? false : rollBack(exhausted, { reject: true });
}

/**
 * Called by the registry each time the official build succeeds, with the
 * paths it read, before homebrew is merged in. The first one under a release
 * on probation that holds every essentials file is what confirms it (and
 * finishes the start counted for it): its files were read and normalized into
 * something the app can use, so the release it replaced is no longer needed
 * and its rows can go. Before the merge on purpose, since a broken homebrew
 * file says nothing about the release. A build missing essentials proves
 * nothing, since a page can ask for the registry before they are on disk.
 */
export async function noteRegistryBuilt(tag: string, paths: ReadonlySet<string>): Promise<void> {
  if (pendingTag === undefined || pendingTag !== tag) return;
  if (!ESSENTIALS_FILES.every((p) => paths.has(p))) return;
  pendingTag = undefined;
  let confirmed = false;
  try {
    confirmed = await db.transaction('rw', db.settings, async () => {
      if ((await readRollback())?.to !== tag) return false;
      await db.settings.delete(ROLLBACK_SETTING);
      return true;
    });
  } catch {
    // Still on record, so the next build confirms it. Pruning now would
    // delete what a rollback needs.
    pendingTag = tag;
    return;
  }
  // Only a confirm that happened here sweeps: a record already gone, or
  // rewritten by another tab's install, is not this build's to act on. Not
  // awaited: the registry waits for the confirm, not for the housekeeping.
  if (confirmed) void pruneStaleTags();
}

/**
 * Called by the registry when the official build under `tag` throws. A
 * release on probation that cannot even be built is rolled back at once,
 * rather than after the sessions the start counter would give it. Resolves
 * whether it went back, so the registry can build again under the restored
 * release.
 */
export async function noteRegistryBuildFailed(tag: string): Promise<boolean> {
  if (pendingTag === undefined || pendingTag !== tag || activeTag !== tag) return false;
  let rollback: RollbackRecord | undefined;
  try {
    rollback = await readRollback();
  } catch {
    return false;
  }
  if (rollback?.to !== tag) return false;
  return rollBack(rollback, { reject: true });
}

async function restoreActiveTag(): Promise<void> {
  const row = await db.settings.get('dataTag');
  if (typeof row?.value === 'string') {
    if (row.value !== activeTag) {
      activeTag = row.value;
      source = new GithubTagSource(activeTag);
    }
    await checkPendingTag();
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
 * Resolves once the active tag is known (and any rollback has happened), for
 * readers outside this module that go to the cache directly rather than
 * through `getFile`.
 */
export function whenTagReady(): Promise<void> {
  return ensureTagReady();
}

/**
 * One global gate for every network fetch (indexes, pack files, on-demand
 * reads) so total wire concurrency stays within the limit no matter how many
 * packs are being ensured in parallel. Keyed to the active tag so a
 * `getFile`/`ensurePack` batch and a background drain share the same budget.
 */
const fetchGate = new Semaphore(FETCH_CONCURRENCY);

/** How many fetches are queued behind {@link fetchGate}, for diagnostics and tests. */
export function fetchesWaiting(): number {
  return fetchGate.waiting;
}

/**
 * The gate every downloaded file passes before it is cached. The source has
 * already bounded the bytes; this bounds the shape, so a body that parses but
 * is not a data file (nested a thousand deep, one enormous string, a bare
 * array) is refused here and never stored, normalized or indexed. Refused the
 * same way a failed download is: the caller sees the error, nothing is kept,
 * and the next attempt fetches again.
 */
function acceptDataFile(path: string, json: unknown): unknown {
  const label = `data file "${path}"`;
  assertJsonWithinLimits(json, DATA_FILE_LIMITS, label);
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new ValidationError(`${label} is not a JSON object`);
  }
  return json;
}

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
      const json = acceptDataFile(path, await from.fetchFile(path));
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
  // Entries naming anything but a plain file are skipped, not fatal: the
  // installer refuses such an index outright, but one already cached (from a
  // release installed before it checked) still has good entries to serve.
  if (pack.startsWith('class:')) {
    const key = pack.slice('class:'.length);
    for (const [k, v] of indexEntries(await getFile('class/index.json'))) {
      if (k.toLowerCase() === key) return [`class/${v}`];
    }
    return [];
  }
  if (pack.startsWith('spells:')) {
    const key = pack.slice('spells:'.length);
    for (const [k, v] of indexEntries(await getFile('spells/index.json'))) {
      if (k.toLowerCase() === key) return [`spells/${v}`];
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
  // The same lenient reading as `filesForPack`, so every id listed here
  // resolves to a file there.
  const classPacks = indexEntries(await getFile('class/index.json')).map(([k]) => classPackId(k));
  const spellPacks = indexEntries(await getFile('spells/index.json')).map(([k]) => spellsPackId(k));
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
 * Drop cached files belonging to any tag nothing can still read: not this
 * session's, not the one stored for the next launch, and neither side of an
 * install on probation. Only `updateToTag` used to clean up after itself, so
 * rows stranded by an interrupted update, or by a boot that resolved to a
 * different tag than it started with, sat in IndexedDB forever, roughly
 * doubling storage use.
 *
 * The stored tag matters because `activeTag` is this tab's view. A second tab
 * still on the old release, sweeping by its own view alone, deleted the
 * release the first tab had just installed, and the next launch booted a tag
 * with no rows at all. Read in the same transaction as the delete, so an
 * install committing in between cannot slip past it.
 */
async function pruneStaleTags(): Promise<void> {
  if (installingTag !== undefined) return;
  try {
    // No sweep at all if the reads fail: a sweep that could not see the
    // rollback record would delete the only release to go back to.
    await db.transaction('rw', db.settings, db.dataFiles, async () => {
      const keep = new Set([activeTag]);
      const stored = (await db.settings.get('dataTag'))?.value;
      if (typeof stored === 'string') keep.add(stored);
      const rollback = await readRollback();
      if (rollback !== undefined) {
        keep.add(rollback.prev);
        keep.add(rollback.to);
      }
      await dataCacheRepo.deleteTagsExcept([...keep]);
    });
  } catch {
    // Best-effort housekeeping; a failure just means we retry next boot.
  }
}

/**
 * Boot entry: make essentials available, then drain every remaining pack in
 * idle time so the app becomes fully offline-capable (about
 * `GAME_DATA_DOWNLOAD_SIZE` on disk, a little less on the wire).
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
  // the old tag's rows are swept once the new one is confirmed, and a late
  // repair would otherwise put one back, stranded under a version nothing
  // reads until the next boot cleans it up again.
  const tag = activeTag;
  const from = source;
  const json = acceptDataFile(path, await fetchGate.run(() => from.fetchFile(path)));
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
  const tags = (await readJsonBounded(res, MAX_TAG_LIST_BYTES)) as Array<{ name?: string }>;
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
    // Not the release this device already went back from: offering it again
    // only invites the same rollback. A newer release is a new offer.
    if (latest !== undefined && latest !== activeTag && latest !== (await readRejected())?.tag) {
      dataStatusStore.getState().setUpdateAvailableTag(latest);
    }
  } catch {
    // ignore: retried next boot
  }
}

/**
 * Install a different data tag: download everything under the new keyspace
 * (old data stays live until the swap), validate every file and check none is
 * missing, then flip in one transaction. The old release's rows stay until
 * the new one has been built into a registry (see `noteRegistryBuilt`), so
 * a release that passes these checks and still cannot start has somewhere
 * to go back to.
 *
 * What an interruption leaves behind, by phase:
 * - before or during the download: settings still name the old tag, which
 *   boots as before; the staged rows are swept by the next prune.
 * - during the swap: the transaction commits whole or not at all, so the next
 *   launch boots the old tag or the new one, never settings for one and
 *   bookkeeping for the other.
 * - after the swap, before a registry is built: both releases' rows are kept
 *   and the rollback record counts registry builds that start and never
 *   finish; the first official build that succeeds confirms the new release,
 *   one that throws goes back at once, and so do too many unfinished ones.
 */
export async function updateToTag(newTag: string): Promise<void> {
  const status = dataStatusStore.getState();
  // So `activeTag` is the installed release rather than the build's default,
  // and any probation it is on has been read, before anything is compared.
  await ensureTagReady();
  if (newTag === activeTag) {
    // Already installed, by this call or another route, so the recorded
    // failure for it is over: leaving it up would show an error about a
    // version that is now the live one, behind a retry that does nothing.
    if (status.failedTag === newTag) status.setPhase('done');
    status.setUpdateAvailableTag(undefined);
    return;
  }
  const newSource = new GithubTagSource(newTag);
  status.beginRun();

  // Every file is held to the full check, whether it was fetched just now or
  // is already staged (from an earlier attempt, or because this is the release
  // a previous install kept to roll back to): a staged row predating these
  // checks is no more trustworthy than a fresh download.
  const fetchNew = async (path: string): Promise<unknown> => {
    const cached = await dataCacheRepo.getFile(newTag, path);
    if (cached) {
      validateDataFile(path, acceptDataFile(path, cached.json));
      // Counted like a download: it was in the total, and leaving it out of
      // the done count stalled the bar short of full on every resumed install.
      status.fileDone();
      return cached.json;
    }
    // Through the same gate as every other fetch. Bypassing it let an install
    // open its own connection alongside the four the background queue was
    // already holding, on exactly the slow network where that hurts.
    const json = await fetchGate.run(async () => {
      status.fileStarted(path);
      return acceptDataFile(path, await newSource.fetchFile(path));
    });
    validateDataFile(path, json);
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

    // Static packs (the indexes among them), then everything the indexes list.
    // One at a time: the gate bounds the wire either way, and a sibling fetch
    // still running after a failure could stage a row behind the sweep in the
    // `finally`.
    const staticFiles = [...ESSENTIALS_FILES, ...ITEMS_FULL_FILES, ...LIBRARY_EXTRAS_FILES];
    status.addTotal(staticFiles.length);
    const staged = new Map<string, unknown>();
    for (const path of staticFiles) staged.set(path, await fetchNew(path));
    const required = requiredFiles(staged.get('class/index.json'), staged.get('spells/index.json'));
    const dynamic = required.filter((p) => !staged.has(p));
    status.addTotal(dynamic.length);
    for (const path of dynamic) await fetchNew(path);

    // Every file the release lists is on disk under its tag, checked against
    // the cache itself rather than the loop above, which is what the swap is
    // about to promise the next launch.
    assertComplete(await dataCacheRepo.cachedPaths(newTag), required);

    // The swap, in one transaction: the tag, its bookkeeping and the rollback
    // record commit together or not at all. As three separate writes, an
    // interruption between them left settings naming the new release over
    // bookkeeping for the old one. The release to go back to is the last one
    // that proved itself: a second install before the first was confirmed
    // keeps the original, not the unproven one in between.
    const from = activeTag;
    await db.transaction('rw', db.settings, db.dataMeta, async () => {
      const existing = await readRollback();
      const kept = existing?.to === from ? existing.prev : from;
      const prev = kept === newTag ? from : kept;
      await db.settings.put({ key: 'dataTag', value: newTag });
      await db.dataMeta.put({
        id: 'installed',
        tag: newTag,
        completedPacks: [],
        installedAt: Date.now(),
      });
      await db.settings.put({
        key: ROLLBACK_SETTING,
        value: { prev, to: newTag, starts: 0 } satisfies RollbackRecord,
      });
      // An install that went through puts the rollback notice away. Installing
      // the very release that was rolled back is the user overruling it, so
      // that one stops being held back from future offers as well.
      const rejected = await readRejected();
      if (rejected?.tag === newTag) await db.settings.delete(REJECTED_SETTING);
      else if (rejected !== undefined && !rejected.dismissed) {
        await db.settings.put({
          key: REJECTED_SETTING,
          value: { ...rejected, dismissed: true } satisfies RejectedRecord,
        });
      }
    });
    activeTag = newTag;
    source = newSource;
    pendingTag = newTag;
    startDecision = undefined;
    status.setRolledBackFrom(undefined);
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
    // Whether we swapped or bailed, `activeTag` is now the one to keep, and
    // the rollback record names the one release kept beside it, so this drops
    // the half-downloaded new rows on failure and anything older than the
    // rollback target on success. Only our own claim is released; a
    // concurrent install still holding the slot keeps the sweep off its
    // staged rows.
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
