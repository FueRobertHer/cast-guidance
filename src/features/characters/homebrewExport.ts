/**
 * Scope and shape the homebrew embedded in a character export (IMP-002).
 *
 * Takes files that have crossed the read boundary, not raw stored rows: an
 * export is read back by another device.
 *
 * Previously every export shipped *all* enabled homebrew plus the full local
 * `HomebrewFileRow` (with local-only fields like `enabled`, `editable`,
 * `addedAt`, `rev`). This selects only the homebrew the character actually
 * depends on and maps it to a minimal public DTO. Import recomputes identity
 * and metadata from `json`, so the DTO only needs the file content + a name.
 */
import type { HomebrewFile } from '@/db/homebrewRepo';
import type { CharacterDoc, EntityRef } from '@/engine/types';

/** Public export shape for one embedded homebrew file. */
export interface HomebrewExportDTO {
  fileName: string;
  json: unknown;
}

function addRef(into: Set<string>, ref: unknown): void {
  const source = (ref as Partial<EntityRef> | null | undefined)?.source;
  if (typeof source === 'string' && source !== '') into.add(source.toLowerCase());
}

/** The array a field should hold, or nothing: stored and imported docs can be malformed. */
function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

const refOf = (entry: unknown, key: string): unknown =>
  typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)[key] : undefined;

/**
 * Every source id the character references across its picks. Used to decide
 * which homebrew files an export must carry, and by the import previews.
 *
 * Read defensively: a document the app accepted (an older export, a damaged
 * roster entry) can lack a list or hold a stray value in one, and one such
 * field must not stop an export or an import of something else.
 */
export function collectCharacterSources(doc: CharacterDoc): Set<string> {
  const out = new Set<string>();
  addRef(out, doc.race);
  addRef(out, doc.subrace);
  addRef(out, doc.background);
  for (const c of listOf(doc.classes)) {
    addRef(out, refOf(c, 'ref'));
    addRef(out, refOf(c, 'subclass'));
  }
  for (const f of listOf(doc.feats)) addRef(out, refOf(f, 'ref'));
  for (const e of listOf(doc.equipment)) addRef(out, refOf(e, 'ref'));
  const spellcasting = doc.spellcasting as unknown;
  if (typeof spellcasting === 'object' && spellcasting !== null) {
    for (const sc of Object.values(spellcasting)) {
      for (const ref of listOf(refOf(sc, 'known'))) addRef(out, ref);
      for (const ref of listOf(refOf(sc, 'prepared'))) addRef(out, ref);
    }
  }
  // Explicit deps, if the character tracked any.
  for (const dep of listOf(doc.homebrewDeps)) {
    if (typeof dep === 'string' && dep !== '') out.add(dep.toLowerCase());
  }
  return out;
}

/**
 * The enabled homebrew files this character depends on — a file is included
 * when any of its source ids is referenced by the character.
 */
export function selectHomebrewForExport(
  doc: CharacterDoc,
  enabled: readonly HomebrewFile[],
): HomebrewFile[] {
  const sources = collectCharacterSources(doc);
  return enabled.filter((row) => row.sourceIds.some((s) => sources.has(s.toLowerCase())));
}

export function toHomebrewExportDTO(row: HomebrewFile): HomebrewExportDTO {
  return { fileName: row.fileName, json: row.json };
}

/** Select + shape the homebrew to embed in an export. */
export function homebrewForExport(
  doc: CharacterDoc,
  enabled: readonly HomebrewFile[],
): HomebrewExportDTO[] {
  return selectHomebrewForExport(doc, enabled).map(toHomebrewExportDTO);
}
