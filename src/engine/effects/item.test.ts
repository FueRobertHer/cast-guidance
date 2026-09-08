import { describe, expect, it } from 'vitest';
import { calcResources } from '../calc/resources';
import type { DataEntity, EffectInput, EngineContext } from '../types';
import { newCharacterDoc } from '../types';
import { Collector } from './base';
import { collectItems, isArmor, isShield, itemTypeCode, parseBonus } from './item';

describe('itemTypeCode', () => {
  it('takes the code before the pipe, or undefined', () => {
    expect(itemTypeCode({ type: 'HA|XPHB' })).toBe('HA');
    expect(itemTypeCode({ type: 'M' })).toBe('M');
    expect(itemTypeCode({})).toBeUndefined();
  });
});

describe('isArmor / isShield', () => {
  it('recognizes light/medium/heavy armor', () => {
    expect(isArmor({ type: 'LA' })).toBe(true);
    expect(isArmor({ type: 'MA|PHB' })).toBe(true);
    expect(isArmor({ type: 'HA' })).toBe(true);
    expect(isArmor({ type: 'S' })).toBe(false);
    expect(isArmor({ type: 'M' })).toBe(false);
  });

  it('recognizes shields', () => {
    expect(isShield({ type: 'S' })).toBe(true);
    expect(isShield({ type: 'HA' })).toBe(false);
  });
});

describe('parseBonus', () => {
  it('reads numbers and +N strings, defaulting to 0', () => {
    expect(parseBonus(2)).toBe(2);
    expect(parseBonus('+1')).toBe(1);
    expect(parseBonus('3')).toBe(3);
    expect(parseBonus('not a number')).toBe(0);
    expect(parseBonus(undefined)).toBe(0);
  });
});

/** One equipped item, resolved from a context holding only that item. */
function itemEffects(item: DataEntity, equipped = true): EffectInput[] {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.equipment = [
    {
      id: 'e1',
      ref: { name: String(item.name), source: String(item.source) },
      qty: 1,
      equipped,
      attuned: false,
    },
  ];
  const ctx: EngineContext = {
    get: (type, name) =>
      type === 'item' && String(item.name).toLowerCase() === name.toLowerCase() ? item : undefined,
    byType: () => [],
  };
  const col = new Collector(doc, ctx);
  collectItems(col);
  return col.effects;
}

const ABILITY_SCORES = Object.fromEntries(
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => [
    a,
    { value: 10, base: 10, overridden: false, parts: [], mod: 0 },
  ]),
) as unknown as Parameters<typeof calcResources>[2];

describe('collectItems: granted spells', () => {
  it('grants a spell the item carries, at will', () => {
    const effects = itemEffects({
      name: 'Wand of Sparks',
      source: 'TST',
      type: 'WD',
      additionalSpells: [{ ability: 'int', known: { _: ['fire bolt'] } }],
    });
    expect(effects).toContainEqual(
      expect.objectContaining({
        kind: 'grantSpell',
        spell: { name: 'fire bolt', source: '' },
        ability: 'int',
      }),
    );
    // At will: no pool to track, so no resource rides along.
    expect(effects.filter((e) => e.kind === 'resource')).toHaveLength(0);
  });

  it('gives a daily spell its own pool of uses', () => {
    const effects = itemEffects({
      name: 'Cloak of Steps',
      source: 'TST',
      type: 'W',
      additionalSpells: [{ innate: { _: { daily: { '2': ['misty step'] } } } }],
    });
    const grant = effects.find((e) => e.kind === 'grantSpell');
    expect(grant).toMatchObject({ usage: '2/day' });
    const key = grant?.kind === 'grantSpell' ? grant.resourceKey : undefined;
    expect(key).toBeDefined();
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', key, max: 2, resetOn: 'long' }),
    );
  });

  it('grants nothing while the item is in the backpack', () => {
    const effects = itemEffects(
      {
        name: 'Wand of Sparks',
        source: 'TST',
        type: 'WD',
        additionalSpells: [{ known: { _: ['fire bolt'] } }],
      },
      false,
    );
    expect(effects).toEqual([]);
  });

  it('adds up the pools when two copies of the same item are equipped', () => {
    const wand: DataEntity = {
      name: 'Wand of Steps',
      source: 'TST',
      type: 'WD',
      additionalSpells: [{ innate: { _: { daily: { '1': ['misty step'] } } } }],
    };
    const doc = newCharacterDoc('c', 'H', 't');
    doc.equipment = [1, 2].map((n) => ({
      id: `e${n}`,
      ref: { name: 'Wand of Steps', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    }));
    const ctx: EngineContext = {
      get: (type) => (type === 'item' ? wand : undefined),
      byType: () => [],
    };
    const col = new Collector(doc, ctx);
    collectItems(col);
    const pools = col.effects.filter((e) => e.kind === 'resource');
    // One pool, two uses: a second wand is a second charge, not a duplicate row
    // and not a grant that silently loses to the first.
    expect(new Set(pools.map((p) => p.kind === 'resource' && p.key)).size).toBe(1);
    expect(calcResources(doc, col.effects, ABILITY_SCORES, 2)).toMatchObject([{ max: 2 }]);
  });
});
