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

/** Current registry over all cached files + enabled homebrew. */
export async function getRegistry(): Promise<EntityRegistry> {
  const [files, brews] = await Promise.all([cachedFilesMap(), homebrewRepo.enabled()]);
  const signature = `${[...files.keys()].sort().join(',')}|hb:${brews
    .map((b) => b.id)
    .sort()
    .join(',')}`;
  if (current === null || signature !== currentSignature) {
    const reg = normalizeDataset(files);
    const brewMap = new Map<string, Record<string, unknown>>();
    for (const b of brews) brewMap.set(b.id, b.json as Record<string, unknown>);
    mergeHomebrew(reg, brewMap);
    current = reg;
    currentSignature = signature;
  }
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
