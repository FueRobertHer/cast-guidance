/**
 * App-side registry singleton: hydrates from whatever files are cached in
 * IndexedDB, rebuilds when the cached file set grows (background drain), and
 * can force specific packs to be present first.
 */
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { DATA_TAG } from './config';
import { ensurePack } from './loader';
import { type EntityRegistry, normalizeDataset } from './normalize';
import type { PackId } from './packs';

export type { EntityType } from './normalize';
export { EntityRegistry, normalizeDataset } from './normalize';

let current: EntityRegistry | null = null;
let currentSignature = '';

async function cachedFilesMap(): Promise<Map<string, unknown>> {
  const rows = await dataCacheRepo.filesByTag(DATA_TAG);
  const map = new Map<string, unknown>();
  for (const row of rows) map.set(row.path, row.json);
  return map;
}

/** Current registry over all cached files; rebuilds only when the file set changes. */
export async function getRegistry(): Promise<EntityRegistry> {
  const files = await cachedFilesMap();
  const signature = [...files.keys()].sort().join(',');
  if (current === null || signature !== currentSignature) {
    current = normalizeDataset(files);
    currentSignature = signature;
  }
  return current;
}

/** Ensure the given packs are downloaded, then return a registry containing them. */
export async function ensureRegistry(packs: PackId[]): Promise<EntityRegistry> {
  await Promise.all(packs.map((p) => ensurePack(p)));
  return getRegistry();
}
