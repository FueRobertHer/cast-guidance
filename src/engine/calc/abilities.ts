import {
  ABILITIES,
  type Ability,
  abilityMod,
  type CharacterDoc,
  type DerivedAbility,
  type EffectInput,
} from '../types';
import { effectsOf } from './core';

export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};
export const POINT_BUY_BUDGET = 27;
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

export function pointBuyCost(scores: Record<Ability, number>): number | undefined {
  let total = 0;
  for (const a of ABILITIES) {
    const cost = POINT_BUY_COSTS[scores[a]];
    if (cost === undefined) return undefined; // out of 8–15 range
    total += cost;
  }
  return total;
}

export function calcAbilities(
  doc: CharacterDoc,
  effects: readonly EffectInput[],
): Record<Ability, DerivedAbility> {
  const out = {} as Record<Ability, DerivedAbility>;
  const bonuses = effectsOf(effects, 'abilityBonus');
  const mins = effectsOf(effects, 'abilityMin');

  for (const a of ABILITIES) {
    const parts: Array<{ label: string; amount: number }> = [
      { label: 'Base', amount: doc.abilities.base[a] },
    ];
    for (const b of bonuses) {
      if (b.ability === a) parts.push({ label: b.origin.label, amount: b.amount });
    }
    let value = parts.reduce((s, p) => s + p.amount, 0);
    if (value > 20) {
      parts.push({ label: 'Cap (20)', amount: 20 - value });
      value = 20;
    }
    for (const m of mins) {
      if (m.ability === a && value < m.min) {
        parts.push({ label: `${m.origin.label} (minimum)`, amount: m.min - value });
        value = m.min;
      }
    }
    const override = doc.overrides[`ability.${a}`];
    const final = override !== undefined ? override.value : value;
    out[a] = {
      value: final,
      base: value,
      overridden: override !== undefined,
      parts,
      mod: abilityMod(final),
    };
  }
  return out;
}
