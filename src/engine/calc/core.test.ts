import { describe, expect, it } from 'vitest';
import type { EffectInput, EffectOrigin } from '../types';
import { dv, effectsOf, withOverride } from './core';

const origin: EffectOrigin = { label: 'x', uid: 'x', type: 'custom' };

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
