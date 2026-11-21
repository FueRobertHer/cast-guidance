/**
 * A Library section's own filters and each row's one line of facts (review
 * finding 44): spells by level, school, class, ritual and concentration;
 * items by rarity, type and attunement. Every filter lives in the URL beside
 * the source, so Back from an entry returns to the list as it was left.
 */
import type { Entity } from '@/data5e/copyMod';
import type { EntityType } from '@/data5e/normalize';
import { itemDamage, itemTypeName, SCHOOLS, spellLevel } from './fmt';

/** A dropdown's URL key, its label, and how to read the value an entry has. */
export interface SelectFilter {
  kind: 'select';
  key: string;
  label: string;
  /** "Any level": the option that filters nothing. */
  any: string;
  /** The values an entry has for it, as option value and label. */
  values: (e: Entity) => ReadonlyArray<readonly [value: string, label: string]>;
  /** Option order; by label when absent. */
  order?: (a: string, b: string) => number;
}

/** A pressed-or-not chip: on, only entries with the property are listed. */
export interface ToggleFilter {
  kind: 'toggle';
  key: string;
  label: string;
  has: (e: Entity) => boolean;
}

export type ListFilter = SelectFilter | ToggleFilter;

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether a spell needs concentration, from any of its durations. */
export function isConcentration(e: Entity): boolean {
  return (
    Array.isArray(e.duration) &&
    e.duration.some(
      (d) => typeof d === 'object' && d !== null && (d as Entity).concentration === true,
    )
  );
}

/** Whether a spell can be cast as a ritual. */
export function isRitual(e: Entity): boolean {
  return typeof e.meta === 'object' && e.meta !== null && (e.meta as Entity).ritual === true;
}

/** An item's rarity as a word, or none for a mundane one. */
function rarityOf(e: Entity): string | undefined {
  const r = e.rarity;
  if (typeof r !== 'string' || r === '' || r === 'none' || r === 'unknown') return undefined;
  return r.toLowerCase();
}

/** The book's order of rarities, rarest last; an unknown one after them. */
const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
const rarityRank = (r: string) => {
  const i = RARITIES.indexOf(r);
  return i === -1 ? RARITIES.length : i;
};

/** What kind of item: its type's name, or Wondrous item where the data marks one. */
function itemKind(e: Entity): string | undefined {
  if (e.wondrous === true) return 'Wondrous item';
  return itemTypeName(e.type);
}

/** Whether an item needs attunement. */
export function needsAttunement(e: Entity): boolean {
  return e.reqAttune !== undefined && e.reqAttune !== false;
}

const SPELL_FILTERS: readonly ListFilter[] = [
  {
    kind: 'select',
    key: 'level',
    label: 'Level',
    any: 'Any level',
    values: (e) => (typeof e.level === 'number' ? [[String(e.level), spellLevel(e.level)]] : []),
    order: (a, b) => Number(a) - Number(b),
  },
  {
    kind: 'select',
    key: 'school',
    label: 'School',
    any: 'Any school',
    values: (e) => {
      if (typeof e.school !== 'string') return [];
      const code = e.school.toUpperCase();
      return [[code, SCHOOLS[code] ?? code]];
    },
  },
  { kind: 'toggle', key: 'ritual', label: 'Ritual', has: isRitual },
  { kind: 'toggle', key: 'concentration', label: 'Concentration', has: isConcentration },
];

const ITEM_FILTERS: readonly ListFilter[] = [
  {
    kind: 'select',
    key: 'rarity',
    label: 'Rarity',
    any: 'Any rarity',
    values: (e) => {
      const r = rarityOf(e);
      return r === undefined ? [] : [[r, capitalized(r)]];
    },
    order: (a, b) => rarityRank(a) - rarityRank(b) || a.localeCompare(b),
  },
  {
    kind: 'select',
    key: 'kind',
    label: 'Type',
    any: 'Any type',
    values: (e) => {
      const k = itemKind(e);
      return k === undefined ? [] : [[k.toLowerCase(), k]];
    },
  },
  { kind: 'toggle', key: 'attunement', label: 'Needs attunement', has: needsAttunement },
];

const BASE_ITEM_FILTERS: readonly ListFilter[] = [ITEM_FILTERS[1] as ListFilter];

/** The filters a section offers beside the name and the source. */
export function filtersFor(type: EntityType): readonly ListFilter[] {
  if (type === 'spell') return SPELL_FILTERS;
  if (type === 'item') return ITEM_FILTERS;
  if (type === 'baseitem') return BASE_ITEM_FILTERS;
  return [];
}

/** Every URL key a section's filters can use, for a Clear filters that leaves the rest. */
export const filterKeys = (type: EntityType): string[] => [
  ...filtersFor(type).map((f) => f.key),
  ...(type === 'spell' ? ['class'] : []),
];

/** Whether an entry passes a filter as the URL sets it; a filter not set passes everything. */
export function passes(filter: ListFilter, e: Entity, value: string | null): boolean {
  if (value === null || value === '') return true;
  if (filter.kind === 'toggle') return filter.has(e);
  return filter.values(e).some(([v]) => v === value);
}

/** A dropdown's options: the values the entries in hand have, each once, in its order. */
export function optionsOf(
  filter: SelectFilter,
  entries: readonly Entity[],
): Array<readonly [string, string]> {
  const out = new Map<string, string>();
  for (const e of entries) for (const [v, label] of filter.values(e)) out.set(v, label);
  const order =
    filter.order ?? ((a: string, b: string) => (out.get(a) ?? a).localeCompare(out.get(b) ?? b));
  return [...out.entries()].sort((a, b) => order(a[0], b[0]));
}

/**
 * A row's facts, short enough for one line under its name: a spell's level,
 * school and casting notes; an item's rarity, kind and attunement; a piece of
 * equipment's kind and damage or AC.
 */
export function rowFacts(type: EntityType, e: Entity): string[] {
  switch (type) {
    case 'spell': {
      const school =
        typeof e.school === 'string' ? (SCHOOLS[e.school.toUpperCase()] ?? e.school) : undefined;
      return [
        typeof e.level === 'number' ? spellLevel(e.level) : undefined,
        school,
        isConcentration(e) ? 'Concentration' : undefined,
        isRitual(e) ? 'Ritual' : undefined,
      ].filter((v): v is string => v !== undefined);
    }
    case 'item': {
      const r = rarityOf(e);
      return [
        r === undefined ? undefined : capitalized(r),
        itemKind(e),
        needsAttunement(e) ? 'Attunement' : undefined,
      ].filter((v): v is string => v !== undefined);
    }
    case 'baseitem':
      return [
        itemKind(e),
        itemDamage(e) ?? (typeof e.ac === 'number' ? `AC ${e.ac}` : undefined),
      ].filter((v): v is string => v !== undefined);
    default:
      return [];
  }
}
