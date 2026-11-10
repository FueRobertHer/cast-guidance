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
 *
 * One book of a converted compendium can run to megabytes, so of a book the
 * export carries only the part the character uses (see `bookParts`), marked
 * as a part: the device that imports it skips it where it has the book, and
 * importing the whole book there replaces it.
 *
 * A rule pack applied to the character goes too, so the table's rules travel
 * with them, without who it is applied to here: the device that imports it
 * applies it to nobody until its player chooses (`data5e/rulePack.ts`).
 */
import { packGuidance, packLocal, packRefusals, sharedFile } from '@/data5e/rulePack';
import { bookParts } from '@/db/homebrewBooks';
import type { HomebrewFile } from '@/db/homebrewRepo';
import type { CharacterDoc, EntityRef } from '@/engine/types';

/** Public export shape for one embedded homebrew file. */
export interface HomebrewExportDTO {
  fileName: string;
  json: unknown;
}

/** A pick's entry, when it names one. */
function refFrom(ref: unknown): EntityRef | undefined {
  const r = ref as Partial<EntityRef> | null | undefined;
  return typeof r?.source === 'string' && r.source !== ''
    ? { name: typeof r.name === 'string' ? r.name : '', source: r.source }
    : undefined;
}

/** The array a field should hold, or nothing: stored and imported docs can be malformed. */
function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

const refOf = (entry: unknown, key: string): unknown =>
  typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)[key] : undefined;

/** A choice's value that names an entry, as `refUid` writes one: `name|source`. */
const PICKED_UID = /^([^|]+)\|([^|]+)$/;

/** The entries a character's choices name: a fighting style, an invocation, a feat at a level. */
function choiceRefs(choices: unknown): EntityRef[] {
  if (typeof choices !== 'object' || choices === null) return [];
  const out: EntityRef[] = [];
  for (const value of Object.values(choices)) {
    for (const v of Array.isArray(value) ? value : [value]) {
      const m = typeof v === 'string' ? PICKED_UID.exec(v) : null;
      if (m?.[1] !== undefined && m[2] !== undefined) out.push({ name: m[1], source: m[2] });
    }
  }
  return out;
}

/**
 * Every entry the character picked, as the doc names it: race, subrace,
 * background, classes and subclasses, feats, equipment, spells, and what its
 * choices name.
 *
 * Read defensively: a document the app accepted (an older export, a damaged
 * roster entry) can lack a list or hold a stray value in one, and one such
 * field must not stop an export or an import of something else.
 */
export function collectCharacterRefs(doc: CharacterDoc): EntityRef[] {
  const raw: unknown[] = [doc.race, doc.subrace, doc.background];
  for (const c of listOf(doc.classes)) raw.push(refOf(c, 'ref'), refOf(c, 'subclass'));
  for (const f of listOf(doc.feats)) raw.push(refOf(f, 'ref'));
  for (const e of listOf(doc.equipment)) raw.push(refOf(e, 'ref'));
  const spellcasting = doc.spellcasting as unknown;
  if (typeof spellcasting === 'object' && spellcasting !== null) {
    // A loop, not a spread: an imported doc's lists can be long enough to
    // overflow a call's arguments.
    for (const sc of Object.values(spellcasting)) {
      for (const ref of listOf(refOf(sc, 'known'))) raw.push(ref);
      for (const ref of listOf(refOf(sc, 'prepared'))) raw.push(ref);
    }
  }
  for (const a of listOf(doc.addedSpells)) raw.push(refOf(a, 'spell'));
  const out: EntityRef[] = [];
  for (const r of raw) {
    const ref = refFrom(r);
    if (ref !== undefined) out.push(ref);
  }
  for (const ref of choiceRefs(doc.choices)) out.push(ref);
  return out;
}

/**
 * Every source id the character references across its picks. Used to decide
 * which homebrew files an export must carry, and by the import previews.
 */
export function collectCharacterSources(doc: CharacterDoc): Set<string> {
  const out = new Set(collectCharacterRefs(doc).map((r) => r.source.toLowerCase()));
  // Explicit deps, if the character tracked any.
  for (const dep of listOf(doc.homebrewDeps)) {
    if (typeof dep === 'string' && dep !== '') out.add(dep.toLowerCase());
  }
  return out;
}

/** A file as it leaves the device: a pack without who it is applied to here. */
export function toHomebrewExportDTO(row: HomebrewFile): HomebrewExportDTO {
  return { fileName: row.fileName, json: sharedFile(row.json) };
}

/** Whether `row` is a rule pack applied here to the character, or to every character. */
function packReaches(row: HomebrewFile, characterId: string): boolean {
  const guidance = packGuidance(row.json);
  if (guidance === undefined || packRefusals(guidance).length > 0) return false;
  const to = packLocal(row.json, row.id)?.appliesTo;
  return to !== undefined && (to.appDefault === true || to.characters.includes(characterId));
}

/**
 * Select + shape the homebrew to embed in an export. A book goes as the part
 * the character uses, with what that part needs from the other books here (a
 * background's feat from another book of the same compendium); one it names
 * only as a dependency, with none of its entries picked, goes whole, as any
 * other file does.
 *
 * Two files can each hold a copy of one book. A part comes from the first
 * copy in merge order that has each entry (`enabled` is in merge order), so
 * the other copy, with no part, is not needed and does not go whole. A book
 * named only as a dependency goes whole once, as its first copy.
 */
export function homebrewForExport(
  doc: CharacterDoc,
  enabled: readonly HomebrewFile[],
): HomebrewExportDTO[] {
  const books = enabled.filter((row) => row.book !== undefined);
  const parts = bookParts(
    books.map((row) => row.json),
    collectCharacterRefs(doc),
  );
  const partOf = new Map(books.map((row, i) => [row, parts[i]]));
  // The books some copy already goes for, by their one source id.
  const sent = new Set<string>();
  for (const [row, part] of partOf) {
    if (part !== undefined) for (const s of row.sourceIds) sent.add(s.toLowerCase());
  }
  const sources = collectCharacterSources(doc);
  const out: HomebrewExportDTO[] = [];
  for (const row of enabled) {
    const part = partOf.get(row);
    if (part !== undefined) out.push({ fileName: row.fileName, json: part });
    else if (row.book === undefined) {
      if (row.sourceIds.some((s) => sources.has(s.toLowerCase())) || packReaches(row, doc.id)) {
        out.push(toHomebrewExportDTO(row));
      }
    } else {
      const needed = row.sourceIds.filter(
        (s) => sources.has(s.toLowerCase()) && !sent.has(s.toLowerCase()),
      );
      if (needed.length === 0) continue;
      for (const s of row.sourceIds) sent.add(s.toLowerCase());
      out.push(toHomebrewExportDTO(row));
    }
  }
  return out;
}
