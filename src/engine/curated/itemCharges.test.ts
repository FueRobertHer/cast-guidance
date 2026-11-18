import { describe, expect, it } from 'vitest';
import itemRules from '@/rules/cast-guidance/items.json';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { type ItemCharges, readRuleSet } from '../effects/mechanics';
import { chargeCosts, ITEM_CHARGES, itemChargesIn } from './itemCharges';

/**
 * What each item's `charges` row says, as the table the rows came from
 * (`ITEM_CHARGES`) said it, written out so that each key's numbers and spells
 * are pinned: the sheet shows only the pool (its charges and dawn roll), and
 * what each spell costs is outside it.
 */
const staff: ItemCharges = {
  charges: 10,
  regain: '1d6+4',
  spells: [
    { spell: 'cure wounds', cost: 1, upTo: 4 },
    { spell: 'lesser restoration', cost: 2 },
    { spell: 'mass cure wounds', cost: 5 },
  ],
};
const wand = (spell: string, upTo: number): ItemCharges => ({
  charges: 7,
  regain: '1d6+1',
  spells: [{ spell, cost: 1, upTo }],
});
const EXPECTED: Record<string, ItemCharges> = {
  'staff of healing|dmg': staff,
  'staff of healing|xdmg': staff,
  'wand of magic missiles|dmg': wand('magic missile', 9),
  'wand of magic missiles|xdmg': wand('magic missile', 3),
  'wand of fireballs|dmg': wand('fireball', 9),
  'wand of fireballs|xdmg': wand('fireball', 5),
  'wand of lightning bolts|dmg': wand('lightning bolt', 9),
  'wand of lightning bolts|xdmg': wand('lightning bolt', 5),
};

const refOf = (key: string) => {
  const [name = '', source = ''] = key.split('|');
  return { name, source };
};
const row = (key: string) => {
  const found = itemChargesIn(BUILT_IN_RULE_SETS, refOf(key));
  if (found === undefined) throw new Error(`no row for ${key}`);
  return found;
};

describe('the built-in charges rows', () => {
  it('cover the keys the table had, each once, and read with no problem', () => {
    const keys = itemRules.rows.filter((r) => r.part === 'charges').flatMap((r) => r.keys);
    expect([...keys].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(readRuleSet(itemRules).problems).toEqual([]);
  });

  for (const [key, expected] of Object.entries(EXPECTED)) {
    it(`say what ${key} holds, regains and casts`, () => {
      expect(row(key)).toEqual(expected);
    });
  }

  it('are found under the name and source as the entry writes them, in any case', () => {
    expect(
      itemChargesIn(BUILT_IN_RULE_SETS, { name: 'Wand of Fireballs', source: 'XDMG' }),
    ).toEqual(EXPECTED['wand of fireballs|xdmg']);
    // Starting equipment can write a ref with no source: no row is found by its name alone.
    expect(itemChargesIn(BUILT_IN_RULE_SETS, { name: 'Wand of Fireballs', source: '' })).toBe(
      undefined,
    );
  });

  it('say nothing without the rule sets', () => {
    expect(itemChargesIn([], refOf('staff of healing|xdmg'))).toBe(undefined);
  });
});

/** Every spell level a spell is cast from, and the names either side writes. */
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('the charges rows beside the table they came from', () => {
  it('say what the table said, key by key', () => {
    let compared = 0;
    for (const [key, table] of Object.entries(ITEM_CHARGES)) {
      const read = row(key);
      expect(read, key).toEqual({
        charges: table.charges,
        regain: table.regain,
        spells: table.spells.map((s) => ({
          spell: s.name,
          cost: s.cost,
          ...(s.upTo === undefined ? {} : { upTo: s.upTo }),
        })),
      });
      // What each spell either side names costs at every level it is cast from.
      const names = new Set([
        ...table.spells.map((s) => s.name),
        ...read.spells.map((s) => s.spell),
      ]);
      const asTable = {
        ...table,
        spells: table.spells.map((s) => ({ ...s, spell: s.name })),
      } as unknown as ItemCharges;
      for (const name of names) {
        for (const level of LEVELS) {
          expect(chargeCosts(read, name, level), `${key} ${name} ${level}`).toEqual(
            chargeCosts(asTable, name, level),
          );
          compared++;
        }
      }
    }
    expect(Object.keys(ITEM_CHARGES)).toHaveLength(8);
    expect(compared).toBe(8 * 9 + 2 * 2 * 9);
  });
});

describe('chargeCosts', () => {
  it('costs a Staff of Healing one charge a level of Cure Wounds, up to 4th', () => {
    expect(chargeCosts(row('staff of healing|xdmg'), 'Cure Wounds', 1)).toEqual([
      { level: 1, cost: 1 },
      { level: 2, cost: 2 },
      { level: 3, cost: 3 },
      { level: 4, cost: 4 },
    ]);
  });

  it('costs its other spells one fixed price, at their own level', () => {
    expect(chargeCosts(row('staff of healing|dmg'), 'lesser restoration', 2)).toEqual([
      { level: 2, cost: 2 },
    ]);
    expect(chargeCosts(row('staff of healing|dmg'), 'Mass Cure Wounds', 5)).toEqual([
      { level: 5, cost: 5 },
    ]);
  });

  it('casts nothing it does not hold', () => {
    expect(chargeCosts(row('staff of healing|dmg'), 'Fireball', 3)).toEqual([]);
  });

  it('lets a 2014 wand spend charges as far as they go, and a 2024 one three at most', () => {
    expect(chargeCosts(row('wand of fireballs|dmg'), 'Fireball', 3).map((c) => c.level)).toEqual([
      3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(chargeCosts(row('wand of fireballs|xdmg'), 'Fireball', 3)).toEqual([
      { level: 3, cost: 1 },
      { level: 4, cost: 2 },
      { level: 5, cost: 3 },
    ]);
    expect(chargeCosts(row('wand of magic missiles|dmg'), 'magic missile', 1)).toHaveLength(7);
    expect(chargeCosts(row('wand of magic missiles|xdmg'), 'magic missile', 1)).toHaveLength(3);
  });
});

describe('a charges row, read', () => {
  const read = (fields: Record<string, unknown>, more: Record<string, unknown>[] = []) =>
    readRuleSet({
      type: RULE_SET_TYPE,
      v: 1,
      name: 'Test rules',
      rows: [
        { part: 'charges', keys: ['rod of tests|tst'], ...good, ...fields },
        ...more.map((f) => ({ part: 'charges', keys: ['rod of tests|tst'], ...good, ...f })),
      ],
    });
  const good = {
    charges: 5,
    regain: '1d4 + 1',
    spells: [{ spell: 'Shield', cost: 1 }],
  };

  it('keeps its numbers, its dice trimmed and its spells by name in lower case', () => {
    const set = read({ regain: ' 1d4 + 1 ', spells: [{ spell: ' Shield ', cost: 2, upTo: 3 }] });
    expect(set.problems).toEqual([]);
    expect(set.rows[0]?.charges).toEqual({
      charges: 5,
      regain: '1d4 + 1',
      spells: [{ spell: 'shield', cost: 2, upTo: 3 }],
    });
    expect(set.rows[0]?.effects).toEqual([]);
  });

  it.each([
    ['no charges', { charges: undefined }, '"charges" is how many it holds'],
    ['no charges at all', { charges: 0 }, '"charges" is how many it holds'],
    ['too many charges', { charges: 100 }, '"charges" is how many it holds'],
    ['part of a charge', { charges: 2.5 }, '"charges" is how many it holds'],
    ['a regain that is not dice', { regain: 'half' }, '"regain" is the dice'],
    ['no regain', { regain: undefined }, '"regain" is the dice'],
    ['no spells', { spells: [] }, '"spells" lists the spells'],
    ['spells that are not a list', { spells: 'shield' }, '"spells" lists the spells'],
    ['a spell that is not one', { spells: ['shield'] }, 'spell 1: is not a spell'],
    ['a spell with no name', { spells: [{ cost: 1 }] }, 'spell 1: "spell" is the spell\'s name'],
    [
      'a spell named twice, in any case',
      {
        spells: [
          { spell: 'Shield', cost: 1 },
          { spell: 'shield', cost: 2 },
        ],
      },
      'spell 2: "shield" is named twice',
    ],
    ['a cost of nothing', { spells: [{ spell: 'shield', cost: 0 }] }, 'spell 1: "cost" is'],
    ['a cost above its charges', { spells: [{ spell: 'shield', cost: 6 }] }, 'spell 1: "cost" is'],
    ['no cost', { spells: [{ spell: 'shield' }] }, 'spell 1: "cost" is'],
    [
      'an upTo below 1st',
      { spells: [{ spell: 'shield', cost: 1, upTo: 0 }] },
      'spell 1: "upTo" is a spell level',
    ],
    [
      'an upTo above 9th',
      { spells: [{ spell: 'shield', cost: 1, upTo: 10 }] },
      'spell 1: "upTo" is a spell level',
    ],
    [
      'a field a spell has not',
      { spells: [{ spell: 'shield', cost: 1, level: 1 }] },
      'spell 1: "level" is not a field a charged spell has',
    ],
    ['a field a row has not', { level: 3 }, '"level" is not a field a charges row has'],
    ['effects', { effects: [] }, '"effects" is not a field a charges row has'],
  ])('leaves out a row with %s, and its keys stay free', (_, fields, problem) => {
    const set = read(fields, [{ charges: 3 }]);
    expect(set.problems.join('; ')).toContain(problem);
    expect(set.rows).toHaveLength(1);
    expect(set.rows[0]?.charges?.charges).toBe(3);
  });

  it('leaves out a row whose one bad spell sits beside good ones', () => {
    const set = read({
      spells: [
        { spell: 'shield', cost: 1 },
        { spell: 'misty step', cost: 0 },
      ],
    });
    expect(set.rows).toEqual([]);
  });

  it('allows a spell whose cost at its top level is more than the item holds', () => {
    // A 2014 Wand of Magic Missiles: one charge, one more a level up to 9th, on 7 charges.
    const set = read({ charges: 7, spells: [{ spell: 'magic missile', cost: 1, upTo: 9 }] });
    expect(set.problems).toEqual([]);
    expect(chargeCosts(set.rows[0]?.charges as ItemCharges, 'magic missile', 1)).toHaveLength(7);
  });
});
