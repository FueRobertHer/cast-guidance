/**
 * The filters 5etools writes where a spell is the player's pick, such as
 * `level=1|class=Wizard` or `level=1;2|school=E;D`.
 */
import type { DataEntity, SpellQuery } from './types';

export const SPELL_SCHOOLS: Record<string, string> = {
  A: 'Abjuration',
  C: 'Conjuration',
  D: 'Divination',
  E: 'Enchantment',
  V: 'Evocation',
  I: 'Illusion',
  N: 'Necromancy',
  T: 'Transmutation',
  P: 'Psionic',
};

/**
 * The tag filters 5etools' spell page has, read by its own keys: `area style`,
 * `affects creature types`, `ability check`, and every item of `components &
 * miscellaneous` a spell carries. Each list holds the item keys as 5etools
 * names them; a spell passes a key by any one of them. Kept beside
 * `SpellQuery` rather than in it, and every one optional, so a query without
 * them is still a whole query.
 */
export interface SpellTagQuery {
  /** Area style codes, in capitals: `C`, `ST`. */
  areas?: string[];
  /** Standard creature types, in lower case. */
  creatureTypes?: string[];
  /** Ability names for the checks a spell calls for, in lower case. */
  checks?: string[];
  /** `components & miscellaneous` items, in lower case: `hl`, `royalty`. */
  misc?: string[];
}

/** 5etools' area style items (its `spAreaTypeToFull`). */
const AREA_STYLES: Readonly<Record<string, string>> = {
  ST: 'Single Target',
  MT: 'Multiple Targets',
  C: 'Cube',
  N: 'Cone',
  Y: 'Cylinder',
  S: 'Sphere',
  R: 'Circle',
  Q: 'Square',
  L: 'Line',
  H: 'Hemisphere',
  W: 'Wall',
  E: 'Emanation',
};

/** 5etools' standard creature types, which a spell naming none affects all of. */
const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

/** 5etools' misc tags (its `SP_MISC_TAG_TO_FULL`), by the key a filter names them. */
const MISC_TAGS: Readonly<Record<string, string>> = {
  hl: 'Healing',
  thp: 'Grants Temporary Hit Points',
  sgt: 'Requires Sight',
  prm: 'Permanent Effects',
  scl: 'Scaling Effects',
  sct: 'Scaling Targets',
  smn: 'Summons Creature',
  mac: 'Modifies AC',
  tp: 'Teleportation',
  fmv: 'Forced Movement',
  ro: 'Rollable Effects',
  lgts: 'Creates Sunlight',
  lgt: 'Creates Light',
  ua: 'Uses Action',
  uba: 'Uses Bonus Action',
  ps: 'Plane Shifting',
  obs: 'Obscures Vision',
  dft: 'Difficult Terrain',
  aad: 'Additional Attack Damage',
  obj: 'Affects Objects',
  adv: 'Grants Advantage',
  pir: 'Permanent If Repeated',
  bo: 'Burns Objects',
  wlt: 'Targets Willing Creatures',
  alt: 'Targets Allies',
};

/**
 * The `components & miscellaneous` items a spell's own fields settle, by key,
 * with how a label names them. 5etools' others (Legacy, Reprinted, Has Images,
 * Has Token) are facts about a book's page, not the spell, so a filter naming
 * one is not read.
 */
const MISC_ITEMS: Readonly<Record<string, string>> = {
  concentration: 'Concentration',
  verbal: 'Verbal',
  somatic: 'Somatic',
  material: 'Material',
  royalty: 'Royalty',
  'material with cost': 'Material with Cost',
  'material is consumed': 'Material is Consumed',
  'material is optionally consumed': 'Material is Optionally Consumed',
  ritual: 'Ritual',
  ...MISC_TAGS,
};

/** The values of a list of filter values when every one is known, else undefined. */
function known(values: readonly string[], allowed: (v: string) => boolean): string[] | undefined {
  const unique = [...new Set(values)];
  return unique.every(allowed) ? unique : undefined;
}

/**
 * Read a filter. Undefined when any part of it is one the app cannot apply: with
 * that part ignored, the picker would offer spells the data rules out. An empty
 * filter rules nothing out: the data writes it where any spell will do.
 */
export function parseSpellFilter(filter: string): (SpellQuery & SpellTagQuery) | undefined {
  const query: SpellQuery & SpellTagQuery = {
    levels: [],
    classes: [],
    schools: [],
    ritual: false,
    attacks: [],
  };
  if (filter.trim() === '') return query;
  for (const part of filter.split('|')) {
    const [key = '', list = ''] = part.split('=');
    const values = list
      .split(';')
      .map((value) => value.trim())
      .filter((value) => value !== '');
    if (values.length === 0) return undefined;
    switch (key.trim().toLowerCase()) {
      case 'level':
        query.levels = values.map(Number);
        if (query.levels.some((level) => !Number.isInteger(level))) return undefined;
        break;
      case 'class':
        query.classes = values;
        break;
      case 'school':
        query.schools = values.map((value) => value.toUpperCase());
        break;
      case 'components & miscellaneous': {
        const items = known(
          values.map((v) => v.toLowerCase()),
          (v) => Object.hasOwn(MISC_ITEMS, v),
        );
        if (items === undefined) return undefined;
        // Ritual alone is the flag it always was; among others, one of them.
        if (items.length === 1 && items[0] === 'ritual') query.ritual = true;
        else query.misc = items;
        break;
      }
      case 'area style': {
        const areas = known(
          values.map((v) => v.toUpperCase()),
          (v) => Object.hasOwn(AREA_STYLES, v),
        );
        if (areas === undefined) return undefined;
        query.areas = areas;
        break;
      }
      case 'affects creature types': {
        const types = known(
          values.map((v) => v.toLowerCase()),
          (v) => (CREATURE_TYPES as readonly string[]).includes(v),
        );
        if (types === undefined) return undefined;
        query.creatureTypes = types;
        break;
      }
      case 'ability check': {
        const checks = known(
          values.map((v) => v.toLowerCase()),
          (v) => ABILITIES.includes(v),
        );
        if (checks === undefined) return undefined;
        query.checks = checks;
        break;
      }
      case 'spell attack':
        query.attacks = values.map((value) => value.toLowerCase());
        break;
      // "source=EGW;!XGE": printed in EGW, and not in XGE.
      case 'source':
        query.sources = values.filter((v) => !v.startsWith('!')).map((v) => v.toUpperCase());
        query.notSources = values
          .filter((v) => v.startsWith('!'))
          .map((v) => v.slice(1).trim().toUpperCase());
        // A bare "!" names no book, and would rule out nothing.
        if (query.notSources.includes('')) return undefined;
        break;
      default:
        return undefined;
    }
  }
  return query;
}

const lowerList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : [];

/** A spell's area styles as 5etools files them: its tags, and a line or emanation range. */
function areaStylesOf(spell: DataEntity): string[] {
  const styles = lowerList(spell.areaTags).map((t) => t.toUpperCase());
  const type = (spell.range as { type?: unknown } | undefined)?.type;
  if (type === 'line') styles.push('L');
  if (type === 'emanation') styles.push('E');
  return styles;
}

/** The creature types a spell affects; one that names none affects every type, as 5etools has it. */
function creatureTypesOf(spell: DataEntity): readonly string[] {
  return spell.affectsCreatureType ? lowerList(spell.affectsCreatureType) : CREATURE_TYPES;
}

/** The `components & miscellaneous` items a spell carries, worked out as 5etools does. */
function miscOf(spell: DataEntity): string[] {
  const out = lowerList(spell.miscTags);
  const meta = spell.meta;
  if (typeof meta === 'object' && meta !== null) {
    for (const [k, v] of Object.entries(meta)) if (v) out.push(k.toLowerCase());
  }
  const durations = (Array.isArray(spell.duration) ? spell.duration : []) as Array<{
    type?: unknown;
    concentration?: unknown;
  } | null>;
  if (durations.some((d) => d?.concentration)) out.push('concentration');
  if (durations.some((d) => d?.type === 'permanent')) out.push('prm');
  if (spell.entriesHigherLevel) out.push('scl');
  const comp = (spell.components ?? {}) as Record<string, unknown>;
  if (comp.v) out.push('verbal');
  if (comp.s) out.push('somatic');
  if (comp.m) out.push('material');
  if (comp.r) out.push('royalty');
  const m = comp.m as { cost?: unknown; consume?: unknown } | undefined;
  if (typeof m === 'object' && m !== null) {
    if (m.cost) out.push('material with cost');
    if (m.consume === 'optional') out.push('material is optionally consumed');
    else if (m.consume) out.push('material is consumed');
  }
  return out;
}

/** A key a query does not name passes; one it names passes on any value it lists. */
const anyOf = (want: readonly string[] | undefined, has: readonly string[]) =>
  want === undefined || want.length === 0 || want.some((w) => has.includes(w));

/**
 * Whether a spell passes every part of a query but its class lists, which live
 * outside the spell (see `src/data5e/spellLookup.ts`).
 */
export function spellFitsQuery(spell: DataEntity, query: SpellQuery & SpellTagQuery): boolean {
  if (!anyOf(query.areas, areaStylesOf(spell))) return false;
  if (!anyOf(query.creatureTypes, creatureTypesOf(spell))) return false;
  if (!anyOf(query.checks, lowerList(spell.abilityCheck))) return false;
  if (!anyOf(query.misc, miscOf(spell))) return false;
  if (query.levels.length > 0 && !query.levels.includes(spell.level as number)) return false;
  if (query.schools.length > 0 && !query.schools.includes(String(spell.school).toUpperCase())) {
    return false;
  }
  if (query.ritual && (spell.meta as { ritual?: unknown } | undefined)?.ritual !== true) {
    return false;
  }
  const source = String(spell.source).toUpperCase();
  if (query.sources !== undefined && query.sources.length > 0 && !query.sources.includes(source)) {
    return false;
  }
  if (query.notSources?.includes(source) === true) return false;
  if (query.attacks.length > 0) {
    const attacks = Array.isArray(spell.spellAttack) ? spell.spellAttack : [];
    if (!attacks.some((attack) => query.attacks.includes(String(attack).toLowerCase()))) {
      return false;
    }
  }
  return true;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Levels in words. Nobody calls a cantrip level 0, so cantrips are named apart. */
function levelsText(levels: readonly number[]): string {
  const above = [...new Set(levels)].filter((level) => level > 0);
  const [first] = above;
  if (first === undefined) return '';
  const words =
    above.length === 1
      ? `level ${first}`
      : above.every((level, i) => level === first + i)
        ? `level ${first} to ${above.at(-1)}`
        : `level ${above.join(' or ')}`;
  return levels.includes(0) ? `cantrip or ${words}` : words;
}

/** A query in words, for a prompt's label: "Level 1 Enchantment or Divination spell". */
export function describeSpellQuery(query: SpellQuery & SpellTagQuery, count: number): string {
  const cantrip = query.levels.length > 0 && query.levels.every((level) => level === 0);
  const sources = query.sources ?? [];
  const notSources = query.notSources ?? [];
  // The tag filters, each a clause after the noun: "Level 1 spell, tagged Healing".
  const tags = [
    query.misc?.length ? `tagged ${query.misc.map((m) => MISC_ITEMS[m] ?? m).join(' or ')}` : '',
    query.areas?.length
      ? `area style ${query.areas.map((a) => AREA_STYLES[a] ?? a).join(' or ')}`
      : '',
    query.creatureTypes?.length
      ? `affecting ${query.creatureTypes.map(capitalized).join(' or ')}`
      : '',
    query.checks?.length ? `calling for a ${query.checks.map(capitalized).join(' or ')} check` : '',
  ].filter((clause) => clause !== '');
  const open =
    query.levels.length +
      query.classes.length +
      query.schools.length +
      query.attacks.length +
      sources.length +
      notSources.length +
      tags.length ===
      0 && !query.ritual;
  return capitalized(
    [
      open ? 'any' : '',
      cantrip ? '' : levelsText(query.levels),
      query.classes.map(capitalized).join(' or '),
      query.schools.map((school) => SPELL_SCHOOLS[school] ?? school).join(' or '),
      query.ritual ? 'ritual' : '',
      query.attacks.length > 0 ? 'attack' : '',
      sources.join(' or '),
      `${cantrip ? 'cantrip' : 'spell'}${count > 1 ? 's' : ''}`,
    ]
      .filter((part) => part !== '')
      .join(' ') +
      tags.map((clause) => `, ${clause}`).join('') +
      (notSources.length > 0 ? `, not from ${notSources.join(' or ')}` : ''),
  );
}
