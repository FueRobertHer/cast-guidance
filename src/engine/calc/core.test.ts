import { describe, expect, it } from 'vitest';
import type { Ability, DerivedAbility, EffectInput, EffectOrigin } from '../types';
import { bonusAmount, dv, effectsOf, withOverride } from './core';

const origin: EffectOrigin = { label: 'x', uid: 'x', type: 'custom' };

describe('bonusAmount', () => {
  const abilities = { wis: { mod: -1 }, cha: { mod: 3 } } as Record<Ability, DerivedAbility>;

  it.each([
    [4, 4],
    ['profBonus', 2],
    ['equalToProfBonus', 2],
    ['abilityMod:wis', -1],
    ['abilityModMin0:wis', 0],
    ['abilityModMin1:wis', 1],
    ['abilityMod:cha', 3],
    ['abilityModMin0:cha', 3],
    ['abilityModMin1:cha', 3],
  ] as const)('%s comes to %i', (amount, expected) => {
    expect(bonusAmount(amount, abilities, 2)).toBe(expected);
  });
});

describe('dv', () => {
  it('sums parts into value and base', () => {
    const v = dv([
      { label: 'a', amount: 2 },
      { label: 'b', amount: 3 },
    ]);
    expect(v).toMatchObject({ value: 5, base: 5, overridden: false });
    expect(v.parts).toHaveLength(2);
  });
});

describe('withOverride', () => {
  it('returns the value unchanged without an override', () => {
    const v = dv([{ label: 'a', amount: 5 }]);
    expect(withOverride(v, undefined)).toBe(v);
  });

  it('applies the override value while keeping parts and marking overridden', () => {
    const v = dv([{ label: 'a', amount: 5 }]);
    const o = withOverride(v, { value: 18 });
    expect(o.value).toBe(18);
    expect(o.base).toBe(5);
    expect(o.overridden).toBe(true);
    expect(o.parts).toEqual(v.parts);
  });
});

describe('effectsOf', () => {
  it('filters effects by kind', () => {
    const effects: EffectInput[] = [
      { origin, kind: 'acBonus', amount: 1 },
      { origin, kind: 'speedBonus', amount: 10 },
      { origin, kind: 'acBonus', amount: 2 },
    ];
    expect(effectsOf(effects, 'acBonus')).toHaveLength(2);
    expect(effectsOf(effects, 'speedBonus')).toEqual([{ origin, kind: 'speedBonus', amount: 10 }]);
    expect(effectsOf(effects, 'resist')).toEqual([]);
  });
});
