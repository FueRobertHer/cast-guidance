/**
 * The rules of the creator's three ways to set ability scores (UX-001), kept
 * apart from the step that draws them so each can be checked on its own.
 *
 * Standard array: the scores are either a permutation of 15/14/13/12/10/8 (the
 * allocator) or not (nothing assigned yet, or scores carried over from another
 * method). There is no half-assigned state, because a score has no slot for
 * "unassigned" (10 is itself an array value), so every edit is a swap and the
 * permutation holds by construction.
 *
 * Point buy: any spread can be entered, so a deviation is always possible; the
 * status says in words what is off, and Manual is where the player says they
 * mean it.
 */
import {
  POINT_BUY_BUDGET,
  POINT_BUY_COSTS,
  pointBuyCost,
  STANDARD_ARRAY,
} from '@/engine/calc/abilities';
import { ABILITIES, type Ability, type CharacterDoc } from '@/engine/types';

export type Scores = Record<Ability, number>;
type Method = CharacterDoc['abilities']['method'];

export const ABILITY_NAMES: Readonly<Record<Ability, string>> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

const ARRAY_KEY = [...STANDARD_ARRAY].sort((a, b) => b - a).join('/');

/** Whether the six scores use each standard-array value exactly once. */
export function isStandardArray(base: Scores): boolean {
  return (
    ABILITIES.map((a) => base[a])
      .sort((a, b) => b - a)
      .join('/') === ARRAY_KEY
  );
}

/** The ability holding `value`, if any does. */
export function holderOf(base: Scores, value: number): Ability | undefined {
  return ABILITIES.find((a) => base[a] === value);
}

/**
 * Give `ability` the array value `value`, and the ability that held it the
 * value `ability` had. Unchanged unless `base` is a standard array and `value`
 * one of its values, so the result is always a permutation too.
 */
export function swapStandard(base: Scores, ability: Ability, value: number): Scores {
  const out = { ...base };
  if (!isStandardArray(base)) return out;
  const holder = holderOf(base, value);
  if (holder === undefined) return out;
  out[holder] = base[ability];
  out[ability] = value;
  return out;
}

/** The array laid down in order, STR 15 down to CHA 8: a start to swap from. */
export function standardInOrder(): Scores {
  const out = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  ABILITIES.forEach((a, i) => {
    out[a] = STANDARD_ARRAY[i] ?? 10;
  });
  return out;
}

export const allAt = (base: Scores, n: number) => ABILITIES.every((a) => base[a] === n);

/** "12/16/14/10/15/8", in STR to CHA order. */
export const scoresLine = (base: Scores) => ABILITIES.map((a) => base[a]).join('/');

export type PointBuyStatus =
  | {
      kind: 'range';
      out: Array<{ ability: Ability; value: number; side: 'low' | 'high' }>;
    }
  | { kind: 'over'; spent: number; over: number }
  | { kind: 'under'; spent: number; left: number }
  | { kind: 'exact'; spent: number };

/**
 * Where a point-buy spread stands. Out of range comes first: a score outside
 * 8 to 15 has no cost, so there is no total to compare with the budget.
 */
export function pointBuyStatus(base: Scores): PointBuyStatus {
  const out = ABILITIES.filter((a) => base[a] < POINT_BUY_MIN || base[a] > POINT_BUY_MAX).map(
    (a) => ({
      ability: a,
      value: base[a],
      side: base[a] < POINT_BUY_MIN ? ('low' as const) : ('high' as const),
    }),
  );
  const spent = pointBuyCost(base);
  if (out.length > 0 || spent === undefined) return { kind: 'range', out };
  if (spent > POINT_BUY_BUDGET) return { kind: 'over', spent, over: spent - POINT_BUY_BUDGET };
  if (spent < POINT_BUY_BUDGET) return { kind: 'under', spent, left: POINT_BUY_BUDGET - spent };
  return { kind: 'exact', spent };
}

/** What one more point in a score costs on top of its current cost, if it can go up. */
export function stepCost(score: number): number | undefined {
  const now = POINT_BUY_COSTS[score];
  const next = POINT_BUY_COSTS[score + 1];
  return now === undefined || next === undefined ? undefined : next - now;
}

/**
 * Whether switching to point buy keeps these scores: a legal spread does (the
 * standard array costs exactly 27, so it carries over). Anything else resets
 * to 8s, the all-10 "nothing assigned" state included.
 */
export function keepsOnPointBuySwitch(base: Scores): boolean {
  const spent = pointBuyCost(base);
  return spent !== undefined && spent <= POINT_BUY_BUDGET && !allAt(base, 10);
}

/**
 * What Review lists about the scores, if anything, for the method in use.
 * Manual (and the unused "roll") is the player saying they mean it, so only
 * the untouched all-10 state is mentioned there. A point-buy spread with
 * points left over is legal and gets no issue, only the step's own cue.
 */
export function abilityIssue(abilities: { method: Method; base: Scores }): string | undefined {
  const { method, base } = abilities;
  if (method === 'pointbuy') {
    const status = pointBuyStatus(base);
    if (status.kind === 'range') {
      const named = status.out.map((o) => `${o.ability.toUpperCase()} ${o.value}`).join(', ');
      return `Point-buy scores outside 8 to 15 (${named})`;
    }
    if (status.kind === 'over') {
      return `Point buy over budget (${status.spent} of ${POINT_BUY_BUDGET})`;
    }
    if (allAt(base, POINT_BUY_MIN)) return 'Ability scores not assigned (all still 8)';
    return undefined;
  }
  if (allAt(base, 10)) return 'Ability scores not assigned (all still 10)';
  if (method === 'standard' && !isStandardArray(base)) return "Scores aren't the standard array";
  return undefined;
}
