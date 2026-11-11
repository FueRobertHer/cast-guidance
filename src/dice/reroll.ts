import { cryptoRng } from './roll';
import type { RollResult } from './types';

/** A reroll of a d20 test's d20, named for what gives it (the engine's `Reroll`). */
export interface RerollHow {
  source: string;
  die?: 'all' | 'one' | 'low' | 'extra';
  atMost?: number;
  bonus?: number;
}

/**
 * The roll with its d20 rerolled, as `how` says: every d20 again in the
 * roll's mode (`all`, as unset); one die showing `atMost` or less, the kept
 * one first (`one`); the lower die of advantage (`low`); or one d20 more,
 * keeping the best (`extra`). A die set aside stays in the working, dropped
 * and out of later rerolls, and the new one follows. The mode keeps a die
 * again, and the total, the natural and an attack's crit follow it; a bonus
 * (2024 Indomitable) joins as a term named for its source. Undefined when it
 * can change nothing: no die shows low enough, or `low` with no advantage.
 */
export function rerollD20(
  result: RollResult,
  how: RerollHow,
  rng: (sides: number) => number = cryptoRng,
): RollResult | undefined {
  const [first, ...rest] = result.terms;
  if (first?.kind !== 'dice' || first.sides !== 20) return undefined;
  const mode = result.meta?.advantage;
  const rolls = first.rolls.map((r) => ({ ...r }));
  const was = rolls.find((r) => r.kept);
  if (was === undefined) return undefined;
  const live = rolls.filter((r) => r.out !== true);
  const die = how.die ?? 'all';
  let aside = live;
  if (die === 'one') {
    const atMost = how.atMost ?? 1;
    const low = was.v <= atMost ? was : live.find((r) => r.v <= atMost);
    if (low === undefined) return undefined;
    aside = [low];
  } else if (die === 'low') {
    if (mode !== 'adv' || live.length < 2) return undefined;
    aside = [live.reduce((a, b) => (b.v < a.v ? b : a))];
  } else if (die === 'extra') aside = [];
  for (const r of aside) {
    r.out = true;
    r.kept = false;
  }
  const count = die === 'all' && mode !== undefined ? 2 : 1;
  for (let i = 0; i < count; i++) rolls.push({ v: rng(20), kept: false });
  const pool = rolls.filter((r) => r.out !== true);
  // The best under 2014 Lucky's choice; else as the mode keeps, the first of a tie.
  const lowest = die !== 'extra' && mode === 'dis';
  const keep = pool.reduce((a, b) => ((lowest ? b.v < a.v : b.v > a.v) ? b : a));
  for (const r of rolls) r.kept = r === keep;
  if (die === 'extra') for (const r of pool) if (r !== keep) r.out = true;
  const terms: RollResult['terms'] = [{ ...first, rolls }, ...rest];
  const from = [...(result.meta?.from ?? [])];
  const bonus = how.bonus ?? 0;
  if (bonus > 0) {
    from.push({ term: terms.length, source: how.source });
    terms.push({ kind: 'mod', value: bonus });
  }
  const attack = result.meta?.attack;
  return {
    ...result,
    total: result.total - was.v + keep.v + Math.max(0, bonus),
    terms,
    meta: {
      ...result.meta,
      d20: { natural: keep.v },
      rerolled: [...(result.meta?.rerolled ?? []), how.source],
      ...(from.length > 0 ? { from } : {}),
      ...(attack !== undefined
        ? { attack: { ...attack, crit: keep.v >= (attack.critFrom ?? 20) } }
        : {}),
    },
  };
}

/** Could this reroll change the roll as it stands: is there a die it rerolls? */
export function canReroll(result: RollResult, how: RerollHow): boolean {
  return rerollD20(result, how, () => 1) !== undefined;
}
