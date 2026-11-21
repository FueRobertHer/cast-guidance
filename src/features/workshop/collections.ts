/**
 * The stored homebrew files as the Workshop's Collections shelf lists them
 * (ADR-002, D1): a file is one collection, and the books one compendium was
 * stored as are one together. Copies of
 * one collection that sit side by side (one key, E1) are one collection too.
 *
 * A collection's address outlives an update (D4), since a row's id is its
 * content's hash and changes with every update:
 * - a file the player made: its id, which never changes;
 * - an imported file: its key (`url:`, `file:` or `made:`), kept through an
 *   update, else its id;
 * - a compendium's books: `books:` and the file they came from, the part of
 *   each book's key they share.
 *
 * A row's id or key also finds its collection, so an address from before
 * keys (a bookmark, an old link) still opens it while that row is here, and a
 * `url:` address finds the collection that came from that link.
 * `books` is The books, never a collection: every other address has a
 * prefix, or is a uuid or a hash.
 */
import { fileKey } from '@/db/homebrewBooks';
import type { HomebrewFileMeta } from '@/db/homebrewRepo';

export interface Collection {
  /**
   * Its address: unique among collections, and the same after an update. Not
   * always a row id (an imported file's is its key, a compendium's is
   * `books:`), so never give it to the repository: use `fileId` or `rows`.
   */
  id: string;
  /**
   * Its first row's id (`rows[0].id`), what `id` was before keys, for
   * `homebrewRepo`. For a single file it is the file: a file you made is
   * always one row, and its id never changes. A compendium or copies hold
   * several rows, and this names one of them (a compendium's books came in
   * together, so which one is arbitrary): work on each of `rows` instead. An
   * imported file's row id changes with every update.
   */
  fileId: string;
  name: string;
  /** Where it came from, in words. */
  from: string;
  /** The file, each book of the compendium, or each copy, newest first. */
  rows: HomebrewFileMeta[];
  /** How many entries it holds, over every row. */
  entries: number;
}

export const collectionPath = (id: string) => `/workshop/collection/${encodeURIComponent(id)}`;

/** The address of The books, the game data's own page. */
export const BOOKS_ID = 'books';
export const BOOKS_PATH = collectionPath(BOOKS_ID);

const total = (rows: readonly HomebrewFileMeta[]) =>
  rows.reduce((n, r) => n + Object.values(r.counts).reduce((a, b) => a + b, 0), 0);

/** What puts rows in one collection: the books of one file, or one key. */
function groupKey(r: HomebrewFileMeta): string {
  if (r.book !== undefined) return `books:${fileKey(r.fileName)}`;
  return r.key ?? r.id;
}

function fromOf(rows: readonly HomebrewFileMeta[]): string {
  const [r] = rows;
  if (r === undefined) return '';
  const link = r.url === undefined ? '' : ', from a link';
  if (rows.length > 1 && r.book !== undefined) return `A compendium of ${rows.length} books${link}`;
  if (rows.length > 1) return `A homebrew file${link}, ${rows.length} copies here`;
  if (r.editable) return 'Yours. Made in this app';
  if (r.subset === true) return 'Part of a book, what a character brought';
  if (r.book !== undefined) return 'One book of a compendium';
  return r.url === undefined ? 'A homebrew file you imported' : 'A homebrew file, from a link';
}

function nameOf(rows: readonly HomebrewFileMeta[], names: ReadonlyMap<string, string>): string {
  const [r] = rows;
  if (r === undefined) return '';
  if (rows.length > 1) return r.fileName;
  return names.get(r.id) ?? r.book ?? r.fileName;
}

/**
 * Every collection in `rows` (newest first, as the shelf lists them),
 * placed where its newest row falls. `names` are the names the
 * player gave the files they made, by id.
 */
export function collectionsOf(
  rows: readonly HomebrewFileMeta[],
  names: ReadonlyMap<string, string> = new Map(),
): Collection[] {
  const groups = new Map<string, HomebrewFileMeta[]>();
  for (const r of rows) {
    const key = groupKey(r);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [r]);
    else group.push(r);
  }
  const out: Collection[] = [];
  for (const [id, members] of groups) {
    const [newest] = members;
    if (newest === undefined) continue;
    out.push({
      id,
      fileId: newest.id,
      name: nameOf(members, names),
      from: fromOf(members),
      rows: members,
      // Copies of one file hold much the same: the newest says how much.
      entries: total(members[0]?.book === undefined ? members.slice(0, 1) : members),
    });
  }
  return out;
}

/**
 * The collection at an address: its own, else the collection one of whose
 * rows has that id or key.
 */
export function collectionWith(
  address: string,
  rows: readonly HomebrewFileMeta[],
  names?: ReadonlyMap<string, string>,
): Collection | undefined {
  const all = collectionsOf(rows, names);
  const link = address.startsWith('url:') ? address.slice('url:'.length) : undefined;
  return (
    all.find((c) => c.id === address) ??
    all.find((c) => c.rows.some((r) => r.id === address || r.key === address)) ??
    // A copy stamped since keys by its stamp (`made:`), and still from that link.
    (link === undefined ? undefined : all.find((c) => c.rows.some((r) => r.url === link)))
  );
}

/**
 * How much a collection holds and whether this device uses it ("2 entries.
 * On"). Only the device: a character can turn a collection off for itself
 * (`sourceSwitches`), so "on" is never "on for every character". `isOn` reads
 * a row as on; its switch alone by default, and the page passes its own
 * reading, which The books' choice of what shows can also hide.
 */
export function holdsOf(
  c: Collection,
  isOn: (r: HomebrewFileMeta) => boolean = (r) => r.enabled,
): string {
  const holds = c.entries === 0 ? 'Empty' : `${c.entries} ${c.entries === 1 ? 'entry' : 'entries'}`;
  const on = c.rows.filter(isOn).length;
  const of = c.rows[0]?.book === undefined ? 'copies' : 'books';
  const where =
    on === c.rows.length ? 'On' : on === 0 ? 'Off' : `${on} of ${c.rows.length} ${of} on`;
  return `${holds}. ${where}`;
}

/** The name the player gave a file they made: its book's full name. */
export function madeName(json: Record<string, unknown>): string | undefined {
  const meta = json._meta;
  const sources =
    typeof meta === 'object' && meta !== null ? (meta as { sources?: unknown }).sources : undefined;
  const first = Array.isArray(sources) ? (sources[0] as { full?: unknown } | undefined) : undefined;
  return typeof first?.full === 'string' && first.full.trim() !== '' ? first.full : undefined;
}
