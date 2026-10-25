import Dexie, { type ObservabilitySet } from 'dexie';
import { invalidateRegistry } from '@/data5e/registry';
import { migrateCharacter } from '@/engine/migrate';
import type { CharacterDoc } from '@/engine/types';
import { sameContent } from '@/lib/docDiff';
import {
  assertCharacterExport,
  type CharacterExport,
  IMPORT_LIMITS,
  ValidationError,
} from '@/lib/guards';
import { randomId } from '@/lib/randomId';
import { type CharacterRow, db, type HomebrewFileRow } from './db';
import { buildHomebrewRow } from './homebrewRepo';

/**
 * What a save expects the stored row to be (REL-007, #98): the revision this
 * tab last read or wrote, with the content it had then, or no row at all.
 */
export type SaveExpect =
  | { kind: 'revision'; revision: string | undefined; content?: CharacterDoc }
  | { kind: 'absent' };

/**
 * How a checked save ended. `conflict`: the row is no longer what the save
 * expected; `missing`: the row is gone. Neither wrote anything.
 */
export type SaveResult =
  | { status: 'saved'; revision: string | undefined }
  | { status: 'conflict' }
  | { status: 'missing' };

/** Every part Dexie reports for a write to the characters table starts with this. */
const CHARACTERS_PART = `idb://${db.name}/characters/`;

/**
 * A stored row without its storage bookkeeping. Every read goes through here,
 * so a document never carries `revision` into an export, a history snapshot
 * or the journal.
 */
function withoutRevision(row: unknown): unknown {
  if (row === null || typeof row !== 'object' || !('revision' in row)) return row;
  const { revision: _, ...doc } = row as CharacterRow;
  return doc;
}

function splitRow(row: CharacterRow): { doc: CharacterDoc; revision: string | undefined } {
  return { doc: migrateCharacter(withoutRevision(row)), revision: row.revision };
}

/** A row to store: a fresh stamp and a fresh revision, whatever `doc` carried. */
function rowFor(doc: CharacterDoc): CharacterRow {
  return { ...doc, updatedAt: new Date().toISOString(), revision: randomId() };
}

/** Persistence seam for characters (cloud sync slots in behind this). */
export const characterRepo = {
  async list(): Promise<CharacterDoc[]> {
    const rows = await db.characters.orderBy('updatedAt').reverse().toArray();
    return rows.map((r) => migrateCharacter(withoutRevision(r)));
  },

  /**
   * Resilient read for the live character list (REL-006): every stored record
   * crosses the migration boundary, but one unreadable record is collected as
   * an error instead of throwing, so a single corrupt document cannot take down
   * the whole list (REL-005). Safe to use inside `useLiveQuery`.
   */
  async listSafe(): Promise<CharacterListResult> {
    const rows = await db.characters.orderBy('updatedAt').reverse().toArray();
    return partitionCharacterRows(rows);
  },

  async get(id: string): Promise<CharacterDoc | undefined> {
    const row = await db.characters.get(id);
    return row === undefined ? undefined : splitRow(row).doc;
  },

  /** A character with the revision of the row it was read from. */
  async getWithRevision(
    id: string,
  ): Promise<{ doc: CharacterDoc; revision: string | undefined } | undefined> {
    const row = await db.characters.get(id);
    return row === undefined ? undefined : splitRow(row);
  },

  /**
   * An unconditional write, for a character no tab has open yet: a new one,
   * or an id nothing else can have written.
   */
  async put(doc: CharacterDoc): Promise<void> {
    await db.characters.put(rowFor(doc));
  },

  /**
   * Store a new character. If its id is already taken (a browser's "Duplicate
   * tab" copies the creator's draft, id and all), it is stored under a fresh
   * one rather than over the other. Returns what was stored.
   */
  async create(doc: CharacterDoc): Promise<CharacterDoc> {
    return db.transaction('rw', db.characters, async () => {
      const taken = (await db.characters.get(doc.id)) !== undefined;
      const created = taken ? { ...doc, id: crypto.randomUUID() } : doc;
      await db.characters.add(rowFor(created));
      return created;
    });
  },

  /**
   * The session's save (REL-007, #98): write `doc` only if the stored row is
   * still what `expect` says, so a tab holding an older copy cannot write
   * over another tab's newer save. The read, the check and the write are one
   * transaction, and everything between them is synchronous, so no other
   * write can land in between.
   *
   * A matching revision is not enough on its own: the stored content must
   * also be the copy the tab expects. A tab running older code writes back
   * the revision it read, and a row from before revisions has none, so only
   * the content tells those writes apart. A row that already holds exactly
   * what this save would write is not a conflict: nothing is written and its
   * revision comes back.
   */
  async save(doc: CharacterDoc, expect: SaveExpect): Promise<SaveResult> {
    return db.transaction('rw', db.characters, async (): Promise<SaveResult> => {
      const row = await db.characters.get(doc.id);
      if (row === undefined) {
        if (expect.kind !== 'absent') return { status: 'missing' };
      } else {
        const { doc: stored, revision } = splitRow(row);
        const current =
          expect.kind === 'revision' &&
          revision === expect.revision &&
          (expect.content === undefined || sameContent(stored, expect.content));
        if (!current) {
          return sameContent(stored, doc) ? { status: 'saved', revision } : { status: 'conflict' };
        }
      }
      const written = rowFor(doc);
      await db.characters.put(written);
      return { status: 'saved', revision: written.revision };
    });
  },

  /**
   * Rename in place: patches the name alone, with a new revision, so a tab
   * holding the character open sees the change rather than having its whole
   * document written over by the roster's copy. False if it is gone.
   */
  async rename(id: string, name: string): Promise<boolean> {
    const changed = await db.characters.update(id, {
      name,
      updatedAt: new Date().toISOString(),
      revision: randomId(),
    });
    return changed > 0;
  },

  /**
   * Call `listener` after any committed write to the characters table, by
   * this tab or another one (Dexie relays its own change events between tabs
   * over a BroadcastChannel), and when Dexie says anything may have changed
   * (its `all` part, sent when a page comes back from the back-forward cache,
   * having missed whatever was written meanwhile). Returns the unsubscribe.
   */
  onChange(listener: () => void): () => void {
    const handler = (parts: ObservabilitySet) => {
      const keys = Object.keys(parts);
      if (keys.some((part) => part === 'all' || part.startsWith(CHARACTERS_PART))) listener();
    };
    Dexie.on.storagemutated.subscribe(handler);
    return () => Dexie.on.storagemutated.unsubscribe(handler);
  },

  async delete(id: string): Promise<void> {
    // One transaction so a failure deleting history cannot orphan the character
    // record (or vice versa) — the pair is removed together or not at all.
    await db.transaction('rw', db.characters, db.characterHistory, async () => {
      await db.characters.delete(id);
      await db.characterHistory.where('charId').equals(id).delete();
    });
  },

  async duplicate(id: string): Promise<CharacterDoc | undefined> {
    const doc = await this.get(id);
    if (doc === undefined) return undefined;
    const copy: CharacterDoc = {
      ...structuredClone(doc),
      id: crypto.randomUUID(),
      name: `${doc.name} (copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.characters.put(rowFor(copy));
    return copy;
  },

  /**
   * Import an exported character + its embedded homebrew as one transaction:
   * {@link prepareExport}, then {@link characterRepo.commitImport}.
   */
  async importExport(exp: CharacterExport): Promise<ImportSummary> {
    return characterRepo.commitImport(await prepareExport(exp, 0));
  },

  /**
   * The first half of an import: size check, parse, validation, migration and
   * re-hashing of every embedded homebrew file, writing nothing. A malformed,
   * future-version, oversized or adversarial file throws here with the
   * database untouched. A preview reads the result, and
   * {@link characterRepo.commitImport} stores it.
   */
  async prepareImport(text: string): Promise<PreparedCharacterImport> {
    if (text.length > IMPORT_LIMITS.maxTextLength) {
      throw new ValidationError(`export is larger than ${IMPORT_LIMITS.maxTextLength} characters`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ValidationError('file is not valid JSON');
    }
    return prepareExport(assertCharacterExport(raw), new TextEncoder().encode(text).byteLength);
  },

  /**
   * Store a prepared import as one transaction. What to write is decided
   * again inside the transaction, against the database as it is then, so the
   * summary stays true even if another tab imported the same homebrew or a
   * character with the same id after the preview was built.
   */
  async commitImport(prepared: PreparedCharacterImport): Promise<ImportSummary> {
    const { doc, homebrew } = prepared;
    const summary = await db.transaction('rw', db.characters, db.homebrewFiles, async () => {
      const existingHomebrewIds = new Set(
        await db.homebrewFiles
          .where('id')
          .anyOf(homebrew.map((r) => r.id))
          .primaryKeys(),
      );
      const characterExists = (await db.characters.get(doc.id)) !== undefined;
      const addedAt = Date.now();
      const plan = planCharacterImport(doc, homebrew, {
        characterExists,
        existingHomebrewIds,
        newId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      // Stamped at commit, as `homebrewRepo.commit` does: merge order counts
      // an import from when it lands.
      for (const row of plan.homebrewToAdd) await db.homebrewFiles.add({ ...row, addedAt });
      await db.characters.put({ ...plan.finalDoc, revision: randomId() });
      return plan.summary;
    });

    if (homebrew.length > 0) invalidateRegistry();
    return summary;
  },

  /**
   * Parse + validate raw exported text, then import it transactionally.
   * The single entry point for an import with no preview.
   */
  async importFromText(text: string): Promise<ImportSummary> {
    return characterRepo.commitImport(await characterRepo.prepareImport(text));
  },
};

/** A validated character import, ready to preview or commit; nothing written yet. */
export interface PreparedCharacterImport {
  /** The character, migrated to the current schema. */
  doc: CharacterDoc;
  /**
   * Embedded homebrew, re-hashed and with metadata recomputed from content
   * (see {@link buildHomebrewRow}), so a file cannot overwrite unrelated local
   * homebrew by supplying its id.
   */
  homebrew: HomebrewFileRow[];
  /** UTF-8 size of the export text (0 when it did not come from text). */
  bytes: number;
}

/**
 * Validate, migrate and re-hash an already-parsed export. The hashing is async
 * crypto, which cannot run inside a Dexie transaction without auto-committing
 * it, so it all happens here, before one opens.
 */
async function prepareExport(
  exp: CharacterExport,
  bytes: number,
): Promise<PreparedCharacterImport> {
  // A revision in the file is another device's bookkeeping, never this one's.
  const doc = migrateCharacter(withoutRevision(exp.character));
  const homebrew: HomebrewFileRow[] = [];
  for (const brew of exp.homebrew) {
    const b = (brew ?? {}) as Partial<HomebrewFileRow>;
    const fileName =
      typeof b.fileName === 'string' && b.fileName !== '' ? b.fileName : 'imported.json';
    const url = typeof b.url === 'string' ? b.url : undefined;
    homebrew.push(await buildHomebrewRow(b.json, fileName, url));
  }
  return { doc, homebrew, bytes };
}

export interface CharacterReadError {
  id?: string;
  message: string;
}

export interface CharacterListResult {
  characters: CharacterDoc[];
  errors: CharacterReadError[];
}

/**
 * Migrate a batch of stored rows, collecting per-row failures instead of
 * throwing. Pure and unit-testable; backs {@link characterRepo.listSafe}.
 */
export function partitionCharacterRows(rows: readonly unknown[]): CharacterListResult {
  const characters: CharacterDoc[] = [];
  const errors: CharacterReadError[] = [];
  for (const row of rows) {
    try {
      characters.push(migrateCharacter(withoutRevision(row)));
    } catch (err) {
      const id = (row as { id?: unknown }).id;
      errors.push({
        id: typeof id === 'string' ? id : undefined,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { characters, errors };
}

export interface ImportSummary {
  name: string;
  id: string;
  /** True when the character id collided locally and a fresh id was assigned. */
  renamed: boolean;
  homebrewAdded: number;
  /** Embedded files already present locally (by content hash) or duplicated in the file. */
  homebrewSkipped: number;
}

export interface ImportPlan {
  finalDoc: CharacterDoc;
  homebrewToAdd: HomebrewFileRow[];
  summary: ImportSummary;
}

/**
 * Pure decision layer for {@link characterRepo.importExport}: given the migrated
 * doc, the content-hashed homebrew rows, and current DB state, decide exactly
 * what to write. Extracted so the import policy is unit-testable without
 * IndexedDB.
 */
export function planCharacterImport(
  doc: CharacterDoc,
  preparedHomebrew: HomebrewFileRow[],
  opts: {
    characterExists: boolean;
    existingHomebrewIds: ReadonlySet<string>;
    newId: () => string;
    now: () => string;
  },
): ImportPlan {
  const finalId = opts.characterExists ? opts.newId() : doc.id;
  const finalDoc: CharacterDoc = { ...doc, id: finalId, updatedAt: opts.now() };

  // Skip files already stored (same content hash) and de-dupe within the batch.
  const seen = new Set(opts.existingHomebrewIds);
  const homebrewToAdd: HomebrewFileRow[] = [];
  let homebrewSkipped = 0;
  for (const row of preparedHomebrew) {
    if (seen.has(row.id)) {
      homebrewSkipped += 1;
      continue;
    }
    seen.add(row.id);
    homebrewToAdd.push(row);
  }

  return {
    finalDoc,
    homebrewToAdd,
    summary: {
      name: finalDoc.name,
      id: finalId,
      renamed: opts.characterExists,
      homebrewAdded: homebrewToAdd.length,
      homebrewSkipped,
    },
  };
}
