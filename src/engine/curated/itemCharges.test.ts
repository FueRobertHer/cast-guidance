import { describe, expect, it } from 'vitest';
import { roll } from '@/dice/roll';
import itemRules from '@/rules/cast-guidance/items.json';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { type ItemCharges, readRuleSet } from '../effects/mechanics';
import { chargeCosts, itemChargesIn } from './itemCharges';

/**
 * What each item's `charges` row says, as the table the rows came from
 * (`ITEM_CHARGES`, rule pack port 5b) said it, written out so that each key's
 * numbers and spells are pinned: the sheet shows only the pool (its charges
 * and dawn roll), and what each spell costs is outside it.
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
const at1 = (...names: string[]) => names.map((spell) => ({ spell, cost: 1 }));
const robe: ItemCharges = {
  charges: 6,
  regain: '1d6',
  spells: [{ spell: 'magic missile', cost: 1, at: 5 }],
};
const wishes: ItemCharges = { charges: 3, regain: 'none', spells: at1('wish') };
const wonder: ItemCharges = { charges: 7, regain: '1d6+1', spells: [] };
const EXPECTED: Record<string, ItemCharges> = {
  'staff of healing|dmg': staff,
  'staff of healing|xdmg': staff,
  'wand of magic missiles|dmg': wand('magic missile', 9),
  'wand of magic missiles|xdmg': wand('magic missile', 3),
  'wand of fireballs|dmg': wand('fireball', 9),
  'wand of fireballs|xdmg': wand('fireball', 5),
  'wand of lightning bolts|dmg': wand('lightning bolt', 9),
  'wand of lightning bolts|xdmg': wand('lightning bolt', 5),
  // O2b: items whose charge fields misstate what their text casts.
  'charred wand of magic missiles|wdh': wand('magic missile', 9),
  'eyes of charming|xdmg': {
    charges: 3,
    regain: 'all',
    spells: [{ spell: 'charm person', cost: 1, upTo: 3 }],
  },
  'failed experiment wand|ai': {
    charges: 2,
    regain: '1d6+1',
    spells: [
      { spell: 'fireball', cost: 1, upTo: 4 },
      { spell: 'lightning bolt', cost: 1, upTo: 4 },
    ],
  },
  "tloques' berserker battleaxe|tftyp": {
    charges: 12,
    regain: '1d6+4',
    spells: [
      { spell: 'burning hands', cost: 1, upTo: 9 },
      { spell: 'gust of wind', cost: 2 },
      { spell: 'passwall', cost: 5 },
    ],
  },
  "invincible's reins|icc": {
    charges: 3,
    regain: '1d3',
    spells: [{ spell: 'find steed', cost: 1, at: 5 }],
  },
  'robe of stars|dmg': robe,
  'robe of stars|xdmg': robe,
  'staff of power|xdmg': {
    charges: 20,
    regain: '2d8+4',
    spells: [
      ...at1('magic missile', 'ray of enfeeblement'),
      { spell: 'levitate', cost: 2 },
      { spell: 'cone of cold', cost: 5 },
      { spell: 'fireball', cost: 5, at: 5 },
      { spell: 'hold monster', cost: 5 },
      { spell: 'lightning bolt', cost: 5, at: 5 },
      { spell: 'wall of force', cost: 5 },
      { spell: 'globe of invulnerability', cost: 6 },
    ],
  },
  'staff of the magi|xdmg': {
    charges: 50,
    regain: '4d6+2',
    spells: [
      ...['flaming sphere', 'invisibility', 'knock', 'web'].map((spell) => ({ spell, cost: 2 })),
      { spell: 'dispel magic', cost: 3 },
      { spell: 'ice storm', cost: 4 },
      { spell: 'wall of fire', cost: 4 },
      { spell: 'passwall', cost: 5 },
      { spell: 'telekinesis', cost: 5 },
      { spell: 'conjure elemental', cost: 7 },
      { spell: 'fireball', cost: 7, at: 7 },
      { spell: 'lightning bolt', cost: 7, at: 7 },
      { spell: 'plane shift', cost: 7 },
    ],
  },
  'ironfang|pota': { charges: 3, regain: '1d3', spells: at1('shatter') },
  'medallion of thoughts|dmg': { charges: 3, regain: '1d3', spells: at1('detect thoughts') },
  'jewel of three prayers (awakened)|crcotn': {
    charges: 5,
    regain: 'all',
    spells: at1('invisibility'),
  },
  'jewel of three prayers (exalted)|crcotn': {
    charges: 7,
    regain: 'all',
    spells: at1('invisibility'),
  },
  'ring of three wishes|dmg': wishes,
  'ring of three wishes|xdmg': wishes,
  'spirit board|xdmg': {
    charges: 3,
    regain: '1',
    spells: [
      { spell: 'augury', cost: 1 },
      { spell: 'commune', cost: 3 },
    ],
  },
  'staff of charming|dmg': {
    charges: 10,
    regain: '1d8+2',
    spells: at1('charm person', 'command', 'comprehend languages'),
  },
  'rod of seven parts|veor': {
    charges: 7,
    regain: '1d4+3',
    spells: at1(
      'arcane gate',
      'commune',
      'find the path',
      'mirage arcane',
      'regenerate',
      'reverse gravity',
      'simulacrum',
    ),
  },
  'wand of wonder|dmg': wonder,
  'wand of wonder|xdmg': wonder,
  'gnomeregan engineering device|wow': { charges: 7, regain: 'none', spells: [] },
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

  it('takes dice and numbers added, a die first, each of them one the roller rolls', () => {
    const most = '100d999 + 100d999 + 9999';
    for (const regain of ['1d6+4', 'd6 + 1d4 + 2', '2d4', '1d20+10', 'd2', most]) {
      expect(read({ regain }).rows[0]?.charges?.regain, regain).toBe(regain);
      expect(roll(regain).total, regain).toBeGreaterThan(0);
    }
  });

  it('takes a whole number away while the lowest roll gives back nothing or more', () => {
    for (const regain of ['1d4-1', '2d6 - 2', '1d6 + 3 - 4', '1d8+1d4-2']) {
      expect(read({ regain }).rows[0]?.charges?.regain, regain).toBe(regain);
      for (let i = 0; i < 50; i++) expect(roll(regain).total, regain).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads a tab between its terms, which the roller skips', () => {
    expect(read({ regain: '1d4\t+ 1' }).rows[0]?.charges?.regain).toBe('1d4\t+ 1');
    expect(roll('1d4\t+ 1').total).toBeGreaterThanOrEqual(2);
  });

  it('takes a whole number back, up to what it holds, and "all" or "none"', () => {
    expect(read({ regain: 1 }).rows[0]?.charges?.regain).toBe('1');
    expect(read({ regain: 5 }).rows[0]?.charges?.regain).toBe('5');
    expect(read({ regain: 'all' }).rows[0]?.charges?.regain).toBe('all');
    expect(read({ regain: 'none' }).rows[0]?.charges?.regain).toBe('none');
  });

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
    ['a regain that is not dice', { regain: 'half' }, '"regain" is what comes back'],
    ['no regain', { regain: undefined }, '"regain" is what comes back'],
    ['a die of no sides', { regain: '1d0' }, '"regain" is what comes back'],
    ['a die of one side', { regain: '1d1 + 2' }, '"regain" is what comes back'],
    ['no dice of a die', { regain: '0d6' }, '"regain" is what comes back'],
    ['more dice than the roller rolls', { regain: '101d6' }, '"regain" is what comes back'],
    ['dice taken away', { regain: '1d4 - 9' }, '"regain" is what comes back'],
    ['a die taken away', { regain: '1d6 - 1d4' }, '"regain" is what comes back'],
    ['a roll that can go below nothing', { regain: '1d4 - 2' }, '"regain" is what comes back'],
    ['more taken away later', { regain: '2d4 + 1 - 4' }, '"regain" is what comes back'],
    ['nothing taken away', { regain: '1d6 -' }, '"regain" is what comes back'],
    ['a gap the roller does not skip', { regain: '1d6\u00a0+ 1' }, '"regain" is what comes back'],
    ['a line between its terms', { regain: '1d6\n+ 1' }, '"regain" is what comes back'],
    ['a number in quotes', { regain: '4' }, '"regain" is what comes back'],
    ['no charges back', { regain: 0 }, '"regain" is what comes back'],
    ['more back than it holds', { regain: 6 }, '"regain" is what comes back'],
    ['a number first', { regain: '4 + 1d6' }, '"regain" is what comes back'],
    ['nothing added', { regain: '1d6 +' }, '"regain" is what comes back'],
    ['no spells field', { spells: undefined }, '"spells" lists the spells'],
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
      'an at below 1st',
      { spells: [{ spell: 'shield', cost: 1, at: 0 }] },
      'spell 1: "at" is the spell level it casts at',
    ],
    [
      'an at above 9th',
      { spells: [{ spell: 'shield', cost: 1, at: 10 }] },
      'spell 1: "at" is the spell level it casts at',
    ],
    [
      'an at beside an upTo',
      { spells: [{ spell: 'shield', cost: 1, at: 3, upTo: 5 }] },
      'spell 1: casts at one level ("at") or up to one ("upTo"), not both',
    ],
    [
      'a field a spell has not',
      { spells: [{ spell: 'shield', cost: 1, level: 1 }] },
      'spell 1: "level" is not a field a charged spell has',
    ],
    ['a DC', { dc: 15 }, '"dc" is not a field a charges row has'],
    ['an attack bonus', { attack: 7 }, '"attack" is not a field a charges row has'],
    ['a field a row has not', { level: 3 }, '"level" is not a field a charges row has'],
    ['an ability', { ability: 'wis' }, '"ability" is not a field a charges row has'],
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

  it('reads a list of none, whose charges count and cast nothing on demand', () => {
    // A Wand of Wonder's spell is the table's roll, not the holder's pick.
    const set = read({ spells: [] });
    expect(set.problems).toEqual([]);
    expect(set.rows[0]?.charges).toEqual({ charges: 5, regain: '1d4 + 1', spells: [] });
  });

  it('keeps a spell cast at one level for its cost, which costs nothing below or above it', () => {
    const set = read({ spells: [{ spell: 'Magic Missile', cost: 1, at: 5 }] });
    expect(set.problems).toEqual([]);
    const charges = set.rows[0]?.charges as ItemCharges;
    expect(charges.spells).toEqual([{ spell: 'magic missile', cost: 1, at: 5 }]);
    expect(chargeCosts(charges, 'magic missile', 1)).toEqual([{ level: 5, cost: 1 }]);
    // One fixed below the spell's own level casts nothing, nor one costing more than it holds.
    expect(chargeCosts(charges, 'magic missile', 6)).toEqual([]);
    const dear = read({ spells: [{ spell: 'fireball', cost: 5, at: 7 }] }).rows[0]?.charges;
    expect(chargeCosts({ ...(dear as ItemCharges), charges: 4 }, 'fireball', 3)).toEqual([]);
  });

  it('allows a spell whose cost at its top level is more than the item holds', () => {
    // A 2014 Wand of Magic Missiles: one charge, one more a level up to 9th, on 7 charges.
    const set = read({ charges: 7, spells: [{ spell: 'magic missile', cost: 1, upTo: 9 }] });
    expect(set.problems).toEqual([]);
    expect(chargeCosts(set.rows[0]?.charges as ItemCharges, 'magic missile', 1)).toHaveLength(7);
  });
});
