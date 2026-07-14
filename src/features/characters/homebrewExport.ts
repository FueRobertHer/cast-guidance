/**
 * Scope and shape the homebrew embedded in a character export (IMP-002).
 *
 * Previously every export shipped *all* enabled homebrew plus the full local
 * `HomebrewFileRow` (with local-only fields like `enabled`, `editable`,
 * `addedAt`, `rev`). This selects only the homebrew the character actually
 * depends on and maps it to a minimal public DTO. Import recomputes identity
 * and metadata from `json`, so the DTO only needs the file content + a name.
 */
import type { HomebrewFileRow } from '@/db/db';
import type { CharacterDoc, EntityRef } from '@/engine/types';

/** Public export shape for one embedded homebrew file. */
export interface HomebrewExportDTO {
  fileName: string;
  json: unknown;
}

function addRef(into: Set<string>, ref: EntityRef | undefined): void {
  if (ref?.source !== undefined && ref.source !== '') into.add(ref.source.toLowerCase());
}

/**
 * Every source id the character references across its picks. Used to decide
 * which homebrew files an export must carry.
 */
export function collectCharacterSources(doc: CharacterDoc): Set<string> {
  const out = new Set<string>();
  addRef(out, doc.race);
  addRef(out, doc.subrace);
  addRef(out, doc.background);
  for (const c of doc.classes) {
    addRef(out, c.ref);
    addRef(out, c.subclass);
  }
  for (const f of doc.feats) addRef(out, f.ref);
  for (const e of doc.equipment) addRef(out, e.ref);
  for (const sc of Object.values(doc.spellcasting)) {
    for (const ref of sc.known) addRef(out, ref);
    for (const ref of sc.prepared) addRef(out, ref);
  }
  // Explicit deps, if the character tracked any.
  for (const dep of doc.homebrewDeps) out.add(dep.toLowerCase());
  return out;
}

/**
 * The enabled homebrew files this character depends on — a file is included
 * when any of its source ids is referenced by the character.
 */
export function selectHomebrewForExport(
  doc: CharacterDoc,
  enabled: readonly HomebrewFileRow[],
): HomebrewFileRow[] {
  const sources = collectCharacterSources(doc);
  return enabled.filter((row) => row.sourceIds.some((s) => sources.has(s.toLowerCase())));
}

export function toHomebrewExportDTO(row: HomebrewFileRow): HomebrewExportDTO {
  return { fileName: row.fileName, json: row.json };
}

/** Select + shape the homebrew to embed in an export. */
export function homebrewForExport(
  doc: CharacterDoc,
  enabled: readonly HomebrewFileRow[],
): HomebrewExportDTO[] {
  return selectHomebrewForExport(doc, enabled).map(toHomebrewExportDTO);
}
