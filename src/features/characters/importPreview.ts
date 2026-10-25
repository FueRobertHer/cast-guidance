/**
 * What importing a character export would do, worked out before anything is
 * written (IMP-002). Pure, and only type imports, so the roster can load it on
 * demand without growing the entry chunk.
 *
 * The commit decides again inside its transaction (`characterRepo.commitImport`),
 * so this is a forecast for the player, not a promise: another tab may change
 * the answer in between, and the commit's summary is the one that counts.
 */
import type { PreparedCharacterImport } from '@/db/characterRepo';
import type { HomebrewFile } from '@/db/homebrewRepo';
import type { OfficialIndex } from '@/features/homebrew/importPreview';
import { collectCharacterSources } from './homebrewExport';

/** Worded for the preview's list of sources nothing here provides. */
export const MISSING_SOURCE_NOTE = 'will show as missing until you import it';

export type EmbeddedFileStatus =
  /** Not here yet; importing adds it. */
  | 'new'
  /** The same content is already here; importing skips it. */
  | 'already-here'
  /**
   * A local file declares the same source id with different content. Both
   * end up here, and the local one was imported first, so it keeps winning
   * any entry the two share.
   */
  | 'other-version';

export interface EmbeddedFilePreview {
  fileName: string;
  status: EmbeddedFileStatus;
  counts: Record<string, number>;
  sourceIds: string[];
  /** For `other-version`: the local files that keep precedence. */
  localFiles: { id: string; fileName: string }[];
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
  const existingIds = new Set(existing.map((f) => f.id));

  // The commit skips a file repeated inside the export, so list it once.
  const seen = new Set<string>();
  const files: EmbeddedFilePreview[] = [];
  for (const row of prepared.homebrew) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const own = new Set(row.sourceIds.map(lower));
    const localFiles = existingIds.has(row.id)
      ? []
      : existing
          .filter((f) => f.sourceIds.some((s) => own.has(lower(s))))
          .map((f) => ({ id: f.id, fileName: f.fileName }));
    files.push({
      fileName: row.fileName,
      status: existingIds.has(row.id)
        ? 'already-here'
        : localFiles.length > 0
          ? 'other-version'
          : 'new',
      counts: row.counts,
      sourceIds: row.sourceIds,
      localFiles,
    });
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
  if (official === null) {
    notes.push('Game data is not available yet, so official sources were not checked.');
  } else if (!official.complete) {
    notes.push('Game data is still downloading, so some sources may not be here yet.');
  }

  return {
    name: doc.name,
    classLabel: doc.classes.map((c) => `${c.ref.name} ${c.levels}`).join(' / '),
    importsAsCopy: input.characterExists,
    bytes: prepared.bytes,
    files,
    missingSources,
    notDownloadedSources,
    disabledSources,
    notes,
  };
}
