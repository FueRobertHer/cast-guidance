import { type PackLocal, readPackLocal } from '@/data5e/rulePack';
import { ENTRY_PARENT_KEYS, own } from '@/engine/castGuidance';
import {
  assertHomebrewFile,
  assertJsonWithinLimits,
  homebrewEntityCounts,
  type SkippedEntry,
  sha256Hex,
  withReadableEntries,
} from '@/lib/guards';
import { db, type HomebrewFileRow, type HomebrewMetaRow } from './db';
import { bookOf, mayBeOldWholeImport, oldWholeImports, splitBooks } from './homebrewBooks';
import {
  CHANGES_SOURCE,
  COLLECTION_ID_KEY,
  collectionIdOf,
  collectionKey,
  compareMergeOrder,
  sameCollection,
  WORKSHOP_SOURCE,
  withCollectionId,
} from './homebrewOrder';
import type { MoveRequest, RepointReport } from './repoint';

export { CHANGES_SOURCE, WORKSHOP_SOURCE };

/** A file to be stored a book at a time, as {@link homebrewRepo.prepareBooks} gives it. */
export interface PreparedBooks {
  /**
   * The whole file, for the preview alone. It is never stored, so it is held
   * to no size limit of its own: each book is.
   */
  whole: HomebrewFileRow;
  /** One row per book, each checked and hashed as a file of its own. */
  books: HomebrewFileRow[];
  /** Entries left out because nothing could read them ({@link withReadableEntries}). */
  skipped: SkippedEntry[];
}

/** A file to be stored whole, as {@link homebrewRepo.prepareFile} gives it. */
export interface PreparedFile {
  row: HomebrewFileRow;
  /** Entries left out because nothing could read them ({@link withReadableEntries}). */
  skipped: SkippedEntry[];
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
 * Identity (`id`) and all metadata (`sourceIds`, `counts`, `key`) are
 * recomputed from the content, never taken from a caller, so an importer
 * cannot forge an id to collide with unrelated local content or misrepresent
 * what a file holds. Imported files are never `editable` (that flag belongs to
 * in-app originals), and never hold a `pack` or a `role`: those are this
 * device's, set here alone.
 */
export async function buildHomebrewRow(
  rawFile: unknown,
  fileName: string,
  url?: string,
): Promise<HomebrewFileRow> {
  return (await buildCheckedRow(rawFile, fileName, url)).row;
}

/**
 * {@link buildHomebrewRow}, with the entries it left out. An entry nothing
 * can read (a spell with no name) is never stored, however the file comes
 * in: a file, a link, pasted text, a book of a compendium or a character's
 * export. A file with none left out is hashed as it came.
 */
async function buildCheckedRow(
  rawFile: unknown,
  fileName: string,
  url?: string,
): Promise<PreparedFile> {
  // Bound adversarial/corrupted payloads before hashing, indexing, or storing.
  assertJsonWithinLimits(rawFile);
  const { meta, json: whole } = assertHomebrewFile(rawFile);
  const { json, skipped } = withReadableEntries(whole);
  const id = await sha256Hex(JSON.stringify(json));
  // One book of a converted compendium says so in its `_meta`, wherever it
  // comes from: an import, a download of it, or a character's export.
  const book = bookOf(json);
  const sourceIds = meta.sources.map((s) => s.json);
  const key = collectionKey({
    url,
    sourceIds,
    fileName,
    book: book.book,
    made: collectionIdOf(json),
  });
  const row: HomebrewFileRow = {
    id,
    fileName,
    url,
    json,
    enabled: true,
    editable: false,
    sourceIds,
    counts: homebrewEntityCounts(json),
    addedAt: Date.now(),
    ...book,
    ...(key === undefined ? {} : { key }),
  };
  return { row, skipped };
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
  const editable = row.editable === true;
  const meta: HomebrewFileMeta = {
    id,
    fileName: fileName ?? `${id}.json`,
    url: typeof row.url === 'string' ? row.url : undefined,
    enabled: row.enabled !== false,
    editable,
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
  const pack = readPackLocal(row.pack);
  // A row written without its key (by a test, or before keys) is keyed as its
  // fields say. An imported file has one unless the app made it before stamps.
  const key = editable
    ? undefined
    : typeof row.key === 'string' && row.key !== ''
      ? row.key
      : collectionKey(meta);
  return {
    ...meta,
    ...(key === undefined ? {} : { key }),
    ...(pack === undefined ? {} : { pack }),
    // The app's to set, on a file the player owns: never one an import stored.
    ...(editable && row.role === 'changes' ? { role: 'changes' as const } : {}),
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

/** A file coming in, as it lands: what it brings, and what it took the place of. */
export interface Landed {
  row: HomebrewFileRow;
  /** The copies of its collection stored before, which it replaced. */
  replaced: HomebrewFileMeta[];
}

/**
 * Store `row`, taking the place of every stored copy of its collection
 * (`stored`, read in the caller's transaction over both tables). The one way
 * an imported file lands, whole or a book at a time, from a file or a
 * character's export (ADR-002, D4). The copies
 * go; the row keeps the earliest one's place in the merge order, is on when
 * any of them was, and keeps the first one's pack settings over any it
 * brings, so an update never cuts a pack loose from its characters. `how`
 * as `putHomebrewRow` takes it: `add` refuses a row already stored by its id.
 */
export async function landHomebrewRow(
  row: HomebrewFileRow,
  stored: readonly HomebrewFileMeta[],
  how: 'put' | 'add' = 'put',
): Promise<Landed> {
  const replaced = stored
    .filter((s) => s.id !== row.id && sameCollection(s, row))
    .sort(compareMergeOrder);
  for (const r of replaced) {
    await db.homebrewFiles.delete(r.id);
    await db.homebrewJson.delete(r.id);
  }
  const first = replaced[0];
  const pack = replaced.find((r) => r.pack !== undefined)?.pack ?? row.pack;
  // A role is the app's to set on a file the player owns: never one imported.
  const { pack: _, role: __, ...rest } = row;
  const landed: HomebrewFileRow = {
    ...rest,
    ...(first === undefined
      ? {}
      : { enabled: replaced.some((r) => r.enabled), addedAt: first.addedAt }),
    ...(pack === undefined ? {} : { pack }),
  };
  await putHomebrewRow(landed, how);
  return { row: landed, replaced };
}

/**
 * A short code for a new collection the player makes, its own (suspected bug
 * 8): `wanted`, unless another stored file declares it already or the app
 * keeps it for its own files, then `wanted` with the first number after it
 * that is free. Two collections under one source could not be told apart:
 * every entry is known by its name and its source.
 */
function freeSource(wanted: string, stored: readonly HomebrewFileMeta[]): string {
  const taken = new Set(
    [WORKSHOP_SOURCE, CHANGES_SOURCE, ...stored.flatMap((f) => f.sourceIds)].map((s) =>
      s.toLowerCase(),
    ),
  );
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; ; n += 1) {
    const next = `${wanted}${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/** The title of the Workshop file (`WORKSHOP_SOURCE`). */
const WORKSHOP_TITLE = 'My homebrew';

/** The title of the file of the player's changes to the books (`CHANGES_SOURCE`). */
const CHANGES_TITLE = 'Changes to the books';

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

/** `String(v)`, which a homebrew object (`{"toString": 1}`) can make throw. */
function text(v: unknown): string {
  try {
    return String(v);
  } catch {
    return '?';
  }
}

/**
 * A change to the books' identity, as the merge reads it (`identityKey`): its
 * name and book and, for a subrace or a feature, its parent's keys
 * (`ENTRY_PARENT_KEYS`), each its own or else its `_copy`'s, without case.
 * Two features of one name and book (each class's Ability Score Improvement)
 * are two changes.
 */
function changeIdentity(type: string, e: Row): string {
  const copy = isRecord(e._copy) ? e._copy : {};
  const parents = Object.hasOwn(ENTRY_PARENT_KEYS, type) ? (ENTRY_PARENT_KEYS[type] ?? []) : [];
  return ['name', 'source', ...parents]
    .map((k) => {
      const v = own(e, k) ?? own(copy, k);
      return v === undefined || v === null ? '' : text(v);
    })
    .join('|')
    .toLowerCase();
}

/**
 * How a file finds an entry: the changes file by the change's identity, so a
 * key there names a feature's class and level too; every other file by name
 * and book.
 */
function finder(type: string, changes: boolean): (e: unknown, key: EntryKey) => boolean {
  if (!changes) return isEntry;
  return (e, key) => isRecord(e) && changeIdentity(type, e) === changeIdentity(type, { ...key });
}

/** The player's Workshop file among stored rows: theirs to edit, in the Workshop's book. */
function isWorkshopFile(row: HomebrewFileMeta): boolean {
  return row.editable && row.role === undefined && row.sourceIds[0] === WORKSHOP_SOURCE;
}

/** The file the player's changes to the books are in. */
const isChangesFile = (row: HomebrewFileMeta): boolean => row.editable && row.role === 'changes';

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

/**
 * A class feature ref (`Name|Class|ClassSource|Level|Source`, or a subclass
 * feature's `Name|Class|ClassSource|…`) that names the class `before`, now
 * naming it `name`; any other as it was. An empty book is PHB, as on the sheet.
 */
function refRenamed(ref: string, before: Row, name: string): string {
  const p = ref.split('|');
  if (!eq(p[1], before.name) || !eq(p[2] || 'PHB', before.source)) return ref;
  p[1] = name;
  return p.join('|');
}

/**
 * Every feature ref in `v` that names the class `before`, renamed, in a copy:
 * a `classFeatures` item, and a held feature's `classFeature` (a Monk's
 * Focus holds Flurry of Blows).
 */
function withRefsRenamed(v: unknown, before: Row, name: string, list = false): unknown {
  if (typeof v === 'string') return list ? refRenamed(v, before, name) : v;
  if (Array.isArray(v)) return v.map((x) => withRefsRenamed(x, before, name, list));
  if (!isRecord(v)) return v;
  const out: Row = {};
  for (const [k, x] of Object.entries(v)) {
    out[k] =
      k === 'classFeature' && typeof x === 'string'
        ? refRenamed(x, before, name)
        : withRefsRenamed(x, before, name, k === 'classFeatures');
  }
  return out;
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

/**
 * A new file the player owns, with no entries yet, stamped with an id of its
 * own (`COLLECTION_ID_KEY`): what another device knows it by when it comes
 * there, in a character's export or as a file.
 */
function editableRow(fullName: string, abbreviation: string): HomebrewFileRow {
  return {
    id: crypto.randomUUID(),
    fileName: `${fullName.replaceAll(/[^\w-]+/g, '_')}.json`,
    json: {
      _meta: {
        sources: [
          { json: abbreviation, abbreviation, full: fullName, authors: [], version: '1.0.0' },
        ],
        [COLLECTION_ID_KEY]: crypto.randomUUID(),
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
 *
 * The file keeps the id it was stamped with, whatever `json` says (the
 * builder hands back the content it opened, which can be older than the
 * stamp). A file made before stamps is stamped on its first save here.
 */
async function rewrite(id: string, next: Record<string, unknown>): Promise<boolean> {
  const stored = await db.homebrewJson.get(id);
  const json = withCollectionId(
    next,
    collectionIdOf(stored?.json) ?? collectionIdOf(next) ?? crypto.randomUUID(),
  );
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

/**
 * What `repoint.ts` builds on, kept out of this file so a move's code loads
 * only with a move; and `OWNED`, for the Workshop's export of a selection to
 * take an entry's own features with it. Not for other callers.
 */
export const internals = { isEntry, rewrite, OWNED } as const;

/** An entry to take out of a file the player owns: its fields, parents' keys and all. */
export interface EntryPick {
  fileId: string;
  type: string;
  key: EntryKey & Row;
}

/**
 * What taking entries out left, for Undo: each file as it was, and the
 * revision the removal gave it.
 */
export interface Removed {
  files: Array<{ id: string; json: Record<string, unknown>; rev: number }>;
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

  /** {@link homebrewRepo.prepare}, with the entries it left out, for the preview to name. */
  prepareFile(raw: unknown, fileName: string, url?: string): Promise<PreparedFile> {
    return buildCheckedRow(raw, fileName, url);
  },

  /**
   * Store a prepared row unless the same content is already here
   * (content-hash keyed, so this is idempotent). `duplicate` says which
   * happened, and `row` is what the database holds either way.
   *
   * A file of a collection stored before (the same key, ADR-002 D4) updates
   * it in place: it takes the place of every copy of it, keeping their
   * switch, their place in the merge order and their pack's settings, and
   * `replaced` names them. Otherwise the row is stamped with the time of the
   * commit, not of the prepare: the merge order counts imports from when they
   * land, so a preview left open cannot jump ahead of a file imported while
   * it was showing.
   */
  async commit(
    prepared: HomebrewFileRow,
  ): Promise<{ row: HomebrewFileRow; duplicate: boolean; replaced: HomebrewFileMeta[] }> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const existing = await db.homebrewFiles.get(prepared.id);
      if (existing !== undefined) {
        const [stored] = await withContent([existing]);
        return { row: stored as HomebrewFileRow, duplicate: true, replaced: [] };
      }
      const stored = partitionHomebrewMeta(await db.homebrewFiles.toArray()).files;
      const { row, replaced } = await landHomebrewRow({ ...prepared, addedAt: Date.now() }, stored);
      return { row, duplicate: false, replaced };
    });
  },

  /**
   * Validate a homebrew file into one row per book, writing nothing: the
   * first half of importing a converted compendium, as {@link prepare} is for
   * a file stored whole. Each book is held to the limits of one file.
   */
  async prepareBooks(raw: unknown, fileName: string, url?: string): Promise<PreparedBooks> {
    // Left out before the split, so the whole and its books count the same.
    const { json, skipped } = withReadableEntries(assertHomebrewFile(raw).json);
    const books: HomebrewFileRow[] = [];
    for (const part of splitBooks(json)) {
      const row = await buildHomebrewRow(part.json, fileName, url);
      // A book whether or not its `_meta` says it was converted, so keyed as one.
      books.push({ ...row, book: part.full, key: collectionKey({ ...row, book: part.full }) });
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
    return { whole, books, skipped };
  },

  /**
   * Store prepared books in one transaction. A book is stored once per file
   * it came from: one already here exactly is left alone, and a copy of it
   * stored before from the same file (a part a character brought included)
   * is replaced, as any collection is (`land`): the new copy keeps that
   * copy's switch and its place in the merge order. A copy from another file
   * stays: between them, the one imported first wins an entry both hold. The
   * file imported whole before it was stored a book at a time
   * ({@link oldWholeImports}) is replaced too. All the books land at one
   * time, as one import.
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
        const landed = await landHomebrewRow(
          { ...book, addedAt },
          stored.filter((r) => ids.has(r.id)),
        );
        for (const r of landed.replaced) ids.delete(r.id);
        replaced += landed.replaced.length;
        ids.add(landed.row.id);
        added.push(landed.row);
      }
      return { added, replaced, same: books.length - added.length };
    });
  },

  /** Validate + store a homebrew JSON file; content-hash keyed (idempotent). */
  async importJson(raw: unknown, fileName: string, url?: string): Promise<HomebrewFileRow> {
    return (await homebrewRepo.commit(await homebrewRepo.prepare(raw, fileName, url))).row;
  },

  /**
   * Write a rule pack's Apply to or its place, on its row and never in its
   * file, so the file stays what was imported (suspected bug 10). `change`
   * gets what is stored, or nobody for a pack never applied here. The
   * revision moves, so the registry and every tab rebuild.
   */
  async setPackLocal(id: string, change: (now: PackLocal) => PackLocal): Promise<void> {
    await db.transaction('rw', db.homebrewFiles, async () => {
      const row = await db.homebrewFiles.get(id);
      const meta = row === undefined ? undefined : readHomebrewMeta(row);
      if (meta === undefined) throw new Error('that pack is no longer on this device');
      if (isReadError(meta)) throw new Error(meta.message);
      const next = change(meta.pack ?? { appliesTo: { characters: [] } });
      await db.homebrewFiles.update(id, {
        pack: {
          appliesTo: {
            characters: [...next.appliesTo.characters],
            ...(next.appliesTo.appDefault === true ? { appDefault: true } : {}),
          },
          ...(next.order === undefined ? {} : { order: next.order }),
        },
        rev: (meta.rev ?? 0) + 1,
      });
    });
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

  /**
   * New in-app editable homebrew file (uuid id: edits don't change identity).
   * It gets a source of its own: `abbreviation`, or the first free one after
   * it when another file here declares it already (`freeSource`). The row
   * returned says which.
   */
  async createEditable(fullName: string, abbreviation: string): Promise<HomebrewFileRow> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const stored = partitionHomebrewMeta(await db.homebrewFiles.toArray()).files;
      const row = editableRow(fullName, freeSource(abbreviation, stored));
      await putHomebrewRow(row);
      return row;
    });
  },

  async saveEditable(id: string, json: Record<string, unknown>): Promise<void> {
    // Bump rev so the registry/search signature notices the content change even
    // though the file id stays the same across edits.
    const modified = await db.transaction('rw', db.homebrewFiles, db.homebrewJson, () =>
      rewrite(id, json),
    );
    // Matching no rows is not success. The Workshop's editor reports what this resolves
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
   * else the Workshop file, made on the first save (`created` says so); with
   * `role: 'changes'` and no `fileId`, the file of the player's changes to
   * the books instead, made the same way with that role on its row. It
   * takes the place of the entry `replaces` names (the one the editor opened,
   * renamed or not); without `replaces` it is added. An entry of that type with
   * the new name and book already, other than the one it replaces, refuses the
   * save (`EntryClash`): neither a new entry nor a rename ever overwrites one.
   * In the changes file, entries and `replaces` are matched by the change's
   * identity instead (`changeIdentity`: a feature's class and level too).
   *
   * `owned`, for a type that owns entries (a subclass's features), replaces
   * every one the entry it replaces owned, in the same write. Another entry
   * whose owned ones could not be told apart from this one's refuses the
   * save, as do two owned entries the sheet could not tell apart; the error
   * says which.
   *
   * A save that renames the entry it replaces (a new name or book) re-points
   * every character that held it, and the player's own rule packs, in the
   * same write (ADR-002, D5); `repointed` says what. A change to the books
   * keeps the book's name and source, so it re-points nothing.
   */
  async saveEntry(
    type: string,
    entry: Record<string, unknown> & EntryKey,
    opts: {
      fileId?: string;
      replaces?: EntryKey;
      owned?: readonly Row[];
      role?: 'changes';
    } = {},
  ): Promise<{ fileId: string; created: boolean; repointed?: RepointReport }> {
    const { replaces: was } = opts;
    // Loaded before the transaction opens: waiting on anything else inside it
    // would let it commit.
    const walker =
      was !== undefined &&
      opts.role !== 'changes' &&
      (was.name !== entry.name || was.source !== entry.source)
        ? await import('./repoint')
        : undefined;
    const tables =
      walker === undefined
        ? [db.homebrewFiles, db.homebrewJson]
        : [db.homebrewFiles, db.homebrewJson, db.characters];
    return db.transaction('rw', tables, async () => {
      let file: HomebrewFile | undefined;
      const changes = opts.role === 'changes';
      if (opts.fileId !== undefined) file = await ownedFile(opts.fileId);
      else {
        const mine = partitionHomebrewMeta(await db.homebrewFiles.toArray()).files.find(
          changes ? isChangesFile : isWorkshopFile,
        );
        if (mine !== undefined) file = await ownedFile(mine.id);
      }
      const row =
        file !== undefined
          ? undefined
          : changes
            ? { ...editableRow(CHANGES_TITLE, CHANGES_SOURCE), role: 'changes' as const }
            : editableRow(WORKSHOP_TITLE, WORKSHOP_SOURCE);
      const json = structuredClone(file?.json ?? (row?.json as Record<string, unknown>));
      const list: unknown[] = Array.isArray(json[type]) ? [...(json[type] as unknown[])] : [];
      const { replaces } = opts;
      const is = finder(type, changes || file?.role === 'changes');
      const at = replaces === undefined ? -1 : list.findIndex((e) => is(e, replaces));
      if (list.some((e, i) => i !== at && is(e, entry))) {
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
      const before = list[at];
      if (at === -1) list.push(entry);
      else list[at] = entry;
      json[type] = list;
      assertJsonWithinLimits(json);
      if (row !== undefined) {
        await putHomebrewRow({ ...row, json, counts: homebrewEntityCounts(json) });
        return { fileId: row.id, created: true };
      }
      const { id, role } = file as HomebrewFile;
      if (!(await rewrite(id, json)))
        throw new Error('that homebrew file is no longer on this device');
      // The changes file is opened by its id too: a change to the books is
      // found by the book's entry, so a character holding it keeps it.
      const repointed =
        walker !== undefined && isRecord(before) && role !== 'changes'
          ? await walker.repointRename(
              type,
              { name: String(before.name), source: String(before.source) },
              { name: entry.name, source: entry.source },
            )
          : undefined;
      return { fileId: id, created: false, ...(repointed === undefined ? {} : { repointed }) };
    });
  },

  /**
   * Rename one entry of a file the player owns, as its editor's save does
   * ({@link homebrewRepo.saveEntry}, which re-points every character that
   * holds it). A class takes its own features along: each names its class, as
   * do the refs its list and their text hold, and its subclasses follow it
   * (`carry`). A subclass's features find it by its short name, which a
   * rename leaves as it is.
   */
  async renameEntry(
    fileId: string,
    type: string,
    was: EntryKey,
    name: string,
  ): Promise<{ repointed?: RepointReport }> {
    const file = await ownedFile(fileId);
    const list = Array.isArray(file.json[type]) ? (file.json[type] as unknown[]) : [];
    const entry = list.find((e) => finder(type, false)(e, was));
    if (!isRecord(entry)) throw new Error(`${was.name} is no longer in "${file.fileName}"`);
    const next = { ...entry, name, source: was.source };
    if (type !== 'class') {
      return homebrewRepo.saveEntry(type, next, { fileId, replaces: was });
    }
    const own = OWNED.class;
    const features = Array.isArray(file.json.classFeature) ? file.json.classFeature : [];
    const owned = features
      .filter((f): f is Row => isRecord(f) && own?.owns(entry, f) === true)
      .map((f) => withRefsRenamed({ ...f, className: name }, entry, name) as Row);
    return homebrewRepo.saveEntry(type, withRefsRenamed(next, entry, name) as Row & EntryKey, {
      fileId,
      replaces: was,
      owned,
    });
  },

  /**
   * Move entries from one of the player's collections to another (ADR-002,
   * D5): each takes the new collection's source, and every character, and the
   * player's own rule packs, follow it in the same write. Loads the move's code
   * first (`repoint.ts`).
   */
  async moveEntries(req: MoveRequest): Promise<RepointReport> {
    return (await import('./repoint')).moveEntries(req);
  },

  /**
   * Take one entry out of a file the player owns, with the entries it owns (a
   * subclass's features). False when it was not there. In the changes file,
   * `key` is matched by the change's identity, so it names a feature's class
   * and level too.
   */
  async removeEntry(fileId: string, type: string, key: EntryKey): Promise<boolean> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const file = await ownedFile(fileId);
      const json = structuredClone(file.json);
      const list: unknown[] = Array.isArray(json[type]) ? [...(json[type] as unknown[])] : [];
      const at = list.findIndex((e) => finder(type, file.role === 'changes')(e, key));
      if (at === -1) return false;
      const [gone] = list.splice(at, 1);
      withoutOwned(json, type, gone, list);
      json[type] = list;
      return rewrite(fileId, json);
    });
  },

  /**
   * Take several entries out of the player's files as one write, each with
   * the entries it owns, matched as {@link homebrewRepo.removeEntry} matches
   * them. One that is no longer there refuses the lot. Characters are left as
   * they are: their refs name each entry again once Undo puts it back.
   */
  async removeEntries(picks: readonly EntryPick[]): Promise<Removed> {
    return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      const files: Removed['files'] = [];
      for (const id of new Set(picks.map((p) => p.fileId))) {
        const file = await ownedFile(id);
        const json = structuredClone(file.json);
        for (const { type, key } of picks.filter((p) => p.fileId === id)) {
          const list: unknown[] = Array.isArray(json[type]) ? [...(json[type] as unknown[])] : [];
          const at = list.findIndex((e) => finder(type, file.role === 'changes')(e, key));
          if (at === -1) throw new Error(`${key.name} is no longer in "${file.fileName}"`);
          withoutOwned(json, type, list.splice(at, 1)[0], list);
          json[type] = list;
        }
        await rewrite(id, json);
        files.push({ id, json: file.json, rev: (await db.homebrewFiles.get(id))?.rev ?? 0 });
      }
      return { files };
    });
  },

  /**
   * Undo {@link homebrewRepo.removeEntries}: each file back as it was, every
   * entry in its place, as one write. Refused, with nothing changed, when a
   * file is gone or was changed since.
   */
  async restoreEntries(removed: Removed): Promise<void> {
    await db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
      for (const f of removed.files) {
        const row = await db.homebrewFiles.get(f.id);
        if (row === undefined) throw new Error('that collection is no longer on this device');
        if ((row.rev ?? 0) !== f.rev) throw new Error('that collection was changed since');
      }
      for (const f of removed.files) await rewrite(f.id, f.json);
    });
  },
};
