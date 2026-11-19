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

/**
 * The book the Workshop keeps the player's own entries in: one file per
 * device, made on the first save. Its entries are `name|MyHomebrew`, apart
 * from every official printing of the same name.
 */
export const WORKSHOP_SOURCE = 'MyHomebrew';

/**
 * The file the player's changes to the books are kept in (ADR-002, D2): one
 * per device, made on the first change saved, and known by its row's
 * `role`, which only the app sets. Its entries keep the book's own name and
 * source; the file declares this source of its own beside them.
 */
export const CHANGES_SOURCE = 'MyChanges';

/**
 * Where in `_meta` a collection made in the app keeps the id it is stamped
 * with when it is made: random, so two players' collections of one name and
 * source are never one, and kept through every save, export and import, so
 * a newer copy of one player's collection still updates the older one.
 */
export const COLLECTION_ID_KEY = 'castGuidanceCollection';

/** The longest stamp read: a random uuid is 36 characters. */
const COLLECTION_ID_LENGTH = 64;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The id a file made in the app is stamped with (`COLLECTION_ID_KEY`), or
 * undefined for one that has none: a file made anywhere else, or one made
 * here before stamps and not saved since. It comes in with imported files,
 * so only a short string of its own is read.
 */
export function collectionIdOf(json: unknown): string | undefined {
  const meta = isRecord(json) && Object.hasOwn(json, '_meta') ? json._meta : undefined;
  if (!isRecord(meta) || !Object.hasOwn(meta, COLLECTION_ID_KEY)) return undefined;
  const id = meta[COLLECTION_ID_KEY];
  return typeof id === 'string' && id.trim() !== '' && id.length <= COLLECTION_ID_LENGTH
    ? id
    : undefined;
}

/** `json` stamped with `id` in its `_meta`. A file with no `_meta` object is left as it is. */
export function withCollectionId(
  json: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  return isRecord(json._meta)
    ? { ...json, _meta: { ...json._meta, [COLLECTION_ID_KEY]: id } }
    : json;
}

/** What a stored file's collection key is made of. */
export interface CollectionKeyParts {
  url?: string;
  sourceIds: readonly string[];
  fileName: string;
  /** Set on one book of a converted compendium. */
  book?: string;
  /** The id a collection made in the app is stamped with (`collectionIdOf`). */
  made?: string;
}

/** The sources the app makes its own files under, lowercased. */
const APP_SOURCES = new Set([WORKSHOP_SOURCE.toLowerCase(), CHANGES_SOURCE.toLowerCase()]);

/**
 * The collection an imported file is, as a key that survives a new content
 * hash (ADR-002, D4): importing a file with the key of one stored updates
 * that one in place, so it keeps its switch, its place in this order and its
 * pack's settings. A book of a converted compendium is keyed by its book and
 * the file it came from, as one stored copy of a book stands for
 * (`sameBookCopy`): every book of one file shares that file's link and its
 * `_meta`. A collection made in the app is keyed by the id it was stamped
 * with. One made under the app's own source before stamps has no key, so it
 * lands beside every other: every device's Workshop file has one name and
 * source. Any other file is keyed by its link, else by its first source and
 * its file name (`fileKey`, so a second download's ` (1)` is the same file).
 * Synchronous, so the database upgrade can key the files already stored.
 */
export function collectionKey(f: CollectionKeyParts): string | undefined {
  const first = (f.sourceIds[0] ?? '').toLowerCase();
  if (f.book !== undefined) return `book:${first}|${fileKey(f.fileName)}`;
  if (f.made !== undefined) return `made:${f.made}`;
  if (APP_SOURCES.has(first)) return undefined;
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
 * the player owns is never one: no import writes over it. Nor is a file with
 * no key (`collectionKey`).
 */
export function sameCollection(a: CollectionMeta, b: CollectionMeta): boolean {
  return !a.editable && !b.editable && a.key !== undefined && a.key === b.key;
}
