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
 * Read a filter. Undefined when any part of it is one the app cannot apply: with
 * that part ignored, the picker would offer spells the data rules out.
 */
export function parseSpellFilter(filter: string): SpellQuery | undefined {
  const query: SpellQuery = { levels: [], classes: [], schools: [], ritual: false, attacks: [] };
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
      case 'components & miscellaneous':
        if (values.length !== 1 || values[0]?.toLowerCase() !== 'ritual') return undefined;
        query.ritual = true;
        break;
      case 'spell attack':
        query.attacks = values.map((value) => value.toLowerCase());
        break;
      default:
        return undefined;
    }
  }
  return query;
}

/**
 * Whether a spell passes every part of a query but its class lists, which live
 * outside the spell (see `src/data5e/spellLookup.ts`).
 */
export function spellFitsQuery(spell: DataEntity, query: SpellQuery): boolean {
  if (query.levels.length > 0 && !query.levels.includes(spell.level as number)) return false;
  if (query.schools.length > 0 && !query.schools.includes(String(spell.school).toUpperCase())) {
    return false;
  }
  if (query.ritual && (spell.meta as { ritual?: unknown } | undefined)?.ritual !== true) {
    return false;
  }
  if (query.attacks.length > 0) {
    const attacks = Array.isArray(spell.spellAttack) ? spell.spellAttack : [];
    if (!attacks.some((attack) => query.attacks.includes(String(attack).toLowerCase()))) {
      return false;
    }
  }
  return true;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function levelsText(levels: readonly number[]): string {
  const [first, ...rest] = levels;
  if (first === undefined) return '';
  const last = rest.at(-1);
  if (last === undefined) return `level ${first}`;
  const unbroken = levels.every((level, i) => level === first + i);
  return unbroken ? `level ${first} to ${last}` : `level ${levels.join(' or ')}`;
}

/** A query in words, for a prompt's label: "Level 1 Enchantment or Divination spell". */
export function describeSpellQuery(query: SpellQuery, count: number): string {
  const cantrip = query.levels.length === 1 && query.levels[0] === 0;
  return capitalized(
    [
      cantrip ? '' : levelsText(query.levels),
      query.classes.map(capitalized).join(' or '),
      query.schools.map((school) => SPELL_SCHOOLS[school] ?? school).join(' or '),
      query.ritual ? 'ritual' : '',
      query.attacks.length > 0 ? 'attack' : '',
      `${cantrip ? 'cantrip' : 'spell'}${count > 1 ? 's' : ''}`,
    ]
      .filter((part) => part !== '')
      .join(' '),
  );
}
