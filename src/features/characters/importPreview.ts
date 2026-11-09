/**
 * What importing a character export would do, worked out before anything is
 * written (IMP-002). Pure. Its runtime imports are `collectCharacterSources`
 * and the homebrew preview's `officialCoverage`, both loaded with the import
 * flow, so the roster can load it on demand without growing the entry chunk.
 *
 * The commit decides again inside its transaction (`characterRepo.commitImport`),
 * so this is a forecast for the player, not a promise: another tab may change
 * the answer in between, and the commit's summary is the one that counts.
 */
import type { PreparedCharacterImport } from '@/db/characterRepo';
import { bookHolders, mergeBook, sameBookCopy } from '@/db/homebrewBooks';
import { compareMergeOrder } from '@/db/homebrewOrder';
import type { HomebrewFile } from '@/db/homebrewRepo';
import {
  type OfficialCoverage,
  type OfficialIndex,
  officialCoverage,
} from '@/features/homebrew/importPreview';
import { collectCharacterSources } from './homebrewExport';

/** Worded for the preview's list of sources nothing here provides. */
export const MISSING_SOURCE_NOTE = 'will show as missing until you import it';

export type EmbeddedFileStatus =
  /** Not here yet; importing adds it. */
  | 'new'
  /** The same content is already here; importing skips it. */
  | 'already-here'
  /**
   * An enabled local file declares the same source id with different
   * content. Both end up here, and the local one was imported first, so it
   * keeps winning any entry the two share. A turned-off local file with the
   * source does not make this status (the import is `new`); it is still
   * listed in `localFiles` with `enabled: false`, because it wins again if
   * it is turned back on.
   */
  | 'other-version'
  /**
   * A book (often only the part the character uses) whose every entry is in
   * the copies of it here; importing skips it.
   */
  | 'book-here'
  /**
   * A book with a copy here from the same file that lacks some of its
   * entries: importing adds those to that copy (`adds` of them), so the
   * book is still stored once.
   */
  | 'adds-to-book';

export interface EmbeddedFilePreview {
  fileName: string;
  status: EmbeddedFileStatus;
  counts: Record<string, number>;
  sourceIds: string[];
  /**
   * Local files (different content) declaring one of this file's sources that
   * win over what this import stores: every one, for a file that comes in on
   * its own; for `adds-to-book`, those ahead of the copy taking the entries.
   * Enabled ones keep precedence now; disabled ones regain it if turned on.
   * Empty where nothing is stored (`already-here`, `book-here`).
   */
  localFiles: { id: string; fileName: string; enabled: boolean }[];
  /**
   * For `already-here`: whether the copy here is turned on; for `book-here`,
   * whether a file holding the book is; for `adds-to-book`, whether the copy
   * taking the entries in is. A turned-off copy is skipped like any other,
   * but its entries are not in use until it is turned back on.
   */
  existingEnabled?: boolean;
  /** For `adds-to-book`: how many entries the copy here takes in. */
  adds?: number;
}

export interface CharacterPreview {
  name: string;
  /** For example `Mage 3 / Warrior 1`; empty for a character with no class yet. */
  classLabel: string;
  /** The id is already taken here, so the import lands as a copy with a new id. */
  importsAsCopy: boolean;
  bytes: number;
  files: EmbeddedFilePreview[];
  /** Sources the character uses that nothing here or in the file provides. */
  missingSources: string[];
  /** Not found, but game data is not all here yet, so they may still arrive. */
  notDownloadedSources: string[];
  /** Provided only by a homebrew file here that is turned off. */
  disabledSources: string[];
  officialCoverage: OfficialCoverage;
  notes: string[];
}

export interface CharacterPreviewInput {
  prepared: PreparedCharacterImport;
  characterExists: boolean;
  /** Every homebrew file here, enabled or not. */
  existing: readonly HomebrewFile[];
  official: OfficialIndex | null;
}

const lower = (s: string) => s.toLowerCase();

export function previewCharacterImport(input: CharacterPreviewInput): CharacterPreview {
  const { prepared, existing, official } = input;
  const { doc } = prepared;
  const existingById = new Map(existing.map((f) => [f.id, f]));
  const existingIds = new Set(existingById.keys());

  // The commit skips a file repeated inside the export, so list it once.
  const seen = new Set<string>();
  const files: EmbeddedFilePreview[] = [];
  for (const row of prepared.homebrew) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const own = new Set(row.sourceIds.map(lower));
    const sharing = existing.filter((f) => f.sourceIds.some((s) => own.has(lower(s))));
    const listed = (local: readonly HomebrewFile[]) =>
      local.map((f) => ({ id: f.id, fileName: f.book ?? f.fileName, enabled: f.enabled }));
    const holders = existingIds.has(row.id) ? [] : bookHolders(row, existing);
    const copy =
      existingIds.has(row.id) || holders.length > 0 || row.book === undefined
        ? undefined
        : existing.find((f) => sameBookCopy(f, row));
    const base = {
      // A book of a converted file goes by the book's name: every book shares the file's.
      fileName: row.book ?? row.fileName,
      counts: row.counts,
      sourceIds: row.sourceIds,
      localFiles: listed(sharing),
    };
    if (existingIds.has(row.id)) {
      files.push({
        ...base,
        status: 'already-here',
        localFiles: [],
        existingEnabled: existingById.get(row.id)?.enabled,
      });
    } else if (holders.length > 0) {
      files.push({
        ...base,
        status: 'book-here',
        localFiles: [],
        // On only if what is turned on holds the part by itself.
        existingEnabled:
          bookHolders(
            row,
            holders.filter((f) => f.enabled),
          ).length > 0,
      });
    } else if (copy !== undefined && isObject(row.json)) {
      const adds = mergeBook(copy.json, row.json).added;
      // Nothing to add when only another book's entries were missing.
      files.push(
        adds === 0
          ? { ...base, status: 'book-here', localFiles: [], existingEnabled: copy.enabled }
          : {
              ...base,
              status: 'adds-to-book',
              // The entries take the copy's place in merge order, not a new file's.
              localFiles: listed(
                sharing.filter((f) => f.id !== copy.id && compareMergeOrder(f, copy) < 0),
              ),
              existingEnabled: copy.enabled,
              adds,
            },
      );
    } else {
      const status = sharing.some((f) => f.enabled) ? 'other-version' : 'new';
      files.push({ ...base, status });
    }
  }

  const embedded = new Set(prepared.homebrew.flatMap((r) => r.sourceIds.map(lower)));
  const enabledLocal = new Set(
    existing.filter((f) => f.enabled).flatMap((f) => f.sourceIds.map(lower)),
  );
  const disabledLocal = new Set(
    existing.filter((f) => !f.enabled).flatMap((f) => f.sourceIds.map(lower)),
  );
  const missingSources: string[] = [];
  const notDownloadedSources: string[] = [];
  const disabledSources: string[] = [];
  const officialKnown = official?.complete === true;
  for (const s of collectCharacterSources(doc)) {
    if (official?.sources.has(s) === true || embedded.has(s) || enabledLocal.has(s)) continue;
    if (disabledLocal.has(s)) disabledSources.push(s);
    else if (officialKnown) missingSources.push(s);
    else notDownloadedSources.push(s);
  }

  const notes: string[] = [];
  const coverage = officialCoverage(official);
  if (coverage === 'unavailable') {
    notes.push('Game data could not be read, so official sources were not checked.');
  } else if (coverage === 'partial') {
    notes.push(
      'Not all game data is on this device yet, so some sources may only be missing for now.',
    );
  }

  return {
    name: doc.name,
    classLabel: classLabelOf(doc.classes),
    importsAsCopy: input.characterExists,
    bytes: prepared.bytes,
    files,
    missingSources,
    notDownloadedSources,
    disabledSources,
    officialCoverage: coverage,
    notes,
  };
}

/**
 * `Mage 3 / Warrior 1`, read defensively: an export the old flow imported can
 * lack its class list or hold a class entry with no reference.
 */
function classLabelOf(classes: unknown): string {
  if (!Array.isArray(classes)) return '';
  return classes
    .map((c: { ref?: { name?: unknown }; levels?: unknown } | null) => {
      const name = typeof c?.ref?.name === 'string' ? c.ref.name : 'Unknown class';
      return typeof c?.levels === 'number' ? `${name} ${c.levels}` : name;
    })
    .join(' / ');
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
