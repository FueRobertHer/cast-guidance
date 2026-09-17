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
  const [paths, { files: brews }] = await Promise.all([
    dataCacheRepo.cachedPaths(getActiveTag()),
    // Through the read boundary, so a row the app cannot read is left out of
    // the registry instead of throwing out of it. `mergeHomebrew` reaches into
    // `json` directly, and the compendium failing takes every view with it.
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
  current = reg;
  currentSignature = signature;
  return current;
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

/** Force a rebuild on next access (after homebrew add/remove/toggle). */
export function invalidateRegistry(): void {
  currentSignature = '';
}
