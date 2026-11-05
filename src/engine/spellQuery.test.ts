import { describe, expect, it } from 'vitest';
import { describeSpellQuery, parseSpellFilter, spellFitsQuery } from './spellQuery';
import type { SpellQuery } from './types';

const query = (over: Partial<SpellQuery>): SpellQuery => ({
  levels: [],
  classes: [],
  schools: [],
  ritual: false,
  attacks: [],
  ...over,
});

describe('parseSpellFilter', () => {
  it('reads every part the data writes', () => {
    expect(parseSpellFilter('level=1;2|class=Bard;cleric|school=e;D|spell attack=M;r')).toEqual({
      levels: [1, 2],
      classes: ['Bard', 'cleric'],
      schools: ['E', 'D'],
      ritual: false,
      attacks: ['m', 'r'],
    });
    expect(parseSpellFilter('level=1|components & miscellaneous=ritual')?.ritual).toBe(true);
  });

  it.each([
    ['a key it does not know', 'level=1|sparkle=yes'],
    ['a level that is not a number', 'level=low'],
    ['a miscellaneous tag other than ritual', 'components & miscellaneous=concentration'],
    ['a part with no value', 'level='],
    ['nothing at all', ''],
  ])('gives up on %s, rather than offer spells the data rules out', (_what, filter) => {
    expect(parseSpellFilter(filter)).toBeUndefined();
  });
});

describe('spellFitsQuery', () => {
  const spell = {
    name: 'Fake',
    source: 'HB',
    level: 1,
    school: 'E',
    meta: { ritual: true },
    spellAttack: ['R'],
  };

  it('holds a spell to every part of the query', () => {
    const all = query({ levels: [1], schools: ['E', 'D'], ritual: true, attacks: ['m', 'r'] });
    expect(spellFitsQuery(spell, all)).toBe(true);
  });

  it.each<[string, Partial<SpellQuery>]>([
    ['level', { levels: [0, 2] }],
    ['school', { schools: ['N'] }],
    ['attack', { attacks: ['m'] }],
  ])('fails on %s', (_part, over) => {
    expect(spellFitsQuery(spell, query(over))).toBe(false);
  });

  it('fails a ritual query for a spell that is no ritual', () => {
    expect(spellFitsQuery({ ...spell, meta: {} }, query({ ritual: true }))).toBe(false);
    expect(spellFitsQuery({ name: 'Plain', source: 'HB' }, query({ ritual: true }))).toBe(false);
  });

  it('fails an attack query for a spell with no attack', () => {
    expect(spellFitsQuery({ name: 'Plain', source: 'HB' }, query({ attacks: ['r'] }))).toBe(false);
  });

  it('leaves the class lists to the caller, since a spell does not carry them', () => {
    expect(spellFitsQuery(spell, query({ classes: ['Nobody'] }))).toBe(true);
  });
});

describe('describeSpellQuery', () => {
  it.each<[string, string, number]>([
    ['Wizard cantrip', 'level=0|class=Wizard', 1],
    ['Wizard cantrips', 'level=0|class=wizard', 2],
    ['Level 1 Cleric spell', 'level=1|class=Cleric', 1],
    ['Level 2 to 4 spell', 'level=2;3;4', 1],
    ['Cantrip or level 1 spell', 'level=0;1', 1],
    ['Cantrip or level 2 spell', 'level=0;2', 1],
    ['Cantrip or level 1 or 3 spell', 'level=0;1;3', 1],
    ['Level 1 spell', 'level=1;1', 1],
    ['Cantrip', 'level=0;0', 1],
    ['Cantrip or level 1 to 3 Cleric or Wizard spell', 'level=0;1;2;3|class=Cleric;Wizard', 1],
    ['Level 1 Enchantment or Divination spell', 'level=1|school=E;D', 1],
    ['Level 1 Bard ritual spells', 'level=1|class=Bard|components & miscellaneous=ritual', 2],
    ['Level 1 ritual spells', 'level=1|components & miscellaneous=ritual', 2],
    ['Bard attack cantrip', 'level=0|class=Bard|spell attack=m;r;o', 1],
    ['Level 1 to 7 Abjuration spell', 'level=1;2;3;4;5;6;7|school=A', 1],
    ['Level 1 or 3 spell', 'level=1;3', 1],
    ['Cleric or Wizard Necromancy cantrip', 'level=0|class=Cleric;Wizard|school=N', 1],
    ['Spell', 'class=', 1],
  ])('says %s', (expected, filter, count) => {
    const parsed = parseSpellFilter(filter) ?? query({});
    expect(describeSpellQuery(parsed, count)).toBe(expected);
  });
});
