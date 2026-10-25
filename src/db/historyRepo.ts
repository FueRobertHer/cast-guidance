import Dexie from 'dexie';
import type { CharacterDoc } from '@/engine/types';
import { sameContent } from '@/lib/docDiff';
import { type CharacterHistoryRow, db } from './db';

const KEEP_PER_CHARACTER = 50;

/** One character's snapshots, oldest first, over the compound index. */
function snapshotsOf(charId: string) {
  return db.characterHistory
    .where('[charId+at]')
    .between([charId, Dexie.minKey], [charId, Dexie.maxKey]);
}

/**
 * Rows order by time, and two in the same millisecond would order by their
 * random ids, so a new or rewritten row always lands strictly after the newest.
 */
function nextAt(newest: number | undefined): number {
  return newest === undefined ? Date.now() : Math.max(Date.now(), newest + 1);
}

/**
 * Rewrite the newest row in place, or false when `rowId` is no longer the
 * newest. A burst that ends where it started (HP down one, then back up) leaves
 * nothing to return to, so its row is dropped and undefined comes back; the
 * check is against the row before it, so a character whose first edits cancel
 * out never loses the snapshot that stands for its current state.
 */
async function replaceNewest(
  snapshot: CharacterDoc,
  label: string,
  rowId: string,
): Promise<string | undefined | false> {
  const [latest, previous] = await snapshotsOf(snapshot.id).reverse().limit(2).toArray();
  if (latest?.id !== rowId) return false;
  if (previous !== undefined && sameContent(previous.doc, snapshot)) {
    await db.characterHistory.delete(rowId);
    return undefined;
  }
  await db.characterHistory.put({ ...latest, at: nextAt(latest.at), label, doc: snapshot });
  return rowId;
}

export const historyRepo = {
  /**
   * Store a snapshot (skips duplicates, prunes to the newest 50). Returns the id
   * of the row that now holds `doc`, or undefined when nothing new was kept.
   *
   * `replaceId` folds this save into that row instead of adding one, for a run
   * of rapid edits the session treats as a single entry (UX-005). It only
   * applies while that row is still the newest; if another tab wrote since,
   * this is an ordinary insert.
   *
   * This runs on every debounced save, so it reads as little as it can get
   * away with. Both reads used to come back as whole rows, and a row holds an
   * entire character document: finding the newest snapshot deserialized all
   * fifty to use one, and pruning deserialized all fifty again to use none of
   * them, only their ids. With the drawer's own query on top, a single save
   * moved the kept history three times over. `last()` fetches one row and
   * `primaryKeys()` never touches the values at all.
   */
  async record(
    doc: CharacterDoc,
    label: string,
    opts?: { replaceId?: string },
  ): Promise<string | undefined> {
    const snapshot = structuredClone(doc);
    // One transaction, so another tab's write cannot land between finding the
    // newest row and writing after it.
    return db.transaction('rw', db.characterHistory, async () => {
      if (opts?.replaceId !== undefined) {
        const replaced = await replaceNewest(snapshot, label, opts.replaceId);
        if (replaced !== false) return replaced;
      }
      const latest = await snapshotsOf(doc.id).last();
      if (latest !== undefined && sameContent(latest.doc, snapshot)) return undefined;
      const id = crypto.randomUUID();
      await db.characterHistory.put({
        id,
        charId: doc.id,
        at: nextAt(latest?.at),
        label,
        doc: snapshot,
      });
      // Keys only, already in `at` order, so the oldest are simply the front.
      const keys = await snapshotsOf(doc.id).primaryKeys();
      if (keys.length > KEEP_PER_CHARACTER) {
        await db.characterHistory.bulkDelete(keys.slice(0, keys.length - KEEP_PER_CHARACTER));
      }
      return id;
    });
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
