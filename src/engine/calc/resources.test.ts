import { describe, expect, it } from 'vitest';
import {
  type Ability,
  type CharacterDoc,
  type DerivedAbility,
  type DerivedResource,
  type EffectInput,
  type EffectOrigin,
  HIT_DIE_COST,
  newCharacterDoc,
  SLOT_COST,
  type SpellcastingBlock,
} from '../types';
import { calcResources, costOnSheet, slotsAndDice } from './resources';

const origin: EffectOrigin = { label: 'Class', uid: 'class|x', type: 'class' };

function abilities(cha = 0): Record<Ability, DerivedAbility> {
  const out = {} as Record<Ability, DerivedAbility>;
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]) {
    const mod = a === 'cha' ? cha : 0;
    out[a] = { value: 10, base: 10, overridden: false, parts: [], mod };
  }
  return out;
}

type ResourceEffect = Extract<EffectInput, { kind: 'resource' }>;

function res(max: ResourceEffect['max'], extra: Partial<ResourceEffect> = {}): ResourceEffect {
  return { origin, kind: 'resource', key: 'k', label: 'Pool', max, resetOn: 'long', ...extra };
}

function docWith(classes: CharacterDoc['classes']): CharacterDoc {
  const d = newCharacterDoc('c', 'H', 't');
  d.classes = classes;
  return d;
}

describe('calcResources max resolution', () => {
  const doc = docWith([{ ref: { name: 'Barbarian', source: 'PHB' }, levels: 5, hp: [] }]);

  it('reads a numeric max', () => {
    expect(calcResources(doc, [res(3)], abilities(), 2)[0]?.max).toBe(3);
  });

  it('resolves profBonus and abilityMod maxima', () => {
    expect(calcResources(doc, [res('profBonus')], abilities(), 4)[0]?.max).toBe(4);
    expect(calcResources(doc, [res('abilityMod:cha')], abilities(3), 2)[0]?.max).toBe(3);
  });

  it('resolves twice the proficiency bonus', () => {
    expect(calcResources(doc, [res('twiceProfBonus')], abilities(), 3)[0]?.max).toBe(6);
  });

  it('resolves "1 + modifier" maxima, dropping the resource at zero', () => {
    expect(calcResources(doc, [res('abilityModPlus1:cha')], abilities(3), 2)[0]?.max).toBe(4);
    // 1 + (-1) = 0 uses: rules-accurate for Divine Sense with CHA 8.
    expect(calcResources(doc, [res('abilityModPlus1:cha')], abilities(-1), 2)).toHaveLength(0);
  });

  it('resolves a class level max', () => {
    expect(calcResources(doc, [res('level:Barbarian')], abilities(), 2)[0]?.max).toBe(5);
    expect(calcResources(doc, [res('level:Wizard')], abilities(), 2)).toHaveLength(0); // 0 → dropped
  });
});

describe('calcResources pooling', () => {
  const doc = docWith([{ ref: { name: 'Fighter', source: 'PHB' }, levels: 3, hp: [] }]);

  it('stacks same-key sources when stack is true', () => {
    const effects = [res(4, { stack: true }), res(1, { stack: true })];
    const out = calcResources(doc, effects, abilities(), 2);
    expect(out).toHaveLength(1);
    expect(out[0]?.max).toBe(5);
  });

  it('keeps the largest die of the sources it stacks', () => {
    const die = (...dice: Array<string | undefined>) =>
      calcResources(
        doc,
        dice.map((d) => res(1, { stack: true, ...(d !== undefined ? { die: d } : {}) })),
        abilities(),
        2,
      )[0]?.die;
    expect(die('1d6', '1d10')).toBe('1d10');
    expect(die('1d10', '1d6')).toBe('1d10');
    expect(die(undefined, '1d8')).toBe('1d8');
    expect(die('1d8', undefined)).toBe('1d8');
    expect(die(undefined, undefined)).toBeUndefined();
  });

  it('keeps the first source (curated wins) when not stacking', () => {
    const effects = [res(4, { label: 'Curated' }), res(1, { label: 'Prose' })];
    const out = calcResources(doc, effects, abilities(), 2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ max: 4, origin: 'Class' });
  });
});

describe('calcResources: regaining on a short rest', () => {
  const regain = (key: string, amount: number): EffectInput => ({
    kind: 'resourceRegain',
    key,
    amount,
    origin,
  });
  const pool = (effects: EffectInput[]) => calcResources(docWith([]), effects, abilities(), 2)[0];

  it('carries what the pool itself says', () => {
    expect(pool([res(3, { regainOnShort: 1 })])?.regainOnShort).toBe(1);
    expect(pool([res(3)])).not.toHaveProperty('regainOnShort');
  });

  it('adds what another feature gives, whichever comes first', () => {
    expect(pool([res(3), regain('k', 4)])?.regainOnShort).toBe(4);
    expect(pool([regain('k', 4), res(3)])?.regainOnShort).toBe(4);
    expect(pool([res(3, { regainOnShort: 1 }), regain('k', 1)])?.regainOnShort).toBe(2);
  });

  it('leaves it out when the pool is not there, or is another pool', () => {
    expect(pool([regain('k', 4)])).toBeUndefined();
    expect(pool([res(3), regain('other', 4)])).not.toHaveProperty('regainOnShort');
  });
});

describe('costOnSheet', () => {
  const pool = (key: string): DerivedResource => ({
    key,
    label: key,
    max: 3,
    resetOn: 'long',
    origin: 'Test',
  });

  it('keeps a cost on a pool the sheet has', () => {
    const cost = { resource: 'dice', amount: 2 };
    expect(costOnSheet(cost, [pool('dice')])).toEqual(cost);
  });

  it('finds Focus and ki under either name', () => {
    expect(costOnSheet({ resource: 'focus', amount: 1 }, [pool('ki')])?.resource).toBe('ki');
    expect(costOnSheet({ resource: 'ki', amount: 1 }, [pool('focus')])?.resource).toBe('focus');
  });

  it('prefers the name it was given when the sheet has both', () => {
    const both = [pool('ki'), pool('focus')];
    expect(costOnSheet({ resource: 'focus', amount: 1 }, both)?.resource).toBe('focus');
  });

  it('drops a cost the sheet has nothing to pay it with', () => {
    expect(costOnSheet({ resource: 'dice', amount: 1 }, [pool('ki')])).toBeUndefined();
    expect(costOnSheet(undefined, [pool('ki')])).toBeUndefined();
  });

  it('finds a buy-back the same way, and keeps what else it says', () => {
    const buyBack = { resource: 'focus', amount: 3, own: 'use' };
    expect(costOnSheet(buyBack, [pool('ki')])).toEqual({ ...buyBack, resource: 'ki' });
    expect(costOnSheet(buyBack, [pool('dice')])).toBeUndefined();
  });

  describe('a spell slot or Hit Point Die price', () => {
    const slot = (extra: { minLevel?: number; pactOnly?: boolean } = {}) => ({
      resource: SLOT_COST,
      amount: 1,
      ...extra,
    });
    const caster = { slotTop: 3, hitDice: 5 };
    const pactCaster = { slotTop: 0, pactLevel: 3, hitDice: 5 };

    it('keeps a slot price while some slot of its level or higher exists', () => {
      expect(costOnSheet(slot(), [], caster)).toEqual(slot());
      expect(costOnSheet(slot({ minLevel: 3 }), [], caster)).toEqual(slot({ minLevel: 3 }));
      expect(costOnSheet(slot({ minLevel: 5 }), [], caster)).toBeUndefined();
      expect(costOnSheet(slot(), [])).toBeUndefined();
    });

    it('lets the pact slot pay any slot price, and only it pay a Pact Magic one', () => {
      expect(costOnSheet(slot({ minLevel: 3 }), [], pactCaster)).toBeDefined();
      expect(costOnSheet(slot({ pactOnly: true }), [], pactCaster)).toBeDefined();
      expect(costOnSheet(slot({ pactOnly: true }), [], caster)).toBeUndefined();
      expect(costOnSheet(slot({ pactOnly: true, minLevel: 4 }), [], pactCaster)).toBeUndefined();
    });

    it('keeps a slot turned into points only with that pool, under either name', () => {
      const refill = (pool: string) => ({ ...slot(), slotRefills: pool });
      expect(costOnSheet(refill('focus'), [pool('ki')], caster)?.slotRefills).toBe('ki');
      expect(costOnSheet(refill('focus'), [pool('focus')], caster)?.slotRefills).toBe('focus');
      expect(costOnSheet(refill('sorcery-points'), [pool('ki')], caster)).toBeUndefined();
    });

    it('keeps a Hit Point Die price for anyone with a die', () => {
      const die = { resource: HIT_DIE_COST, amount: 1 };
      expect(costOnSheet(die, [], caster)).toEqual(die);
      expect(costOnSheet(die, [], { slotTop: 0, hitDice: 0 })).toBeUndefined();
    });
  });
});

describe('slotsAndDice', () => {
  const block = (slots: number[], pactSlots?: { count: number; level: number }) =>
    ({ slots, ...(pactSlots !== undefined ? { pactSlots } : {}) }) as SpellcastingBlock;

  it('finds the highest slot, the pact slot and every Hit Point Die', () => {
    expect(slotsAndDice([block([4, 3, 2, 0])], { d10: 3, d6: 2 })).toEqual({
      slotTop: 3,
      pactLevel: undefined,
      hitDice: 5,
    });
    expect(slotsAndDice([block([0]), block([], { count: 2, level: 4 })], {})).toEqual({
      slotTop: 0,
      pactLevel: 4,
      hitDice: 0,
    });
  });
});
