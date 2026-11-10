import { describe, expect, it } from 'vitest';
import { expandedListMatcher } from './expandedSpells';

const spell = (name: string, source: string, level: number) => ({ name, source, level });
const onClassList = (className: string, uid: string) =>
  className.toLowerCase() === 'cleric' && uid === 'bless|phb';

describe('expandedListMatcher', () => {
  it('matches nothing without a list', () => {
    expect(expandedListMatcher(undefined, onClassList)(spell('Bless', 'PHB', 1))).toBeUndefined();
  });

  it('matches a named spell in any printing and any case', () => {
    const from = expandedListMatcher(
      [{ from: 'The Fiend', spells: ['burning hands|xphb', 'Command'], filters: [] }],
      onClassList,
    );
    expect(from(spell('Burning Hands', 'PHB', 1))).toBe('The Fiend');
    expect(from(spell('Command', 'XPHB', 1))).toBe('The Fiend');
    expect(from(spell('Fireball', 'PHB', 3))).toBeUndefined();
  });

  it("matches a filter's level and class list together", () => {
    const from = expandedListMatcher(
      [{ from: 'Divine Soul', spells: [], filters: ['level=1|class=Cleric'] }],
      onClassList,
    );
    expect(from(spell('Bless', 'PHB', 1))).toBe('Divine Soul');
    // On the list, at another level; and at the level, off the list.
    expect(from(spell('Bless', 'PHB', 2))).toBeUndefined();
    expect(from(spell('Shield', 'PHB', 1))).toBeUndefined();
  });

  it('matches a filter with no class by its other parts', () => {
    const from = expandedListMatcher(
      [{ from: 'Chronurgy Magic', spells: [], filters: ['source=EGW;!XGE'] }],
      onClassList,
    );
    expect(from(spell('Pulse Wave', 'EGW', 3))).toBe('Chronurgy Magic');
    expect(from(spell('Pulse Wave', 'egw', 3))).toBe('Chronurgy Magic');
    expect(from(spell('Absorb Elements', 'XGE', 1))).toBeUndefined();
  });

  it('skips a filter it cannot read rather than match everything', () => {
    const from = expandedListMatcher(
      [{ from: 'Odd', spells: [], filters: ['sparkle=yes'] }],
      onClassList,
    );
    expect(from(spell('Bless', 'PHB', 1))).toBeUndefined();
  });

  it('names the first list that adds a spell', () => {
    const from = expandedListMatcher(
      [
        { from: 'Mark of Healing', spells: ['bless'], filters: [] },
        { from: 'Divine Soul', spells: [], filters: ['level=1|class=Cleric'] },
      ],
      onClassList,
    );
    expect(from(spell('Bless', 'PHB', 1))).toBe('Mark of Healing');
  });
});
