// How a spell row casts (`castPlan`): which rows cast through the prompt, the
// items whose charges each row offers, and the dice a spell rolls at a level.
import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { type DataEntity, type DerivedSheet, newCharacterDoc } from '@/engine/types';
import { ruleSetLookup } from '../../../tests-fixtures/testWorld';
import {
  castDamageBonuses,
  castDiceAt,
  castNow,
  castRowId,
  castsByPrompt,
  castWaysOf,
  grantBadgeTitle,
  grantCast,
  grantLimitWords,
  grantNumbersKey,
  grantRowKey,
  grantUsedUp,
  grantUseWays,
  itemChargeWays,
  type SpellCast,
  usedUpTitle,
} from './castPlan';

const STAFF = { name: 'Staff of Healing', source: 'XDMG' };

/** A character carrying two Staffs of Healing, both working. */
function twoStaves() {
  const doc = newCharacterDoc('c1', 'Vela', 't');
  doc.equipment = [
    { id: 'a', ref: STAFF, qty: 1, equipped: true, attuned: true },
    { id: 'b', ref: STAFF, qty: 1, equipped: true, attuned: true },
  ];
  const pool = (id: string) => ({
    key: `item-charges:${id}`,
    label: 'Staff of Healing charges',
    max: 10,
    resetOn: 'long' as const,
    origin: 'Staff of Healing',
    regainRoll: '1d6+4',
  });
  const sheet = { totalLevel: 5, resources: [pool('a'), pool('b')] } as unknown as DerivedSheet;
  return { doc, sheet };
}

describe('the items whose charges cast a spell', () => {
  it('numbers two of one item, so each tile says which it spends', () => {
    const { doc, sheet } = twoStaves();
    const ways = itemChargeWays(doc, sheet, 'Cure Wounds', 1, ruleSetLookup());
    expect(ways.map((w) => [w.key, w.label])).toEqual([
      ['item-charges:a', 'Staff of Healing 1'],
      ['item-charges:b', 'Staff of Healing 2'],
    ]);
  });

  it('casts an at-will grant at once, leaving the charges to the class row', () => {
    const { doc, sheet } = twoStaves();
    const atWill = {
      doc,
      sheet,
      info: { name: 'Cure Wounds', source: 'XPHB' },
      entity: undefined,
      level: 1,
      attack: false,
    } as unknown as SpellCast;
    expect(itemChargeWays(doc, sheet, 'Cure Wounds', 1, ruleSetLookup())).toHaveLength(2);
    expect(castsByPrompt(atWill)).toBe(false);
  });

  it("prices each level from the staff's row, and offers nothing without the rule sets", () => {
    const { doc, sheet } = twoStaves();
    const [first] = itemChargeWays(doc, sheet, 'Cure Wounds', 1, ruleSetLookup());
    expect(first?.costs).toEqual([
      { level: 1, cost: 1 },
      { level: 2, cost: 2 },
      { level: 3, cost: 3 },
      { level: 4, cost: 4 },
    ]);
    expect(itemChargeWays(doc, sheet, 'Cure Wounds', 1, ruleSetLookup([]))).toEqual([]);
  });

  it("finds the row under the entry's ref, as the pool's derive does", () => {
    const { doc, sheet } = twoStaves();
    doc.equipment = doc.equipment.map((e) => ({ ...e, ref: { name: STAFF.name, source: '' } }));
    expect(itemChargeWays(doc, sheet, 'Cure Wounds', 1, ruleSetLookup())).toEqual([]);
  });
});

describe("a grant paid in an item's own charges", () => {
  const rod: DataEntity = {
    name: 'Rod of Sparks',
    source: 'HB',
    castGuidance: {
      v: 1,
      effects: [
        {
          kind: 'charges',
          charges: 7,
          regain: 'all',
          spells: [
            { spell: 'Spark Flick|TST', cost: 2 },
            { spell: 'Cure Wounds|TST', cost: 1, upTo: 3 },
          ],
        },
      ],
    },
  };
  const entities = {
    get: (type: string, name: string) =>
      type === 'item' && name.toLowerCase() === 'rod of sparks' ? rod : undefined,
    byType: () => [],
  };
  function holding(used: number) {
    const doc = newCharacterDoc('c1', 'Vela', 't');
    doc.equipment = [
      {
        id: 'r1',
        ref: { name: 'Rod of Sparks', source: 'HB' },
        qty: 1,
        equipped: true,
        attuned: true,
      },
    ];
    doc.play.resources = used > 0 ? [{ key: 'item-charges:r1', used }] : [];
    const pool = {
      key: 'item-charges:r1',
      label: 'Rod of Sparks charges',
      max: 7,
      resetOn: 'long' as const,
      origin: 'Rod of Sparks',
    };
    const sheet = {
      totalLevel: 5,
      resources: [pool],
      grantedSpells: [],
      spellDamageBonuses: [],
    } as unknown as DerivedSheet;
    const cast = (name: string, level: number) =>
      ({
        doc,
        sheet,
        update: (recipe: (d: typeof doc) => void) => recipe(doc),
        hp: { maxHp: 100, edition: '2024' },
        info: { name, source: 'TST' },
        entity: undefined,
        level,
        grantPool: { key: pool.key, label: 'Rod of Sparks', max: 7 },
        attack: false,
        entities,
      }) as unknown as SpellCast;
    return { doc, cast };
  }

  it('prices a leveled spell from that copy by level, and offers no use of it', () => {
    const { cast } = holding(5);
    const cure = cast('Cure Wounds', 1);
    expect(
      castWaysOf(cure).flatMap((w) =>
        w.tiles.map((t) => [t.resource.kind, t.resource.level, t.ok]),
      ),
    ).toEqual([
      ['charges', 1, true],
      ['charges', 2, true],
      ['charges', 3, false],
    ]);
    expect(grantUsedUp(cure, 2)).toBe(false);
  });

  it('casts a cantrip at once for what it costs, and not with too few left', () => {
    const { doc, cast } = holding(0);
    const flick = cast('Spark Flick', 0);
    expect(castsByPrompt(flick)).toBe(false);
    expect(grantUsedUp(flick, 7)).toBe(false);
    castNow(flick);
    expect(doc.play.resources).toEqual([{ key: 'item-charges:r1', used: 2 }]);
    expect(grantUsedUp(flick, 2)).toBe(false);
    expect(grantUsedUp(flick, 1)).toBe(true);
    // Its cast button says why it is off: charges, not a rest.
    expect(usedUpTitle(flick)).toBe('Not enough charges left');
    const daily = { ...flick, grantPool: { key: 'fey-step', label: 'Fey Step', max: 1 } };
    expect(usedUpTitle(daily as SpellCast)).toBe('No uses left until you rest');
  });

  it('is used up when the item no longer casts the spell', () => {
    const { cast } = holding(0);
    expect(grantUsedUp(cast('Light', 0), 7)).toBe(true);
  });

  it("offers its charges on another grant's row only while the item casts with the character's numbers", () => {
    const { cast } = holding(0);
    // A daily Cure Wounds of a feat's, beside the rod's.
    const daily = {
      ...cast('Cure Wounds', 1),
      grantPool: { key: 'spark', label: 'Spark', max: 1 },
    };
    const kinds = (c: SpellCast) => castWaysOf(c).map((w) => w.tiles[0]?.resource.kind);
    expect(kinds(daily)).toEqual(['uses', 'charges']);
    // A rod whose text fixes its DC casts with it on its own row, and on no other.
    const effects = rod.castGuidance as { effects: Array<Record<string, unknown>> };
    const fixed = { ...rod, castGuidance: { v: 1, effects: [{ ...effects.effects[0], dc: 15 }] } };
    const lookup = { ...entities, get: (type: string) => (type === 'item' ? fixed : undefined) };
    expect(kinds({ ...daily, entities: lookup } as SpellCast)).toEqual(['uses']);
    expect(kinds({ ...cast('Cure Wounds', 1), entities: lookup } as SpellCast)).toEqual([
      'charges',
    ]);
  });

  it('says its count in charges, and a daily use per day', () => {
    expect(grantLimitWords('charges')).toBe('charges');
    expect(grantLimitWords('1/day')).toBe('per day');
    expect(grantLimitWords('2/rest')).toBe('per rest');
    expect(grantBadgeTitle('charges', 'Rod of Sparks', false)).toBe('charges from Rod of Sparks');
    expect(grantBadgeTitle('charges', 'Rod of Sparks', true)).toBe('No charges left');
    expect(grantBadgeTitle('1/day', 'Fey Step', true)).toBe('No uses left until you rest');
  });
});

describe('grantCast: what a granted spell casts with', () => {
  const sheet = {
    abilities: { wis: { mod: 3 }, cha: { mod: -1 } },
    profBonus: { value: 2 },
  } as unknown as DerivedSheet;
  const grant = (more: Partial<DerivedSheet['grantedSpells'][number]>) =>
    ({
      name: 'Light',
      source: 'XPHB',
      origin: 'Orb',
      ...more,
    }) as DerivedSheet['grantedSpells'][number];

  it('works its numbers out from the ability it names', () => {
    expect(grantCast(grant({ ability: 'wis' }), sheet)).toEqual({ dc: 13, attack: 5, mod: 3 });
    expect(grantCast(grant({ ability: 'cha' }), sheet)).toEqual({ dc: 9, attack: 1, mod: -1 });
  });

  it("takes an item's, what its text fixes beside its ability", () => {
    expect(grantCast(grant({ ability: 'wis', dc: 17 }), sheet)).toEqual({
      dc: 17,
      attack: 5,
      mod: 3,
    });
    expect(grantCast(grant({ dc: 13, attack: 5, mod: 3 }), sheet)).toEqual({
      dc: 13,
      attack: 5,
      mod: 3,
    });
  });

  it('has none with no ability and no numbers of its own', () => {
    expect(grantCast(grant({}), sheet)).toEqual({});
  });
});

describe("a granted spell's row beside another grant of the spell", () => {
  const grant = (more: Partial<DerivedSheet['grantedSpells'][number]>) =>
    ({
      name: 'Suggestion',
      source: 'XPHB',
      origin: 'Feat',
      ...more,
    }) as DerivedSheet['grantedSpells'][number];

  it("offers a daily use on the class's row, but not an item's whose text fixes its DC", () => {
    const sheet = {
      grantedSpells: [
        grant({ usage: '1/day', resourceKey: 'feat' }),
        grant({
          usage: '1/day',
          resourceKey: 'helm',
          origin: 'Helm',
          dc: 13,
          fixed: { dc: 13 },
        }),
        grant({ usage: '1/day', resourceKey: 'orb', origin: 'Orb', dc: 15, attack: 7, mod: 4 }),
      ],
      resources: [
        { key: 'feat', max: 1 },
        { key: 'helm', max: 1 },
        { key: 'orb', max: 1 },
      ],
    } as unknown as DerivedSheet;
    // The orb casts with the character's own numbers, so the class row may too.
    expect(grantUseWays(sheet, 'suggestion').map((w) => w.key)).toEqual(['feat', 'orb']);
  });

  it("keeps an item's row, cast with other numbers, apart from another's", () => {
    const race = grant({ name: 'Light', origin: 'Race', ability: 'cha' });
    // The orb casts with the character's numbers; the wand's text fixes a DC.
    const orb = grant({ name: 'Light', origin: 'Orb', dc: 13, attack: 5, mod: 3 });
    const wand = grant({
      name: 'Light',
      origin: 'Wand',
      dc: 15,
      attack: 5,
      mod: 3,
      fixed: { dc: 15 },
    });
    expect(grantNumbersKey(race)).toBeUndefined();
    expect(new Set([race, orb, wand].map(grantRowKey)).size).toBe(3);
    // At-will rows, cast from no class and no pool of their own.
    const light = {
      doc: newCharacterDoc('c1', 'Vela', 't'),
      info: { name: 'Light', source: 'XPHB' },
    } as unknown as SpellCast;
    const ids = [undefined, grantNumbersKey(orb), grantNumbersKey(wand)].map((numbers) =>
      castRowId({ ...light, numbers }),
    );
    expect(new Set(ids).size).toBe(3);
    // A grant without numbers keeps the id it had.
    expect(ids[0]).toBe('c1|innate|light|xphb');
  });

  it("keeps a row's key and cast id while an effect moves the character's numbers", () => {
    // A cloak casting with the character's DC 13, then 14 under a buff.
    const before = grant({ usage: '1/day', resourceKey: 'cloak', dc: 13, attack: 5, mod: 3 });
    const after = { ...before, dc: 14, attack: 6 };
    expect(grantRowKey(after)).toBe(grantRowKey(before));
    // A fixed item's row follows the numbers its text fixes, not the rest.
    const fixed = { ...before, fixed: { dc: 15 } };
    expect(grantRowKey({ ...fixed, attack: 6 })).toBe(grantRowKey(fixed));
    // A row with a pool or a class is one of its kind: its id says no numbers,
    // so the Spells tab's class row for a prepared grant shares it.
    const base = {
      doc: newCharacterDoc('c1', 'Vela', 't'),
      info: { name: 'Suggestion', source: 'XPHB' },
    } as unknown as SpellCast;
    const pooled = { ...base, grantPool: { key: 'cloak', label: 'Cloak', max: 1 } };
    expect(castRowId({ ...pooled, numbers: 'own' })).toBe(castRowId(pooled));
    const prepared = { ...base, block: { classUid: 'wizard|xphb' } } as unknown as SpellCast;
    expect(castRowId({ ...prepared, numbers: 'own' })).toBe(castRowId(prepared));
  });
});

describe('the dice a spell rolls at a level', () => {
  // Shaped like Ice Knife: a hit's damage, then a burst's that grows with the slot.
  const shard: Entity = {
    name: 'Ice Shard',
    level: 1,
    entries: [
      'On a hit, the target takes {@damage 1d10} piercing damage. Hit or miss, each creature nearby takes {@damage 2d6} cold damage.',
    ],
    entriesHigherLevel: ['The cold damage increases by {@scaledamage 2d6|1-9|1d6} per slot level.'],
  };
  const cast = {
    doc: newCharacterDoc('c1', 'Vela', 't'),
    sheet: { totalLevel: 5, resources: [], spellDamageBonuses: [] } as unknown as DerivedSheet,
    info: { name: 'Ice Shard', source: 'TST' },
    entity: shard,
    level: 1,
    attack: true,
  } as unknown as SpellCast;

  it("offers an attack's first damage, and any other by its label, at the level", () => {
    expect(castDiceAt(cast, 3)).toEqual({
      expr: '1d10',
      label: 'Ice Shard piercing damage',
      kind: 'damage',
    });
    expect(castDiceAt(cast, 3, 'Ice Shard cold damage')).toEqual({
      expr: '4d6',
      label: 'Ice Shard cold damage',
      kind: 'damage',
    });
    expect(castDiceAt(cast, 3, 'Ice Shard thunder damage')).toBeUndefined();
  });
});

describe('what the character adds to a cast’s damage', () => {
  const bonuses: DerivedSheet['spellDamageBonuses'] = [
    { amount: 3, origin: 'Agonizing Blast', spells: ['eldritch blast'] },
    { amount: 4, origin: 'Potent Spellcasting', className: 'Cleric', cantrips: true },
    {
      amount: 2,
      origin: 'Empowered Evocation',
      className: 'Wizard',
      school: 'V',
      oneRoll: true,
    },
  ];
  const cast = (
    name: string,
    level: number,
    where: { block?: string; className?: string },
    school = 'V',
  ) =>
    ({
      sheet: { spellDamageBonuses: bonuses },
      info: { name, source: 'TST' },
      entity: { name, level, school },
      level,
      ...(where.block === undefined ? {} : { block: { className: where.block } }),
      ...(where.className === undefined ? {} : { className: where.className }),
    }) as unknown as SpellCast;
  const from = (c: SpellCast) => castDamageBonuses(c).map((b) => b.amount);

  it('matches a named spell whatever casts it', () => {
    expect(from(cast('Eldritch Blast', 0, { block: 'Warlock' }))).toEqual([3]);
    expect(from(cast('Eldritch Blast', 0, {}))).toEqual([3]);
    expect(from(cast('Fire Bolt', 0, { block: 'Warlock' }))).toEqual([]);
  });

  it('matches a class by the row’s block, or by the class a granted spell belongs to', () => {
    expect(from(cast('Sacred Flame', 0, { block: 'Cleric' }))).toEqual([4]);
    expect(from(cast('Sacred Flame', 0, { className: 'cleric' }))).toEqual([4]);
    // A species' or a feat's cantrip is no class's.
    expect(from(cast('Sacred Flame', 0, {}))).toEqual([]);
    expect(from(cast('Sacred Flame', 0, { block: 'Druid' }))).toEqual([]);
    // Cantrips only.
    expect(from(cast('Guiding Bolt', 1, { block: 'Cleric' }))).toEqual([]);
  });

  it('matches a school, and keeps a one-roll bonus marked', () => {
    expect(castDamageBonuses(cast('Fireball', 3, { block: 'Wizard' }))).toEqual([
      { amount: 2, oneRoll: true },
    ]);
    expect(from(cast('Chill Touch', 0, { block: 'Wizard' }, 'N'))).toEqual([]);
  });
});
