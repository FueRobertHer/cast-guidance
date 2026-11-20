import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import type { FeatureCard } from '@/engine/types';
import { changeHolding, findFeatureInfo } from './FeatureInfoSheet';

const rogue: FeatureCard = {
  name: 'Rogue',
  origin: { label: 'Rogue', uid: 'rogue|phb', type: 'class' },
  entries: [{ name: 'Sneak Attack', entries: ['Once per turn, deal extra damage.'] }],
};

describe('findFeatureInfo', () => {
  it('finds a feature by a label carrying a trailing annotation', () => {
    expect(findFeatureInfo([rogue], 'Sneak Attack (+1d6 once/turn)')?.title).toBe('Sneak Attack');
  });

  it('stays linear on a label full of "("', () => {
    // The budget is the test timeout; the old regex took about eleven seconds.
    expect(findFeatureInfo([rogue], `${'('.repeat(120_000)}x`)).toBeUndefined();
  }, 2000);
});

// ADR-002 U11: a feature card's sheet finds the change to the books whose
// text it shows by identity, and the book's text at the same place.
describe('changeHolding', () => {
  const release = new Map<string, unknown>([
    [
      'races.json',
      {
        race: [
          {
            name: 'Dwarf',
            source: 'XPHB',
            entries: [
              { type: 'entries', name: 'Toughness', entries: ['Tough.'] },
              { type: 'entries', name: 'Stonecunning', entries: ['Stone sense.'] },
            ],
          },
        ],
      },
    ],
  ]);
  const changed = (entries: unknown[]) => {
    const reg = normalizeDataset(release);
    const dwarf = reg.get('race', 'Dwarf', 'XPHB') as Entity;
    const change = { name: 'Dwarf', source: 'XPHB', entries };
    mergeHomebrew(
      reg,
      new Map([['c', { _meta: { sources: [{ json: 'MyChanges' }] }, race: [change] }]]),
      new Map(),
      new Set(['c']),
    );
    return { reg, dwarf, placed: reg.get('race', 'Dwarf', 'XPHB') as Entity };
  };

  it("finds a race's changed trait, with the book's trait beside it", () => {
    const { reg, placed } = changed([
      { type: 'entries', name: 'Toughness', entries: ['Very tough.'] },
      { type: 'entries', name: 'Stonecunning', entries: ['Stone sense.'] },
    ]);
    const card: FeatureCard = {
      name: 'Dwarf',
      origin: { label: 'Dwarf', uid: 'dwarf|xphb', type: 'race' },
      entries: placed.entries,
    };
    const trait = findFeatureInfo([card], 'Toughness');
    const found = changeHolding(reg, trait?.entries);
    expect(found?.record.placed).toBe(placed);
    expect(found?.book).toEqual(['Tough.']);
    // The whole race's card finds it too, with the book's whole text.
    expect(changeHolding(reg, placed.entries)?.book).toEqual(found?.record.base.entries);
  });

  it("gives the book's whole text for a part the change added, and nothing for text it does not hold", () => {
    const { reg, placed } = changed([
      { type: 'entries', name: 'Deep Sight', entries: ['Sees far.'] },
      { type: 'entries', name: 'Toughness', entries: ['Tough.'] },
    ]);
    const added = (placed.entries as Array<{ entries: unknown }>)[0]?.entries;
    const found = changeHolding(reg, added);
    expect(found?.book).toEqual(found?.record.base.entries);
    // Equal words in another array are not the change's: identity, not content.
    expect(changeHolding(reg, ['Sees far.'])).toBeUndefined();
    expect(changeHolding(null, added)).toBeUndefined();
  });
});
