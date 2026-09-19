/**
 * App-side registry singleton: hydrates from cached official files plus
 * enabled homebrew, rebuilds when either set changes, and can force packs
 * to be present first.
 */
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { homebrewRepo } from '@/db/homebrewRepo';
import { ensurePack, getActiveTag } from './loader';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from './normalize';
import type { PackId } from './packs';
import { setHomebrewSourceNames } from './sourceNames';

export type { EntityType } from './normalize';
export { EntityRegistry, normalizeDataset } from './normalize';

let current: EntityRegistry | null = null;
let currentSignature = '';
/**
 * Bumped by every invalidation. A rebuild reads rows, which takes long enough
 * to matter, and publishing what it read regardless of what happened meanwhile
 * is how a repair loses: the rebuild starts before the repaired rows are
 * written, finishes after the invalidation, and installs the bodies it read at
 * the start under a signature that says they are current. Since a repair
 * changes no paths, that signature matches the next request exactly, so the
 * pre-repair registry is served from cache and the repair vanishes.
 */
let epoch = 0;

async function cachedFilesMap(): Promise<Map<string, unknown>> {
  const rows = await dataCacheRepo.filesByTag(getActiveTag());
  const map = new Map<string, unknown>();
  for (const row of rows) map.set(row.path, row.json);
  return map;
}

/**
 * Fingerprint of the data behind a registry: the cached file paths plus each
 * enabled homebrew file's id AND content revision. Including `rev` is what makes
 * an editable-homebrew edit (same id, new content) change the signature, so the
 * registry rebuilds and the search index (keyed off this) is not served stale.
 * Pure so it can be unit-tested.
 */
export function computeRegistrySignature(
  filePaths: Iterable<string>,
  brews: ReadonlyArray<{ id: string; rev?: number }>,
): string {
  const files = [...filePaths].sort().join(',');
  const hb = brews
    .map((b) => `${b.id}@${b.rev ?? 0}`)
    .sort()
    .join(',');
  return `${files}|hb:${hb}`;
}

/**
 * Source code to title for every enabled homebrew file, read from the
 * `_meta.sources` block a 5etools brew carries. Tolerant on purpose: an entry
 * with no title, or a `_meta` that got mangled somewhere, simply contributes
 * nothing and its code renders bare as it did before. A title identical to the
 * code is skipped too, since `abbreviation` is usually just the code again.
 */
export function homebrewSourceNames(
  brews: ReadonlyArray<{ json: unknown }>,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const brew of brews) {
    if (typeof brew.json !== 'object' || brew.json === null) continue;
    const meta = (brew.json as { _meta?: unknown })._meta;
    if (typeof meta !== 'object' || meta === null) continue;
    const sources = (meta as { sources?: unknown }).sources;
    if (!Array.isArray(sources)) continue;
    for (const entry of sources) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { json: code, full, abbreviation } = entry as Record<string, unknown>;
      if (typeof code !== 'string' || code === '') continue;
      const title =
        typeof full === 'string' && full !== ''
          ? full
          : typeof abbreviation === 'string' && abbreviation !== ''
            ? abbreviation
            : undefined;
      if (title !== undefined && title !== code) out.set(code, title);
    }
  }
  return out;
}

/**
 * Current registry over all cached files + enabled homebrew.
 *
 * The signature is computed from cached *paths* rather than rows, so answering
 * "is the registry still current?" costs an index scan. It used to load every
 * cached file to read one key off each, meaning every mount of a registry hook
 * deserialized the whole compendium before returning the object it already had
 * in memory. That was most of the delay before a page could paint.
 */
export async function getRegistry(): Promise<EntityRegistry> {
  beginRead();
  try {
    return await readRegistry();
  } finally {
    endRead();
  }
}

async function readRegistry(): Promise<EntityRegistry> {
  const startedAt = epoch;
  const [paths, { files: brews }] = await Promise.all([
    dataCacheRepo.cachedPaths(getActiveTag()),
    // `mergeHomebrew` reaches into `json` directly, so an unreadable row used
    // to throw out of here, and every view needs the compendium.
    homebrewRepo.enabledSafe(),
  ]);
  const signature = computeRegistrySignature(paths, brews);
  if (current !== null && signature === currentSignature) return current;

  // Only a real rebuild pays for the file bodies.
  const files = await cachedFilesMap();
  // Before the registry is published, so the first render that can show a
  // brew's badge already has its title.
  setHomebrewSourceNames(homebrewSourceNames(brews));
  const reg = normalizeDataset(files);
  const brewMap = new Map<string, Record<string, unknown>>();
  for (const b of brews) brewMap.set(b.id, b.json);
  mergeHomebrew(reg, brewMap);
  // Only if nothing invalidated the registry while this was reading. The
  // caller still gets what was built, which is the best answer available to
  // it; what it must not do is leave that answer behind as the current one.
  if (startedAt === epoch) {
    current = reg;
    currentSignature = signature;
  }
  return reg;
}

/**
 * Whether a registry read is in flight, and who to tell when that changes.
 *
 * This lives here rather than in each `useRegistryState` because it is a
 * property of the registry, not of any one component. Every consumer used to
 * hold its own copy as React state, which meant two extra renders of every
 * page reading the registry for each of the hundreds of files a background
 * drain lands, in components that never looked at the value. Published once,
 * only the pages that ask to hear about it pay for it.
 */
let readsInFlight = 0;
const readListeners = new Set<() => void>();

/** Tell the listeners, but only when the flag itself moved. */
function announceReads(wasRefreshing: boolean): void {
  if (isRegistryRefreshing() === wasRefreshing) return;
  for (const fn of [...readListeners]) fn();
}

function beginRead(): void {
  const wasRefreshing = isRegistryRefreshing();
  readsInFlight++;
  announceReads(wasRefreshing);
}

function endRead(): void {
  const wasRefreshing = isRegistryRefreshing();
  readsInFlight--;
  announceReads(wasRefreshing);
}

/**
 * True while the registry is catching up with the files on disk. A page that
 * reads "nothing here" out of the registry during this window is reading a
 * stale answer, not a final one.
 */
export function isRegistryRefreshing(): boolean {
  return readsInFlight > 0;
}

/**
 * Hold the flag up across work this module cannot see the end of, and release
 * it with the returned function (idempotent, so a cleanup path can call it
 * without checking).
 *
 * `useRegistryState` needs this because the flag has to stay up until the
 * registry it read has been *applied*, not until the read settled. `endRead`
 * runs in `getRegistry`'s `finally`, which is a microtask before the awaiting
 * caller's `setRegistry`, so a consumer bracketing only the read commits a
 * frame reporting nothing in flight while still holding the previous
 * registry. That frame is the exact false answer this flag exists to prevent:
 * the library renders "Nothing here yet" over a section whose files have
 * already landed.
 */
export function holdRegistryRefreshing(): () => void {
  beginRead();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    endRead();
  };
}

/** Subscribe to {@link isRegistryRefreshing} changes. Returns the unsubscribe. */
export function subscribeRegistryRefreshing(fn: () => void): () => void {
  readListeners.add(fn);
  return () => {
    readListeners.delete(fn);
  };
}

/** Ensure the given packs are downloaded, then return a registry containing them. */
export async function ensureRegistry(packs: PackId[]): Promise<EntityRegistry> {
  await Promise.all(packs.map((p) => ensurePack(p)));
  return getRegistry();
}

/** Signature of the file set behind the current registry (search index key). */
export function registrySignature(): string {
  return currentSignature;
}

/** Force a rebuild on next access (after homebrew add/remove/toggle, or a repair). */
export function invalidateRegistry(): void {
  currentSignature = '';
  epoch++;
}
