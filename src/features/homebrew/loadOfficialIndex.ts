import { getRegistry } from '@/data5e/registry';
import { dataStatusStore } from '@/stores/dataStatus';
import { type OfficialIndex, officialIndexFrom } from './importPreview';

/**
 * The official data an import preview checks against, or null when the
 * registry cannot be read at all (the preview then says so in a note rather
 * than failing the import).
 *
 * `complete` is read before the registry, from the download queue: `done` is
 * only set once every pack has landed, so anything not found then is truly
 * not on this device. Read the other way round, a pack landing in between
 * could be counted as checked when the registry read never saw it.
 */
export async function loadOfficialIndex(): Promise<OfficialIndex | null> {
  const complete = dataStatusStore.getState().phase === 'done';
  try {
    return officialIndexFrom(await getRegistry(), { complete });
  } catch {
    return null;
  }
}
