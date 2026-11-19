// An item's own charge fields (O2a): what `charges`, `recharge` and
// `rechargeAmount` count, where they stand among the other sources
// (`itemChargesOf`), and the pool a derive makes of them.
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE, RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { longRestRecovery } from '../rest';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { fieldChargesOf, idleChargePools, itemChargesOf } from './itemCharges';

const item = (name: string, source: string, more: Record<string, unknown> = {}): DataEntity => ({
  name,
  source,
  type: 'WD',
  rarity: 'rare',
  ...more,
});

function world(items: DataEntity[], packs: DataEntity[] = []): EngineContext {
  const of: Record<string, readonly DataEntity[]> = {
    item: items,
    [RULE_SET_TYPE]: BUILT_IN_RULE_SETS,
    [RULE_PACK_TYPE]: packs,
  };
  return {
    get: (type, name, source) =>
      of[type]?.find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      ),
    byType: (type) => of[type] ?? [],
  };
}

function carrying(...entries: Array<{ id: string; name: string; source: string; on?: boolean }>) {
  const doc: CharacterDoc = newCharacterDoc('hero', 'Hero', 't');
  doc.equipment = entries.map((e) => ({
    id: e.id,
    ref: { name: e.name, source: e.source },
    qty: 1,
    equipped: e.on ?? true,
    attuned: true,
  }));
  return doc;
}

/** A long rest's hit points, which these pools do not touch. */
const HP = { maxHp: 40, edition: '2024' } as const;

/** What the fields count, as charges and regain. */
const counted = (more: Record<string, unknown>) => {
  const held = fieldChargesOf(item('Rod', 'TST', more));
  return held === undefined ? undefined : [held.charges, held.regain, held.spells.length];
};

describe('fieldChargesOf: what the charge fields count', () => {
  it('gives back the dawn amount, its dice tag read, or all when none is said', () => {
    // Wand of Web (DMG), Wand of Binding (XDMG), Clockwork Amulet (XDMG).
    expect(counted({ charges: 7, recharge: 'dawn', rechargeAmount: '{@dice 1d6 + 1}' })).toEqual([
      7,
      '1d6+1',
      0,
    ]);
    expect(counted({ charges: 3, recharge: 'dawn', rechargeAmount: 3 })).toEqual([3, '3', 0]);
    expect(counted({ charges: 1, recharge: 'dawn' })).toEqual([1, 'all', 0]);
  });

  it('reads dusk, midnight and a long rest as a long rest, in any case', () => {
    for (const recharge of ['dusk', 'midnight', 'restLong', 'Dawn']) {
      expect(counted({ charges: 4, recharge, rechargeAmount: '{@dice 1d4}' }), recharge).toEqual([
        4,
        '1d4',
        0,
      ]);
    }
  });

  it('gives nothing back with no recharge, an empty one, or one the text tells', () => {
    // A Ring of Three Wishes; the Workshop's "Never"; Helm of Devil Command.
    expect(counted({ charges: 3 })).toEqual([3, 'none', 0]);
    expect(counted({ charges: 3, recharge: '', rechargeAmount: 2 })).toEqual([3, 'none', 0]);
    expect(counted({ charges: 3, recharge: 'special' })).toEqual([3, 'none', 0]);
  });

  it('gives an amount with no recharge back at dawn, as a Robe of Stars does', () => {
    expect(counted({ charges: 6, rechargeAmount: '{@dice 1d6}' })).toEqual([6, '1d6', 0]);
  });

  it('reads a number written as text, and a whole number taken away', () => {
    // Key Card (BMT) and Ring of Puzzler's Wit (BMT).
    expect(counted({ charges: 5, recharge: 'dawn', rechargeAmount: '5' })).toEqual([5, '5', 0]);
    expect(counted({ charges: 3, recharge: 'dawn', rechargeAmount: '{@dice 1d4 - 1}' })).toEqual([
      3,
      '1d4-1',
      0,
    ]);
  });

  it('counts nothing when the fields do not read as a whole', () => {
    // Stonemaker War Pick (BMT) holds a roll of charges.
    expect(counted({ charges: '{@dice 1d6 + 1}' })).toBe(undefined);
    expect(counted({ charges: 0 })).toBe(undefined);
    expect(counted({ charges: 100 })).toBe(undefined);
    expect(counted({ charges: 2.5 })).toBe(undefined);
    expect(counted({ charges: 3, recharge: 'dawn', rechargeAmount: 'lots' })).toBe(undefined);
    expect(counted({ charges: 3, recharge: 'dawn', rechargeAmount: 9 })).toBe(undefined);
    expect(counted({ recharge: 'dawn', rechargeAmount: 2 })).toBe(undefined);
  });

  it('reads each item once', () => {
    const wand = item('Wand', 'TST', { charges: 7, recharge: 'dawn' });
    expect(fieldChargesOf(wand)).toBe(fieldChargesOf(wand));
  });
});

describe('itemChargesOf: the fields below every other source', () => {
  const ref = { name: 'Rod of Tests', source: 'TST' };
  const fields = { charges: 3, recharge: 'dawn', rechargeAmount: 1 };
  const held = (ctx: EngineContext) => itemChargesOf(ctx, 'hero', ref)?.charges;
  const pack = (patch: Record<string, unknown>): DataEntity => ({
    name: 'Pack',
    source: 'Pack',
    appliesTo: { characters: ['hero'] },
    castGuidance: { v: 1, patches: [{ target: 'Rod of Tests|TST', ...patch }] },
  });
  const effect = { kind: 'charges', charges: 5, regain: 'all' };

  it('count an item with nothing else to say', () => {
    expect(held(world([item('Rod of Tests', 'TST', fields)]))).toBe(3);
  });

  it("give way to the built-in row, the item's own effect and a pack's", () => {
    const wand = item('Wand of Fireballs', 'XDMG', { charges: 2, recharge: 'dawn' });
    expect(itemChargesOf(world([wand]), 'hero', wand as never)?.charges).toBe(7);
    const own = item('Rod of Tests', 'TST', {
      ...fields,
      castGuidance: { v: 1, effects: [effect] },
    });
    expect(held(world([own]))).toBe(5);
    expect(
      held(
        world([item('Rod of Tests', 'TST', fields)], [pack({ add: [{ ...effect, charges: 6 }] })]),
      ),
    ).toBe(6);
  });

  it('count when its own effects say no charges, or cannot be read', () => {
    const plain = { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] };
    expect(held(world([item('Rod of Tests', 'TST', { ...fields, castGuidance: plain })]))).toBe(3);
    const broken = { v: 1, effects: [{ kind: 'nothing at all' }] };
    expect(held(world([item('Rod of Tests', 'TST', { ...fields, castGuidance: broken })]))).toBe(3);
  });

  it("are dropped with the rest of what it inherits by a pack's replacement", () => {
    const replaces = pack({ effects: [{ kind: 'acBonus', amount: 1 }] });
    expect(held(world([item('Rod of Tests', 'TST', fields)], [replaces]))).toBe(undefined);
  });
});

describe('the pool its fields make', () => {
  const robe = item('Robe of Stars', 'DMG', {
    type: undefined,
    wondrous: true,
    reqAttune: true,
    charges: 6,
    rechargeAmount: '{@dice 1d6}',
  });

  it('is one per carried copy, while its magic works, rolled back at dawn', () => {
    const doc = carrying(
      { id: 'a', name: 'Robe of Stars', source: 'DMG' },
      { id: 'b', name: 'Robe of Stars', source: 'DMG' },
    );
    const sheet = deriveSheet(doc, world([robe]));
    expect(sheet.warnings).toEqual([]);
    expect(sheet.resources.filter((r) => r.key.startsWith('item-charges:'))).toEqual([
      expect.objectContaining({
        key: 'item-charges:a',
        label: 'Robe of Stars charges',
        max: 6,
        resetOn: 'long',
        regainRoll: '1d6',
        origin: 'Robe of Stars',
      }),
      expect.objectContaining({ key: 'item-charges:b', max: 6 }),
    ]);
    doc.equipment = doc.equipment.map((e) => ({ ...e, attuned: false }));
    expect(
      deriveSheet(doc, world([robe])).resources.some((r) => r.key.startsWith('item-charges:')),
    ).toBe(false);
  });

  it('comes back by its roll on a long rest, and never when nothing does', () => {
    const doc = carrying({ id: 'a', name: 'Robe of Stars', source: 'DMG' });
    doc.play.resources = [{ key: 'item-charges:a', used: 5 }];
    const sheet = deriveSheet(doc, world([robe]));
    longRestRecovery(doc.play, sheet, HP, { rollTotal: () => 3 });
    expect(doc.play.resources.find((r) => r.key === 'item-charges:a')?.used).toBe(2);

    const wishes = item('Ring of Three Wishes', 'DMG', { charges: 3 });
    const ring = carrying({ id: 'r', name: 'Ring of Three Wishes', source: 'DMG' });
    ring.play.resources = [{ key: 'item-charges:r', used: 1 }];
    const its = deriveSheet(ring, world([wishes]));
    expect(its.resources.find((r) => r.key === 'item-charges:r')?.regainRoll).toBe('0');
    longRestRecovery(ring.play, its, HP, { rollTotal: (d) => Number(d) });
    expect(ring.play.resources.find((r) => r.key === 'item-charges:r')?.used).toBe(1);
  });

  it('is idle while the item is put away, with the same roll', () => {
    const doc = carrying({ id: 'a', name: 'Robe of Stars', source: 'DMG', on: false });
    const ctx = world([robe]);
    const sheet = deriveSheet(doc, ctx);
    expect(idleChargePools(doc, sheet.resources, ctx)).toEqual([
      {
        key: 'item-charges:a',
        label: 'Robe of Stars charges',
        max: 6,
        resetOn: 'long',
        origin: 'Robe of Stars',
        regainRoll: '1d6',
      },
    ]);
  });

  it('stands beside a pool an older Workshop item counts the same charges in, whose card spends the older one', () => {
    const old = item('Old Wand', 'HB', {
      charges: 5,
      recharge: 'dawn',
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'charges', label: 'Charges', max: 5, reset: 'long' },
          { kind: 'grantSpell', spell: 'Fireball|XPHB', usage: '1/day', resourceKey: 'charges' },
        ],
      },
    });
    const doc = carrying({ id: 'a', name: 'Old Wand', source: 'HB' });
    const sheet = deriveSheet(doc, world([old]));
    expect(sheet.warnings).toEqual([]);
    expect(sheet.resources.find((r) => r.key === 'charges')?.max).toBe(5);
    expect(sheet.resources.find((r) => r.key === 'item-charges:a')?.max).toBe(5);
    expect(sheet.grantedSpells.map((g) => g.resourceKey)).toEqual(['charges']);
  });
});
