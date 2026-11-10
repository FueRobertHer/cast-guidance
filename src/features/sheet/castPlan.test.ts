// How a spell row casts (`castPlan`): which rows cast through the prompt, the
// items whose charges each row offers, and the dice a spell rolls at a level.
import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { type DerivedSheet, newCharacterDoc } from '@/engine/types';
import { castDiceAt, castsByPrompt, itemChargeWays, type SpellCast } from './castPlan';

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
    const ways = itemChargeWays(doc, sheet, 'Cure Wounds', 1);
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
    expect(itemChargeWays(doc, sheet, 'Cure Wounds', 1)).toHaveLength(2);
    expect(castsByPrompt(atWill)).toBe(false);
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
    sheet: { totalLevel: 5, resources: [] } as unknown as DerivedSheet,
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
