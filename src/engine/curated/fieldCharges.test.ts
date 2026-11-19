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
    // A Ring of Three Wishes; an empty one; Helm of Devil Command; a short rest.
    expect(counted({ charges: 3 })).toEqual([3, 'none', 0]);
    expect(counted({ charges: 3, recharge: '', rechargeAmount: 2 })).toEqual([3, 'none', 0]);
    expect(counted({ charges: 3, recharge: 'special' })).toEqual([3, 'none', 0]);
    expect(counted({ charges: 3, recharge: 'restShort', rechargeAmount: 1 })).toEqual([
      3,
      'none',
      0,
    ]);
  });

  it("gives an amount with no recharge nothing back, as the Workshop's Never leaves it", () => {
    // A Robe of Stars's data says no recharge; its text says dawn.
    expect(counted({ charges: 6, rechargeAmount: '{@dice 1d6}' })).toEqual([6, 'none', 0]);
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
    const plain = {
      v: 1,
      replace: false,
      effects: [
        { kind: 'acBonus', amount: 1 },
        { kind: 'resource', key: 'sparks', label: 'Sparks', max: 2, reset: 'long' },
      ],
    };
    expect(held(world([item('Rod of Tests', 'TST', { ...fields, castGuidance: plain })]))).toBe(3);
    const broken = { v: 1, effects: [{ kind: 'nothing at all' }] };
    expect(held(world([item('Rod of Tests', 'TST', { ...fields, castGuidance: broken })]))).toBe(3);
    // A replace in a guidance that does not read leaves out nothing, as it leaves nothing else out.
    const late = { v: 99, replace: true, effects: [{ kind: 'acBonus', amount: 1 }] };
    expect(held(world([item('Rod of Tests', 'TST', { ...fields, castGuidance: late })]))).toBe(3);
  });

  it('stand aside for its own charges effect, even one that does not read yet, as the Workshop says', () => {
    for (const half of [
      { kind: 'charges', charges: 0, regain: 'all' },
      { kind: 'charges', charges: 3, regain: 'lots' },
      { kind: 'charges' },
    ]) {
      const own = item('Rod of Tests', 'TST', {
        ...fields,
        castGuidance: { v: 1, effects: [half] },
      });
      expect(held(world([own])), JSON.stringify(half)).toBe(undefined);
      expect(fieldChargesOf(own)).toBe(undefined);
    }
    // In a guidance that does not read as a whole, too.
    const late = { v: 99, effects: [{ kind: 'charges', charges: 3, regain: 'all' }] };
    expect(held(world([item('Rod of Tests', 'TST', { ...fields, castGuidance: late })]))).toBe(
      undefined,
    );
  });

  it("are dropped with the rest of what it inherits by a pack's replacement, or its own", () => {
    const replaces = pack({ effects: [{ kind: 'acBonus', amount: 1 }] });
    expect(held(world([item('Rod of Tests', 'TST', fields)], [replaces]))).toBe(undefined);
    const fresh = { v: 1, replace: true, effects: [{ kind: 'acBonus', amount: 1 }] };
    const own = item('Rod of Tests', 'TST', { ...fields, castGuidance: fresh });
    expect(held(world([own]))).toBe(undefined);
    expect(fieldChargesOf(own)).toBe(undefined);
    // Its own charges still count, and the row stands outside it, as it does a pack's.
    const counts = { ...fresh, effects: [effect] };
    expect(held(world([item('Rod of Tests', 'TST', { ...fields, castGuidance: counts })]))).toBe(5);
    const wand = item('Wand of Fireballs', 'XDMG', { ...fields, castGuidance: fresh });
    expect(itemChargesOf(world([wand]), 'hero', wand as never)?.charges).toBe(7);
  });
});

describe('the pool its fields make', () => {
  // As the release writes a Wand of Web (DMG): no effect and no row.
  const wand = item('Wand of Web', 'DMG', {
    reqAttune: 'by a spellcaster',
    charges: 7,
    recharge: 'dawn',
    rechargeAmount: '{@dice 1d6 + 1}',
  });

  it('is one per carried copy, while its magic works, rolled back at dawn', () => {
    const doc = carrying(
      { id: 'a', name: 'Wand of Web', source: 'DMG' },
      { id: 'b', name: 'Wand of Web', source: 'DMG' },
    );
    const sheet = deriveSheet(doc, world([wand]));
    expect(sheet.warnings).toEqual([]);
    expect(sheet.resources.filter((r) => r.key.startsWith('item-charges:'))).toEqual([
      expect.objectContaining({
        key: 'item-charges:a',
        label: 'Wand of Web charges',
        max: 7,
        resetOn: 'long',
        regainRoll: '1d6+1',
        origin: 'Wand of Web',
      }),
      expect.objectContaining({ key: 'item-charges:b', max: 7 }),
    ]);
    doc.equipment = doc.equipment.map((e) => ({ ...e, attuned: false }));
    expect(
      deriveSheet(doc, world([wand])).resources.some((r) => r.key.startsWith('item-charges:')),
    ).toBe(false);
  });

  it('comes back by its roll on a long rest, and never when nothing does', () => {
    const doc = carrying({ id: 'a', name: 'Wand of Web', source: 'DMG' });
    doc.play.resources = [{ key: 'item-charges:a', used: 5 }];
    const sheet = deriveSheet(doc, world([wand]));
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

  it('is made for a mundane item too, as the release writes a Robot Controller', () => {
    const controller = item('Robot Controller', 'QftIS', { rarity: 'none', type: 'G', charges: 3 });
    const doc = carrying({ id: 'c', name: 'Robot Controller', source: 'QftIS' });
    doc.equipment = doc.equipment.map((e) => ({ ...e, attuned: false }));
    const sheet = deriveSheet(doc, world([controller]));
    expect(sheet.resources.find((r) => r.key === 'item-charges:c')).toMatchObject({
      max: 3,
      regainRoll: '0',
    });
  });

  it('is idle while the item is put away, with the same roll', () => {
    const doc = carrying({ id: 'a', name: 'Wand of Web', source: 'DMG', on: false });
    const ctx = world([wand]);
    const sheet = deriveSheet(doc, ctx);
    expect(idleChargePools(doc, sheet.resources, ctx)).toEqual([
      {
        key: 'item-charges:a',
        label: 'Wand of Web charges',
        max: 7,
        resetOn: 'long',
        origin: 'Wand of Web',
        regainRoll: '1d6+1',
      },
    ]);
  });

  it('is not made beside the pool an older Workshop item counts them in, which its cards and actions spend', () => {
    const old = item('Old Wand', 'HB', {
      charges: 5,
      recharge: 'dawn',
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'charges', label: 'Charges', max: 5, reset: 'long' },
          { kind: 'grantSpell', spell: 'Fireball|XPHB', usage: '1/day', resourceKey: 'charges' },
          {
            kind: 'action',
            economy: 'bonus',
            label: 'Strike',
            cost: { resource: 'charges', amount: 1 },
          },
        ],
      },
    });
    const doc = carrying({ id: 'a', name: 'Old Wand', source: 'HB' });
    const sheet = deriveSheet(doc, world([old]));
    expect(sheet.warnings).toEqual([]);
    expect(sheet.resources.find((r) => r.key === 'charges')?.max).toBe(5);
    expect(sheet.resources.some((r) => r.key.startsWith('item-charges:'))).toBe(false);
    expect(sheet.grantedSpells.map((g) => g.resourceKey)).toEqual(['charges']);
    expect(sheet.actions.filter((a) => a.label === 'Strike').map((a) => a.cost?.resource)).toEqual([
      'charges',
    ]);
  });
});
