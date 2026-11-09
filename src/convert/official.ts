// Where a converted entry's official counterpart lives. The import leaves out
// an entry the installed game data already has, and the converter check
// (`compareOfficial.ts`) sets one beside it. Relative imports only: scripts
// load this under plain Bun.
import type { Entity } from '../data5e/copyMod';
import type { EntityType } from '../data5e/normalize';
import type { ConvertedKind } from './types';

/**
 * The registry types an entry of each converted kind could already be. Other
 * apps have no subraces, so a race could be an official subrace too.
 */
export const OFFICIAL_TYPES: Record<ConvertedKind, readonly EntityType[]> = {
  spell: ['spell'],
  item: ['item', 'baseitem', 'itemGroup'],
  feat: ['feat'],
  background: ['background'],
  race: ['race', 'subrace'],
};

/**
 * The names, lowercased, that a converted entry could carry for an official
 * one. Most answer to their own name only. A 2014 subrace is an entry of its
 * own in 5etools (`Hill`, of `Dwarf|PHB`) and a 2024 lineage is a version of
 * its species (`Elf; Drow Lineage`), but other apps name either as a race:
 * `Dwarf, Hill`, `Dwarf (Hill)` (as 5etools shows it), `Hill Dwarf`, and
 * `Elf, Drow` or `Drow Elf` for the lineage. A subrace never answers to its
 * own name alone, and a nameless one is its race's own base entry, so it
 * answers to nothing.
 */
export function officialNames(type: EntityType, e: Entity): string[] {
  if (typeof e.name !== 'string') return [];
  const own = e.name.toLowerCase();
  const raceName =
    type === 'subrace'
      ? e.raceName
      : type === 'race' && typeof e._versionOf === 'string'
        ? e._versionOf.split('|')[0]
        : undefined;
  if (typeof raceName !== 'string' || raceName === '') return [own];
  const race = raceName.toLowerCase();
  const qualifier = qualifierOf(own, race) ?? (type === 'subrace' ? own : undefined);
  if (qualifier === undefined) return [own];
  // A subrace's own name (`Hill`) is no race's name.
  const names = new Set(type === 'subrace' ? [] : [own]);
  for (const q of new Set([qualifier, shortQualifier(qualifier, race)])) {
    names.add(`${race}, ${q}`);
    names.add(shownName(race, q));
    // `Hill Dwarf`, but not `Variant; Hellfire Tiefling` or `Joraga Elf (Zendikar)`.
    if (/^[\p{L}' -]+$/u.test(`${q} ${race}`)) names.add(`${q} ${race}`);
  }
  return [...names];
}

/**
 * As the 5etools site names a subrace (`Renderer.race.getSubraceName`):
 * `Dwarf (Hill)`, and `Elf (Zendikar; Joraga Nation)` for a race whose name
 * already ends in brackets.
 */
function shownName(race: string, qualifier: string): string {
  const open = race.indexOf('(');
  if (open === -1 || !race.endsWith(')')) return `${race} (${qualifier})`;
  return `${race.slice(0, open)}(${race.slice(open + 1, -1)}; ${qualifier})`;
}

/** `Drow Lineage` of `elf; drow lineage`, `Black` of `dragonborn (black)`. */
function qualifierOf(name: string, race: string): string | undefined {
  if (name.startsWith(`${race}; `)) return name.slice(race.length + 2).trim() || undefined;
  if (name.startsWith(`${race} (`) && name.endsWith(')')) {
    return name.slice(race.length + 2, -1).trim() || undefined;
  }
  return undefined;
}

/**
 * `High Elf Lineage` as `high`, `Abyssal Legacy` as `abyssal`, `Cloud Giant
 * Ancestry` as `cloud giant`.
 */
function shortQualifier(qualifier: string, race: string): string {
  let q = qualifier;
  for (const suffix of [' lineage', ' legacy', ' ancestry']) {
    if (q.endsWith(suffix)) q = q.slice(0, -suffix.length);
  }
  if (q.endsWith(` ${race}`)) q = q.slice(0, -race.length - 1);
  return q.trim() || qualifier;
}
