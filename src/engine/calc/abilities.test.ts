import { describe, expect, it } from 'vitest';
import {
  type Ability,
  type CharacterDoc,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
} from '../types';
import { calcAbilities, POINT_BUY_BUDGET, pointBuyCost, STANDARD_ARRAY } from './abilities';

const origin: EffectOrigin = { label: 'Race', uid: 'race|x', type: 'race' };

function scores(over: Partial<Record<Ability, number>>): Record<Ability, number> {
  return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...over };
}

function doc(base: Partial<Record<Ability, number>>): CharacterDoc {
  const d = newCharacterDoc('c', 'Hero', 'tag');
  d.abilities.base = scores(base);
  return d;
}

describe('pointBuyCost', () => {
  it('costs 0 for all 8s and matches the budget for the standard spread', () => {
    expect(pointBuyCost(scores({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }))).toBe(0);
    const [a, b, c, e, f, g] = STANDARD_ARRAY;
    expect(pointBuyCost({ str: a, dex: b, con: c, int: e, wis: f, cha: g })).toBe(POINT_BUY_BUDGET);
  });

  it('returns undefined for a score outside 8–15', () => {
    expect(pointBuyCost(scores({ str: 16 }))).toBeUndefined();
    expect(pointBuyCost(scores({ str: 7 }))).toBeUndefined();
  });
});

describe('calcAbilities', () => {
  it('adds ability bonuses and computes the modifier', () => {
    const effects: EffectInput[] = [{ origin, kind: 'abilityBonus', ability: 'str', amount: 2 }];
    const out = calcAbilities(doc({ str: 13 }), effects);
    expect(out.str.value).toBe(15);
    expect(out.str.mod).toBe(2);
    expect(out.str.parts).toContainEqual({ label: 'Race', amount: 2 });
  });

  it('caps a total above 20 at 20', () => {
    const effects: EffectInput[] = [{ origin, kind: 'abilityBonus', ability: 'con', amount: 4 }];
    const out = calcAbilities(doc({ con: 19 }), effects);
    expect(out.con.value).toBe(20);
    expect(out.con.parts).toContainEqual({ label: 'Cap (20)', amount: -3 });
  });

  it('lets a bonus with a max go past 20, after the rest is held to 20', () => {
    const champion: EffectOrigin = { label: 'Primal Champion', uid: 'class|x', type: 'class' };
    const raise: EffectInput = {
      origin: champion,
      kind: 'abilityBonus',
      ability: 'str',
      amount: 4,
      max: 24,
    };
    // 19 + 2 is held to 20 before the 4 goes on.
    const over = calcAbilities(doc({ str: 19 }), [
      { origin, kind: 'abilityBonus', ability: 'str', amount: 2 },
      raise,
    ]);
    expect(over.str.value).toBe(24);
    expect(over.str.parts).toContainEqual({ label: 'Cap (20)', amount: -1 });
    expect(over.str.parts).toContainEqual({ label: 'Primal Champion', amount: 4 });
    // A base over 20 is held to 20 first too.
    expect(calcAbilities(doc({ str: 22 }), [raise]).str.value).toBe(24);
    // Under the cap it is a plain +4.
    expect(calcAbilities(doc({ str: 15 }), [raise]).str.value).toBe(19);
    // Its own cap holds.
    const capped = calcAbilities(doc({ str: 20 }), [{ ...raise, amount: 6 }]);
    expect(capped.str.value).toBe(24);
    expect(capped.str.parts).toContainEqual({ label: 'Cap (24)', amount: -2 });
  });

  it('applies the lowest raised cap first, so a higher one keeps its room', () => {
    const at = (label: string): EffectOrigin => ({ label, uid: label, type: 'feat' });
    const effects: EffectInput[] = [
      { origin: at('Boon'), kind: 'abilityBonus', ability: 'str', amount: 1, max: 30 },
      { origin: at('Champion'), kind: 'abilityBonus', ability: 'str', amount: 4, max: 24 },
    ];
    expect(calcAbilities(doc({ str: 20 }), effects).str.value).toBe(25);
  });

  it('raises a score to an abilityMin floor', () => {
    const effects: EffectInput[] = [{ origin, kind: 'abilityMin', ability: 'wis', min: 13 }];
    const out = calcAbilities(doc({ wis: 10 }), effects);
    expect(out.wis.value).toBe(13);
  });

  it('an explicit override wins and reports base separately', () => {
    const d = doc({ dex: 12 });
    d.overrides = { 'ability.dex': { value: 18 } };
    const out = calcAbilities(d, []);
    expect(out.dex.value).toBe(18);
    expect(out.dex.base).toBe(12);
    expect(out.dex.overridden).toBe(true);
    expect(out.dex.mod).toBe(4);
  });
});
