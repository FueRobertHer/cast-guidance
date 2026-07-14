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
   * Import an exported character + its embedded homebrew as one transaction.
   * Everything is validated, migrated, and re-hashed *before* the transaction
   * opens, so a malformed / future-version / oversized / adversarial file
   * throws with the database untouched. Embedded homebrew identity and metadata
   * are recomputed from content (see {@link buildHomebrewRow}), so a file
   * cannot overwrite unrelated local homebrew by supplying its id.
   */
  async importExport(exp: CharacterExport): Promise<ImportSummary> {
    const doc = migrateCharacter(exp.character);
    // Re-hash + re-derive metadata for every embedded file up front (async
    // crypto cannot run inside a Dexie transaction without auto-committing it).
    const prepared: HomebrewFileRow[] = [];
    for (const brew of exp.homebrew) {
      const b = (brew ?? {}) as Partial<HomebrewFileRow>;
      const fileName =
        typeof b.fileName === 'string' && b.fileName !== '' ? b.fileName : 'imported.json';
      const url = typeof b.url === 'string' ? b.url : undefined;
      prepared.push(await buildHomebrewRow(b.json, fileName, url));
    }

    const summary = await db.transaction('rw', db.characters, db.homebrewFiles, async () => {
      const existingHomebrewIds = new Set(
        await db.homebrewFiles
          .where('id')
          .anyOf(prepared.map((r) => r.id))
          .primaryKeys(),
      );
      const characterExists = (await db.characters.get(doc.id)) !== undefined;
      const plan = planCharacterImport(doc, prepared, {
        characterExists,
        existingHomebrewIds,
        newId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      });
      for (const row of plan.homebrewToAdd) await db.homebrewFiles.add(row);
      await db.characters.put(plan.finalDoc);
      return plan.summary;
    });

    if (prepared.length > 0) invalidateRegistry();
    return summary;
  },

  /**
   * Parse + validate raw exported text, then import it transactionally.
   * The single entry point the UI should use.
   */
  async importFromText(text: string): Promise<ImportSummary> {
    if (text.length > IMPORT_LIMITS.maxTextLength) {
      throw new ValidationError(`export is larger than ${IMPORT_LIMITS.maxTextLength} characters`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ValidationError('file is not valid JSON');
    }
    return this.importExport(assertCharacterExport(raw));
  },
};

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
