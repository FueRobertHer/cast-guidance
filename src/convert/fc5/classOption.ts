/**
 * Class options Fight Club stores as spells: Eldritch Invocations, Battle
 * Master maneuvers, Metamagic options, and the options of third-party classes
 * (a Blood Hunter's mutagens, a Warmage's tricks). They have no school of
 * magic, and their `<classes>` names an option list rather than a spell list:
 * `Eldritch Invocations`, `Maneuver Options [5.5e]`, `Blood Hunter (Order of
 * the Mutant): Mutagens`.
 *
 * They become 5etools optional features. One on an official list gets that
 * list's 5etools feature type (`EI`, `MV:B`, `MM`…) and loses the list's name
 * prefix (`Invocation: Agonizing Blast` is `Agonizing Blast`), so the class
 * option pickers offer it beside the official options. One on any other list
 * keeps its full name and takes the list's name as its feature type: no class
 * the app has reads it yet, but it is in the Library and ready for one.
 */

import type { RulesVersion } from '../../data5e/rulesVersion';
import { childText, childTexts, type XmlElement } from '../xml';
import { citationEntry, type Fc5Context, type Fc5Result, placeEntity } from './context';
import { type Entry, entryName, inlineText, markerEdition, own, readText, splitName } from './text';

/** The classes a plain spell list names. */
export const BASE_CLASSES: ReadonlySet<string> = new Set([
  'artificer',
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
]);

interface OfficialList {
  featureType: string;
  className: string;
}

/** Fight Club's names for the official option lists, lowercased, markers off. */
const OFFICIAL_LISTS: Record<string, OfficialList> = {
  'eldritch invocations': { featureType: 'EI', className: 'Warlock' },
  'maneuver options': { featureType: 'MV:B', className: 'Fighter' },
  maneuvers: { featureType: 'MV:B', className: 'Fighter' },
  'metamagic options': { featureType: 'MM', className: 'Sorcerer' },
  'fighter (arcane archer)': { featureType: 'AS', className: 'Fighter' },
  'fighter (arcane archer): arcane shot': { featureType: 'AS', className: 'Fighter' },
  'fighter (arcane archer): arcane shot options': { featureType: 'AS', className: 'Fighter' },
  'artificer infusions': { featureType: 'AI', className: 'Artificer' },
  'monk (way of the four elements)': { featureType: 'ED', className: 'Monk' },
  'fighter (rune knight)': { featureType: 'RN', className: 'Fighter' },
};

/** Split at commas outside brackets: `A (x, y), B` is `A (x, y)` and `B`. */
function topLevelParts(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  parts.push(current.trim());
  return parts.filter((p) => p !== '');
}

/** A list name without its edition markers, wherever they sit: `Fighter [5.5e] (Rune Knight)`. */
function withoutMarkers(text: string): string {
  return text
    .replace(/\[[^[\]]{1,12}\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ (?=[),:])/g, '')
    .trim();
}

/** A `<classes>` part as a lookup key: `Fighter [5.5e] (Arcane Archer)` as `fighter (arcane archer)`. */
function listKey(part: string): string {
  return withoutMarkers(part)
    .replace(/\s*\(UA\)$/i, '')
    .toLowerCase();
}

/** Fight Club's spell lists that are not a class's: `School: Evocation`, `Ritual Caster`. */
function isSpellList(key: string): boolean {
  return (
    BASE_CLASSES.has(key) ||
    key.startsWith('school:') ||
    key === 'ritual caster' ||
    key === 'touch spells'
  );
}

/** `cleric (forge)`: a subclass's spell list, not an option list. */
const SUBCLASS_LIST = /^([a-z]+) \([^():]*\)$/;

/**
 * Whether a `<classes>` part names an option list rather than a spell list. A
 * subclass's list can be either (`Cleric (Forge)` spells, `Fighter
 * (Gunslinger)` trick shots), so it counts as one for an entry named for its
 * list.
 */
function isOptionList(key: string, listNamed: boolean): boolean {
  if (own(OFFICIAL_LISTS, key) !== undefined) return true;
  if (isSpellList(key)) return false;
  const sub = SUBCLASS_LIST.exec(key);
  return listNamed || !(sub !== null && BASE_CLASSES.has(sub[1] ?? ''));
}

/**
 * Whether a `<spell>` is a class option: a level 0 or 1 entry whose
 * `<classes>` names option lists only. Most have no school of magic; a spell
 * that only lost its school keeps being a spell, as its lists are spell lists
 * (`Wizard`, `Cleric (Forge)`). Some that work like spells keep their school:
 * an option on an official list (`Arcane Shot: Banishing Arrow`, `Infusion:
 * Enhanced Defense`, `Elemental Discipline: Breath of Winter`), and one named
 * for its list (`Splicer Augment: Amphibious`). A starred copy of a spell
 * (`Burning Hands*`) is never one.
 */
export function isClassOption(el: XmlElement): boolean {
  if (el.name !== 'spell') return false;
  const classes = childText(el, 'classes');
  if (classes === undefined) return false;
  const level = Number(childText(el, 'level') ?? 0);
  if (!(level === 0 || level === 1)) return false;
  const name = splitName(childText(el, 'name') ?? '').name;
  if (name.endsWith('*')) return false;
  const listNamed = /^[^:]{1,40}: \S/.test(name);
  const keys = topLevelParts(classes).map(listKey);
  if (keys.length === 0 || !keys.every((key) => isOptionList(key, listNamed))) return false;
  if ((childText(el, 'school') ?? '') === '') return true;
  return listNamed || keys.every((key) => own(OFFICIAL_LISTS, key) !== undefined);
}

/** `Invocation: Agonizing Blast` as `Agonizing Blast`; a name with no such prefix as it is. */
function withoutPrefix(name: string): string {
  const colon = name.indexOf(': ');
  if (colon <= 0 || colon > 40) return name;
  const rest = name.slice(colon + 2).trim();
  return rest === '' ? name : rest;
}

const PREREQUISITE = /^\s*Prerequisites?:\s*(\S.*)$/i;
const LEVEL = /\b(\d{1,2})(?:st|nd|rd|th)[- ]level\b|\blevel (\d{1,2})\+?/i;
const PACT = /\bPact of the (Blade|Chain|Tome|Talisman)\b/i;
/** "Level 5+ Warlock", "5th-level Monk", "5th Level Artificer". */
const LEVEL_THEN_CLASS =
  /^(?:level (\d{1,2})\+?|(\d{1,2})(?:st|nd|rd|th)[- ]level) ([a-z]{4,12})$/i;
/** "Warlock Level 5+". */
const CLASS_THEN_LEVEL = /^([a-z]{4,12}) level (\d{1,2})\+?$/i;
const CLASSES = [
  'Artificer',
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
];

/** A class level clause's level and class, for a class of the rules or the list's own. */
function classLevel(
  text: string,
  className: string | undefined,
): { level: number; className: string } | undefined {
  const first = LEVEL_THEN_CLASS.exec(text);
  const second = first === null ? CLASS_THEN_LEVEL.exec(text) : null;
  const level = Number(first?.[1] ?? first?.[2] ?? second?.[2]);
  const word = (first?.[3] ?? second?.[1] ?? '').toLowerCase();
  const name = [...CLASSES, ...(className === undefined ? [] : [className])].find(
    (c) => c.toLowerCase() === word,
  );
  return name === undefined || !Number.isInteger(level) ? undefined : { level, className: name };
}

/**
 * `Prerequisite:` lines into 5etools' shape: a level (of the list's class,
 * when the list is official, or of the class the line names), a warlock pact,
 * and anything else as `other` text. The engine enforces the level and shows
 * the rest.
 */
export function readOptionPrerequisite(
  lines: readonly string[],
  className: string | undefined,
): Record<string, unknown>[] | undefined {
  if (lines.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  const other: string[] = [];
  for (const line of lines) {
    for (const clause of line.split(/[,;]/)) {
      const text = clause.trim().replace(/\.$/, '');
      if (text === '') continue;
      const level = LEVEL.exec(text);
      const pact = PACT.exec(text);
      const classed = classLevel(text, className);
      if (classed !== undefined) {
        out.level = { level: classed.level, class: { name: classed.className, visible: true } };
      } else if (level !== null && text.replace(level[0], '').trim() === '') {
        const n = Number(level[1] ?? level[2]);
        out.level =
          className === undefined ? n : { level: n, class: { name: className, visible: true } };
      } else if (pact !== null && /^(?:the\s+)?Pact of the \w+(?: feature| boon)?$/i.test(text)) {
        out.pact = (pact[1] ?? '').charAt(0).toUpperCase() + (pact[1] ?? '').slice(1).toLowerCase();
      } else other.push(text);
    }
  }
  if (other.length > 0) out.other = other.join(', ');
  return [out];
}

/** The fields the file gives a class option that a 5etools optional feature has no field for. */
const SPELL_FIELDS: readonly [string, string][] = [
  ['time', 'Casting Time'],
  ['range', 'Range'],
  ['components', 'Components'],
  ['duration', 'Duration'],
];

export function convertClassOption(el: XmlElement, ctx: Fc5Context): Fc5Result {
  const rawName = childText(el, 'name');
  if (rawName === undefined) return { skip: 'it has no name' };
  const lists = topLevelParts(childText(el, 'classes') ?? '');
  const official: OfficialList[] = [];
  const types = new Set<string>();
  let listEdition: RulesVersion | undefined;
  for (const list of lists) {
    for (const marker of list.matchAll(/\[([^[\]]{1,12})\]/g)) {
      listEdition ??= markerEdition(marker[1] ?? '');
    }
    const bare = withoutMarkers(list);
    const known = own(OFFICIAL_LISTS, listKey(list));
    if (known !== undefined) official.push(known);
    types.add(known?.featureType ?? bare);
  }

  const named = entryName(rawName);
  const name = official.length > 0 ? withoutPrefix(named.name) : named.name;

  // Prerequisites have a field of their own, as on an official option.
  const prerequisites: string[] = [];
  const blocks = childTexts(el, 'text').map((block) =>
    block
      .split(/\r?\n/)
      .filter((line) => {
        const m = PREREQUISITE.exec(line);
        if (m !== null) prerequisites.push(m[1] ?? '');
        return m === null;
      })
      .join('\n'),
  );
  const text = readText(blocks);
  const placement = ctx.place(
    childText(el, 'source') ?? text.sourceLine,
    named.edition ?? listEdition,
  );

  const feature: Record<string, unknown> = { name };
  placeEntity(feature, placement);
  feature.featureType = [...types];
  const prerequisite = readOptionPrerequisite(prerequisites, official[0]?.className);
  if (prerequisite !== undefined) feature.prerequisite = prerequisite;

  const lead: Entry[] = [];
  for (const [field, label] of SPELL_FIELDS) {
    const value = childText(el, field)?.trim();
    if (value !== undefined && value !== '') lead.push(`{@b ${label}:} ${inlineText(value)}`);
  }
  const entries: Entry[] = [...lead, ...text.entries];
  const citation = citationEntry(placement);
  if (citation !== undefined) entries.push(citation);
  feature.entries = entries;

  return {
    kind: 'optionalfeature',
    name,
    edition: placement.edition,
    entity: feature,
    placement,
    reasons: [],
  };
}

/**
 * The lists a class option names that are not official ones, as its feature
 * types are written (`Warmage (Valda): Tricks`), so the class they are for can
 * offer them.
 */
export function homebrewOptionLists(el: XmlElement): string[] {
  return topLevelParts(childText(el, 'classes') ?? '')
    .filter((list) => own(OFFICIAL_LISTS, listKey(list)) === undefined)
    .map(withoutMarkers);
}

/** Whether a converted option is on an official list, so a class the app has offers it. */
export function isOnOfficialList(entity: Record<string, unknown>): boolean {
  const types = Array.isArray(entity.featureType) ? entity.featureType : [];
  return types.some((t) => Object.values(OFFICIAL_LISTS).some((list) => list.featureType === t));
}
