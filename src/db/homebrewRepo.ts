import {
  assertHomebrewFile,
  assertJsonWithinLimits,
  homebrewEntityCounts,
  sha256Hex,
} from '@/lib/guards';
import { db, type HomebrewFileRow } from './db';

/**
 * Build a content-hashed homebrew row from a raw 5etools homebrew file object.
 * Identity (`id`) and all metadata (`sourceIds`, `counts`) are recomputed from
 * the content, never taken from a caller — so an importer cannot forge an id
 * to collide with unrelated local content or misrepresent what a file holds.
 * Imported files are never `editable` (that flag belongs to in-app originals).
 */
export async function buildHomebrewRow(
  rawFile: unknown,
  fileName: string,
  url?: string,
): Promise<HomebrewFileRow> {
  // Bound adversarial/corrupted payloads before hashing, indexing, or storing.
  assertJsonWithinLimits(rawFile);
  const { meta, json } = assertHomebrewFile(rawFile);
  const id = await sha256Hex(JSON.stringify(rawFile));
  return {
    id,
    fileName,
    url,
    json,
    enabled: true,
    editable: false,
    sourceIds: meta.sources.map((s) => s.json),
    counts: homebrewEntityCounts(json),
    addedAt: Date.now(),
  };
}

export const homebrewRepo = {
  async list(): Promise<HomebrewFileRow[]> {
    return db.homebrewFiles.orderBy('addedAt').reverse().toArray();
  },

  async enabled(): Promise<HomebrewFileRow[]> {
    return (await db.homebrewFiles.toArray()).filter((r) => r.enabled);
  },

  /** Validate + store a homebrew JSON file; content-hash keyed (idempotent). */
  async importJson(raw: unknown, fileName: string, url?: string): Promise<HomebrewFileRow> {
    const row = await buildHomebrewRow(raw, fileName, url);
    const existing = await db.homebrewFiles.get(row.id);
    if (existing !== undefined) return existing;
    await db.homebrewFiles.put(row);
    return row;
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await db.homebrewFiles.update(id, { enabled });
  },

  async delete(id: string): Promise<void> {
    await db.homebrewFiles.delete(id);
  },

  async get(id: string): Promise<HomebrewFileRow | undefined> {
    return db.homebrewFiles.get(id);
  },

  /** New in-app editable homebrew file (uuid id — edits don't change identity). */
  async createEditable(fullName: string, abbreviation: string): Promise<HomebrewFileRow> {
    const json: Record<string, unknown> = {
      _meta: {
        sources: [
          { json: abbreviation, abbreviation, full: fullName, authors: [], version: '1.0.0' },
        ],
      },
    };
    const row: HomebrewFileRow = {
      id: crypto.randomUUID(),
      fileName: `${fullName.replaceAll(/[^\w-]+/g, '_')}.json`,
      json,
      enabled: true,
      editable: true,
      sourceIds: [abbreviation],
      counts: {},
      addedAt: Date.now(),
    };
    await db.homebrewFiles.put(row);
    return row;
  },

  async saveEditable(id: string, json: Record<string, unknown>): Promise<void> {
    // Bump rev so the registry/search signature notices the content change even
    // though the file id stays the same across edits.
    await db.homebrewFiles
      .where('id')
      .equals(id)
      .modify((row) => {
        row.json = json;
        row.counts = homebrewEntityCounts(json);
        row.rev = (row.rev ?? 0) + 1;
      });
  },
};
