import { cryptoRng } from './roll';
import type { RollResult } from './types';

/** A reroll of a d20 test's d20, named for what gives it (the engine's `Reroll`). */
export interface RerollHow {
  source: string;
  die?: 'all' | 'one' | 'low' | 'extra';
  atMost?: number;
  bonus?: number;
  /** A set, not a reroll: the kept d20, when it shows less, counts as this. */
  to?: number;
  /** A floor, not a reroll: the total counts as at least this (Indomitable Might). */
  floor?: number;
}

/** What a roll's terms come to, before a floor holds the total up. */
export function rawTotal(result: RollResult): number {
  return result.meta?.floor?.raw ?? result.total;
}

/** The roll with its terms coming to `raw`, its total held at its floor, if it has one. */
export function withRaw(result: RollResult, raw: number): RollResult {
  const floor = result.meta?.floor;
  if (floor === undefined) return { ...result, total: raw };
  return {
    ...result,
    total: Math.max(raw, floor.at),
    meta: { ...result.meta, floor: { ...floor, raw } },
  };
}

/**
 * The roll with its kept d20 set to `to`, as `how` says: the die it replaces
 * is set aside, and the natural and an attack's crit follow the new number.
 * Undefined when it can change nothing: the die shows `to` or more.
 */
function setD20(
  result: RollResult,
  first: Extract<RollResult['terms'][number], { kind: 'dice' }>,
  how: RerollHow & { to: number },
): RollResult | undefined {
  const rolls = first.rolls.map((r) => ({ ...r }));
  const was = rolls.find((r) => r.kept);
  if (was === undefined || was.v >= how.to) return undefined;
  was.kept = false;
  was.out = true;
  rolls.push({ v: how.to, kept: true });
  const attack = result.meta?.attack;
  const set: RollResult = {
    ...result,
    terms: [{ ...first, rolls }, ...result.terms.slice(1)],
    meta: {
      ...result.meta,
      d20: { natural: how.to },
      setBy: [...(result.meta?.setBy ?? []), how.source],
      ...(attack !== undefined
        ? { attack: { ...attack, crit: how.to >= (attack.critFrom ?? 20) } }
        : {}),
    },
  };
  return withRaw(set, rawTotal(result) - was.v + how.to);
}

/** The roll with a total under `at` counting as `at`; undefined when it is `at` or more. */
function floorTotal(result: RollResult, at: number, source: string): RollResult | undefined {
  const raw = rawTotal(result);
  if (raw >= at || (result.meta?.floor?.at ?? 0) >= at) return undefined;
  return withRaw({ ...result, meta: { ...result.meta, floor: { at, source, raw } } }, raw);
}

/**
 * The roll with its d20 rerolled, as `how` says: every d20 again in the
 * roll's mode (`all`, as unset); the lowest die showing `atMost` or less
 * (`one`); the lower die of advantage (`low`); or one d20 more,
 * keeping the best (`extra`). A die set aside stays in the working, dropped
 * and out of later rerolls, and the new one follows. The mode keeps a die
 * again, and the total, the natural and an attack's crit follow it; a bonus
 * (2024 Indomitable) joins as a term named for its source. Undefined when it
 * can change nothing: no die shows low enough, or `low` with no advantage.
 * A set (`to`) or a floor (`floor`) changes the roll in place of a reroll.
 */
export function rerollD20(
  result: RollResult,
  how: RerollHow,
  rng: (sides: number) => number = cryptoRng,
): RollResult | undefined {
  const [first, ...rest] = result.terms;
  if (first?.kind !== 'dice' || first.sides !== 20) return undefined;
  if (how.floor !== undefined) return floorTotal(result, how.floor, how.source);
  if (how.to !== undefined) return setD20(result, first, { ...how, to: how.to });
  const mode = result.meta?.advantage;
  const rolls = first.rolls.map((r) => ({ ...r }));
  const was = rolls.find((r) => r.kept);
  if (was === undefined) return undefined;
  const live = rolls.filter((r) => r.out !== true);
  const die = how.die ?? 'all';
  let aside = live;
  if (die === 'one') {
    const atMost = how.atMost ?? 1;
    // The lowest that shows low enough, the kept one on a tie: under advantage a
    // reroll of it never lowers the die kept; under disadvantage it is the one kept.
    const low = live.reduce<(typeof live)[number] | undefined>(
      (a, r) =>
        r.v > atMost ? a : a === undefined || r.v < a.v || (r.v === a.v && r === was) ? r : a,
      undefined,
    );
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
  return withRaw(
    {
      ...result,
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
    },
    rawTotal(result) - was.v + keep.v + Math.max(0, bonus),
  );
}

/** Could this reroll change the roll as it stands: is there a die it rerolls? */
export function canReroll(result: RollResult, how: RerollHow): boolean {
  return rerollD20(result, how, () => 1) !== undefined;
}
