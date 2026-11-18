/**
 * A stored pick (`kind: "pick"`, rule pack port phase 4) in words: what it
 * asks for, how many, and from what. The Workshop's Pick card reads its line
 * from here, and a rule pack's review says what a changed entry asks for.
 * Words are read from the stored fields as written; what the reader would
 * refuse is the card's problem line to say, not these words'.
 */
import { isRecord } from '@/engine/castGuidance';

type Json = Record<string, unknown>;

const ABILITIES: Readonly<Record<string, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

/** A weapon's property codes, as a weapon pick's `without` gives them. */
const PROPERTIES: Readonly<Record<string, string>> = {
  '2h': 'Two-Handed',
  a: 'Ammunition',
  f: 'Finesse',
  h: 'Heavy',
  l: 'Light',
  ld: 'Loading',
  r: 'Reach',
  s: 'Special',
  t: 'Thrown',
  v: 'Versatile',
};

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/** "a, b or c". */
export function orList(items: readonly string[], joiner = 'or'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${joiner} ${items.at(-1)}`;
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/** What one answer is called, and many: "skill" and "skills". */
interface Noun {
  one: string;
  many: string;
}

/** The kinds a weapon pick's filter names ("type=martial weapon;type=melee weapon"). */
export function weaponKinds(filter: unknown): string[] {
  if (typeof filter !== 'string') return [];
  return filter
    .trim()
    .toLowerCase()
    .replace(/^type=/, '')
    .split(';')
    .map((k) => k.replace(/ weapon$/, '').trim())
    .filter((k) => k !== '');
}

function spellNoun(e: Json): Noun {
  const spells = isRecord(e.spells) ? e.spells : {};
  const levels = Array.isArray(spells.levels)
    ? spells.levels.filter((l): l is number => typeof l === 'number')
    : [];
  const above = levels.filter((l) => l > 0).map(String);
  const cantrips = levels.includes(0);
  if (above.length === 0) return { one: 'cantrip', many: 'cantrips' };
  const of = `of level ${orList(above)}`;
  return cantrips
    ? { one: `cantrip or spell ${of}`, many: `cantrips or spells ${of}` }
    : { one: `spell ${of}`, many: `spells ${of}` };
}

function nounOf(e: Json): Noun {
  switch (e.ask) {
    case 'skill':
      return { one: 'skill', many: 'skills' };
    case 'tool':
      return { one: 'tool', many: 'tools' };
    case 'weapon': {
      const kinds = isRecord(e.weapons) ? weaponKinds(e.weapons.filter) : [];
      const kind = kinds.length > 0 ? `${orList(kinds)} ` : '';
      return { one: `${kind}weapon`, many: `${kind}weapons` };
    }
    case 'weaponMastery': {
      const melee = e.melee === true ? 'melee ' : '';
      return { one: `${melee}kind of weapon to master`, many: `${melee}kinds of weapon to master` };
    }
    case 'save':
      return { one: 'saving throw', many: 'saving throws' };
    case 'damage':
      return { one: 'damage type', many: 'damage types' };
    case 'spell':
      return spellNoun(e);
    default:
      return { one: 'pick', many: 'picks' };
  }
}

/** How many it asks, said with its noun: "a skill", "2 skills", "skills, as many as ...". */
function countWords(e: Json, noun: Noun): string {
  const c = e.count;
  if (c === undefined || c === 1) return `${article(noun.one)} ${noun.one}`;
  if (typeof c === 'number') return `${c} ${noun.many}`;
  if (isRecord(c) && isRecord(c.byLevel)) return `${noun.many}, as many as its level table says`;
  if (isRecord(c) && typeof c.tableColumn === 'string') {
    const rest = typeof c.else === 'number' ? `, else ${c.else}` : '';
    return `${noun.many}, as many as the class table's ${c.tableColumn} column says${rest}`;
  }
  return `${noun.many}, as many as the file says`;
}

/** What an option pick offers, by its options' names. */
function optionWords(e: Json): string {
  const names = (Array.isArray(e.options) ? e.options : [])
    .filter(isRecord)
    .map((o) =>
      typeof o.label === 'string' && o.label.trim() !== '' ? o.label.trim() : String(o.id),
    );
  const among = names.length === 0 ? 'its options' : orList(names);
  const c = e.count;
  if (c === undefined || c === 1) return `one of ${among}`;
  if (typeof c === 'number') return `${c} of ${among}`;
  return `${countWords(e, { one: 'option', many: 'options' })}, from ${among}`;
}

/** The names a pick's `from` (or `inPlaceOf`) lists, as its answers are worded. */
function namesOf(e: Json, v: unknown): string[] {
  const names = strings(v);
  if (e.ask === 'save') return names.map((a) => ABILITIES[a.toLowerCase()] ?? a);
  return names;
}

/** What it picks from: " from Arcana or History", " from the class's skills". */
function fromWords(e: Json): string {
  const from = namesOf(e, e.from);
  if (e.ask === 'spell') {
    const spells = isRecord(e.spells) ? e.spells : {};
    const classes = strings(spells.classes);
    if (classes.length === 0) return '';
    return ` from the ${orList(classes)} ${classes.length === 1 ? 'list' : 'lists'}`;
  }
  if (e.ask === 'weaponMastery') {
    return e.proficient === true ? ', among those you are proficient with' : '';
  }
  const among = [...(e.classSkills === true ? ["the class's skills"] : []), ...from];
  const said = among.length === 0 ? '' : ` from ${orList(among)}`;
  if (e.ask === 'weapon' && isRecord(e.weapons)) {
    const without = strings(e.weapons.without).map((p) => PROPERTIES[p.toLowerCase()] ?? p);
    return without.length === 0 ? said : `${said}, not ${orList(without)}`;
  }
  return said;
}

/**
 * A stored pick in words, "Asks for 2 skills from Arcana, History or Nature".
 * One in place of what is held says what it gives first: "Gives Persuasion;
 * for each held already, asks for a skill from Insight or Performance".
 */
export function pickWords(e: Json): string {
  const asked =
    e.ask === 'option'
      ? optionWords(e)
      : `${countWords(e, nounOf(e))}${fromWords(e)}${
          e.ask === 'skill' && e.orLanguage === true ? ', or a language' : ''
        }`;
  const late = e.afterBuild === true ? ', once the build is in' : '';
  const held = namesOf(e, e.inPlaceOf);
  if (held.length > 0) {
    const noun = nounOf(e);
    const what = `${article(noun.one)} ${noun.one}${fromWords(e)}`;
    return `Gives ${orList(held, 'and')}; for each held already, asks for ${what}${late}`;
  }
  return `Asks for ${asked}${late}`;
}
