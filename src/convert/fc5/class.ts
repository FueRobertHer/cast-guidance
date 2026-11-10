/**
 * A Fight Club 5e `<class>` into a 5etools class and its class features.
 *
 * Fight Club lists a class as a run of `<autolevel level="N">` blocks, each
 * holding features, a spell slot row and counters. A feature without
 * `optional="YES"` is one every member of the class gets at that level; it
 * becomes a `classFeature` of its own, listed on the class by reference, as
 * 5etools has them. The rest are choices. A subclass is picked by a feature
 * named `Label: Name` (`Martial Archetype: Champion`, `Fighter Subclass:
 * Champion`), and its features end in its name (`Improved Critical
 * (Champion)`): each subclass becomes a `subclass` with its `subclassFeature`s,
 * bound to the class it ends up on ({@link SubclassBinder}). Options such as a
 * fighting style, and the starting and multiclass notes, are not converted
 * here.
 *
 * The class's own fields come from its tags: the hit die, the saving throws
 * and skills (`<proficiency>` names the saves first, then the skills to pick
 * `<numSkills>` from), armor, weapons, tools and starting gold. A spellcaster's
 * slot rows give its caster progression, matched against the progressions the
 * engine knows (full, half rounded up or down, third, pact), and its own table
 * besides, so a slot row the match does not explain still reaches the sheet.
 * How many spells it knows or prepares is read from its spellcasting feature:
 * a table column, a formula ("your Wisdom modifier + your cleric level"), or a
 * spellbook.
 *
 * A level with `scoreImprovement="YES"` holds an Ability Score Improvement,
 * which the engine finds by that name, so Fight Club's `Ability Score
 * Improvement (2nd)` loses its count, and a level that has none gets one.
 */

import type { RulesVersion } from '../../data5e/rulesVersion';
import { ownCasterLevel, PACT_SLOTS, STANDARD_SLOTS } from '../../engine/calc/slots';
import { childElements, childText, childTexts, type XmlElement } from '../xml';
import {
  type ClassBinding,
  citationEntry,
  type Fc5Context,
  type Fc5Converted,
  type Fc5Part,
  type Fc5Result,
  type Placement,
  placeEntity,
  type SubclassBinder,
} from './context';
import {
  abilityKey,
  countWord,
  type Entry,
  entryName,
  lastGroup,
  own,
  plainText,
  readText,
  readTools,
  readWeapons,
  SKILLS,
  splitName,
} from './text';

/** The highest level a class has. */
const MAX_LEVEL = 20;

/** One `<feature>` of a class, at its level. */
interface FileFeature {
  level: number;
  el: XmlElement;
  optional: boolean;
}

/** A spell slot row: cantrips known, then slots by spell level. */
interface SlotRow {
  level: number;
  values: number[];
  optional: boolean;
}

/** What a class's `<autolevel>` blocks hold, in file order. */
interface Levels {
  features: FileFeature[];
  slots: SlotRow[];
  /** Levels marked `scoreImprovement="YES"`. */
  asi: Set<number>;
  /** Blocks whose level is not one a class has. */
  outOfRange: number;
  /**
   * The names of its counters (`Ki`, `Rage`), each once, by the subclass a
   * counter's `<subclass>` names, lowercased, or '' for the class's own.
   */
  counters: Map<string, Set<string>>;
}

function readLevels(el: XmlElement): Levels {
  const out: Levels = {
    features: [],
    slots: [],
    asi: new Set(),
    outOfRange: 0,
    counters: new Map(),
  };
  for (const block of childElements(el, 'autolevel')) {
    const level = Number(block.attrs.level);
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
      out.outOfRange += 1;
      continue;
    }
    if (/^yes$/i.test(block.attrs.scoreimprovement ?? '')) out.asi.add(level);
    for (const child of childElements(block)) {
      const optional = /^yes$/i.test(child.attrs.optional ?? '');
      if (child.name === 'feature') out.features.push({ level, el: child, optional });
      else if (child.name === 'slots') {
        // A blank value is no number: an empty row is not a row of zeros.
        const values = textOf(child)
          .split(',')
          .map((v) => (v.trim() === '' ? Number.NaN : Number(v.trim())));
        if (values.every((v) => Number.isInteger(v) && v >= 0)) {
          out.slots.push({ level, values, optional });
        }
      } else if (child.name === 'counter') {
        const name = childText(child, 'name')?.trim();
        if (name !== undefined && name !== '') {
          const of = pickKey(childText(child, 'subclass') ?? '');
          const names = out.counters.get(of) ?? new Set<string>();
          names.add(name);
          out.counters.set(of, names);
        }
      }
    }
  }
  return out;
}

/** An element's own text, whitespace kept as the file has it. */
function textOf(el: XmlElement): string {
  return el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** `Level 3: Fighter Subclass`: a 2024 feature's level, ahead of its name. */
const LEVEL_PREFIX = /^Level \d{1,2}: /i;

/** `Ability Score Improvement (2nd)`, `Ability Score Improvement [5.5e]`. */
const ASI = /^Ability Score Improvement\b/i;
const ASI_NAME = 'Ability Score Improvement';

/**
 * A name a feature ref can hold: `|` separates a ref's parts, so `Ash|Palm`
 * would read as feature `Ash` of class `Palm`.
 */
function refName(name: string): string {
  return name.replace(/\|/g, '/');
}

/** A feature's name as the class lists it: no level ahead, no count after an ASI. */
export function featureName(raw: string): string {
  const name = refName(splitName(raw).name.replace(LEVEL_PREFIX, '').trim());
  return ASI.test(name) ? ASI_NAME : name;
}

/**
 * Valda's Spire of Secrets' auxiliary levels (`Auxiliary Level: Courier
 * (Valda)`): a class of one level, taken in place of a level in another class
 * by a character who meets its prerequisite, as a multiclass level is. It
 * converts as a class whose features are all at level 1. The sheet has no
 * limit on a class's levels, so it is said.
 */
const AUXILIARY = /^Auxiliary Level: /i;
const AUXILIARY_WHY =
  'it is an auxiliary level, a class taken for one level only: nothing stops a second level, which gives only hit points';

/**
 * The notes a class gives a first or later class (proficiencies, hit points,
 * equipment, multiclass prerequisites), as a choice (`optional="YES"`): they
 * are the class's fields, not features. A fixed feature of such a name (a
 * sidekick's "Starting Warrior Sidekick") is a feature.
 */
const START_NOTE =
  /^(?:Starting|Multiclass) [^:]{1,60}$|^Becoming an? [^:]{1,60} As an? (?:Level 1|Multiclass) Character$/i;

/** Whether a feature's name is one of a start note, for a first or later class. */
export function isStartNote(name: string): boolean {
  return START_NOTE.test(name);
}

// ---------------------------------------------------------------------------
// Proficiencies
// ---------------------------------------------------------------------------

const ARMOR_WORDS: Record<string, string> = {
  light: 'light',
  'light armor': 'light',
  medium: 'medium',
  'medium armor': 'medium',
  heavy: 'heavy',
  'heavy armor': 'heavy',
  shield: 'shield',
  shields: 'shield',
};

/** A list from a tag, `None` and blanks dropped. */
function tagList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '' && !/^none\.?$/i.test(p));
}

/**
 * `<armor>` into the class's `armor` words (`light`, `shield`), as 5etools
 * lists them, and `armorProficiencies` when every part is one. A note in
 * brackets (a druid's metal) stays in the class's text.
 */
function readClassArmor(raw: string | undefined): Record<string, unknown> {
  const armor: string[] = [];
  const flags: Record<string, boolean> = {};
  let all = true;
  for (const part of tagList(raw?.replace(/\band\b/gi, ','))) {
    const bare = part.replace(/\s*\([^()]{0,200}\)$/, '').toLowerCase();
    const key = own(ARMOR_WORDS, bare);
    if (key === undefined) {
      all = false;
      armor.push(part);
    } else if (flags[key] !== true) {
      armor.push(key);
      flags[key] = true;
    }
  }
  const out: Record<string, unknown> = {};
  if (armor.length > 0) out.armor = armor;
  if (all && Object.keys(flags).length > 0) out.armorProficiencies = [flags];
  return out;
}

/** "Martial weapons that have the Finesse or Light property", as the 2024 monk and rogue have them. */
const MARTIAL_WITH =
  /^martial weapons? (?:that have|with) the ([a-z]{3,12}(?:(?:,| or) [a-z]{3,12}){0,3}) propert(?:y|ies)$/i;

/**
 * `<weapons>` into the class's `weapons` list: `simple`, `martial`, named
 * weapons tagged as 5etools tags them, and martial weapons of a property, which
 * the engine reads from `weaponProficiencies` as a filter. A list the weapon
 * reader cannot read whole is kept as written, a part an entry.
 */
function readClassWeapons(raw: string | undefined, edition: RulesVersion): Record<string, unknown> {
  // "Simple Weapons and Martial weapons that have the Light property".
  const parts = tagList(raw).flatMap((p) => p.split(/ and (?=martial weapons? (?:that|with) )/i));
  if (parts.length === 0) return {};
  const filters: string[] = [];
  const filtered: string[] = [];
  const rest = parts.filter((part) => {
    const m = MARTIAL_WITH.exec(part.trim());
    if (m === null) return true;
    const properties = (m[1] ?? '')
      .toLowerCase()
      .split(/,| or /)
      .map((p) => p.trim());
    filters.push(`type=martial weapon|property=${properties.filter((p) => p !== '').join(';')}`);
    filtered.push(part);
    return false;
  });
  const read = rest.length === 0 ? {} : readWeapons(rest.join(', '), edition);
  const out: Record<string, unknown> = {};
  if (read === undefined || 'choose' in read) out.weapons = parts;
  else {
    const weapons = Object.keys(read).map((key) => {
      if (key === 'simple' || key === 'martial') return key;
      const [name, book] = key.split('|');
      return book === undefined ? key : `{@item ${name}|${book}}`;
    });
    out.weapons = [...weapons, ...filtered];
  }
  if (filters.length > 0) {
    out.weaponProficiencies = filters.map((fromFilter) => ({ all: { fromFilter } }));
  }
  return out;
}

/**
 * `<tools>` into the class's `tools`, one proficiency an entry as the sheet
 * reads them, and `toolProficiencies` where the list reads as one.
 */
function readClassTools(raw: string | undefined): Record<string, unknown> {
  const tools = tagList(raw);
  if (tools.length === 0) return {};
  const read = readTools(tools.join(', '));
  return read === undefined ? { tools } : { tools, toolProficiencies: [read] };
}

/**
 * `<proficiency>` and `<numSkills>`: the saving throws, then the skills to
 * pick from. Every skill is "any". A class that names skills but no count
 * gives them all.
 */
function readSavesAndSkills(
  raw: string | undefined,
  numSkills: string | undefined,
): { saves: string[]; skills?: Record<string, unknown>[]; unread: string[] } {
  const saves: string[] = [];
  const skills: string[] = [];
  const unread: string[] = [];
  for (const part of tagList(raw)) {
    const word = part.replace(/^and\s+/i, '').trim();
    const ability = abilityKey(word);
    const skill = word.toLowerCase();
    if (ability !== undefined) {
      if (!saves.includes(ability)) saves.push(ability);
    } else if ((SKILLS as readonly string[]).includes(skill)) {
      if (!skills.includes(skill)) skills.push(skill);
    } else unread.push(part);
  }
  const count = countWord((numSkills ?? '').trim());
  if (skills.length === 0) return { saves, unread };
  if (count === undefined) {
    return { saves, skills: [Object.fromEntries(skills.map((s) => [s, true]))], unread };
  }
  const pick =
    skills.length === SKILLS.length ? { any: count } : { choose: { from: skills, count } };
  return { saves, skills: [pick], unread };
}

/** `5d4x10`, `2d4 x 10`, `150`: starting gold, as 5etools writes it. */
function readWealth(raw: string | undefined): string | undefined {
  const text = (raw ?? '').replace(/\s+/g, '').toLowerCase();
  const dice = /^(\d{1,2})d(\d{1,2})(?:[x×*](\d{1,4}))?$/.exec(text);
  if (dice !== null) {
    const roll = `${dice[1]}d${dice[2]}${dice[3] === undefined ? '' : ` × ${dice[3]}`}`;
    return `{@dice ${roll}|${roll}|Starting Gold}`;
  }
  return /^\d{1,5}$/.test(text) ? `${text} gp` : undefined;
}

// ---------------------------------------------------------------------------
// Spellcasting
// ---------------------------------------------------------------------------

const NO_SLOTS = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Each level's row in effect, 1 to 20: the last row at or below it, all zeros before the first. */
function rowsByLevel(rows: readonly SlotRow[]): number[][] {
  const byLevel = new Map<number, number[]>();
  for (const row of rows) byLevel.set(row.level, row.values);
  const out: number[][] = [];
  let current: number[] = [];
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    current = byLevel.get(level) ?? current;
    out.push(current);
  }
  return out;
}

/** A row's slots by spell level 1 to 9. */
function slotsOf(row: readonly number[]): number[] {
  return NO_SLOTS.map((_, i) => row[i + 1] ?? 0);
}

/** The slots a progression gives at a class level, by spell level 1 to 9. */
function expectedSlots(progression: string, level: number): number[] {
  if (progression === 'pact') {
    const [count, slotLevel] = PACT_SLOTS[level - 1] ?? [0, 0];
    return NO_SLOTS.map((_, i) => (i === slotLevel - 1 ? count : 0));
  }
  const caster = ownCasterLevel(progression, level);
  return caster > 0 ? [...(STANDARD_SLOTS[caster - 1] ?? NO_SLOTS)] : [...NO_SLOTS];
}

/** The progressions the engine reads, the likelier first. */
const PROGRESSIONS = ['full', 'artificer', '1/2', '1/3', 'pact'] as const;
export type CasterProgression = (typeof PROGRESSIONS)[number];

/**
 * The caster progression a slot table follows, and whether it follows it at
 * every level. A table that matches none is read as the progression it
 * matches at the most levels, pact magic only for a class whose slots come
 * back on a short rest; its own rows still give its slots.
 */
export function matchProgression(
  slots: readonly number[][],
  shortRest: boolean,
): { progression: CasterProgression; exact: boolean } {
  let best: { progression: CasterProgression; matched: number } | undefined;
  for (const progression of PROGRESSIONS) {
    if (progression === 'pact' && !shortRest) continue;
    let matched = 0;
    slots.forEach((row, i) => {
      if (expectedSlots(progression, i + 1).every((n, j) => n === (row[j] ?? 0))) matched += 1;
    });
    if (matched === slots.length) return { progression, exact: true };
    if (best === undefined || matched > best.matched) best = { progression, matched };
  }
  return { progression: best?.progression ?? 'full', exact: false };
}

/** A count by level from a table's rows (`1st | 4`, `10 | 5`), carried to the next row. */
function columnByLevel(rows: readonly unknown[], column: number): number[] | undefined {
  const values = new Map<number, number>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const level = Number.parseInt(String(row[0] ?? ''), 10);
    const value = Number.parseInt(String(row[column] ?? '').replace(/^[^\d-]{0,3}/, ''), 10);
    if (Number.isInteger(level) && level >= 1 && level <= MAX_LEVEL && Number.isInteger(value)) {
      values.set(level, value);
    }
  }
  if (values.size < 2) return undefined;
  const out: number[] = [];
  let current = 0;
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    current = values.get(level) ?? current;
    out.push(current);
  }
  return out;
}

/** Tables anywhere in a feature's entries. */
function tablesIn(entries: readonly unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (e: unknown) => {
    if (Array.isArray(e)) e.forEach(walk);
    else if (e !== null && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      if (o.type === 'table') out.push(o);
      walk(o.entries);
      walk(o.items);
    }
  };
  walk(entries);
  return out;
}

/** The column of a table whose label matches, read by level. */
function tableColumn(entries: readonly unknown[], label: RegExp): number[] | undefined {
  for (const table of tablesIn(entries)) {
    const labels = Array.isArray(table.colLabels) ? table.colLabels.map(String) : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const column = labels.findIndex((l) => label.test(l));
    if (column <= 0) continue;
    const read = columnByLevel(rows, column);
    if (read !== undefined) return read;
  }
  return undefined;
}

/**
 * "equal to your Wisdom modifier + your cleric level", "your Charisma
 * modifier + half your paladin level, rounded down", "your rogue level
 * divided by 3": a 2014 prepared caster's formula, as 5etools writes it.
 */
const PREPARED =
  /equal to your (?:[\w']{1,20} )?(strength|dexterity|constitution|intelligence|wisdom|charisma|spellcasting ability) modifier ?\+ ?(half )?your [\w' ()-]{1,40}? level(?:,? divided by (\w{1,5}))?/i;

function preparedFormula(prose: string, own: string | undefined): string | undefined {
  const m = PREPARED.exec(prose);
  const word = m?.[1]?.toLowerCase();
  const ability = word === 'spellcasting ability' ? own : abilityKey(word ?? '');
  if (m === null || ability === undefined) return undefined;
  const divisor = m[2] !== undefined ? 2 : m[3] === undefined ? 1 : spellCount(m[3]);
  if (divisor === undefined) return undefined;
  return divisor === 1
    ? `<$level$> + <$${ability}_mod$>`
    : `<$level$> / ${divisor} + <$${ability}_mod$>`;
}

/** "a spellbook containing six 1st-level wizard spells", "add two wizard spells … to your spellbook". */
const SPELLBOOK_START = /spellbook containing (\w{1,6}) (?:1st-level|level 1)/i;
const SPELLBOOK_ADD = /add (\w{1,6}) [\w ]{0,30}?spells? [^.]{0,60}?to your spellbook/i;

function spellbook(prose: string): number[] | undefined {
  const start = SPELLBOOK_START.exec(prose);
  const add = SPELLBOOK_ADD.exec(prose);
  const first = start === null ? undefined : spellCount(start[1] ?? '');
  const each = add === null ? undefined : spellCount(add[1] ?? '');
  if (first === undefined || each === undefined) return undefined;
  return Array.from({ length: MAX_LEVEL }, (_, i) => (i === 0 ? first : each));
}

/**
 * A 2014 known caster's count in words: "You know four 1st-level spells",
 * then one more "at each level except 12th, 16th, 19th, and 20th", "at each
 * odd numbered level thereafter", or "at 2nd through 9th level, and at every
 * odd level thereafter". Counted from the first level with spell slots.
 */
const KNOW_START = /you know (\w{1,6}) 1st-level (?:[\w']{1,20} ){0,2}spells/i;
const EXCEPT = /at each level except ((?:\d{1,2}(?:st|nd|rd|th)(?:,? (?:and )?)?){1,12})/i;
const THROUGH =
  /at (\d{1,2})(?:st|nd|rd|th) through (\d{1,2})(?:st|nd|rd|th) levels?,? and at every odd level thereafter/i;
const ODD = /\b(?:each|every) odd(?:[- ]numbered)? level\b/i;

function knownFromProse(prose: string, first: number): number[] | undefined {
  const start = KNOW_START.exec(prose);
  const count = start === null ? undefined : spellCount(start[1] ?? '');
  if (count === undefined) return undefined;
  const except = EXCEPT.exec(prose);
  const through = THROUGH.exec(prose);
  let gains: (level: number) => boolean;
  if (except !== null) {
    const skipped = new Set([...(except[1] ?? '').matchAll(/\d{1,2}/g)].map((m) => Number(m[0])));
    gains = (level) => !skipped.has(level);
  } else if (through !== null) {
    const [from, to] = [Number(through[1]), Number(through[2])];
    gains = (level) => (level >= from && level <= to) || (level > to && level % 2 === 1);
  } else if (ODD.test(prose)) {
    gains = (level) => level % 2 === 1;
  } else return undefined;
  const out: number[] = [];
  let current = 0;
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    if (level === first) current = count;
    else if (level > first && gains(level)) current += 1;
    out.push(current);
  }
  return out;
}

/** How a class's spellcasting reads, in 5etools fields, and what stayed as text. */
interface Spellcasting {
  fields: Record<string, unknown>;
  reasons: string[];
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

/** A progression in words, for the report: how the slots count with another class. */
const CASTER_WORDS: Record<CasterProgression, string> = {
  full: "a full caster's",
  artificer: "a half caster's, rounded up",
  '1/2': "a half caster's",
  '1/3': "a third caster's",
  pact: "a pact caster's",
};

/**
 * A class's spellcasting feature: `Spellcasting`, `Pact Magic`, and a third
 * party's own (`Apothecary Magic`, `Dimensioncasting`).
 */
const CASTING = /\b(?:spellcasting|pact magic)\b|casting$|\bmagic$/i;

/**
 * Counts a spellcasting feature writes in words: a wizard's spellbook starts
 * with six. The shared {@link countWord} stops at four, which the other
 * readers rely on.
 */
const SPELL_COUNTS: Record<string, number> = {
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function spellCount(word: string): number | undefined {
  return own(SPELL_COUNTS, word.toLowerCase()) ?? countWord(word);
}

/**
 * A class's or subclass's spellcasting: its slot rows, its ability, and the
 * counts its spellcasting feature gives. A class's rows are the ones every
 * member gets; the optional ones are a subclass's (an Eldritch Knight's), so a
 * class with only those casts nothing of its own.
 */
function readSpellcasting(
  slotRows: readonly SlotRow[],
  spellAbility: string | undefined,
  shortRest: boolean,
  features: readonly { name: string; entries: Entry[] }[],
  described: readonly Entry[],
): Spellcasting {
  if (slotRows.length === 0) return { fields: {}, reasons: [] };
  const rows = rowsByLevel(slotRows);
  const slots = rows.map(slotsOf);
  const cantrips = rows.map((r) => r[0] ?? 0);
  const fields: Record<string, unknown> = {};
  const reasons: string[] = [];

  const ability = abilityKey(spellAbility ?? '');
  if (ability !== undefined) fields.spellcastingAbility = ability;
  else reasons.push('its spellcasting ability is kept as text');

  const hasSlots = slots.some((r) => r.some((n) => n > 0));
  if (hasSlots) {
    // Pact magic only for a table that is the warlock's: the sheet gives a pact
    // caster the warlock's slots whatever its rows say, and its own table only
    // reaches the sheet for the other progressions.
    let match = matchProgression(slots, shortRest);
    if (match.progression === 'pact' && !match.exact) match = matchProgression(slots, false);
    fields.casterProgression = match.progression;
    if (!match.exact) {
      reasons.push(
        `its spell slots follow no standard table, so with another class they count as ${CASTER_WORDS[match.progression]}`,
      );
    }
    if (shortRest && match.progression !== 'pact') {
      reasons.push('its spell slots come back on a short rest, which is kept as text');
    }
  }
  if (cantrips.some((n) => n > 0)) fields.cantripProgression = cantrips;

  // What the spellcasting feature says of the spells it knows or prepares: its
  // words, and a table column, its own or one elsewhere in the class. Another
  // feature's words are not read: "a number of times equal to your Wisdom
  // modifier + your level" counts uses.
  const castingEntries = features.filter((f) => CASTING.test(f.name)).flatMap((f) => f.entries);
  const tables = [...castingEntries, ...features.flatMap((f) => f.entries), ...described];
  const prose = plainText(castingEntries);
  const first = slots.findIndex((r) => r.some((n) => n > 0)) + 1;
  const prepared = tableColumn(tables, /prepared spells|spells prepared/i);
  const known =
    tableColumn(tables, /spells known/i) ?? (first > 0 ? knownFromProse(prose, first) : undefined);
  const formula = preparedFormula(prose, ability);
  const book = spellbook(prose);
  if (prepared !== undefined) fields.preparedSpellsProgression = prepared;
  else if (formula !== undefined) fields.preparedSpells = formula;
  // A spellbook without a count prepared would read as a known caster whose
  // limit is the spells it adds each level.
  const preparing = prepared !== undefined || formula !== undefined;
  if (book !== undefined && preparing) {
    fields.spellsKnownProgressionFixed = book;
    fields.spellsKnownProgressionFixedAllowLowerLevel = true;
  } else if (known !== undefined && !preparing) {
    fields.spellsKnownProgression = known;
  }
  if (
    fields.preparedSpellsProgression === undefined &&
    fields.preparedSpells === undefined &&
    fields.spellsKnownProgression === undefined
  ) {
    reasons.push('how many spells it knows or prepares is kept as text');
  }

  // Its own slot table, as 5etools gives one: the sheet reads its rows, so a
  // table the progression does not explain still gives the right slots.
  const top = slots.reduce((max, r) => Math.max(max, r.findLastIndex((n) => n > 0) + 1), 0);
  if (hasSlots && fields.casterProgression !== 'pact') {
    fields.classTableGroups = [
      {
        title: 'Spell Slots per Spell Level',
        colLabels: ORDINALS.slice(0, top),
        rowsSpellProgression: slots.map((r) => r.slice(0, top)),
      },
    ];
  }
  return { fields, reasons };
}

// ---------------------------------------------------------------------------
// Subclasses
// ---------------------------------------------------------------------------

/** A choice a feature's name makes: `Martial Archetype: Champion`. */
const PICK = /^([^:]{1,60}): (.{1,120})$/;

/** A feature that is a choice, by its name as the class lists it. */
interface Choice {
  name: string;
  level: number;
  el: XmlElement;
  /** The edition its name marks (`Ember Path: Ash Guard [5.5e]`), which the name drops. */
  edition?: RulesVersion;
}

/** A subclass the file offers: the feature that picks it and the ones that end in its name. */
interface Pick {
  label: string;
  /** Its name as the file writes it, qualifiers and all: `Barrow Guard (TP)`. */
  written: string;
  level: number;
  el: XmlElement;
  edition?: RulesVersion;
  /** The book its `Source:` line cites, when it has one. */
  book?: string;
  features: Choice[];
}

/** A class's choices, sorted: its subclasses, and the others, its options. */
interface Split {
  picks: Pick[];
  /** The label most picks carry (`Martial Archetype`), for `subclassTitle`. */
  label?: string;
  others: Choice[];
}

/**
 * A subclass's name as a key: `Barber (HB)` whether a feature's group writes
 * `(Barber (HB) [5.5e])` or the pick `Barber (HB) [5.5e]`.
 */
function pickKey(name: string): string {
  return splitName(name).name.toLowerCase();
}

/** The last one to three words of a subclass's name: `hexblade` of `The Hexblade`. */
function tailsOf(key: string): string[] {
  const words = key.split(' ');
  return Array.from({ length: Math.min(words.length - 1, 3) }, (_, i) =>
    words.slice(-(i + 1)).join(' '),
  );
}

/**
 * A class's choices split into subclasses and options. A `Label: Name` choice
 * picks a subclass when another choice ends in `(Name)`, or in the last words
 * of it where the class has a feature named for the label (`Blood Hunter
 * Order: Order of the Ghostslayer` beside `Rite of the Dawn (Ghostslayer)`),
 * and so does every choice of a label more than half of whose choices do (a
 * subclass whose features name it some other way). Two picks of one name are
 * two subclasses when their `Source:` lines cite two books, and a feature goes
 * to the one whose book it cites. A choice ends in a subclass's name as
 * written, or in the last words of it no other subclass shares. The rest are
 * options: a fighting style, a totem spirit.
 */
function splitChoices(
  choices: readonly Choice[],
  named: ReadonlySet<string>,
  bookOf: (el: XmlElement) => string | undefined,
): Split {
  const groups = new Set<string>();
  for (const c of choices) {
    const g = lastGroup(c.name);
    if (g !== undefined) groups.add(pickKey(g.inner));
  }
  // `Wizard Subclass: (Legacy)` names nothing.
  const candidates = choices.flatMap((c) => {
    const m = PICK.exec(c.name);
    const written = (m?.[2] ?? '').trim();
    return m === null || written.startsWith('(')
      ? []
      : [{ c, label: (m[1] ?? '').trim(), written, key: pickKey(written) }];
  });
  // A label is a subclass's when most of its choices name one: a fighting
  // style may share its name with a subclass (`Melee Marksman (HB)` and
  // `Legendary Marksman (Marksman (HB))`).
  const tally = new Map<string, { all: number; named: number }>();
  for (const p of candidates) {
    const label = p.label.toLowerCase();
    const t = tally.get(label) ?? { all: 0, named: 0 };
    t.all += 1;
    if (
      groups.has(p.key) ||
      (named.has(label) && tailsOf(p.key).some((tail) => groups.has(tail)))
    ) {
      t.named += 1;
    }
    tally.set(label, t);
  }
  const labels = new Set(
    [...tally]
      .filter(([, t]) => t.named * 2 > t.all && t.named >= Math.min(2, t.all))
      .map(([l]) => l),
  );
  // By name, and by book among picks of one name; a pick that cites no book
  // is a repeat of any other of its name.
  const picks = new Map<string, Pick[]>();
  const pickEls = new Set<XmlElement>();
  const labelCounts = new Map<string, number>();
  for (const p of candidates) {
    if (!labels.has(p.label.toLowerCase())) continue;
    pickEls.add(p.c.el);
    const same = picks.get(p.key) ?? [];
    const book = bookOf(p.c.el);
    if (same.some((s) => s.book === undefined || book === undefined || s.book === book)) continue;
    same.push({
      label: p.label,
      written: p.written,
      level: p.c.level,
      el: p.c.el,
      ...(p.c.edition !== undefined && { edition: p.c.edition }),
      ...(book !== undefined && { book }),
      features: [],
    });
    picks.set(p.key, same);
    labelCounts.set(p.label, (labelCounts.get(p.label) ?? 0) + 1);
  }
  // The last words of a subclass's name, when no other's end so.
  const tails = new Map<string, string | null>();
  for (const key of picks.keys()) {
    for (const tail of tailsOf(key)) {
      if (!picks.has(tail)) tails.set(tail, tails.has(tail) ? null : key);
    }
  }
  const others: Choice[] = [];
  for (const c of choices) {
    if (pickEls.has(c.el)) continue;
    const g = lastGroup(c.name);
    const key = g === undefined ? undefined : pickKey(g.inner);
    const found = key === undefined || picks.has(key) ? key : (tails.get(key) ?? undefined);
    const same = found === undefined ? undefined : picks.get(found);
    // Of two of one name, the one whose book the feature cites, else the first.
    const book = same !== undefined && same.length > 1 ? bookOf(c.el) : undefined;
    const pick = same?.find((p) => p.book === book) ?? same?.[0];
    if (g === undefined || pick === undefined) others.push(c);
    else pick.features.push({ name: g.base, level: c.level, el: c.el });
  }
  let label: string | undefined;
  for (const [l, n] of labelCounts) {
    if (label === undefined || n > (labelCounts.get(label) ?? 0)) label = l;
  }
  return { picks: [...picks.values()].flat(), label, others };
}

/** What a subclass is built from, beside its pick: the class's own parts it shares. */
interface SubclassFrom {
  ctx: Fc5Context;
  /** The class's place, for a subclass that cites no book. */
  placement: Placement;
  /** The edition the class's name marks. */
  edition: RulesVersion | undefined;
  /** The class's optional slot rows, a subclass caster's. */
  castingRows: readonly SlotRow[];
  spellAbility: string | undefined;
  /** Whether the class's slots come back on a short rest (`<slotsReset>S`). */
  shortRest: boolean;
  counters: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * A subclass's spellcasting feature: one named for it, or a third party's own
 * (`Heretic Magic`) that says what its spellcasting ability is. One that only
 * ends in `Magic` (`Drain Magic`, `Black Magic`) is not: the class's optional
 * slot rows are another subclass's.
 */
function castsSpells(f: { name: string; entries: Entry[] }): boolean {
  return (
    /\b(?:spellcasting|pact magic)\b/i.test(f.name) ||
    (CASTING.test(f.name) && /\bspellcasting ability\b/i.test(plainText(f.entries)))
  );
}

/**
 * The class's place for a subclass whose name marks the other edition: the
 * same book, but not the book's own entry, which is in the book's edition.
 */
function inEdition(placement: Placement, edition: RulesVersion): Placement {
  const { officialBook: _, ...rest } = placement;
  return { ...rest, edition };
}

/**
 * Choices a subclass gains all of, though they share a label and a level: a
 * subclass grants every Channel Divinity it lists (the Oath of Devotion's
 * Sacred Weapon and Turn the Unholy), as it does a Channel Duplicity or a
 * Channel Arcana.
 */
const GAINED_TOGETHER = /^channel\b/;

/** A subclass feature's ref: `Name|Class|ClassSource|Subclass|SubclassSource|Level`, and its own source when another. */
function subclassFeatureRef(
  name: string,
  bound: ClassBinding,
  shortName: string,
  subclassSource: string,
  level: number,
  source: string,
): string {
  const ref = `${name}|${bound.className}|${bound.classSource}|${shortName}|${subclassSource}|${level}`;
  return source === subclassSource ? ref : `${ref}|${source}`;
}

/** Counters named for a subclass, by its name as written or as converted. */
function countersReason(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined;
  const more = names.length > 4 ? `, and ${names.length - 4} more` : '';
  return `its counters (${names.slice(0, 4).join(', ')}${more}) are not converted yet`;
}

/**
 * One subclass, on the class it is bound to. Its pick's text opens it as a
 * feature of its name at the level it is picked, as 5etools has a subclass's
 * first feature. Its own choices (`Fighting Style: Dueling (College of
 * Swords)` beside `Fighting Style: Two-Weapon Fighting (College of Swords)`,
 * two of one label at one level) are options, not features.
 */
function convertSubclass(pick: Pick, from: SubclassFrom, bound: ClassBinding): Fc5Converted {
  const named = entryName(pick.written);
  const name = refName(named.name);
  const edition = named.edition ?? pick.edition ?? from.edition;
  const pickText = readText(childTexts(pick.el, 'text'));
  const sourceLine =
    pickText.sourceLine ??
    pick.features
      .map((f) => readText(childTexts(f.el, 'text')).sourceLine)
      .find((l) => l !== undefined);
  const placement =
    sourceLine !== undefined
      ? from.ctx.place(sourceLine, edition)
      : edition === undefined || edition === from.placement.edition
        ? from.placement
        : inEdition(from.placement, edition);
  const subclassSource = placement.source.json;
  const reasons: string[] = [];

  const sub: Record<string, unknown> = { name, shortName: name };
  placeEntity(sub, placement);
  sub.className = bound.className;
  sub.classSource = bound.classSource;

  const optionKeys = new Map<string, number>();
  for (const f of pick.features) {
    const m = PICK.exec(f.name);
    if (m !== null) {
      const key = `${(m[1] ?? '').toLowerCase()}|${f.level}`;
      optionKeys.set(key, (optionKeys.get(key) ?? 0) + 1);
    }
  }
  const isOption = (f: Choice) => {
    const m = PICK.exec(f.name);
    const label = (m?.[1] ?? '').toLowerCase();
    return (
      m !== null && !GAINED_TOGETHER.test(label) && (optionKeys.get(`${label}|${f.level}`) ?? 0) > 1
    );
  };

  const parts: Fc5Part[] = [];
  const read: { name: string; entries: Entry[] }[] = [];
  const seen = new Set<string>();
  const add = (fname: string, level: number, text: { entries: Entry[]; sourceLine?: string }) => {
    const key = `${fname.toLowerCase()}|${level}`;
    if (seen.has(key)) return;
    seen.add(key);
    const where =
      text.sourceLine === undefined ? placement : from.ctx.place(text.sourceLine, edition);
    read.push({ name: fname, entries: text.entries });
    const entity: Record<string, unknown> = { name: fname };
    placeEntity(entity, where);
    entity.className = bound.className;
    entity.classSource = bound.classSource;
    entity.subclassShortName = name;
    entity.subclassSource = subclassSource;
    entity.level = level;
    const entries: Entry[] = [...text.entries];
    const citation = citationEntry(where);
    if (citation !== undefined) entries.push(citation);
    entity.entries = entries;
    parts.push({ kind: 'subclassFeature', entity, placement: where });
  };
  add(name, pick.level, { entries: pickText.entries });
  let options = 0;
  const features = [...pick.features].sort((a, b) => a.level - b.level);
  for (const f of features) {
    if (isOption(f)) {
      options += 1;
      continue;
    }
    add(refName(f.name), f.level, readText(childTexts(f.el, 'text')));
  }
  parts.sort((a, b) => Number(a.entity.level) - Number(b.entity.level));
  sub.subclassFeatures = parts.map((p) =>
    subclassFeatureRef(
      String(p.entity.name),
      bound,
      name,
      subclassSource,
      Number(p.entity.level),
      String(p.entity.source),
    ),
  );

  // A subclass caster (the Eldritch Knight) casts by the class's optional rows.
  if (from.castingRows.length > 0 && read.some(castsSpells)) {
    const casting = readSpellcasting(from.castingRows, from.spellAbility, from.shortRest, read, []);
    const { classTableGroups, ...fields } = casting.fields;
    Object.assign(sub, fields);
    if (classTableGroups !== undefined) sub.subclassTableGroups = classTableGroups;
    reasons.push(...casting.reasons);
  }
  if (options > 0) reasons.push('its options are not converted yet');
  const counters = new Set([
    ...(from.counters.get(pickKey(pick.written)) ?? []),
    ...(from.counters.get(name.toLowerCase()) ?? []),
  ]);
  const counted = countersReason([...counters]);
  if (counted !== undefined) reasons.push(counted);

  return {
    kind: 'subclass',
    name,
    edition: placement.edition,
    entity: sub,
    placement,
    reasons,
    parts,
  };
}

/** What a `<class>` with no hit die adds: see {@link convertClassAdditions}. */
export interface ClassAdditions {
  name: string;
  edition: RulesVersion;
  subclasses: SubclassBinder;
  /** What it holds besides its subclasses, which is not converted. */
  reasons: string[];
}

/**
 * A `<class>` with no hit die adds to a class of its name, as a file of
 * subclasses for an official class does: its subclasses, every feature read as
 * a choice. Undefined when it has none.
 */
export function convertClassAdditions(
  el: XmlElement,
  ctx: Fc5Context,
): ClassAdditions | { skip: string } | undefined {
  const identity = classIdentity(el, ctx);
  if (identity === undefined) return { skip: 'it has no name' };
  const levels = readLevels(el);
  const choices: Choice[] = levels.features.flatMap((f) => choiceOf(f.el, f.level));
  const { picks, others } = splitChoices(
    choices,
    new Set(choices.map((c) => c.name.toLowerCase())),
    (pickEl) => bookOf(pickEl, ctx, identity.edition),
  );
  if (picks.length === 0) return undefined;
  const reasons: string[] = [];
  if (others.length > 0) {
    const names = [...new Set(others.map((c) => c.name))];
    const more = names.length > 4 ? `, and ${names.length - 4} more` : '';
    reasons.push(
      `its features in no subclass (${names.slice(0, 4).join(', ')}${more}) are not converted: it adds to a class of that name, and only its subclasses convert`,
    );
  }
  const counted = countersReason(classCounters(levels.counters, picks));
  if (counted !== undefined) reasons.push(counted);
  // Every feature is a choice, so the class cites its book in its first pick.
  const pickLine = picks
    .map((p) => readText(childTexts(p.el, 'text')).sourceLine)
    .find((l) => l !== undefined);
  const placement =
    classSourceLine(el) === undefined && pickLine !== undefined
      ? ctx.place(pickLine, identity.edition)
      : identity.placement;
  const from: SubclassFrom = {
    ctx,
    placement,
    edition: identity.edition,
    castingRows: levels.slots,
    spellAbility: childText(el, 'spellability'),
    shortRest: /^s$/i.test(childText(el, 'slotsreset') ?? ''),
    counters: levels.counters,
  };
  return {
    name: identity.name,
    edition: placement.edition,
    subclasses: (bound) => picks.map((p) => convertSubclass(p, from, bound)),
    reasons,
  };
}

/** A feature as a choice, by the name the class lists it under, with the edition that name marks. */
function choiceOf(el: XmlElement, level: number): Choice[] {
  const raw = childText(el, 'name') ?? '';
  const name = featureName(raw);
  const edition = splitName(raw).edition;
  return name === '' ? [] : [{ name, level, el, ...(edition !== undefined && { edition }) }];
}

/** The book a feature's `Source:` line cites, as its homebrew source. */
function bookOf(el: XmlElement, ctx: Fc5Context, edition: RulesVersion | undefined) {
  const line = readText(childTexts(el, 'text')).sourceLine;
  return line === undefined ? undefined : ctx.place(line, edition).source.json;
}

/**
 * The names of the counters a class keeps for itself: its own, and those named
 * for a subclass it does not have.
 */
function classCounters(
  counters: ReadonlyMap<string, ReadonlySet<string>>,
  picks: readonly Pick[],
): string[] {
  const subclassKeys = new Set(
    picks.flatMap((p) => [pickKey(p.written), refName(entryName(p.written).name).toLowerCase()]),
  );
  return [
    ...new Set(
      [...counters]
        .filter(([of]) => of === '' || !subclassKeys.has(of))
        .flatMap(([, names]) => [...names]),
    ),
  ];
}

// ---------------------------------------------------------------------------
// The class
// ---------------------------------------------------------------------------

/** A class's place, from the first `Source:` line among its description and features. */
function classSourceLine(el: XmlElement): string | undefined {
  for (const trait of childElements(el, 'trait')) {
    const line = readText(childTexts(trait, 'text')).sourceLine;
    if (line !== undefined) return line;
  }
  for (const block of childElements(el, 'autolevel')) {
    for (const feature of childElements(block, 'feature')) {
      if (/^yes$/i.test(feature.attrs.optional ?? '')) continue;
      const line = readText(childTexts(feature, 'text')).sourceLine;
      if (line !== undefined) return line;
    }
  }
  return undefined;
}

/** A class's name, edition and place: all the first pass needs of one. */
export function classIdentity(
  el: XmlElement,
  ctx: Fc5Context,
): { name: string; edition: RulesVersion | undefined; placement: Placement } | undefined {
  const raw = childText(el, 'name');
  if (raw === undefined || raw.trim() === '') return undefined;
  const named = entryName(raw);
  return {
    name: refName(named.name),
    edition: named.edition,
    placement: ctx.place(classSourceLine(el), named.edition),
  };
}

/**
 * A class's hit die, by its faces (`8`, `d8`): undefined when it has no
 * `<hd>`, which makes the entry an addition to a class of its name, and NaN
 * when the tag holds no die.
 */
export function classHitDie(el: XmlElement): number | undefined {
  const raw = childText(el, 'hd');
  if (raw === undefined) return undefined;
  const faces = Number(raw.trim().replace(/^d/i, ''));
  return Number.isInteger(faces) && faces >= 2 && faces <= 20 ? faces : Number.NaN;
}

/** A class feature's ref on its class: `Name|Class|ClassSource|Level`, and the feature's source when another. */
function featureRef(
  name: string,
  className: string,
  classSource: string,
  level: number,
  source: string,
): string {
  const ref = `${name}|${className}|${classSource}|${level}`;
  return source === classSource ? ref : `${ref}|${source}`;
}

export function convertClass(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const identity = classIdentity(el, ctx);
  if (identity === undefined) return { skip: 'it has no name' };
  const { name, placement } = identity;
  const hd = classHitDie(el);
  if (hd === undefined) {
    return { skip: 'it adds to a class of that name, and only its subclasses convert' };
  }
  if (Number.isNaN(hd)) return { skip: 'its hit die is not a die' };
  const edition = placement.edition;
  const reasons: string[] = [];
  const levels = readLevels(el);
  if (levels.outOfRange > 0) reasons.push('levels past 20 are left out');

  const cls: Record<string, unknown> = { name };
  placeEntity(cls, placement);
  const classSource = placement.source.json;
  const of: FeatureOf = { className: name, classSource };
  cls.hd = { number: 1, faces: hd };
  if (AUXILIARY.test(name)) reasons.push(AUXILIARY_WHY);

  const { saves, skills, unread } = readSavesAndSkills(
    childText(el, 'proficiency'),
    childText(el, 'numskills'),
  );
  if (saves.length > 0) cls.proficiency = saves;
  if (unread.length > 0) reasons.push(`its proficiencies (${unread.join(', ')}) are kept as text`);
  const starting: Record<string, unknown> = {
    ...readClassArmor(childText(el, 'armor')),
    ...readClassWeapons(childText(el, 'weapons'), edition),
    ...readClassTools(childText(el, 'tools')),
  };
  if (skills !== undefined) starting.skills = skills;
  if (Object.keys(starting).length > 0) cls.startingProficiencies = starting;
  const gold = readWealth(childText(el, 'wealth'));
  if (gold !== undefined) cls.startingEquipment = { goldAlternative: gold };

  // Fixed features, in level order; a repeat of one at the same level is left out.
  const features: Fc5Part[] = [];
  const read: { name: string; level: number; entries: Entry[] }[] = [];
  const seen = new Set<string>();
  const choices: Choice[] = [];
  let startNotes = 0;
  const sorted = levels.features
    .map((f, i) => ({ ...f, at: i }))
    .sort((a, b) => a.level - b.level || a.at - b.at);
  for (const f of sorted) {
    const featureRaw = childText(f.el, 'name') ?? '';
    const fname = featureName(featureRaw);
    if (fname === '') continue;
    if (f.optional && isStartNote(fname)) {
      startNotes += 1;
      continue;
    }
    // An Ability Score Improvement offered as a choice, at a level marked for
    // one, is the class's: the choice is the feat it may be taken as.
    if (f.optional && !(fname === ASI_NAME && levels.asi.has(f.level))) {
      choices.push(...choiceOf(f.el, f.level));
      continue;
    }
    const key = `${fname.toLowerCase()}|${f.level}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const text = readText(childTexts(f.el, 'text'));
    const where =
      text.sourceLine === undefined ? placement : ctx.place(text.sourceLine, identity.edition);
    read.push({ name: fname, level: f.level, entries: text.entries });
    features.push({
      kind: 'classFeature',
      entity: featureEntity(fname, of, f.level, text, where),
      placement: where,
    });
  }
  // An Ability Score Improvement at each level the file marks for one.
  for (const level of levels.asi) {
    if (seen.has(`${ASI_NAME.toLowerCase()}|${level}`)) continue;
    seen.add(`${ASI_NAME.toLowerCase()}|${level}`);
    features.push({
      kind: 'classFeature',
      entity: featureEntity(
        ASI_NAME,
        of,
        level,
        { entries: [edition === '2024' ? ASI_TEXT_2024 : ASI_TEXT] },
        placement,
      ),
      placement,
    });
  }
  // Its subclasses: the class names what it calls them, and the feature that
  // picks one opens the choice on the sheet. A class that has no such feature
  // gets one where its first subclass is picked.
  const split = splitChoices(choices, new Set(read.map((f) => f.name.toLowerCase())), (pickEl) =>
    bookOf(pickEl, ctx, identity.edition),
  );
  let picksAt: Fc5Part | undefined;
  if (split.label !== undefined) {
    const label = split.label;
    cls.subclassTitle = label;
    picksAt = features.find((p) => String(p.entity.name).toLowerCase() === label.toLowerCase());
    if (picksAt === undefined) {
      // A loop, not a spread: a file's picks could pass an engine's argument limit.
      let level = MAX_LEVEL;
      for (const p of split.picks) level = Math.min(level, p.level);
      picksAt = {
        kind: 'classFeature',
        entity: featureEntity(
          label,
          of,
          level,
          { entries: [`You choose your ${label}.`] },
          placement,
        ),
        placement,
      };
      features.push(picksAt);
    }
  }
  features.sort((a, b) => Number(a.entity.level) - Number(b.entity.level));
  cls.classFeatures = features.map((p) => {
    const ref = featureRef(
      String(p.entity.name),
      name,
      classSource,
      Number(p.entity.level),
      String(p.entity.source),
    );
    return p === picksAt ? { classFeature: ref, gainSubclassFeature: true } : ref;
  });

  // The class's description, which some files give its tables in.
  const fluff: Entry[] = childElements(el, 'trait').flatMap((t) => {
    const text = readText(childTexts(t, 'text')).entries;
    const title = childText(t, 'name');
    return text.length === 0
      ? []
      : title === undefined || title.trim() === '' || title.trim() === name
        ? text
        : [{ type: 'entries', name: title.trim(), entries: text }];
  });
  if (fluff.length > 0) cls.fluff = { entries: fluff };

  const spellAbility = childText(el, 'spellability');
  const casting = readSpellcasting(
    levels.slots.filter((s) => !s.optional),
    spellAbility,
    /^s$/i.test(childText(el, 'slotsreset') ?? ''),
    read,
    fluff,
  );
  Object.assign(cls, casting.fields);
  reasons.push(...casting.reasons);
  if (split.others.length > 0) reasons.push('its options are not converted yet');
  if (startNotes > 0) {
    reasons.push('its notes on starting equipment and multiclassing are not converted yet');
  }
  const counted = countersReason(classCounters(levels.counters, split.picks));
  if (counted !== undefined) reasons.push(counted);

  const from: SubclassFrom = {
    ctx,
    placement,
    edition: identity.edition,
    castingRows: levels.slots.filter((s) => s.optional),
    spellAbility,
    shortRest: /^s$/i.test(childText(el, 'slotsreset') ?? ''),
    counters: levels.counters,
  };
  return {
    kind: 'class',
    name,
    edition,
    entity: cls,
    placement,
    reasons,
    parts: features,
    ...(split.picks.length > 0 && {
      subclasses: (bound: ClassBinding) => split.picks.map((p) => convertSubclass(p, from, bound)),
    }),
  };
}

/** The rule an Ability Score Improvement the file marks but does not write out gives, by edition. */
const ASI_TEXT_2024 =
  'You gain the Ability Score Improvement feat or another feat of your choice for which you qualify.';
const ASI_TEXT =
  "You can increase one ability score of your choice by 2, or you can increase two ability scores of your choice by 1. As normal, you can't increase an ability score above 20 using this feature.";

/** The class a feature belongs to, as its `className` and `classSource` name it. */
interface FeatureOf {
  className: string;
  classSource: string;
}

function featureEntity(
  name: string,
  of: FeatureOf,
  level: number,
  text: { entries: Entry[] },
  placement: Placement,
): Record<string, unknown> {
  const feature: Record<string, unknown> = { name };
  placeEntity(feature, placement);
  feature.className = of.className;
  feature.classSource = of.classSource;
  feature.level = level;
  const entries: Entry[] = [...text.entries];
  const citation = citationEntry(placement);
  if (citation !== undefined) entries.push(citation);
  feature.entries = entries;
  return feature;
}
