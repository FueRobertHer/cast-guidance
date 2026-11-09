/**
 * A converted compendium stored a book at a time. One community compendium
 * holds 173 books and converts to 26 MB, past what one stored file may hold,
 * and no player wants every book of it in every picker. Each book becomes a
 * homebrew file of its own, with its own switch and its own place in the
 * merge order, and importing a book again replaces the copy stored before.
 *
 * Each entry goes with the book its `source` names. The converter declares a
 * source for each book it read, so an entry naming one it did not declare
 * gets a book of that id alone, rather than being lost.
 */
import { ValidationError } from '@/lib/guards';

export interface BookPart {
  /** The book's source id, as its entries name it. */
  sourceId: string;
  /** The book's full name, or its id when it has none. */
  full: string;
  /** A homebrew file of this book alone: the `_meta` with only its source, and its entries. */
  json: Record<string, unknown>;
}

/**
 * The most books one file is stored as. The largest compendium known holds
 * 173; a file citing a new book on every entry would otherwise become as many
 * stored files, each one a row on the Homebrew page and in the picker.
 */
export const MAX_BOOKS = 1000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Split a homebrew file into one file per book, in the order its `_meta`
 * declares them. A book with no entries is left out: it would add nothing.
 * Values beside the entry arrays and `_meta` go to every book. Throws
 * `ValidationError` for an entry with no source, whose book cannot be told.
 */
export function splitBooks(json: Record<string, unknown>): BookPart[] {
  const meta = isRecord(json._meta) ? json._meta : {};
  const declared = Array.isArray(meta.sources) ? meta.sources.filter(isRecord) : [];
  const books = new Map<
    string,
    { source: Record<string, unknown>; entries: Map<string, unknown[]> }
  >();
  const bookOf = (id: string, source: Record<string, unknown>) => {
    const key = id.toLowerCase();
    let book = books.get(key);
    if (book === undefined) {
      book = { source, entries: new Map() };
      books.set(key, book);
    }
    return book;
  };
  for (const s of declared) if (typeof s.json === 'string') bookOf(s.json, s);

  const shared: [string, unknown][] = [];
  for (const [key, value] of Object.entries(json)) {
    if (key === '_meta') continue;
    if (!Array.isArray(value)) {
      shared.push([key, value]);
      continue;
    }
    for (const entry of value) {
      const source = isRecord(entry) ? entry.source : undefined;
      if (typeof source !== 'string' || source === '') {
        throw new ValidationError(`a ${key} entry names no source, so its book is not known`);
      }
      const { entries } = bookOf(source, { json: source });
      let list = entries.get(key);
      if (list === undefined) {
        list = [];
        entries.set(key, list);
      }
      list.push(entry);
    }
  }

  let filled = 0;
  for (const { entries } of books.values()) if (entries.size > 0) filled += 1;
  if (filled > MAX_BOOKS) {
    throw new ValidationError(
      `the file holds ${filled.toLocaleString('en-US')} books, more than the ${MAX_BOOKS.toLocaleString('en-US')} one import can keep`,
    );
  }

  const parts: BookPart[] = [];
  for (const { source, entries } of books.values()) {
    if (entries.size === 0) continue;
    const sourceId = String(source.json);
    const full = typeof source.full === 'string' && source.full !== '' ? source.full : sourceId;
    parts.push({
      sourceId,
      full,
      json: {
        _meta: { ...meta, sources: [source] },
        ...Object.fromEntries(entries),
        ...Object.fromEntries(shared),
      },
    });
  }
  return parts;
}

/** The book a stored file holds, as a key: its one source id. Undefined for a file of several. */
export function bookKey(file: { sourceIds: readonly string[] }): string | undefined {
  return file.sourceIds.length === 1 ? file.sourceIds[0]?.toLowerCase() : undefined;
}

/** An entry's identity, as 5etools names one: `name|source`, lowercased. */
const uidOf = (name: string, source: string) => `${name}|${source}`.toLowerCase();

/**
 * A tag that names an entry and its book, `{@spell Ember Lance|FCEmber}`.
 * Neither part may hold a brace or a bar, so each try stops at the next one:
 * linear however the text is written.
 */
const TAG = /\{@\w+ ([^|{}]+)\|([^|{}]+)/g;
/** A whole string (or key) that is `name|source`, as `feats: [{ "ember fear|fcember": true }]`. */
const UID = /^([^|]+)\|([^|]+)$/;

/** The entries `entry` names, by uid: structural links, tags and `name|source` strings. */
function namedBy(entry: Record<string, unknown>): string[] {
  const out: string[] = [];
  const pair = (name: unknown, source: unknown) => {
    if (typeof name === 'string' && typeof source === 'string') out.push(uidOf(name, source));
  };
  const copy = entry._copy;
  if (isRecord(copy)) pair(copy.name, copy.source);
  pair(entry.raceName, entry.raceSource);
  pair(entry.className, entry.classSource);
  const text = (s: string) => {
    const whole = UID.exec(s);
    if (whole !== null) pair(whole[1], whole[2]);
    for (const m of s.matchAll(TAG)) pair(m[1], m[2]);
  };
  const stack: unknown[] = [entry];
  while (stack.length > 0) {
    const v = stack.pop();
    if (typeof v === 'string') text(v);
    else if (Array.isArray(v)) for (const item of v) stack.push(item);
    else if (isRecord(v)) {
      for (const [k, inner] of Object.entries(v)) {
        text(k);
        stack.push(inner);
      }
    }
  }
  return out;
}

/** Each entry of a homebrew file, as an object with a name and a source. */
function* entriesOf(
  json: Record<string, unknown>,
): Generator<[key: string, entry: Record<string, unknown>, name: string, source: string]> {
  for (const [key, value] of Object.entries(json)) {
    if (key === '_meta' || !Array.isArray(value)) continue;
    for (const entry of value) {
      if (isRecord(entry) && typeof entry.name === 'string' && typeof entry.source === 'string') {
        yield [key, entry, entry.name, entry.source];
      }
    }
  }
}

/**
 * The parts of `books` one character uses: the entries it picked (`refs`),
 * and what those need (a subrace's race, a subclass's class, what a `_copy`
 * copies, and any entry another names in a tag or as `name|source`, such as
 * a background's feat), followed across all of them until nothing more is
 * needed: a background in one book can grant a feat from another. Each part
 * is marked in `_meta.convertedFrom.subset`, so the device that imports it
 * knows it is not the whole book. Undefined, at a book's index, where the
 * character uses none of that book's entries.
 */
export function bookParts(
  books: readonly Record<string, unknown>[],
  refs: readonly { name: string; source: string }[],
): (Record<string, unknown> | undefined)[] {
  const byUid = new Map<string, Record<string, unknown>[]>();
  for (const json of books) {
    for (const [, entry, name, source] of entriesOf(json)) {
      const uid = uidOf(name, source);
      const same = byUid.get(uid);
      if (same === undefined) byUid.set(uid, [entry]);
      else same.push(entry);
    }
  }
  const kept = new Set<Record<string, unknown>>();
  const queue: Record<string, unknown>[] = [];
  const take = (uid: string) => {
    const same = byUid.get(uid);
    if (same === undefined) return;
    // Taken once, for good: an entry named again costs nothing more.
    byUid.delete(uid);
    for (const entry of same) {
      if (kept.has(entry)) continue;
      kept.add(entry);
      queue.push(entry);
    }
  };
  for (const ref of refs) take(uidOf(ref.name, ref.source));
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const uid of namedBy(next)) take(uid);
  }
  return books.map((json) => partOf(json, kept));
}

/** `json` with only the `kept` entries, marked as a part; undefined when none are kept. */
function partOf(
  json: Record<string, unknown>,
  kept: ReadonlySet<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const meta = isRecord(json._meta) ? json._meta : {};
  const from = isRecord(meta.convertedFrom) ? meta.convertedFrom : {};
  const out: Record<string, unknown> = {
    _meta: { ...meta, convertedFrom: { ...from, subset: true } },
  };
  let any = false;
  for (const [key, value] of Object.entries(json)) {
    if (key === '_meta') continue;
    if (!Array.isArray(value)) {
      out[key] = value;
      continue;
    }
    const entries = value.filter((e) => isRecord(e) && kept.has(e));
    if (entries.length > 0) {
      out[key] = entries;
      any = true;
    }
  }
  return any ? out : undefined;
}

/**
 * What a homebrew file's own `_meta` says it is: one book of a converted
 * compendium (its name), and whether only a part of that book.
 */
export function bookOf(json: Record<string, unknown>): { book?: string; subset?: true } {
  const meta = isRecord(json._meta) ? json._meta : {};
  const sources = Array.isArray(meta.sources) ? meta.sources.filter(isRecord) : [];
  const source = sources[0];
  if (!isRecord(meta.convertedFrom) || sources.length !== 1 || source === undefined) return {};
  const id = typeof source.json === 'string' ? source.json : '';
  const book = typeof source.full === 'string' && source.full !== '' ? source.full : id;
  if (book === '') return {};
  return meta.convertedFrom.subset === true ? { book, subset: true } : { book };
}

/** The shape {@link bookHolders} reads of a file: its sources, whether a part, and its content. */
export interface BookFile {
  sourceIds: readonly string[];
  subset?: true;
  json: unknown;
}

/**
 * The stored files that make a part of a book (`row`) unneeded: those, other
 * than parts, that declare its source, when between them they hold every
 * entry the part has. Empty when `row` is not a part, or when an entry of it
 * is missing here (an older conversion of the book, say), so the part is
 * still worth storing.
 */
export function bookHolders<T extends BookFile>(row: BookFile, stored: readonly T[]): T[] {
  const key = bookKey(row);
  if (row.subset !== true || key === undefined || !isRecord(row.json)) return [];
  const holders = stored.filter(
    (f) => f.subset !== true && f.sourceIds.some((s) => s.toLowerCase() === key),
  );
  if (holders.length === 0) return [];
  const have = new Set<string>();
  for (const f of holders) {
    if (!isRecord(f.json)) continue;
    for (const [kind, , name, source] of entriesOf(f.json))
      have.add(`${kind}:${uidOf(name, source)}`);
  }
  for (const [kind, , name, source] of entriesOf(row.json)) {
    if (!have.has(`${kind}:${uidOf(name, source)}`)) return [];
  }
  return holders;
}
