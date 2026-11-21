import { describe, expect, it } from 'vitest';
import {
  filterKeys,
  filtersFor,
  isConcentration,
  isRitual,
  needsAttunement,
  optionsOf,
  passes,
  rowFacts,
  type SelectFilter,
} from './listFilters';

const fireball = { name: 'Fireball', level: 3, school: 'V', duration: [{ type: 'instant' }] };
const detectMagic = {
  name: 'Detect Magic',
  level: 1,
  school: 'D',
  meta: { ritual: true },
  duration: [{ type: 'timed', concentration: true }],
};
const select = (type: 'spell' | 'item' | 'baseitem', key: string) =>
  filtersFor(type).find((f) => f.key === key) as SelectFilter;

describe('the spell filters', () => {
  it('reads ritual and concentration from the data', () => {
    expect(isRitual(detectMagic)).toBe(true);
    expect(isConcentration(detectMagic)).toBe(true);
    expect(isRitual(fireball)).toBe(false);
    expect(isConcentration(fireball)).toBe(false);
  });

  it('offers the levels the list has, in level order, and the schools by name', () => {
    expect(optionsOf(select('spell', 'level'), [fireball, detectMagic, { level: 0 }])).toEqual([
      ['0', 'Cantrip'],
      ['1', '1st level'],
      ['3', '3rd level'],
    ]);
    expect(optionsOf(select('spell', 'school'), [fireball, detectMagic])).toEqual([
      ['D', 'Divination'],
      ['V', 'Evocation'],
    ]);
  });

  it('passes everything while a filter is not set', () => {
    const level = select('spell', 'level');
    expect(passes(level, fireball, null)).toBe(true);
    expect(passes(level, fireball, '')).toBe(true);
    expect(passes(level, fireball, '3')).toBe(true);
    expect(passes(level, fireball, '1')).toBe(false);
  });

  it('has a class key besides its own filters, which Clear filters also clears', () => {
    expect(filterKeys('spell')).toEqual(['level', 'school', 'ritual', 'concentration', 'class']);
    expect(filterKeys('item')).toEqual(['rarity', 'kind', 'attunement']);
    expect(filterKeys('feat')).toEqual([]);
  });
});

describe('the item filters', () => {
  const cloak = {
    name: 'Cloak of Protection',
    rarity: 'uncommon',
    wondrous: true,
    reqAttune: true,
  };
  const sword = { name: 'Flame Tongue', rarity: 'rare', type: 'M', reqAttune: true };
  const potion = { name: 'Potion of Healing', rarity: 'common', type: 'P' };

  it('orders rarities as the book does, not alphabetically', () => {
    expect(optionsOf(select('item', 'rarity'), [sword, cloak, potion]).map((o) => o[1])).toEqual([
      'Common',
      'Uncommon',
      'Rare',
    ]);
  });

  it('names a wondrous item as one, and others by their type', () => {
    expect(optionsOf(select('item', 'kind'), [cloak, sword]).map((o) => o[1])).toEqual([
      'Melee weapon',
      'Wondrous item',
    ]);
  });

  it('reads attunement, true or a condition, as needing it', () => {
    expect(needsAttunement(cloak)).toBe(true);
    expect(needsAttunement({ reqAttune: 'by a wizard' })).toBe(true);
    expect(needsAttunement(potion)).toBe(false);
  });
});

describe("a row's facts", () => {
  it('gives a spell its level, school and casting notes', () => {
    expect(rowFacts('spell', detectMagic)).toEqual([
      '1st level',
      'Divination',
      'Concentration',
      'Ritual',
    ]);
    expect(rowFacts('spell', fireball)).toEqual(['3rd level', 'Evocation']);
  });

  it('gives an item its rarity, kind and attunement', () => {
    expect(rowFacts('item', { rarity: 'very rare', wondrous: true, reqAttune: true })).toEqual([
      'Very rare',
      'Wondrous item',
      'Attunement',
    ]);
    // Mundane rarity is no fact.
    expect(rowFacts('item', { rarity: 'none', type: 'P' })).toEqual(['Potion']);
  });

  it('gives a piece of equipment its kind and damage or AC', () => {
    expect(rowFacts('baseitem', { type: 'HA', ac: 18 })).toEqual(['Heavy armor', 'AC 18']);
  });

  it('has none for a section with no filters', () => {
    expect(rowFacts('feat', { name: 'Alert' })).toEqual([]);
  });
});
