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
 *
 * `books` go in merge order: where two copies of a book (from two files)
 * hold the same entry, only the first one's is used, so only it goes.
 */
export function bookParts(
  books: readonly Record<string, unknown>[],
  refs: readonly { name: string; source: string }[],
): (Record<string, unknown> | undefined)[] {
  const byUid = new Map<string, Record<string, unknown>[]>();
  const first = new Set<string>();
  for (const json of books) {
    for (const [kind, entry, name, source] of entriesOf(json)) {
      const uid = uidOf(name, source);
      if (first.has(`${kind}:${uid}`)) continue;
      first.add(`${kind}:${uid}`);
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

/**
 * The compendium file a book came from, as a key: the file's name without
 * its folder, its extension or the ` (1)` a browser adds to a second
 * download, lowercased. A book is stored once per file it came from, so
 * importing that file again replaces its copy and leaves another file's.
 */
export function fileKey(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').toLowerCase();
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 && base.length - dot <= 9 ? base.slice(0, dot) : base;
  return stem.replace(/ \(\d{1,4}\)$/, '').trim();
}

/** What the book checks read of a file's metadata: what it holds and where it came from. */
export interface BookMeta {
  sourceIds: readonly string[];
  fileName: string;
  /** Set on a book of a converted compendium (see {@link bookOf}). */
  book?: string;
  subset?: true;
}

/** {@link BookMeta} with the file's content. */
export interface BookFile extends BookMeta {
  json: unknown;
}

/** Whether `a` and `b` are copies of one book from one file: what one stored copy stands for. */
export function sameBookCopy(a: BookMeta, b: BookMeta): boolean {
  if (a.book === undefined || b.book === undefined) return false;
  const key = bookKey(a);
  return key !== undefined && key === bookKey(b) && fileKey(a.fileName) === fileKey(b.fileName);
}

/** By its metadata alone, a file {@link oldWholeImports} may name: no book. */
export function mayBeOldWholeImport(f: BookMeta): boolean {
  return f.book === undefined;
}

/**
 * The stored files that hold the compendium `fileName` converted whole: how a
 * compendium was stored before it was stored a book at a time, first as one
 * source named after the file, later as one file declaring each book's
 * source. Importing the file again replaces them, or every entry would show
 * twice, once from the old file and once from its book.
 */
export function oldWholeImports<T extends BookFile>(fileName: string, stored: readonly T[]): T[] {
  const key = fileKey(fileName);
  return stored.filter((f) => {
    if (!mayBeOldWholeImport(f) || !isRecord(f.json)) return false;
    const meta = isRecord(f.json._meta) ? f.json._meta : {};
    const from = meta.convertedFrom;
    if (!isRecord(from) || from.subset === true) return false;
    const origin = typeof from.fileName === 'string' ? from.fileName : f.fileName;
    return fileKey(origin) === key || fileKey(f.fileName) === key;
  });
}

/** `kind:name|source` of every entry: an entry's identity within one kind. */
function entryKeys(json: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRecord(json)) return out;
  for (const [kind, , name, source] of entriesOf(json)) out.add(`${kind}:${uidOf(name, source)}`);
  return out;
}

/**
 * The stored files that make a book coming in (`row`, whole or a part)
 * unneeded: every stored file declaring its source (a copy of the book from
 * any file, a part included), when between them they hold every entry it has. Empty when `row` is no book, or when an entry
 * of it is missing here (an older conversion of the book, say), so it still
 * has something to add.
 */
export function bookHolders<T extends BookFile>(row: BookFile, stored: readonly T[]): T[] {
  const key = bookKey(row);
  if (row.book === undefined || key === undefined || !isRecord(row.json)) return [];
  const holders = stored.filter((f) => f.sourceIds.some((s) => s.toLowerCase() === key));
  if (holders.length === 0) return [];
  const have = new Set<string>();
  for (const f of holders) for (const k of entryKeys(f.json)) have.add(k);
  for (const [kind, , name, source] of entriesOf(row.json)) {
    if (!have.has(`${kind}:${uidOf(name, source)}`)) return [];
  }
  return holders;
}

/**
 * One copy of a book from what is stored and what comes in: the stored
 * entries as they are, then each entry coming in that the stored copy lacks.
 * The stored copy wins an entry both hold, as the copy imported first wins
 * between files. A part stays a part only while both are parts; a whole
 * book coming in makes the copy whole. `added` counts the entries taken in.
 */
export function mergeBook(
  stored: Record<string, unknown>,
  incoming: Record<string, unknown>,
): { json: Record<string, unknown>; added: number } {
  const have = entryKeys(stored);
  // Only entries of the book itself: a part carrying another book's entry (a
  // hand-edited export, say) must not give that entry this copy's place.
  const meta = isRecord(stored._meta) ? stored._meta : {};
  const own = new Set(
    (Array.isArray(meta.sources) ? meta.sources : [])
      .map((s) => (isRecord(s) && typeof s.json === 'string' ? s.json.toLowerCase() : undefined))
      .filter((s) => s !== undefined),
  );
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stored)) {
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  let added = 0;
  for (const [kind, entry, name, source] of entriesOf(incoming)) {
    const k = `${kind}:${uidOf(name, source)}`;
    if (have.has(k) || !own.has(source.toLowerCase())) continue;
    have.add(k);
    const list = out[kind];
    if (Array.isArray(list)) list.push(entry);
    else out[kind] = [entry];
    added += 1;
  }
  const part = (json: Record<string, unknown>) => {
    const meta = isRecord(json._meta) ? json._meta : {};
    return isRecord(meta.convertedFrom) && meta.convertedFrom.subset === true;
  };
  if (part(stored) && !part(incoming)) {
    const from = isRecord(meta.convertedFrom) ? meta.convertedFrom : {};
    out._meta = {
      ...meta,
      convertedFrom: Object.fromEntries(Object.entries(from).filter(([k]) => k !== 'subset')),
    };
  }
  return { json: out, added };
}
