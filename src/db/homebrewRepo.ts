import { assertHomebrewFile, homebrewEntityCounts, sha256Hex } from '@/lib/guards';
import { db, type HomebrewFileRow } from './db';

export const homebrewRepo = {
  async list(): Promise<HomebrewFileRow[]> {
    return db.homebrewFiles.orderBy('addedAt').reverse().toArray();
  },

  async enabled(): Promise<HomebrewFileRow[]> {
    return (await db.homebrewFiles.toArray()).filter((r) => r.enabled);
  },

  /** Validate + store a homebrew JSON file; content-hash keyed (idempotent). */
  async importJson(raw: unknown, fileName: string, url?: string): Promise<HomebrewFileRow> {
    const { meta, json } = assertHomebrewFile(raw);
    const text = JSON.stringify(raw);
    const id = await sha256Hex(text);
    const existing = await db.homebrewFiles.get(id);
    if (existing !== undefined) return existing;
    const row: HomebrewFileRow = {
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
};
