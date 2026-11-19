import Dexie, { type EntityTable } from 'dexie';
import type { PackLocal } from '@/data5e/rulePack';
import type { CharacterDoc } from '@/engine/types';
import { jsonByteSize } from '@/lib/byteSize';
import { collectionKey } from './homebrewOrder';
import { installDbLifecycle } from './lifecycle';

export interface DataFileRow {
  /** `${tag}:${path}` */
  key: string;
  tag: string;
  path: string;
  pack: string;
  /** Parsed JSON, stored via structured clone — no re-parse on boot. */
  json: unknown;
  bytes: number;
  fetchedAt: number;
}

export interface DataMetaRow {
  id: 'installed';
  tag: string;
  completedPacks: string[];
  installedAt: number;
}

export interface HomebrewFileRow {
  /** SHA-256 of the file content. */
  id: string;
  fileName: string;
  url?: string;
  json: unknown;
  enabled: boolean;
  /** Files created by the in-app builder can be edited. */
  editable: boolean;
  sourceIds: string[];
  counts: Record<string, number>;
  addedAt: number;
  /**
   * Revision, bumped whenever what the registry builds from the row changes
   * under the same id: an editable file's save, a pack's Apply to or order.
   * The id stays, so `rev` is what lets the registry/search signature notice.
   * Optional; absent means 0.
   */
  rev?: number;
  /**
   * Set for one book of a file stored a book at a time (a converted
   * compendium, see `homebrewBooks.ts`): the book's full name. `fileName` is
   * then the file it came from, which its other books share.
   */
  book?: string;
  /**
   * Set for a book that holds only the part of it one character uses: what a
   * character export carries of a book, not all of it. Importing the whole
   * book replaces it.
   */
  subset?: true;
  /**
   * The collection an imported file is (`collectionKey`), kept through a new
   * content hash: importing a file with this key updates this row in place
   * (ADR-002, D4). Imported files only: a file the player owns has none, so
   * no import ever writes over it.
   */
  key?: string;
  /**
   * For a rule pack: who it applies to here and its place among the packs.
   * This device's alone, so it lives on the row and never in `json`, which
   * stays the file as it came from its link.
   */
  pack?: PackLocal;
  /**
   * What the app keeps in a file the player owns, set by the app alone and
   * never read from a file: `changes`, the player's changes to the books.
   */
  role?: 'changes';
}

/**
 * A homebrew file as `homebrewFiles` stores it: everything but the content,
 * which sits in `homebrewJson` under the same id. A list, a toggle or the
 * registry's signature reads these alone, so none of them deserializes every
 * file's content (a Fight Club compendium converts to tens of megabytes).
 * A row written before version 5 may still carry its `json`.
 */
export type HomebrewMetaRow = Omit<HomebrewFileRow, 'json'> & { json?: unknown };

/** A homebrew file's content, keyed by the file's id. */
export interface HomebrewJsonRow {
  id: string;
  json: unknown;
}

export interface SearchIndexRow {
  /** `${tag}|${homebrewRev}|${scope}` */
  key: string;
  json: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface RollLogRow {
  id: string;
  charId?: string;
  at: number;
  result: unknown;
}

/**
 * A character as stored. `revision` is an opaque token every write replaces
 * (REL-007, #98), so a tab can tell whether the row is still the one it last
 * read before it writes over it. It is storage bookkeeping only: the
 * repository strips it from every read, so no document in memory, export,
 * history snapshot or journal entry carries it. Not indexed, so adding it
 * needed no schema version; a row written before it has none.
 */
export interface CharacterRow extends CharacterDoc {
  revision?: string;
}

/** One point-in-time snapshot of a character (version history). */
export interface CharacterHistoryRow {
  id: string;
  charId: string;
  at: number;
  label: string;
  doc: CharacterDoc;
}

export const db = new Dexie('cast-guidance') as Dexie & {
  dataFiles: EntityTable<DataFileRow, 'key'>;
  dataMeta: EntityTable<DataMetaRow, 'id'>;
  characters: EntityTable<CharacterRow, 'id'>;
  homebrewFiles: EntityTable<HomebrewMetaRow, 'id'>;
  homebrewJson: EntityTable<HomebrewJsonRow, 'id'>;
  searchIndexes: EntityTable<SearchIndexRow, 'key'>;
  settings: EntityTable<SettingRow, 'key'>;
  rollLog: EntityTable<RollLogRow, 'id'>;
  characterHistory: EntityTable<CharacterHistoryRow, 'id'>;
};

db.version(1).stores({
  dataFiles: 'key, tag, pack',
  dataMeta: 'id',
  characters: 'id, name, updatedAt',
  homebrewFiles: 'id, enabled, addedAt',
  searchIndexes: 'key',
  settings: 'key',
  rollLog: 'id, at, charId',
});

db.version(2).stores({
  characterHistory: 'id, charId, at',
});

/**
 * Index `bytes` so the settings screen can total cached-data size by walking
 * index keys alone. Summing it from the rows themselves would deserialize
 * every `json` blob (megabytes) just to render one number. Rows written before
 * this version stored a placeholder 0, so backfill them once here.
 */
db.version(3)
  .stores({ dataFiles: 'key, tag, pack, bytes' })
  .upgrade(async (tx) => {
    await tx
      .table<DataFileRow>('dataFiles')
      .toCollection()
      .modify((row) => {
        row.bytes = jsonByteSize(row.json);
      });
  });

/**
 * Compound `[charId+at]` for the history table, for the same reason version 3
 * indexed `bytes`: without it, the only way to ask for a character's newest
 * snapshot, or for its snapshot keys in age order, is to load every row it
 * has. Each row holds a whole character document, so every autosave was
 * deserializing the fifty kept snapshots twice over (once to find the newest,
 * once to work out what to prune) to end up using one of them and none of
 * them respectively. Purely additive: no data changes shape, so no upgrade
 * step.
 */
db.version(4).stores({ characterHistory: 'id, charId, at, [charId+at]' });

/**
 * Homebrew content apart from its metadata, for the reason version 3 indexed
 * `bytes`: the registry checked its signature, and the homebrew list and the
 * Sources settings rendered, by reading every file whole. The upgrade moves
 * each row's `json` into `homebrewJson` once; the readers still take a `json`
 * left on a row, so a row this misses is read as it was.
 */
db.version(5)
  .stores({ homebrewJson: 'id' })
  .upgrade(async (tx) => {
    const rows = await tx.table<HomebrewMetaRow>('homebrewFiles').toArray();
    const moved = rows.filter((row) => row.json !== undefined);
    await tx
      .table<HomebrewJsonRow>('homebrewJson')
      .bulkPut(moved.map((row) => ({ id: row.id, json: row.json })));
    await tx
      .table<HomebrewMetaRow>('homebrewFiles')
      .toCollection()
      .modify((row) => {
        delete row.json;
      });
  });

/**
 * A collection keeps its identity through an update (ADR-002, D4). Each
 * imported file gets the key an import finds it by, so the first time a file
 * imported before this is imported again it updates, rather than lands beside
 * it. A rule pack's Apply to and order move off the file onto its row: they
 * were kept in the file's `_meta.castGuidanceLocal`, bound to its id, and are
 * read from there this once, leaving the file as it was imported. A block
 * bound to another id came with the file from another device and reached
 * nobody, so it stays as it came. Content is read for files stored whole
 * only: a book of a converted compendium is never a pack, and the books are
 * the megabytes, and only a file a block comes out of is written back, so
 * the upgrade needs no room beyond the packs' own small files. What lands on
 * the row is checked where every row is read.
 *
 * Content is read with a cursor, not `modify`: `modify` writes back every row
 * its callback does not refuse, and one that writes nothing leaves Dexie's
 * per-transaction read cache (keyed by primary keys alone, whatever the
 * table) in place, so the `modify` of `homebrewFiles` after it, over the same
 * ids, would be handed the content rows.
 */
db.version(6)
  .stores({})
  .upgrade(async (tx) => {
    const files = tx.table<HomebrewMetaRow>('homebrewFiles');
    const rows = await files.toArray();
    const whole = rows.filter((r) => typeof r.id === 'string' && r.book === undefined);
    const packs = new Map<string, PackLocal>();
    const bodies = tx.table<HomebrewJsonRow>('homebrewJson');
    const taken: HomebrewJsonRow[] = [];
    await bodies
      .where('id')
      .anyOf(whole.map((r) => r.id))
      .each((body) => {
        const local = takeOldPackLocal(body.id, body.json);
        if (local === undefined) return;
        packs.set(body.id, local);
        taken.push(body);
      });
    if (taken.length > 0) await bodies.bulkPut(taken);
    await files.toCollection().modify((row) => {
      // A row the version 5 upgrade missed still carries its content.
      const local = packs.get(row.id) ?? takeOldPackLocal(row.id, row.json);
      if (local !== undefined) row.pack = local;
      if (row.editable !== true && typeof row.key !== 'string') row.key = storedKey(row);
    });
  });

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A pack's Apply to and order as version 5 kept them, in the file's own
 * `_meta`, taken out of it when they were written for this file. Spelled out
 * here rather than read through `rulePack.ts`: this is the old format, and
 * stays what it was whatever the pack code becomes.
 */
function takeOldPackLocal(id: string, json: unknown): PackLocal | undefined {
  const meta = isObject(json) && isObject(json._meta) ? json._meta : undefined;
  const block = meta?.castGuidanceLocal;
  if (meta === undefined || !isObject(block) || block.file !== id || id === '') return undefined;
  delete meta.castGuidanceLocal;
  return {
    appliesTo: block.appliesTo as PackLocal['appliesTo'],
    ...(block.order === undefined ? {} : { order: block.order as number }),
  };
}

/** A stored row's key, from its fields read as `homebrewRepo` reads them. */
function storedKey(row: HomebrewMetaRow): string {
  const r = row as unknown as Record<string, unknown>;
  return collectionKey({
    url: typeof r.url === 'string' ? r.url : undefined,
    sourceIds: Array.isArray(r.sourceIds)
      ? r.sourceIds.filter((s): s is string => typeof s === 'string')
      : [],
    fileName: typeof r.fileName === 'string' ? r.fileName : `${String(r.id)}.json`,
    ...(typeof r.book === 'string' && r.book !== '' ? { book: r.book } : {}),
  });
}

// Here rather than in the shell: every write to this database, including the
// data loader's drain that runs before and outside it, must stop once another
// tab deletes or upgrades the database. See ./lifecycle.
installDbLifecycle(db);
