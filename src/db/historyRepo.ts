import Dexie from 'dexie';
import type { CharacterDoc } from '@/engine/types';
import { type CharacterHistoryRow, db } from './db';

const KEEP_PER_CHARACTER = 50;

/** One character's snapshots, oldest first, over the compound index. */
function snapshotsOf(charId: string) {
  return db.characterHistory
    .where('[charId+at]')
    .between([charId, Dexie.minKey], [charId, Dexie.maxKey]);
}

export const historyRepo = {
  /**
   * Store a snapshot (skips exact duplicates, prunes to the newest 50).
   *
   * This runs on every debounced save, so it reads as little as it can get
   * away with. Both reads used to come back as whole rows, and a row holds an
   * entire character document: finding the newest snapshot deserialized all
   * fifty to use one, and pruning deserialized all fifty again to use none of
   * them, only their ids. With the drawer's own query on top, a single save
   * moved the kept history three times over. `last()` fetches one row and
   * `primaryKeys()` never touches the values at all.
   */
  async record(doc: CharacterDoc, label: string): Promise<void> {
    const latest = await snapshotsOf(doc.id).last();
    const snapshot = structuredClone(doc);
    if (latest !== undefined && JSON.stringify(latest.doc) === JSON.stringify(snapshot)) return;
    await db.characterHistory.put({
      id: crypto.randomUUID(),
      charId: doc.id,
      at: Date.now(),
      label,
      doc: snapshot,
    });
    // Keys only, already in `at` order, so the oldest are simply the front.
    const keys = await snapshotsOf(doc.id).primaryKeys();
    if (keys.length > KEEP_PER_CHARACTER) {
      await db.characterHistory.bulkDelete(keys.slice(0, keys.length - KEEP_PER_CHARACTER));
    }
  },

  /**
   * Every snapshot for a character, newest first. This one does need the whole
   * rows, because restoring hands a stored document straight back, so the
   * drawer only asks for it while it is open.
   */
  async list(charId: string): Promise<CharacterHistoryRow[]> {
    return (await snapshotsOf(charId).toArray()).reverse();
  },

  async clear(charId: string): Promise<void> {
    await db.characterHistory.where('charId').equals(charId).delete();
  },
};
