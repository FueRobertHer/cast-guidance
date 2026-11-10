import {
  assertHomebrewFile,
  assertJsonWithinLimits,
  homebrewEntityCounts,
  sha256Hex,
} from '@/lib/guards';
import { db, type HomebrewFileRow, type HomebrewMetaRow } from './db';
import {
  bookOf,
  mayBeOldWholeImport,
  oldWholeImports,
  sameBookCopy,
  splitBooks,
} from './homebrewBooks';
import { compareMergeOrder } from './homebrewOrder';

/** A file to be stored a book at a time, as {@link homebrewRepo.prepareBooks} gives it. */
export interface PreparedBooks {
  /**
   * The whole file, for the preview alone. It is never stored, so it is held
   * to no size limit of its own: each book is.
   */
  whole: HomebrewFileRow;
  /** One row per book, each checked and hashed as a file of its own. */
  books: HomebrewFileRow[];
}

/** What storing a file's books did. */
export interface CommittedBooks {
  /** The books stored, as stored. */
  added: HomebrewFileRow[];
  /** Books stored before from another copy, which those replaced. */
  replaced: number;
  /** Books already here exactly as they are, so left alone. */
  same: number;
}

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
    // One book of a converted compendium says so in its `_meta`, wherever
    // it comes from: an import, a download of it, or a character's export.
    ...bookOf(json),
  };
}

/**
 * A stored row that has crossed the read boundary: the stored shape, but with
 * `json` narrowed from `unknown` to a JSON object. That narrowing is what lets
 * callers index into `json` without an unchecked cast.
 */
export interface HomebrewFile extends Omit<HomebrewFileRow, 'json'> {
  json: Record<string, unknown>;
}

/** A stored file's metadata, read: everything a list or a toggle needs, without the content. */
export type HomebrewFileMeta = Omit<HomebrewFile, 'json'>;

export interface HomebrewReadError {
  id?: string;
  fileName?: string;
  message: string;
}

export interface HomebrewListResult {
  files: HomebrewFile[];
  errors: HomebrewReadError[];
}

export interface HomebrewMetaListResult {
  files: HomebrewFileMeta[];
  errors: HomebrewReadError[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Finite numbers only: NaN and Infinity survive a JSON round trip as nulls. */
function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Read one stored homebrew row, or say why it cannot be read (REL-006).
 *
 * The split between what is repaired and what is refused follows what the rest
 * of the app does with each field. `id` and `json` are dereferenced everywhere
 * (the registry merges `json[type]`, every write addresses the row by `id`), so
 * a row missing either is not a homebrew file and is reported rather than
 * handed on. Everything else is presentation the app can supply a sane value
 * for, and a file whose counts went missing is still the user's content: it is
 * repaired, not hidden.
 */
function readHomebrewRow(row: unknown): HomebrewFile | HomebrewReadError {
  const meta = readHomebrewMeta(row);
  if (isReadError(meta)) return meta;
  const json = (row as Record<string, unknown>).json;
  if (!isRecord(json)) {
    return {
      id: meta.id,
      fileName: meta.fileName,
      message: 'the file content is missing or is not a JSON object',
    };
  }
  return { ...meta, json };
}

/** A stored row's metadata, or why it cannot be read: {@link readHomebrewRow} without the content. */
function readHomebrewMeta(row: unknown): HomebrewFileMeta | HomebrewReadError {
  if (!isRecord(row)) return { message: `expected a stored row, got ${typeof row}` };
  const id = row.id;
  const fileName = typeof row.fileName === 'string' ? row.fileName : undefined;
  if (typeof id !== 'string' || id === '') {
    return { fileName, message: 'the row has no id, so nothing can address it' };
  }
  const counts = isRecord(row.counts) ? row.counts : {};
  return {
    id,
    fileName: fileName ?? `${id}.json`,
    url: typeof row.url === 'string' ? row.url : undefined,
    enabled: row.enabled !== false,
    editable: row.editable === true,
    sourceIds: Array.isArray(row.sourceIds)
      ? row.sourceIds.filter((s) => typeof s === 'string')
      : [],
    counts: Object.fromEntries(
      Object.entries(counts).map(([k, v]) => [k, numberOr(v, 0)] as const),
    ),
    addedAt: numberOr(row.addedAt, 0),
    rev: typeof row.rev === 'number' && Number.isFinite(row.rev) ? row.rev : undefined,
    ...(typeof row.book === 'string' && row.book !== '' ? { book: row.book } : {}),
    ...(row.subset === true ? { subset: true as const } : {}),
  };
}

function isReadError<T extends object>(v: T | HomebrewReadError): v is HomebrewReadError {
  return 'message' in v;
}

/**
 * Read a batch of stored rows, collecting per-row failures instead of throwing.
 * Pure and unit-testable; backs every homebrew read the app makes, the same way
 * {@link partitionCharacterRows} backs the character list.
 */
export function partitionHomebrewRows(rows: readonly unknown[]): HomebrewListResult {
  const files: HomebrewFile[] = [];
  const errors: HomebrewReadError[] = [];
  for (const row of rows) {
    const read = readHomebrewRow(row);
    if (isReadError(read)) errors.push(read);
    else files.push(read);
  }
  return { files, errors };
}

/** {@link partitionHomebrewRows} for metadata alone: a row without its content is no error here. */
export function partitionHomebrewMeta(rows: readonly unknown[]): HomebrewMetaListResult {
  const files: HomebrewFileMeta[] = [];
  const errors: HomebrewReadError[] = [];
  for (const row of rows) {
    const read = readHomebrewMeta(row);
    if (isReadError(read)) errors.push(read);
    else files.push(read);
  }
  return { files, errors };
}

/**
 * Stored rows with their content put back on, as the readers take them. A
 * `json` still on the row (written before the content had a table of its
 * own) is used when the content table has none.
 */
export async function withContent(rows: readonly HomebrewMetaRow[]): Promise<unknown[]> {
  const bodies = await db.homebrewJson.bulkGet(rows.map((row) => row.id));
  return rows.map((row, i) => ({ ...row, json: bodies[i]?.json ?? row.json }));
}

/**
 * Write a whole file: its metadata to `homebrewFiles`, its content to
 * `homebrewJson`. The caller holds a transaction over both tables.
 */
export async function putHomebrewRow(
  row: HomebrewFileRow,
  how: 'put' | 'add' = 'put',
): Promise<void> {
  const { json, ...meta } = row;
  if (how === 'add') await db.homebrewFiles.add(meta);
  else await db.homebrewFiles.put(meta);
  await db.homebrewJson.put({ id: row.id, json });
}

/** Newest import first; ties break on the id descending. */
function newestFirst(a: HomebrewFileMeta, b: HomebrewFileMeta): number {
  return b.addedAt - a.addedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * The book the Workshop keeps the player's own entries in: one file per
 * device, made on the first save. Its entries are `name|MyHomebrew`, apart
 * from every official printing of the same name.
 */
export const WORKSHOP_SOURCE = 'MyHomebrew';
const WORKSHOP_TITLE = 'My homebrew';

/** An entry's identity in a file: its name and its book, compared without case. */
export interface EntryKey {
  name: string;
  source: string;
}

function isEntry(e: unknown, key: EntryKey): boolean {
  return (
    isRecord(e) &&
    typeof e.name === 'string' &&
    typeof e.source === 'string' &&
    e.name.toLowerCase() === key.name.toLowerCase() &&
    e.source.toLowerCase() === key.source.toLowerCase()
  );
}

/** The player's Workshop file among stored rows: theirs to edit, in the Workshop's book. */
function isWorkshopFile(row: HomebrewFileMeta): boolean {
  return row.editable && row.sourceIds[0] === WORKSHOP_SOURCE;
}

/** A save refused because another entry of that type already has the name and book. */
export class EntryClash extends Error {}

type Row = Record<string, unknown>;
const eq = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Entries that belong to another and are saved and deleted with it, found as
 * the sheet finds them: a subclass's own features (by class, short name, the
 * subclass's book and level) and a class's (by class name, its book and level).
 *
 * A class does not own its subclasses. Each is an entry of its own with its own
 * editor, saves and features, and a class saved without them must not drop or
 * rewrite them; one renamed takes the file's subclasses of it along (`carry`).
 */
const OWNED: Readonly<
  Record<
    string,
    {
      type: string;
      /** Two owners whose features could not be told apart. */
      peer: (a: Row, b: Row) => boolean;
      owns: (owner: Row, e: Row) => boolean;
      /** What tells two owned entries apart. */
      key: (e: Row) => string;
      /** What follows the owner when it is saved under another name or book. */
      carry?: (json: Row, before: Row, after: Row) => void;
    }
  >
> = {
  subclass: {
    type: 'subclassFeature',
    peer: (a, b) =>
      eq(a.className, b.className) && eq(a.shortName, b.shortName) && eq(a.source, b.source),
    owns: (s, f) =>
      eq(f.className, s.className) &&
      eq(f.subclassShortName, s.shortName) &&
      eq(f.subclassSource, s.source),
    key: (f) => `${f.name}|${f.className}|${f.subclassShortName}|${f.subclassSource}|${f.level}`,
  },
  class: {
    type: 'classFeature',
    peer: (a, b) => eq(a.name, b.name) && eq(a.source, b.source),
    owns: (c, f) => eq(f.className, c.name) && eq(f.classSource, c.source),
    key: (f) => `${f.name}|${f.className}|${f.classSource}|${f.level}`,
    carry: carrySubclasses,
  },
};

/**
 * The file's subclasses of a class saved under another name or book, and their
 * features, moved to it: the sheet finds them by the class's name and book.
 */
function carrySubclasses(json: Row, before: Row, after: Row): void {
  if (eq(before.name, after.name) && eq(before.source, after.source)) return;
  const of = (e: Row) => eq(e.className, before.name) && eq(e.classSource, before.source);
  const moved = (e: unknown) =>
    isRecord(e) && of(e) ? { ...e, className: after.name, classSource: after.source } : e;
  // A subclass lists its features as `Name|Class|ClassSource|Short|Source|Level`.
  const ref = (r: unknown) => {
    if (typeof r !== 'string') return r;
    const parts = r.split('|');
    if (!eq(parts[1], before.name) || !eq(parts[2] || 'PHB', before.source)) return r;
    parts[1] = String(after.name);
    parts[2] = String(after.source);
    return parts.join('|');
  };
  const refs = (list: unknown) =>
    Array.isArray(list)
      ? list.map((x) =>
          isRecord(x) && typeof x.subclassFeature === 'string'
            ? { ...x, subclassFeature: ref(x.subclassFeature) }
            : ref(x),
        )
      : list;
  if (Array.isArray(json.subclass)) {
    json.subclass = json.subclass.map((s) => {
      if (!isRecord(s) || !of(s)) return s;
      const out = moved(s) as Row;
      if (s.subclassFeatures !== undefined) out.subclassFeatures = refs(s.subclassFeatures);
      return out;
    });
  }
  if (Array.isArray(json.subclassFeature)) json.subclassFeature = json.subclassFeature.map(moved);
}

/** True when entries of this type own others, which save and go with them. */
export const ownsEntries = (type: string): boolean => OWNED[type] !== undefined;

/**
 * `json` without the entries `owner` owns, unless another entry of its type
 * (`others`) has the same owner identity, so the owned ones may be its too.
 */
function withoutOwned(json: Row, type: string, owner: unknown, others: readonly unknown[]): void {
  const own = OWNED[type];
  if (own === undefined || !isRecord(owner)) return;
  if (others.some((o) => isRecord(o) && own.peer(o, owner))) return;
  const list = json[own.type];
  if (Array.isArray(list)) json[own.type] = list.filter((e) => !isRecord(e) || !own.owns(owner, e));
}

/** A new file the player owns, with no entries yet. */
function editableRow(fullName: string, abbreviation: string): HomebrewFileRow {
  return {
    id: crypto.randomUUID(),
    fileName: `${fullName.replaceAll(/[^\w-]+/g, '_')}.json`,
    json: {
      _meta: {
        sources: [
          { json: abbreviation, abbreviation, full: fullName, authors: [], version: '1.0.0' },
        ],
      },
    },
    enabled: true,
    editable: true,
    sourceIds: [abbreviation],
    counts: {},
    addedAt: Date.now(),
  };
}

/**
 * Write new content to a file the player owns, bumping `rev` so the registry
 * and the search index notice a change under the same id. The caller holds a
 * transaction over both tables. False when the row is gone.
 */
async function rewrite(id: string, json: Record<string, unknown>): Promise<boolean> {
  const count = await db.homebrewFiles
    .where('id')
    .equals(id)
    .modify((row) => {
      delete row.json;
      row.counts = homebrewEntityCounts(json);
      row.rev = (row.rev ?? 0) + 1;
    });
  if (count > 0) await db.homebrewJson.put({ id, json });
  return count > 0;
}

/** A stored file the player owns, with its content, or why it cannot take a save. */
async function ownedFile(id: string): Promise<HomebrewFile> {
  const row = await db.homebrewFiles.get(id);
  if (row === undefined) throw new Error('that homebrew file is no longer on this device');
  const read = partitionHomebrewRows(await withContent([row]));
  const file = read.files[0];
  if (file === undefined) throw new Error(read.errors[0]?.message ?? 'the file could not be read');
  if (!file.editable) throw new Error('that file was imported, so it cannot be changed here');
  return file;
}

export const homebrewRepo = {
  /** Every stored homebrew file, newest first. */
  async listSafe(): Promise<HomebrewListResult> {
    // Unordered read, sorted after, rather than `orderBy('addedAt')`: Dexie
    // leaves a row out of an index traversal when its indexed key is missing,
    // so the damaged rows this exists to report are the ones an ordered read
    // would never hand it. Ties break on the id descending, as the reversed
    // traversal did, so a same-millisecond import keeps its order.
    const result = partitionHomebrewRows(await withContent(await db.homebrewFiles.toArray()));
    result.files.sort(newestFirst);
    return result;
  },

  /** {@link homebrewRepo.listSafe} without the content: what a list of files or of sources needs. */
  async listMetaSafe(): Promise<HomebrewMetaListResult> {
    const result = partitionHomebrewMeta(await db.homebrewFiles.toArray());
    result.files.sort(newestFirst);
    return result;
  },

  /**
   * The enabled files only, with the errors from the whole set.
   *
   * Oldest import first. This is the merge order, and so the precedence: the
   * earliest import wins a `name|source` tie with another homebrew file, and
   * official data always wins (see {@link compareMergeOrder}). A row whose
   * `addedAt` was lost reads as 0, so it sorts first rather than moving.
   */
  async enabledSafe(): Promise<HomebrewListResult> {
    return db.transaction('r', db.homebrewFiles, db.homebrewJson, async () => {
      const rows = await db.homebrewFiles.toArray();
      // The disabled rows' errors too, without paying for their content.
      const off = partitionHomebrewMeta(rows.filter((row) => row.enabled === false));
      const read = partitionHomebrewRows(
        await withContent(rows.filter((row) => row.enabled !== false)),
      );
      return {
        files: read.files.filter((r) => r.enabled).sort(compareMergeOrder),
        errors: [...read.errors, ...off.errors],
      };
    });
  },

  /**
   * {@link homebrewRepo.enabledSafe} without the content, in the same order:
   * enough for the registry to tell whether what it holds is current.
   */
  async enabledMetaSafe(): Promise<HomebrewMetaListResult> {
    const { files, errors } = partitionHomebrewMeta(await db.homebrewFiles.toArray());
    return { files: files.filter((r) => r.enabled).sort(compareMergeOrder), errors };
  },

  /**
   * One file by id, with all three outcomes distinct: no row, an unreadable
   * row, and a file. A caller that cannot tell "still loading" from "no such
   * file" shows a spinner forever over a file deleted in another tab.
   */
  async getSafe(id: string): Promise<{ file?: HomebrewFile; error?: HomebrewReadError }> {
    const row = await db.homebrewFiles.get(id);
    if (row === undefined) return {};
    const { files, errors } = partitionHomebrewRows(await withContent([row]));
    return { file: files[0], error: errors[0] };
  },

  /**
   * Validate a homebrew JSON file into the row an import would store, writing
   * nothing. The first half of an import: a preview reads this row, and
   * {@link homebrewRepo.commit} stores it once the player says so.
   */
  prepare(raw: unknown, fileName: string, url?: string): Promise<HomebrewFileRow> {
    return buildHomebrewRow(raw, fileName, url);
  },

  /**
   * Store a prepared row unless the same content is already here
   * (content-hash keyed, so this is idempotent). `duplicate` says which
   * happened, and `row` is what the database holds either way.
   *
   * The row is stamped with the time of the commit, not of the prepare: the
   * merge order counts imports from when they land, so a preview left open
   * cannot jump ahead of a file imported while it was showing.
   */
  async commit(prepared: HomebrewFileRow): Promise<{ row: HomebrewFileRow; duplicate: boolean }> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const existing = await db.homebrewFiles.get(prepared.id);
      if (existing !== undefined) {
        const [stored] = await withContent([existing]);
        return { row: stored as HomebrewFileRow, duplicate: true };
      }
      const row: HomebrewFileRow = { ...prepared, addedAt: Date.now() };
      await putHomebrewRow(row);
      return { row, duplicate: false };
    });
  },

  /**
   * Validate a homebrew file into one row per book, writing nothing: the
   * first half of importing a converted compendium, as {@link prepare} is for
   * a file stored whole. Each book is held to the limits of one file.
   */
  async prepareBooks(raw: unknown, fileName: string, url?: string): Promise<PreparedBooks> {
    const { json } = assertHomebrewFile(raw);
    const books: HomebrewFileRow[] = [];
    for (const part of splitBooks(json)) {
      books.push({ ...(await buildHomebrewRow(part.json, fileName, url)), book: part.full });
    }
    const whole: HomebrewFileRow = {
      id: '',
      fileName,
      url,
      json,
      enabled: true,
      editable: false,
      sourceIds: books.flatMap((b) => b.sourceIds),
      counts: homebrewEntityCounts(json),
      addedAt: Date.now(),
    };
    return { whole, books };
  },

  /**
   * Store prepared books in one transaction. A book is stored once per file
   * it came from: one already here exactly is left alone, and a copy of it
   * stored before from the same file (a part a character brought included)
   * is replaced. The new copy keeps that copy's switch and its place in the
   * merge order. A copy from another file stays: between them, the one
   * imported first wins an entry both hold. The file imported whole before
   * it was stored a book at a time ({@link oldWholeImports}) is replaced
   * too. All the books land at one time, as one import.
   */
  async commitBooks(books: readonly HomebrewFileRow[]): Promise<CommittedBooks> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const rows = await db.homebrewFiles.toArray();
      const stored = partitionHomebrewMeta(rows).files;
      const ids = new Set(stored.map((r) => r.id));
      const addedAt = Date.now();
      const added: HomebrewFileRow[] = [];
      let replaced = 0;
      const first = books[0];
      if (first !== undefined) {
        const candidates = new Set(stored.filter(mayBeOldWholeImport).map((r) => r.id));
        const old = oldWholeImports(
          first.fileName,
          (await withContent(rows.filter((r) => candidates.has(r.id)))) as HomebrewFileRow[],
        );
        for (const r of old) {
          await db.homebrewFiles.delete(r.id);
          await db.homebrewJson.delete(r.id);
          ids.delete(r.id);
        }
        replaced += old.length;
      }
      for (const book of books) {
        if (ids.has(book.id)) continue;
        const old = stored.filter((r) => ids.has(r.id) && sameBookCopy(r, book));
        for (const r of old) {
          await db.homebrewFiles.delete(r.id);
          await db.homebrewJson.delete(r.id);
          ids.delete(r.id);
        }
        replaced += old.length;
        const row: HomebrewFileRow = {
          ...book,
          enabled: old.length === 0 ? book.enabled : old.some((r) => r.enabled),
          // A fold, not a spread: the copy it replaces keeps its place.
          addedAt: old.reduce((min, r) => Math.min(min, r.addedAt), addedAt),
        };
        await putHomebrewRow(row);
        ids.add(row.id);
        added.push(row);
      }
      return { added, replaced, same: books.length - added.length };
    });
  },

  /** Validate + store a homebrew JSON file; content-hash keyed (idempotent). */
  async importJson(raw: unknown, fileName: string, url?: string): Promise<HomebrewFileRow> {
    return (await homebrewRepo.commit(await homebrewRepo.prepare(raw, fileName, url))).row;
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    // `update` resolves with 0 for a row that isn't there rather than throwing,
    // so a write against a file another tab deleted would otherwise report
    // success and change nothing.
    if ((await db.homebrewFiles.update(id, { enabled })) === 0) {
      throw new Error(`homebrew file ${id} no longer exists`);
    }
  },

  async delete(id: string): Promise<void> {
    await homebrewRepo.deleteMany([id]);
  },

  /** Remove several files at once, as one change: all of a file's books, say. */
  async deleteMany(ids: readonly string[]): Promise<void> {
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      await db.homebrewFiles.bulkDelete([...ids]);
      await db.homebrewJson.bulkDelete([...ids]);
    });
  },

  /** New in-app editable homebrew file (uuid id — edits don't change identity). */
  async createEditable(fullName: string, abbreviation: string): Promise<HomebrewFileRow> {
    const row = editableRow(fullName, abbreviation);
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () => putHomebrewRow(row));
    return row;
  },

  async saveEditable(id: string, json: Record<string, unknown>): Promise<void> {
    // Bump rev so the registry/search signature notices the content change even
    // though the file id stays the same across edits.
    const modified = await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () =>
      rewrite(id, json),
    );
    // Matching no rows is not success. The builder reports what this resolves
    // to, so a save against a file deleted in another tab has to say so rather
    // than close the form over an edit that reached nothing.
    if (!modified) throw new Error(`homebrew file ${id} no longer exists`);
  },

  /** Every file the player owns, with its content: where the Workshop finds their entries. */
  async ownedSafe(): Promise<HomebrewListResult> {
    const rows = (await db.homebrewFiles.toArray()).filter((r) => r.editable === true);
    const result = partitionHomebrewRows(await withContent(rows));
    result.files.sort(newestFirst);
    return result;
  },

  /**
   * Save one entry into a file the player owns, as one write: into `fileId`,
   * else the Workshop file, made on the first save (`created` says so). It
   * takes the place of the entry `replaces` names (the one the editor opened,
   * renamed or not); without `replaces` it is added. An entry of that type with
   * the new name and book already, other than the one it replaces, refuses the
   * save (`EntryClash`): neither a new entry nor a rename ever overwrites one.
   *
   * `owned`, for a type that owns entries (a subclass's features), replaces
   * every one the entry it replaces owned, in the same write. Another entry
   * whose owned ones could not be told apart from this one's refuses the
   * save, as do two owned entries the sheet could not tell apart; the error
   * says which.
   */
  async saveEntry(
    type: string,
    entry: Record<string, unknown> & EntryKey,
    opts: { fileId?: string; replaces?: EntryKey; owned?: readonly Row[] } = {},
  ): Promise<{ fileId: string; created: boolean }> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      let file: HomebrewFile | undefined;
      if (opts.fileId !== undefined) file = await ownedFile(opts.fileId);
      else {
        const mine = partitionHomebrewMeta(await db.homebrewFiles.toArray()).files.find(
          isWorkshopFile,
        );
        if (mine !== undefined) file = await ownedFile(mine.id);
      }
      const row = file === undefined ? editableRow(WORKSHOP_TITLE, WORKSHOP_SOURCE) : undefined;
      const json = structuredClone(file?.json ?? (row?.json as Record<string, unknown>));
      const list: unknown[] = Array.isArray(json[type]) ? [...(json[type] as unknown[])] : [];
      const { replaces } = opts;
      const at = replaces === undefined ? -1 : list.findIndex((e) => isEntry(e, replaces));
      if (list.some((e, i) => i !== at && isEntry(e, entry))) {
        throw new EntryClash(`you already have one called ${entry.name}`);
      }
      const own = OWNED[type];
      if (opts.owned !== undefined) {
        if (own === undefined) throw new Error(`a ${type} owns no other entries`);
        const others = list.filter((_, i) => i !== at);
        if (others.some((o) => isRecord(o) && own.peer(o, entry))) {
          throw new Error(
            `another ${type} in that file has its short name, so their features would mix`,
          );
        }
        withoutOwned(json, type, list[at], others);
        const kept = Array.isArray(json[own.type]) ? (json[own.type] as unknown[]) : [];
        const keys = new Set(
          kept
            .filter(isRecord)
            .map(own.key)
            .map((k) => k.toLowerCase()),
        );
        for (const e of opts.owned) {
          const k = own.key(e).toLowerCase();
          if (keys.has(k))
            throw new Error(`two of its features at one level are called ${String(e.name)}`);
          keys.add(k);
        }
        json[own.type] = [...kept, ...opts.owned];
        if (at !== -1 && isRecord(list[at])) own.carry?.(json, list[at] as Row, entry);
      }
      if (at === -1) list.push(entry);
      else list[at] = entry;
      json[type] = list;
      assertJsonWithinLimits(json);
      if (row !== undefined) {
        await putHomebrewRow({ ...row, json, counts: homebrewEntityCounts(json) });
        return { fileId: row.id, created: true };
      }
      const id = (file as HomebrewFile).id;
      if (!(await rewrite(id, json)))
        throw new Error('that homebrew file is no longer on this device');
      return { fileId: id, created: false };
    });
  },

  /**
   * Take one entry out of a file the player owns, with the entries it owns (a
   * subclass's features). False when it was not there.
   */
  async removeEntry(fileId: string, type: string, key: EntryKey): Promise<boolean> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const file = await ownedFile(fileId);
      const json = structuredClone(file.json);
      const list: unknown[] = Array.isArray(json[type]) ? [...(json[type] as unknown[])] : [];
      const at = list.findIndex((e) => isEntry(e, key));
      if (at === -1) return false;
      const [gone] = list.splice(at, 1);
      withoutOwned(json, type, gone, list);
      json[type] = list;
      return rewrite(fileId, json);
    });
  },
};
