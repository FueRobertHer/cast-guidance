/**
 * Check a converter against the data it imitates. Fight Club's SRD files hold
 * spells, items, feats, backgrounds and races that 5etools has too, so each
 * converted entry can be set beside its official counterpart, field by field.
 * A field only the official entry has is a rule the converter leaves as text;
 * one whose value differs is a reading to check by hand.
 *
 * A developer tool, run by `scripts/convert-fc5.ts --compare`: nothing the app
 * ships imports it. Relative imports only, for plain Bun.
 */
import type { Entity } from '../data5e/copyMod';
import type { EntityType } from '../data5e/normalize';
import { editionOf } from '../data5e/rulesVersion';
import { OFFICIAL_TYPES, officialNames } from './official';
import type { ConvertedKind } from './types';

export interface OfficialData {
  /** The official entries of a registry type, as `normalizeDataset` builds them. */
  byType(type: EntityType): readonly Entity[];
  /**
   * The classes whose list has this official spell. 5etools keeps spell lists
   * in a lookup file beside the spells, not on them; without this, `classes`
   * is not compared.
   */
  spellClasses?: (spell: Entity) => readonly string[];
}

/** How one field of a matched pair compares; see `compareValues`. */
export type Outcome = 'same' | 'source' | 'differs' | 'missing' | 'extra';

export interface FieldTally {
  field: string;
  /** Both entries have it, with the same value once read alike. */
  same: number;
  /**
   * Both have it, and it would be the same but for a reference naming another
   * book, or none (`M` against `M|XPHB`). The engine reads some references
   * with their source (a background's feat), so this is not counted as same.
   */
  source: number;
  /** Both have it, with different values. */
  differs: number;
  /** Only the official entry has it: the converter did not produce it. */
  missing: number;
  /** Only the converted entry has it. */
  extra: number;
  /** `Name: …` lines, up to the cap, for each outcome but `same`. */
  examples: Record<Exclude<Outcome, 'same'>, string[]>;
  /**
   * For a list of plain values that differs, in how many entries each value
   * was absent from the converted list (`lacks`) or added to it (`adds`), most
   * first: one class missing from 73 spells reads as one line, not 73.
   */
  lacks: ValueCount[];
  adds: ValueCount[];
  /** A 5etools filter tag worked out from the text, which the app does not read. */
  searchTag: boolean;
}

export interface ValueCount {
  value: string;
  count: number;
}

export interface KindComparison {
  kind: ConvertedKind;
  /** Converted entries of this kind (records; anything else is not an entry). */
  converted: number;
  /** Converted entries with an official entry of the same name and edition. */
  matched: number;
  /** Names of converted entries with none, up to the cap. */
  unmatched: string[];
  /** Every field either side of a matched pair has, most disagreements first. */
  fields: FieldTally[];
}

const KINDS = Object.keys(OFFICIAL_TYPES) as ConvertedKind[];

/**
 * About the printing or the 5etools site, not the rules, so never a
 * converter's job: where it is printed and referenced, which free rules carry
 * it, its pictures and sound, loot tables, cross-links, display flags, and a
 * race's height and weight. `entries`, `additionalEntries` and `sizeEntry` are
 * text, which a converted entry keeps in its own wording. Keys that start
 * with `_` are 5etools' own bookkeeping. The app reads none of these.
 */
const NOT_COMPARED = new Set([
  'name',
  'source',
  'page',
  'edition',
  'bookEdition',
  'srd',
  'srd52',
  'basicRules',
  'basicRules2024',
  'freeRules2024',
  'otherSources',
  'additionalSources',
  'referenceSources',
  'reprintedAs',
  'hasFluff',
  'hasFluffImages',
  'fluff',
  'soundClip',
  'entries',
  'additionalEntries',
  'sizeEntry',
  'alias',
  'lootTables',
  'tier',
  'hasRefs',
  'seeAlsoDeck',
  'seeAlsoVehicle',
  'detail1',
  'heightAndWeight',
  'repeatableHidden',
  'itemsHidden',
]);

/**
 * Not compared on one kind only. A race's `age` is lore; an item's is its era,
 * which the engine reads (a firearm is no weapon choice).
 */
const NOT_COMPARED_ON: Partial<Record<ConvertedKind, ReadonlySet<string>>> = {
  race: new Set(['age']),
};

/**
 * 5etools' filter tags, worked out from an entry's text for the site's search.
 * The app reads none of them, so they are tallied apart from the rules. On a
 * spell, the defenses are what it gives its targets, so they are tags too; on
 * an item or a race they are its own, and the engine reads them.
 */
const SEARCH_TAGS = new Set(['miscTags', 'areaTags', 'traitTags']);
const SPELL_SEARCH_TAGS = new Set([
  'damageInflict',
  'conditionInflict',
  'affectsCreatureType',
  'abilityCheck',
  'damageResist',
  'damageImmune',
  'damageVulnerable',
  'conditionImmune',
]);

/** Text in each side's own wording: only whether it is there is compared. */
const PRESENCE_ONLY = new Set(['entriesHigherLevel']);

/** The flags that mark a free-rules printing, which is what an SRD file copies. */
const FREE_RULES = ['srd52', 'srd', 'basicRules2024', 'basicRules', 'freeRules2024'] as const;

/** Shown for a converted entry with no name. */
const NO_NAME = '(no name)';

/**
 * Set every converted entry in `json` beside the official entry of the same
 * kind, name and rules edition, and tally each field. An official entry also
 * answers to the name the SRD prints it under (`srd: "Hideous Laughter"`), and
 * a subrace or lineage to the names other apps give it (`Dwarf, Hill`).
 */
export function compareWithOfficial(
  json: Readonly<Record<string, unknown>>,
  official: OfficialData,
  maxExamples = 5,
): KindComparison[] {
  const out: KindComparison[] = [];
  for (const kind of KINDS) {
    const list = json[kind];
    if (!Array.isArray(list)) continue;
    const entries = list.filter(isRecord);
    if (entries.length === 0) continue;
    const index = officialIndex(kind, official);
    const tallies = new Map<string, { tally: FieldTally; counts: Counts }>();
    const unmatched: string[] = [];
    let matched = 0;
    for (const converted of entries) {
      const name = typeof converted.name === 'string' ? converted.name : '';
      const match = pick(index.get(keyOf(name, editionOf(converted))));
      if (match === undefined) {
        if (unmatched.length < maxExamples) unmatched.push(name === '' ? NO_NAME : name);
        continue;
      }
      matched += 1;
      const mine = comparable(kind, converted);
      const theirs = comparable(kind, match);
      if (kind === 'spell') {
        mine.delete('classes');
        theirs.delete('classes');
        if (official.spellClasses !== undefined) {
          setList(mine, 'classes', convertedClassNames(converted));
          setList(theirs, 'classes', official.spellClasses(match));
        }
      }
      tallyPair(kind, name, mine, theirs, tallies, maxExamples);
    }
    out.push({
      kind,
      converted: entries.length,
      matched,
      unmatched,
      fields: [...tallies.values()].map(finish).sort(worstFirst),
    });
  }
  return out;
}

/**
 * `spellClasses` from 5etools' generated lookup, which lists a spell's
 * classes by spell source and name, then by class source:
 * `lookup[source][name].class[classSource][ClassName]`.
 */
export function spellClassesFromLookup(lookup: unknown): (spell: Entity) => readonly string[] {
  return (spell) => {
    if (typeof spell.source !== 'string' || typeof spell.name !== 'string') return [];
    const bySource = recordAt(lookup, spell.source.toLowerCase());
    const classes = recordAt(recordAt(bySource, spell.name.toLowerCase()), 'class');
    if (classes === undefined) return [];
    return Object.values(classes).flatMap((names) => (isRecord(names) ? Object.keys(names) : []));
  };
}

function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Object.hasOwn(value, key)) return undefined;
  const found = value[key];
  return isRecord(found) ? found : undefined;
}

/**
 * How a converted value compares with the official one, once read alike: key
 * order never counts, nor does the order of a list of plain values (5etools
 * lists of saves, damage types and properties are sets in practice), nor case
 * in text with a space in it (`Acid damage`, a reaction's trigger). A code or
 * a single word keeps its case, since the app reads `V` and `v` apart.
 *
 * A reference (`M|XPHB`, `alert|xphb`, `{ uid: 'F|XPHB' }`) that would match
 * but for the book it names, or for naming none, is `source`, not `same`. So
 * is one to the converted file's own entries, which names its own book.
 */
export function compareValues(
  converted: unknown,
  official: unknown,
): 'same' | 'source' | 'differs' {
  if (stable(converted, 'keep') === stable(official, 'keep')) return 'same';
  return stable(converted, 'drop') === stable(official, 'drop') ? 'source' : 'differs';
}

const keyOf = (name: string, edition: string) => `${name.toLowerCase()}|${edition}`;

/**
 * Official entries of a kind by `name|edition`, under their SRD names too, and
 * a subrace or lineage under the names other apps give it (`officialNames`).
 * A subrace is merged into its race first, as the 5etools site shows it, and
 * so is a race's nameless subrace, its base entry (the PHB Human's scores).
 */
function officialIndex(kind: ConvertedKind, official: OfficialData): Map<string, Entity[]> {
  const index = new Map<string, Entity[]>();
  const add = (key: string, e: Entity) => {
    const list = index.get(key);
    if (list === undefined) index.set(key, [e]);
    else if (!list.includes(e)) list.push(e);
  };
  for (const type of OFFICIAL_TYPES[kind]) {
    const raceOf = type === 'subrace' ? raceFinder(official.byType('race')) : undefined;
    const baseOf = type === 'race' ? baseSubraces(official.byType('subrace')) : undefined;
    for (const e of official.byType(type)) {
      if (typeof e.name !== 'string') continue;
      const edition = editionOf(e);
      const base = baseOf?.get(uidKey(e.name, e.source));
      const entry =
        raceOf !== undefined
          ? mergedSubrace(raceOf(e), e)
          : base !== undefined
            ? mergedSubrace(e, base)
            : e;
      for (const name of officialNames(type, e)) add(keyOf(name, edition), entry);
      for (const flag of ['srd', 'srd52'] as const) {
        const srdName = e[flag];
        if (typeof srdName === 'string') add(keyOf(srdName, edition), entry);
      }
    }
  }
  return index;
}

const uidKey = (name: unknown, source: unknown) =>
  `${String(name)}|${String(source)}`.toLowerCase();

/** Nameless subraces, each its race's base entry, by the race's `name|source`. */
function baseSubraces(subraces: readonly Entity[]): Map<string, Entity> {
  const out = new Map<string, Entity>();
  for (const s of subraces) {
    if (s.name !== undefined || typeof s.raceName !== 'string') continue;
    if (typeof s.raceSource !== 'string') continue;
    const key = uidKey(s.raceName, s.raceSource);
    if (!out.has(key)) out.set(key, s);
  }
  return out;
}

/** A subrace's race, by `raceName` and `raceSource` (by name alone without one). */
function raceFinder(races: readonly Entity[]): (subrace: Entity) => Entity | undefined {
  const byUid = new Map<string, Entity>();
  const byName = new Map<string, Entity>();
  for (const race of races) {
    if (typeof race.name !== 'string' || typeof race.source !== 'string') continue;
    const name = race.name.toLowerCase();
    if (!byUid.has(`${name}|${race.source.toLowerCase()}`)) {
      byUid.set(`${name}|${race.source.toLowerCase()}`, race);
    }
    if (!byName.has(name)) byName.set(name, race);
  }
  return (subrace) => {
    if (typeof subrace.raceName !== 'string') return undefined;
    const name = subrace.raceName.toLowerCase();
    return typeof subrace.raceSource === 'string'
      ? byUid.get(`${name}|${subrace.raceSource.toLowerCase()}`)
      : byName.get(name);
  };
}

/**
 * A subrace laid over its race, as the 5etools site merges "Dwarf (Hill)"
 * (`Renderer.race._getMergedSubrace`): ability scores merge entry by entry;
 * languages and trait tags add to the race's, and a skill list merges into
 * the race's single one, unless the subrace's `overwrite` names the field;
 * any other field of the subrace replaces the race's, and a null removes it.
 * Where 5etools would stop with an error (lists of different lengths), the
 * subrace's own list stands.
 */
function mergedSubrace(race: Entity | undefined, subrace: Entity): Entity {
  const sr: Entity = { ...subrace };
  const overwrite = sr.overwrite;
  // Which race it belongs to, and how to merge: not rules to compare.
  delete sr.raceName;
  delete sr.raceSource;
  delete sr.overwrite;
  const out: Entity = { ...race };
  // The race's free-rules flags are not the subrace's.
  for (const flag of FREE_RULES) delete out[flag];
  const replaces = (field: string) => isRecord(overwrite) && Boolean(overwrite[field]);
  const merged: Entity = {};

  if (Array.isArray(sr.ability)) {
    const base = out.ability;
    const sameShape =
      !replaces('ability') && Array.isArray(base) && base.length === sr.ability.length;
    merged.ability = sr.ability.map((scores, i) => ({
      ...(sameShape && isRecord(base[i]) ? base[i] : {}),
      ...(isRecord(scores) ? scores : {}),
    }));
  }
  for (const field of ['languageProficiencies', 'traitTags']) {
    const own = sr[field];
    const base = out[field];
    if (Array.isArray(own) && Array.isArray(base) && !replaces(field)) {
      merged[field] = [...base, ...own];
    }
  }
  const skills = sr.skillProficiencies;
  const baseSkills = out.skillProficiencies;
  if (
    Array.isArray(skills) &&
    Array.isArray(baseSkills) &&
    !replaces('skillProficiencies') &&
    skills.length === 1 &&
    baseSkills.length === 1 &&
    isRecord(skills[0]) &&
    isRecord(baseSkills[0])
  ) {
    merged.skillProficiencies = [{ ...baseSkills[0], ...skills[0] }];
  }

  const result: Entity = { ...out, ...sr, ...merged };
  for (const [key, value] of Object.entries(result)) {
    if (value === null || value === undefined) delete result[key];
  }
  return result;
}

/** Of several printings with one name and edition, the free-rules one. */
function pick(candidates: readonly Entity[] | undefined): Entity | undefined {
  if (candidates === undefined) return undefined;
  return (
    candidates.find((e) => FREE_RULES.some((flag) => e[flag] !== undefined && e[flag] !== false)) ??
    candidates[0]
  );
}

function comparable(kind: ConvertedKind, e: Entity): Map<string, unknown> {
  const skip = NOT_COMPARED_ON[kind];
  const fields = new Map<string, unknown>();
  for (const [key, value] of Object.entries(e)) {
    if (value === undefined || key.startsWith('_') || NOT_COMPARED.has(key)) continue;
    if (skip?.has(key) === true) continue;
    fields.set(key, value);
  }
  return fields;
}

function setList(fields: Map<string, unknown>, key: string, list: readonly string[]): void {
  if (list.length > 0) fields.set(key, [...new Set(list)]);
}

function convertedClassNames(spell: Entity): string[] {
  const classes = spell.classes;
  const list = isRecord(classes) ? classes.fromClassList : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((c) => (isRecord(c) && typeof c.name === 'string' ? [c.name] : []));
}

interface Counts {
  lacks: Map<string, ValueCount>;
  adds: Map<string, ValueCount>;
}

function tallyPair(
  kind: ConvertedKind,
  name: string,
  mine: ReadonlyMap<string, unknown>,
  theirs: ReadonlyMap<string, unknown>,
  tallies: Map<string, { tally: FieldTally; counts: Counts }>,
  cap: number,
): void {
  const label = name === '' ? NO_NAME : name;
  for (const field of new Set([...mine.keys(), ...theirs.keys()])) {
    let entry = tallies.get(field);
    if (entry === undefined) {
      entry = {
        tally: {
          field,
          same: 0,
          source: 0,
          differs: 0,
          missing: 0,
          extra: 0,
          examples: { source: [], differs: [], missing: [], extra: [] },
          lacks: [],
          adds: [],
          searchTag: SEARCH_TAGS.has(field) || (kind === 'spell' && SPELL_SEARCH_TAGS.has(field)),
        },
        counts: { lacks: new Map(), adds: new Map() },
      };
      tallies.set(field, entry);
    }
    const { tally, counts } = entry;
    const a = mine.get(field);
    const b = theirs.get(field);
    const note = (outcome: Exclude<Outcome, 'same'>, text: string) => {
      tally[outcome] += 1;
      const list = tally.examples[outcome];
      if (list.length < cap) list.push(`${label}: ${text}`);
    };
    if (a === undefined) {
      note('missing', short(b));
      continue;
    }
    if (b === undefined) {
      note('extra', short(a));
      continue;
    }
    const outcome = PRESENCE_ONLY.has(field) ? 'same' : compareValues(a, b);
    if (outcome === 'same') {
      tally.same += 1;
      continue;
    }
    // A source difference is shown with the books; a value difference without.
    const lists = listDifference(a, b, outcome === 'source' ? 'keep' : 'drop');
    note(outcome, lists === undefined ? bothValues(a, b) : describe(lists));
    if (outcome === 'differs' && lists !== undefined) {
      if ([...lists.lacks, ...lists.adds].every(isPlain)) {
        for (const v of lists.lacks) count(counts.lacks, v);
        for (const v of lists.adds) count(counts.adds, v);
      }
    }
  }
}

function count(counts: Map<string, ValueCount>, value: unknown): void {
  const key = stable(value, 'drop');
  const found = counts.get(key);
  if (found === undefined) counts.set(key, { value: short(value), count: 1 });
  else found.count += 1;
}

const byCount = (a: ValueCount, b: ValueCount) =>
  b.count - a.count || a.value.localeCompare(b.value);

function finish({ tally, counts }: { tally: FieldTally; counts: Counts }): FieldTally {
  tally.lacks = [...counts.lacks.values()].sort(byCount);
  tally.adds = [...counts.adds.values()].sort(byCount);
  return tally;
}

const disagreements = (t: FieldTally) => t.source + t.differs + t.missing + t.extra;

function worstFirst(a: FieldTally, b: FieldTally): number {
  return disagreements(b) - disagreements(a) || a.field.localeCompare(b.field);
}

/**
 * For two lists, the values the converted one lacks and adds, each once;
 * nothing if they hold the same values or either is not a list.
 */
function listDifference(
  converted: unknown,
  official: unknown,
  sources: SourceReading,
): { lacks: unknown[]; adds: unknown[] } | undefined {
  if (!Array.isArray(converted) || !Array.isArray(official)) return undefined;
  const only = (from: unknown[], against: unknown[]) => {
    const present = new Set(against.map((v) => stable(v, sources)));
    const seen = new Set<string>();
    return from.filter((v) => {
      const key = stable(v, sources);
      if (present.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const lacks = only(official, converted);
  const adds = only(converted, official);
  return lacks.length + adds.length > 0 ? { lacks, adds } : undefined;
}

function describe({ lacks, adds }: { lacks: unknown[]; adds: unknown[] }): string {
  const parts: string[] = [];
  if (lacks.length > 0) parts.push(`lacks ${short(lacks)}`);
  if (adds.length > 0) parts.push(`adds ${short(adds)}`);
  return parts.join(', ');
}

function bothValues(converted: unknown, official: unknown): string {
  return `converted ${short(converted)}, official ${short(official)}`;
}

const MAX_SHOWN = 100;

function short(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 1)}…` : text;
}

/** How `stable` reads the book in a reference: drop it, or keep it, lowercased. */
type SourceReading = 'drop' | 'keep';

/**
 * A string as compared. A reference is text before a `|` with no tag in it:
 * `M|XPHB`, `magic initiate; cleric|xphb`. Text with a space in it ignores
 * case; a code or one word keeps it.
 */
function readString(text: string, sources: SourceReading): string {
  const bar = text.includes('{') ? -1 : text.indexOf('|');
  const head = bar > 0 ? text.slice(0, bar) : text;
  const value = /\s/.test(head) ? head.toLowerCase() : head;
  if (sources === 'drop') return value;
  return bar > 0 ? `${value}|${text.slice(bar + 1).toLowerCase()}` : `${value}|`;
}

/** One string per meaning; see `compareValues`. */
function stable(value: unknown, sources: SourceReading): string {
  if (typeof value === 'string') return JSON.stringify(readString(value, sources));
  if (Array.isArray(value)) {
    const items = value.map((v) => stable(v, sources));
    if (value.every(isPlain)) items.sort();
    return `[${items.join(',')}]`;
  }
  if (isRecord(value)) {
    if (typeof value.uid === 'string') return JSON.stringify(readString(value.uid, sources));
    const parts = Object.keys(value).map(
      (key) => `${JSON.stringify(readString(key, sources))}:${stable(value[key], sources)}`,
    );
    return `{${parts.sort().join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** A value `stable` reads as one string, never a list or a record. */
function isPlain(value: unknown): boolean {
  if (Array.isArray(value)) return false;
  return !isRecord(value) || typeof value.uid === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
