import {
  assertHomebrewFile,
  assertJsonWithinLimits,
  homebrewEntityCounts,
  sha256Hex,
} from '@/lib/guards';
import { db, type HomebrewFileRow } from './db';

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
  };
}

/**
 * A stored row that has crossed the read boundary. Identical to the stored
 * shape but for `json`, which is `unknown` on the way out of Dexie and a JSON
 * object once it has been read: the narrowing is the boundary's whole point,
 * and it is what lets the registry and the editors index into `json` without
 * an unchecked cast between them and a row nobody validated.
 */
export interface HomebrewFile extends Omit<HomebrewFileRow, 'json'> {
  json: Record<string, unknown>;
}

export interface HomebrewReadError {
  id?: string;
  fileName?: string;
  message: string;
}

export interface HomebrewListResult {
  files: HomebrewFile[];
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
  if (!isRecord(row)) return { message: `expected a stored row, got ${typeof row}` };
  const id = row.id;
  const fileName = typeof row.fileName === 'string' ? row.fileName : undefined;
  if (typeof id !== 'string' || id === '') {
    return { fileName, message: 'the row has no id, so nothing can address it' };
  }
  if (!isRecord(row.json)) {
    return { id, fileName, message: 'the file content is missing or is not a JSON object' };
  }
  const counts = isRecord(row.counts) ? row.counts : {};
  return {
    id,
    fileName: fileName ?? `${id}.json`,
    url: typeof row.url === 'string' ? row.url : undefined,
    json: row.json,
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
  };
}

function isReadError(v: HomebrewFile | HomebrewReadError): v is HomebrewReadError {
  return 'message' in v;
}

/**
 * Read a batch of stored rows, collecting per-row failures instead of throwing.
 * Pure and unit-testable; backs every homebrew read the app makes, the same way
 * `partitionCharacterRows` backs the character list.
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

export const homebrewRepo = {
  /**
   * Every stored homebrew file, newest first, read through the boundary. The
   * unvalidated read this replaced handed `json` straight to the registry,
   * where `json[type]` on a row whose content was not an object threw out of
   * `getRegistry()` and took down every view that needed the compendium.
   */
  async listSafe(): Promise<HomebrewListResult> {
    // Read unordered and sort after, rather than `orderBy('addedAt')`: Dexie
    // leaves a row out of an index traversal when its indexed key is missing,
    // so the damaged rows this boundary exists to report are exactly the ones
    // an ordered read would never hand it. Newest first, as before, with rows
    // whose timestamp is gone treated as oldest.
    const result = partitionHomebrewRows(await db.homebrewFiles.toArray());
    result.files.sort((a, b) => b.addedAt - a.addedAt);
    return result;
  },

  /** The enabled files only, with the errors from the whole set. */
  async enabledSafe(): Promise<HomebrewListResult> {
    const { files, errors } = partitionHomebrewRows(await db.homebrewFiles.toArray());
    return { files: files.filter((r) => r.enabled), errors };
  },

  /**
   * One file by id. All three outcomes are distinct: no row, an unreadable
   * row, and a file. A caller that cannot tell "still loading" from "no such
   * file" shows a spinner forever over a file that was deleted in another tab.
   */
  async getSafe(id: string): Promise<{ file?: HomebrewFile; error?: HomebrewReadError }> {
    const row = await db.homebrewFiles.get(id);
    if (row === undefined) return {};
    const { files, errors } = partitionHomebrewRows([row]);
    return { file: files[0], error: errors[0] };
  },

  /** Validate + store a homebrew JSON file; content-hash keyed (idempotent). */
  async importJson(raw: unknown, fileName: string, url?: string): Promise<HomebrewFileRow> {
    const row = await buildHomebrewRow(raw, fileName, url);
    const existing = await db.homebrewFiles.get(row.id);
    if (existing !== undefined) return existing;
    await db.homebrewFiles.put(row);
    return row;
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
    await db.homebrewFiles.delete(id);
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
    await db.homebrewFiles.put(row);
    return row;
  },

  async saveEditable(id: string, json: Record<string, unknown>): Promise<void> {
    // Bump rev so the registry/search signature notices the content change even
    // though the file id stays the same across edits.
    const modified = await db.homebrewFiles
      .where('id')
      .equals(id)
      .modify((row) => {
        row.json = json;
        row.counts = homebrewEntityCounts(json);
        row.rev = (row.rev ?? 0) + 1;
      });
    // Matching no rows is not success. The builder reports what this resolves
    // to, so a save against a file deleted in another tab has to say so rather
    // than close the form over an edit that reached nothing.
    if (modified === 0) throw new Error(`homebrew file ${id} no longer exists`);
  },
};
