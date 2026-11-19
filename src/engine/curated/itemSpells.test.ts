// What an item casts (O2b): the spells its charge fields cast (`fieldChargeSpells`),
// what it casts without them (`attachedInnate`, an `itemSpells` row), the DC
// its text fixes (an `itemDc` row, a `charges` effect's), and the numbers a
// derive gives each grant where nothing fixes them.
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS, makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE, RULE_SET_LIMITS, RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { attachedInnate } from '../effects/item';
import { readRuleSet } from '../effects/mechanics';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { fieldChargeSpells, itemChargesOf, itemDcIn } from './itemCharges';

const item = (name: string, source: string, more: Record<string, unknown> = {}): DataEntity => ({
  name,
  source,
  type: 'WD',
  rarity: 'rare',
  ...more,
});

/** The test world, with these items and packs, and the rule sets the app ships. */
function world(items: DataEntity[], packs: DataEntity[] = [], feats?: DataEntity[]): EngineContext {
  const base = makeTestContext();
  const of: Record<string, readonly DataEntity[]> = {
    item: items,
    ...(feats === undefined ? {} : { feat: feats }),
    [RULE_SET_TYPE]: BUILT_IN_RULE_SETS,
    [RULE_PACK_TYPE]: packs,
  };
  return {
    get: (type, name, source) =>
      type in of
        ? of[type]?.find(
            (e) =>
              String(e.name).toLowerCase() === name.toLowerCase() &&
              (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
          )
        : base.get(type, name, source),
    byType: (type) => of[type] ?? base.byType(type),
  };
}

function carrying(doc: CharacterDoc, ...refs: Array<{ name: string; source: string }>) {
  doc.equipment = refs.map((ref, i) => ({
    id: `e${i + 1}`,
    ref,
    qty: 1,
    equipped: true,
    attuned: true,
  }));
  return doc;
}
const nobody = () => newCharacterDoc('hero', 'Hero', 't');
/** A Mage 3 with Intelligence 16: spell save DC 13, attack +5. */
function mage(): CharacterDoc {
  const doc = newCharacterDoc('m1', 'Wizzo', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 };
  doc.classes = [{ ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  doc.choices = { 'class:mage|tst:skill:0': ['Arcana'] };
  return doc;
}

/** Each grant as name, usage and the numbers it casts with. */
const grants = (doc: CharacterDoc, ctx: EngineContext) =>
  deriveSheet(doc, ctx).grantedSpells.map((g) => ({
    name: g.name,
    usage: g.usage,
    ...(g.dc === undefined ? {} : { dc: g.dc }),
    ...(g.attack === undefined ? {} : { attack: g.attack }),
    ...(g.mod === undefined ? {} : { mod: g.mod }),
  }));

const readRows = (rows: Record<string, unknown>[]) =>
  readRuleSet({ type: RULE_SET_TYPE, v: 1, name: 'Test rules', rows });

describe('an itemDc row, read', () => {
  const row = (fields: Record<string, unknown>) => ({
    part: 'itemDc',
    keys: ['rod|tst'],
    ...fields,
  });

  it('takes a DC, an attack bonus, or both', () => {
    expect(readRows([row({ dc: 15 })]).rows[0]?.itemDc).toEqual({ dc: 15 });
    expect(readRows([row({ attack: 0 })]).rows[0]?.itemDc).toEqual({ attack: 0 });
    const both = readRows([row({ dc: 30, attack: 20 })]);
    expect(both.problems).toEqual([]);
    expect(both.rows[0]?.itemDc).toEqual({ dc: 30, attack: 20 });
  });

  it.each([
    ['neither', {}, 'says a "dc", an "attack", or both'],
    ['a DC of nothing', { dc: 0 }, '"dc" is the save DC its spells cast with, 1 to 30'],
    ['a DC too high', { dc: 31 }, '"dc" is the save DC'],
    ['part of a DC', { dc: 14.5 }, '"dc" is the save DC'],
    ['a DC in words', { dc: '15' }, '"dc" is the save DC'],
    ['an attack below nothing', { dc: 15, attack: -1 }, '"attack" is the spell attack bonus'],
    [
      'an attack too high',
      { attack: 21 },
      '"attack" is the spell attack bonus its spells cast with, 0 to 20',
    ],
    ['an ability', { dc: 15, ability: 'wis' }, '"ability" is not a field'],
  ])('leaves out a row with %s, and its keys stay free', (_, fields, problem) => {
    const set = readRows([row(fields), row({ dc: 12 })]);
    expect(set.problems.join('; ')).toContain(problem);
    expect(set.rows.map((r) => r.itemDc)).toEqual([{ dc: 12 }]);
  });

  it("is found under the entry's name and source, in any case", () => {
    const sets = [{ type: RULE_SET_TYPE, v: 1, name: 'T', rows: [row({ dc: 15 })] }];
    expect(itemDcIn(sets, { name: 'Rod', source: 'TST' })).toEqual({ dc: 15 });
    expect(itemDcIn(sets, { name: 'Rod', source: '' })).toBe(undefined);
  });
});

describe('an itemSpells row, read', () => {
  const row = (spells: unknown) => ({ part: 'itemSpells', keys: ['rod|tst'], spells });

  it('takes will, daily and rest lists as the data writes them, and none as {}', () => {
    const lists = {
      will: ['light'],
      daily: { '1': ['fly', 'levitate'], '2e': ['shield'] },
      rest: { '1e': ['misty step|xphb'] },
    };
    const set = readRows([row(lists)]);
    expect(set.problems).toEqual([]);
    expect(set.rows[0]?.itemSpells).toEqual(lists);
    expect(readRows([row({})]).rows[0]?.itemSpells).toEqual({});
  });

  it.each([
    ['no lists', undefined, '"spells" is what it casts without charges'],
    ['a list', ['light'], '"spells" is what it casts without charges'],
    [
      'a list the sheet does not count',
      { limited: { '1': ['fly'] } },
      '"limited" is not a list it casts from',
    ],
    ['an empty will', { will: [] }, '"will" lists 1 to 20 spells'],
    ['a name that is not one', { will: ['light', 3] }, '"will" lists 1 to 20 spells'],
    ['a blank name', { will: [' '] }, '"will" lists 1 to 20 spells'],
    ['no counts', { daily: {} }, '"daily" gives each count of casts'],
    ['a count that is not one', { daily: { x: ['fly'] } }, '"daily": "x" is a count of casts'],
    ['a count of none', { rest: { '0': ['fly'] } }, '"rest": "0" is a count of casts'],
    ['an empty count', { daily: { '1': [] } }, '"daily.1" lists 1 to 20 spells'],
    [
      'too many',
      { will: Array.from({ length: RULE_SET_LIMITS.chargeSpells + 1 }, (_, i) => `s${i}`) },
      '"will" lists 1 to 20 spells',
    ],
  ])('leaves out a row with %s, and its keys stay free', (_, spells, problem) => {
    const set = readRows([row(spells), row({ will: ['light'] })]);
    expect(set.problems.join('; ')).toContain(problem);
    expect(set.rows.map((r) => r.itemSpells)).toEqual([{ will: ['light'] }]);
  });
});

describe('the built-in itemDc and itemSpells rows', () => {
  const sets = BUILT_IN_RULE_SETS;
  it("say the DC an item fixes, and none where the text uses the holder's", () => {
    expect(itemDcIn(sets, { name: 'True-Ice Shards (Dagger)', source: 'CoA' })).toEqual({ dc: 20 });
    expect(itemDcIn(sets, { name: 'Staff of the Magi', source: 'XDMG' })).toBe(undefined);
    // "14 or your spell save DC, whichever is higher": the holder's numbers read it better.
    expect(itemDcIn(sets, { name: 'The Infernal Machine of Lum the Mad', source: 'IMR' })).toBe(
      undefined,
    );
  });
});

describe('fieldChargeSpells: the spells its charge fields cast', () => {
  it('reads each cost, its book in lower case, and #N as the one level it casts at', () => {
    const attached = {
      charges: {
        '0': ['light'],
        '1': ['Magic Missile|XPHB#5', 'shield'],
        '7': ['fireball#7'],
      },
    };
    expect(fieldChargeSpells(attached, 50)).toEqual([
      { spell: 'magic missile', cost: 1, at: 5, ref: { name: 'magic missile', source: 'xphb' } },
      { spell: 'shield', cost: 1, ref: { name: 'shield', source: '' } },
      { spell: 'fireball', cost: 7, at: 7, ref: { name: 'fireball', source: '' } },
    ]);
  });

  it('leaves out alone each spell it cannot cast, and keeps the rest', () => {
    const attached = {
      charges: {
        '0': ['light'],
        '1.5': ['fly'],
        x: ['haste'],
        '2': ['web', 4, '', 'Web|XPHB'],
        '9': ['wish'],
        '3': 'fireball',
      },
    };
    // Cost 0 is at will (`attachedInnate`); a cost above the item's charges, never.
    expect(fieldChargeSpells(attached, 5).map((s) => [s.spell, s.cost])).toEqual([['web', 2]]);
    expect(fieldChargeSpells({ will: ['light'] }, 5)).toEqual([]);
    expect(fieldChargeSpells(undefined, 5)).toEqual([]);
  });

  it('takes no more than a charges row lists', () => {
    const names = Array.from({ length: 25 }, (_, i) => `spell ${i}`);
    expect(fieldChargeSpells({ charges: { '1': names } }, 5)).toHaveLength(
      RULE_SET_LIMITS.chargeSpells,
    );
  });

  it("are the item's charges' spells where nothing else says them", () => {
    const rod = item('Rod', 'TST', {
      charges: 5,
      recharge: 'dawn',
      rechargeAmount: '{@dice 1d4+1}',
      attachedSpells: { charges: { '1': ['shield|xphb'], '2': ['web|xphb'] } },
    });
    expect(itemChargesOf(world([rod]), 'hero', { name: 'Rod', source: 'TST' })).toEqual({
      charges: 5,
      regain: '1d4+1',
      spells: [
        { spell: 'shield', cost: 1, ref: { name: 'shield', source: 'xphb' } },
        { spell: 'web', cost: 2, ref: { name: 'web', source: 'xphb' } },
      ],
    });
  });
});

describe('attachedInnate: what an item casts without its charges', () => {
  it('casts at will, a number a day and a number a short rest, and its free charge spells at will', () => {
    expect(
      attachedInnate({
        ability: 'wis',
        will: ['light'],
        daily: { '1e': ['fly'] },
        rest: { '1': ['shield'] },
        charges: { '0': ['mage hand'], '1': ['web'] },
        limited: { '1': ['wish'] },
        other: ['haste'],
        ritual: ['alarm'],
      }),
    ).toEqual({
      ability: 'wis',
      innate: {
        _: { will: ['light', 'mage hand'], daily: { '1e': ['fly'] }, rest: { '1': ['shield'] } },
      },
    });
  });

  it('casts none from lists whose uses the sheet does not count, and names no ability it does not know', () => {
    expect(attachedInnate({ limited: { '1': ['wish'] }, ritual: ['alarm'] })).toBe(undefined);
    expect(attachedInnate(['light'])).toBe(undefined);
    expect(attachedInnate({ ability: 'luck', will: ['light'] })).toEqual({
      innate: { _: { will: ['light'] } },
    });
  });
});

describe('the spells an item grants without its charges', () => {
  const ring = item('Ring of Lights', 'TST', {
    reqAttune: true,
    attachedSpells: { will: ['light'], daily: { '1e': ['fly'] }, limited: { '1': ['wish'] } },
  });
  const RING = { name: 'Ring of Lights', source: 'TST' };

  it('grants its lists the sheet counts, while its magic works', () => {
    const doc = carrying(nobody(), RING);
    expect(grants(doc, world([ring])).map((g) => [g.name, g.usage])).toEqual([
      ['light', undefined],
      ['fly', '1/day'],
    ]);
    doc.equipment = doc.equipment.map((e) => ({ ...e, attuned: false }));
    expect(grants(doc, world([ring]))).toEqual([]);
  });

  it("grants a built-in row's lists in place of its data's, and none for {}", () => {
    // The data's one a day each; the text's one a day between them.
    const icon = item('Icon of Ravenloft', 'CoS', {
      attachedSpells: { daily: { '1': ['augury', 'bane'] } },
    });
    const doc = carrying(nobody(), { name: 'Icon of Ravenloft', source: 'CoS' });
    expect(grants(doc, world([icon])).map((g) => [g.name, g.usage])).toEqual([['augury', '1/day']]);
    // The 2024 Staff of Healing's Cure Wounds is no cantrip: its charges cast it.
    const staff = item('Staff of Healing', 'XDMG', {
      attachedSpells: { charges: { '0': ['cure wounds|xphb'] } },
    });
    const held = carrying(nobody(), { name: 'Staff of Healing', source: 'XDMG' });
    expect(
      grants(held, world([staff]))
        .filter((g) => g.usage !== 'charges')
        .map((g) => g.name),
    ).toEqual([]);
  });

  it("grants none once a pack's patch replaces what it inherits", () => {
    const pack: DataEntity = {
      name: 'Plain',
      source: 'Plain',
      appliesTo: { characters: ['hero'] },
      castGuidance: { v: 1, patches: [{ target: 'Ring of Lights|TST', effects: [] }] },
    };
    expect(grants(carrying(nobody(), RING), world([ring], [pack]))).toEqual([]);
  });
});

describe('the numbers an item grant casts with', () => {
  const orb = (more: Record<string, unknown> = {}) =>
    item('Orb', 'TST', { attachedSpells: { will: ['light'], ...more } });
  const ORB = { name: 'Orb', source: 'TST' };

  it("are the character's own spellcasting where the item names no ability", () => {
    expect(grants(carrying(mage(), ORB), world([orb()]))).toEqual([
      { name: 'light', dc: 13, attack: 5, mod: 3 },
    ]);
  });

  it('are 8 + proficiency, and proficiency, with no spellcasting', () => {
    const doc = carrying(nobody(), ORB);
    const prof = deriveSheet(doc, world([orb()])).profBonus.value;
    expect(grants(doc, world([orb()]))).toEqual([
      { name: 'light', dc: 8 + prof, attack: prof, mod: 0 },
    ]);
  });

  it('are by the ability an item names, which the sheet works out', () => {
    expect(grants(carrying(mage(), ORB), world([orb({ ability: 'wis' })]))).toEqual([
      { name: 'light' },
    ]);
  });

  it('are the DC its text fixes, from its itemDc row, for every spell it grants', () => {
    const shards = item('True-Ice Shards (Dagger)', 'CoA', {
      attachedSpells: { will: ['detect thoughts'], daily: { '1e': ['scrying'] } },
    });
    const doc = carrying(mage(), { name: 'True-Ice Shards (Dagger)', source: 'CoA' });
    const all = grants(doc, world([shards]));
    expect(all.map((g) => g.dc)).toEqual([20, 20, 20, 20, 20, 20]);
    expect(all.every((g) => g.attack === 5 && g.mod === 3)).toBe(true);
  });

  it("are its own charges effect's, for its charges' spells and its other grants", () => {
    const rod = item('Rod', 'HB', {
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'charges',
            charges: 5,
            regain: 'all',
            dc: 15,
            attack: 7,
            spells: [{ spell: 'Web|XPHB', cost: 2 }],
          },
        ],
      },
      additionalSpells: [{ innate: { _: { daily: { '1': ['shield|xphb'] } } } }],
    });
    const doc = carrying(mage(), { name: 'Rod', source: 'HB' });
    expect(grants(doc, world([rod]))).toEqual([
      { name: 'Web', usage: 'charges', dc: 15, attack: 7, mod: 3 }, // As its effect names it.
      { name: 'shield', usage: '1/day', dc: 15, attack: 7, mod: 3 },
    ]);
  });

  it("are an item's alone: another grant with no ability casts with none", () => {
    const gift: DataEntity = {
      name: 'Spark Gift',
      source: 'TST',
      additionalSpells: [{ innate: { _: { daily: { '1': ['light'] } } } }],
      entries: ['A spark.'],
    };
    const doc = mage();
    doc.feats = [{ ref: { name: 'Spark Gift', source: 'TST' }, instanceId: 'f1' }];
    expect(grants(doc, world([], [], [gift]))).toEqual([{ name: 'light', usage: '1/day' }]);
  });

  it('keep a row each for two items whose numbers differ, and one for two alike', () => {
    const other = item('Other Orb', 'TST', { attachedSpells: { will: ['light'] } });
    const fixed: DataEntity = {
      type: RULE_SET_TYPE,
      v: 1,
      name: 'Fixed',
      rows: [{ part: 'itemDc', keys: ['other orb|tst'], dc: 18 }],
    };
    const ctx = world([orb(), other]);
    const sets = {
      ...ctx,
      byType: (t: string) => (t === RULE_SET_TYPE ? [...BUILT_IN_RULE_SETS, fixed] : ctx.byType(t)),
    };
    const doc = carrying(mage(), ORB, { name: 'Other Orb', source: 'TST' });
    expect(grants(doc, sets).map((g) => g.dc)).toEqual([13, 18]);
    expect(grants(doc, ctx).map((g) => g.dc)).toEqual([13]);
  });
});
