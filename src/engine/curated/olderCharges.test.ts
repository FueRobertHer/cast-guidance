// An item the Workshop wrote before its Charges section counted charges (a
// pool card keyed `charges` and Cast a spell cards spending it), read as the
// `charges` effect it writes now (`upgradeOlderCharges`), and only when that
// loses nothing.
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE, RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { lookupItem } from '../effects/item';
import { longRestRecovery } from '../rest';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { upgradeOlderCharges } from './itemCharges';

function world(items: DataEntity[]): EngineContext {
  const of: Record<string, readonly DataEntity[]> = {
    item: items,
    [RULE_SET_TYPE]: BUILT_IN_RULE_SETS,
    [RULE_PACK_TYPE]: [],
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

function carrying(...ids: string[]): CharacterDoc {
  const doc = newCharacterDoc('hero', 'Hero', 't');
  doc.equipment = ids.map((id) => ({
    id,
    ref: { name: 'Old Wand', source: 'HB' },
    qty: 1,
    equipped: true,
    attuned: true,
  }));
  return doc;
}

const POOL = { kind: 'resource', key: 'charges', label: 'Charges', max: 5, reset: 'long' };
const CARD = {
  kind: 'grantSpell',
  spell: 'Fireball|XPHB',
  ability: 'int',
  usage: '1/day',
  resourceKey: 'charges',
};
const STRIKE = {
  kind: 'action',
  economy: 'bonus',
  label: 'Strike',
  cost: { resource: 'charges', amount: 1 },
};

/** An older Workshop item: its fields, and its effects as the Workshop wrote them. */
const older = (effects: unknown[], more: Record<string, unknown> = {}): DataEntity => ({
  name: 'Old Wand',
  source: 'HB',
  type: 'WD',
  rarity: 'rare',
  charges: 5,
  recharge: 'dawn',
  rechargeAmount: '{@dice 1d4}',
  castGuidance: { v: 1, effects },
  ...more,
});

/** Its effects once converted, or undefined when it is left as it was. */
const converted = (e: DataEntity) => {
  const up = upgradeOlderCharges(e);
  return up === e ? undefined : (up.castGuidance as { effects: unknown[] }).effects;
};

describe('upgradeOlderCharges: what converts', () => {
  it('puts the charges effect in the pool card’s place, with each card’s spell at one charge', () => {
    const other = { kind: 'acBonus', amount: 1 };
    expect(converted(older([other, POOL, CARD, STRIKE]))).toEqual([
      other,
      {
        kind: 'charges',
        charges: 5,
        regain: '1d4',
        ability: 'int',
        spells: [{ spell: 'Fireball|XPHB', cost: 1 }],
      },
      STRIKE,
    ]);
    // Two cards, and a renamed pool.
    const shield = { ...CARD, spell: 'Shield|XPHB' };
    expect(converted(older([{ ...POOL, label: 'Sparks' }, CARD, shield]))).toEqual([
      {
        kind: 'charges',
        charges: 5,
        regain: '1d4',
        ability: 'int',
        spells: [
          { spell: 'Fireball|XPHB', cost: 1 },
          { spell: 'Shield|XPHB', cost: 1 },
        ],
      },
    ]);
  });

  it('keeps everything outside the effects, and a card spending another pool', () => {
    const sparks = { kind: 'resource', key: 'sparks', label: 'Sparks', max: 2, reset: 'long' };
    const elsewhere = { ...CARD, resourceKey: 'sparks' };
    const e = older([POOL, sparks, elsewhere]);
    (e.castGuidance as Record<string, unknown>).drop = [{ kind: 'note' }];
    const up = upgradeOlderCharges(e);
    expect(up).toEqual({
      ...e,
      castGuidance: {
        v: 1,
        drop: [{ kind: 'note' }],
        effects: [{ kind: 'charges', charges: 5, regain: '1d4' }, sparks, elsewhere],
      },
    });
  });

  it('gives back what the recharge fields say for a time a long rest covers, else all', () => {
    const regain = (more: Record<string, unknown>) =>
      (converted(older([POOL], more))?.[0] as { regain?: unknown } | undefined)?.regain;
    expect(regain({})).toBe('1d4');
    expect(regain({ recharge: 'Midnight', rechargeAmount: 2 })).toBe(2);
    expect(regain({ recharge: 'dusk', rechargeAmount: undefined })).toBe('all');
    // The card gave all back on a long rest, whatever the fields said, so with no time named it still does.
    expect(regain({ recharge: undefined })).toBe('all');
    expect(regain({ recharge: '' })).toBe('all');
    expect(regain({ recharge: undefined, rechargeAmount: '{@dice 1d6}' })).toBe('all');
  });

  it('counts what the pool held when the fields say no number', () => {
    expect(converted(older([POOL], { charges: undefined }))?.[0]).toMatchObject({ charges: 5 });
  });

  it('keeps the actions that spend or give back the pool where the sheet moves them', () => {
    const sparks = { kind: 'resource', key: 'sparks', label: 'Sparks', max: 2, reset: 'long' };
    const actions = [
      STRIKE,
      { ...STRIKE, label: 'Bought', buyBack: { resource: 'sparks', amount: 1, own: 'charges' } },
      { ...STRIKE, label: 'Mend', cost: undefined, regains: { resource: 'charges', amount: 1 } },
      {
        ...STRIKE,
        label: 'Siphon',
        cost: { resource: 'spell-slot', amount: 1, slotRefills: 'charges' },
      },
    ];
    expect(converted(older([POOL, sparks, ...actions]))).toEqual([
      { kind: 'charges', charges: 5, regain: '1d4' },
      sparks,
      ...actions,
    ]);
  });

  it('carries no ability when no card names one, and no spells with no card', () => {
    const { ability: _a, ...plain } = CARD;
    expect(converted(older([POOL, plain]))?.[0]).toEqual({
      kind: 'charges',
      charges: 5,
      regain: '1d4',
      spells: [{ spell: 'Fireball|XPHB', cost: 1 }],
    });
    expect(converted(older([POOL, STRIKE]))?.[0]).toEqual({
      kind: 'charges',
      charges: 5,
      regain: '1d4',
    });
  });
});

describe('upgradeOlderCharges: what is left as it was', () => {
  it.each([
    ['no pool', [CARD]],
    ['two pools', [POOL, POOL, CARD]],
    ['a pool for a short rest', [{ ...POOL, reset: 'short' }, CARD]],
    ['a pool given back on a short rest too', [{ ...POOL, regainOnShort: 1 }, CARD]],
    ['a pool of another kind of field', [{ ...POOL, die: 'd6' }, CARD]],
    ['cards of two abilities', [POOL, CARD, { ...CARD, spell: 'Shield|XPHB', ability: 'wis' }]],
    [
      'a card one ability, one none',
      [POOL, CARD, { ...CARD, spell: 'Shield|XPHB', ability: undefined }],
    ],
    ['a card that counts as known', [POOL, { ...CARD, countsAsKnown: true }]],
    ['a card with slots alone', [POOL, { ...CARD, slotsOnly: true }]],
    ['a card naming its spell another way', [POOL, { ...CARD, spell: { name: 'Fireball' } }]],
    ['one spell twice', [POOL, CARD, CARD]],
    [
      'another effect naming the pool',
      [POOL, CARD, { kind: 'resourceRegain', key: 'charges', amount: 1 }],
    ],
    ['a charges effect already', [POOL, { kind: 'charges', charges: 5, regain: 'all' }]],
    ['an effect that is not one', [POOL, CARD, 'note']],
    // The sheet moves an action's price, a buy-back's own use and a regain to
    // the new pool, and not what a buy-back is paid from.
    [
      'an action buying back with the pool',
      [POOL, CARD, { ...STRIKE, cost: undefined, buyBack: { resource: 'charges', amount: 1 } }],
    ],
    ['an action naming the pool elsewhere', [POOL, { ...STRIKE, note: { resource: 'charges' } }]],
    // A use with no price spends the pool its name shares, which the new one does not.
    ['an action named as the card', [POOL, CARD, { ...STRIKE, cost: undefined, label: 'charges' }]],
    [
      'an action named as a renamed card',
      [
        { ...POOL, label: 'Sparks' },
        { ...STRIKE, label: 'SPARKS' },
      ],
    ],
  ])('%s', (_why, effects) => {
    expect(converted(older(effects))).toBe(undefined);
  });

  it.each([
    ['fields that count another number', { charges: 4 }, POOL],
    ['a short rest', { recharge: 'restShort' }, POOL],
    ['a recharge the text tells', { recharge: 'special' }, POOL],
    ['an amount the roller cannot roll', { rechargeAmount: 'lots' }, POOL],
    ['a pool of more than the effect holds', { charges: 100 }, { ...POOL, max: 100 }],
  ])('%s', (_why, more, pool) => {
    expect(converted(older([pool, CARD], more))).toBe(undefined);
  });

  it('names the pool outside the effects', () => {
    const e = older([POOL, CARD]);
    (e.castGuidance as Record<string, unknown>).amend = [{ label: 'Zap', resource: 'charges' }];
    expect(converted(e)).toBe(undefined);
  });

  it('has no guidance, or no effects list', () => {
    const plain = { name: 'Wand', source: 'HB' };
    expect(upgradeOlderCharges(plain)).toBe(plain);
    expect(converted(older('none' as never))).toBe(undefined);
  });
});

describe('upgradeOlderCharges: the item given', () => {
  it('is never changed, and gives one answer', () => {
    const e = older([POOL, CARD, STRIKE]);
    const before = structuredClone(e);
    const up = upgradeOlderCharges(e);
    expect(e).toEqual(before);
    expect(upgradeOlderCharges(e)).toBe(up);
    expect(upgradeOlderCharges(up)).toBe(up);
  });

  it('is read converted wherever the engine looks an item up', () => {
    const e = older([POOL, CARD]);
    expect(lookupItem({ ctx: world([e]) }, 'Old Wand', 'HB')).toBe(upgradeOlderCharges(e));
  });
});

describe('a converted item on the sheet', () => {
  // As the Workshop now writes the same item.
  const twin = older([
    {
      kind: 'charges',
      charges: 5,
      regain: '1d4',
      ability: 'int',
      spells: [{ spell: 'Fireball|XPHB', cost: 1 }],
    },
    STRIKE,
  ]);
  const view = (e: DataEntity, doc: CharacterDoc) => {
    const sheet = deriveSheet(doc, world([e]));
    return {
      warnings: sheet.warnings,
      resources: sheet.resources,
      granted: sheet.grantedSpells,
      actions: sheet.actions,
    };
  };

  it('is the sheet the item written now makes', () => {
    const doc = carrying('a');
    expect(view(older([POOL, CARD, STRIKE]), doc)).toEqual(view(twin, doc));
    expect(view(older([POOL, CARD, STRIKE]), doc).resources).toContainEqual(
      expect.objectContaining({ key: 'item-charges:a', max: 5, regainRoll: '1d4' }),
    );
  });

  it('gives each carried copy its own pool, where the older card was one for all', () => {
    const doc = carrying('a', 'b');
    const keys = deriveSheet(doc, world([older([POOL, CARD])]))
      .resources.map((r) => r.key)
      .filter((k) => k.includes('charges'));
    expect(keys).toEqual(['item-charges:a', 'item-charges:b']);
  });

  it('starts full: what was spent from the older card is not carried over', () => {
    const doc = carrying('a');
    doc.play.resources = [{ key: 'charges', used: 3 }];
    const sheet = deriveSheet(doc, world([older([POOL, CARD])]));
    expect(sheet.warnings).toEqual([]);
    expect(doc.play.resources.find((r) => r.key === 'item-charges:a')).toBe(undefined);
    // A long rest gives back by the fields' roll.
    doc.play.resources = [{ key: 'item-charges:a', used: 4 }];
    longRestRecovery(doc.play, sheet, { maxHp: 40, edition: '2024' }, { rollTotal: () => 2 });
    expect(doc.play.resources.find((r) => r.key === 'item-charges:a')?.used).toBe(2);
  });
});
