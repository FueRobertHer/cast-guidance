import { invalidateRegistry } from '@/data5e/registry';
import { migrateCharacter } from '@/engine/migrate';
import type { CharacterDoc } from '@/engine/types';
import {
  assertCharacterExport,
  type CharacterExport,
  IMPORT_LIMITS,
  ValidationError,
} from '@/lib/guards';
import { db, type HomebrewFileRow } from './db';
import { buildHomebrewRow } from './homebrewRepo';

/** Persistence seam for characters (cloud sync slots in behind this). */
export const characterRepo = {
  async list(): Promise<CharacterDoc[]> {
    const rows = await db.characters.orderBy('updatedAt').reverse().toArray();
    return rows.map((r) => migrateCharacter(r));
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
    return row === undefined ? undefined : migrateCharacter(row);
  },

  async put(doc: CharacterDoc): Promise<void> {
    await db.characters.put({ ...doc, updatedAt: new Date().toISOString() });
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
    await db.characters.put(copy);
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
      await db.characters.put(plan.finalDoc);
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
  const doc = migrateCharacter(exp.character);
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
      characters.push(migrateCharacter(row));
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
