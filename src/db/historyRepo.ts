import type { CharacterDoc } from '@/engine/types';
import { type CharacterHistoryRow, db } from './db';

const KEEP_PER_CHARACTER = 50;

export const historyRepo = {
  /** Store a snapshot (skips exact duplicates, prunes to the newest 50). */
  async record(doc: CharacterDoc, label: string): Promise<void> {
    const latest = await db.characterHistory
      .where('charId')
      .equals(doc.id)
      .reverse()
      .sortBy('at')
      .then((rows) => rows[0]);
    const snapshot = structuredClone(doc);
    if (latest !== undefined && JSON.stringify(latest.doc) === JSON.stringify(snapshot)) return;
    await db.characterHistory.put({
      id: crypto.randomUUID(),
      charId: doc.id,
      at: Date.now(),
      label,
      doc: snapshot,
    });
    const all = await db.characterHistory.where('charId').equals(doc.id).sortBy('at');
    if (all.length > KEEP_PER_CHARACTER) {
      const excess = all.slice(0, all.length - KEEP_PER_CHARACTER).map((r) => r.id);
      await db.characterHistory.bulkDelete(excess);
    }
  },

  async list(charId: string): Promise<CharacterHistoryRow[]> {
    const rows = await db.characterHistory.where('charId').equals(charId).sortBy('at');
    return rows.reverse();
  },

  async clear(charId: string): Promise<void> {
    await db.characterHistory.where('charId').equals(charId).delete();
  },
};
