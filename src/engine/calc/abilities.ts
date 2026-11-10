import {
  ABILITIES,
  type Ability,
  abilityMod,
  type CharacterDoc,
  type DerivedAbility,
  type EffectInput,
} from '../types';
import { effectsOf, inPlay } from './core';

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
      if (b.ability === a && b.max === undefined) {
        parts.push({ label: b.origin.label, amount: b.amount });
      }
    }
    let value = parts.reduce((s, p) => s + p.amount, 0);
    if (value > 20) {
      parts.push({ label: 'Cap (20)', amount: 20 - value });
      value = 20;
    }
    // A bonus that raises the cap goes on top of a score held to 20, the lowest
    // cap first, so a higher one later (an Epic Boon's 30) still has room.
    const raising = bonuses
      .filter((b) => b.ability === a && b.max !== undefined)
      .sort((x, y) => (x.max ?? 0) - (y.max ?? 0));
    // A cap stops the bonus, never takes the score below where it stood: a
    // maximum of 18 on a score of 20 leaves it 20.
    for (const b of raising) {
      const max = b.max ?? 20;
      const cap = Math.max(max, value);
      parts.push({ label: b.origin.label, amount: b.amount });
      value += b.amount;
      if (value > cap) {
        parts.push({ label: `Cap (${max})`, amount: cap - value });
        value = cap;
      }
    }
    for (const m of mins) {
      if (m.ability === a && !inPlay(m) && value < m.min) {
        parts.push({ label: `${m.origin.label} (minimum)`, amount: m.min - value });
        value = m.min;
      }
    }
    const override = doc.overrides[`ability.${a}`];
    let final = override !== undefined ? override.value : value;
    // A floor from something in play (a Potion of Giant Strength) holds over
    // an override too, since it is not part of the build the override corrects.
    // Its part raises the computed score by as much, so the parts still sum to it.
    for (const m of mins) {
      if (m.ability !== a || !inPlay(m) || final >= m.min) continue;
      const amount = m.min - final;
      parts.push({ label: `${m.origin.label} (minimum)`, amount });
      final += amount;
      value += amount;
    }
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
