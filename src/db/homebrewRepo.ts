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
    const json: Record<string, unknown> = {
      _meta: {
        sources: [
          { json: abbreviation, abbreviation, full: fullName, authors: [], version: '1.0.0' },
        ],
      },
    };
    const row: HomebrewFileRow = {
      id: crypto.randomUUID(),
      fileName: `${fullName.replaceAll(/[^\w-]+/g, '_')}.json`,
      json,
      enabled: true,
      editable: true,
      sourceIds: [abbreviation],
      counts: {},
      addedAt: Date.now(),
    };
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () => putHomebrewRow(row));
    return row;
  },

  async saveEditable(id: string, json: Record<string, unknown>): Promise<void> {
    // Bump rev so the registry/search signature notices the content change even
    // though the file id stays the same across edits.
    const modified = await db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const count = await db.homebrewFiles
        .where('id')
        .equals(id)
        .modify((row) => {
          delete row.json;
          row.counts = homebrewEntityCounts(json);
          row.rev = (row.rev ?? 0) + 1;
        });
      if (count > 0) await db.homebrewJson.put({ id, json });
      return count;
    });
    // Matching no rows is not success. The builder reports what this resolves
    // to, so a save against a file deleted in another tab has to say so rather
    // than close the form over an edit that reached nothing.
    if (modified === 0) throw new Error(`homebrew file ${id} no longer exists`);
  },
};
