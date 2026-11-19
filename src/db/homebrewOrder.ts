/**
 * The order homebrew files merge in, and so which one wins a tie (IMP-002).
 *
 * The registry adds official data first and keeps the first entity it sees for
 * each `name|source`, so official content always wins. Homebrew merges after
 * it, file by file, in the order `homebrewRepo.enabledSafe()` returns. That
 * order used to be the database's primary key order, which is a content hash
 * (or a random uuid for builder files), so which of two files defining the
 * same `name|source` won was an accident. This puts the earliest import first:
 * the file that was here before keeps its place when another one arrives.
 *
 * Pure, so the import preview can say who wins using the same rule the
 * registry applies. The key a file keeps its place by through an update
 * (`collectionKey`) is here too, for the same reason.
 */
import { fileKey } from './homebrewBooks';

export interface MergeOrderKey {
  addedAt: number;
  id: string;
}

/**
 * Earliest `addedAt` first, then `id` ascending so a same-millisecond pair
 * (a character import writes several files in one go) still has one answer.
 */
export function compareMergeOrder(a: MergeOrderKey, b: MergeOrderKey): number {
  return a.addedAt - b.addedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** What a stored file's collection key is made of. */
export interface CollectionKeyParts {
  url?: string;
  sourceIds: readonly string[];
  fileName: string;
  /** Set on one book of a converted compendium. */
  book?: string;
}

/**
 * The collection an imported file is, as a key that survives a new content
 * hash (ADR-002, D4): importing a file with the key of one stored updates
 * that one in place, so it keeps its switch, its place in this order and its
 * pack's settings. A file is keyed by its link, else by its first source and
 * its file name (`fileKey`, so a second download's ` (1)` is the same file).
 * A book of a converted compendium is keyed by its book and the file it came
 * from, as one stored copy of a book stands for (`sameBookCopy`): every book
 * of one file shares that file's link. Synchronous, so the database upgrade
 * can key the files already stored.
 */
export function collectionKey(f: CollectionKeyParts): string {
  const first = (f.sourceIds[0] ?? '').toLowerCase();
  if (f.book !== undefined) return `book:${first}|${fileKey(f.fileName)}`;
  const url = f.url?.trim() ?? '';
  return url === '' ? `file:${first}|${fileKey(f.fileName)}` : `url:${url}`;
}

/** What tells two stored files are one collection. */
export interface CollectionMeta {
  editable: boolean;
  key?: string;
}

/**
 * Whether `a` and `b` are copies of one collection (ADR-002, D4): imported
 * files with the same key, so one coming in takes the other's place. A file
 * the player owns is never one: no import writes over it.
 */
export function sameCollection(a: CollectionMeta, b: CollectionMeta): boolean {
  return !a.editable && !b.editable && a.key !== undefined && a.key === b.key;
}
