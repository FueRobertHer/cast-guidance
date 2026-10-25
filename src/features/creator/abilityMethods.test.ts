// UX-001: the standard array was six free steppers with a sentence above them,
// so nothing kept the scores a permutation, and point buy said what was wrong
// only by turning a number red.
import { describe, expect, it } from 'vitest';
import { STANDARD_ARRAY } from '@/engine/calc/abilities';
import { ABILITIES } from '@/engine/types';
import {
  abilityIssue,
  isStandardArray,
  keepsOnPointBuySwitch,
  pointBuyStatus,
  type Scores,
  standardInOrder,
  stepCost,
  swapStandard,
} from './abilityMethods';

const s = (
  str: number,
  dex: number,
  con: number,
  int: number,
  wis: number,
  cha: number,
): Scores => ({
  str,
  dex,
  con,
  int,
  wis,
  cha,
});
const sorted = (b: Scores) =>
  ABILITIES.map((a) => b[a])
    .sort((x, y) => y - x)
    .join('/');

describe('swapStandard', () => {
  it('keeps a permutation for every ability and value', () => {
    const start = s(13, 15, 8, 12, 14, 10);
    for (const a of ABILITIES) {
      for (const v of STANDARD_ARRAY) {
        const next = swapStandard(start, a, v);
        expect(next[a]).toBe(v);
        expect(sorted(next)).toBe('15/14/13/12/10/8');
        // Only the two abilities in the swap move.
        expect(ABILITIES.filter((b) => next[b] !== start[b]).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('gives the old holder the value it took from', () => {
    expect(swapStandard(standardInOrder(), 'cha', 15)).toEqual(s(8, 14, 13, 12, 10, 15));
  });

  it('changes nothing on scores that are not the array, or for a value not in it', () => {
    const off = s(12, 16, 14, 10, 15, 8);
    expect(swapStandard(off, 'str', 15)).toEqual(off);
    expect(swapStandard(standardInOrder(), 'str', 9)).toEqual(standardInOrder());
  });
});

describe('isStandardArray', () => {
  it('needs each value exactly once', () => {
    expect(isStandardArray(s(8, 10, 12, 13, 14, 15))).toBe(true);
    expect(isStandardArray(s(10, 10, 10, 10, 10, 10))).toBe(false);
    expect(isStandardArray(s(15, 15, 13, 12, 10, 8))).toBe(false);
  });
});

describe('pointBuyStatus', () => {
  it('says the standard array spends exactly 27', () => {
    expect(pointBuyStatus(standardInOrder())).toEqual({ kind: 'exact', spent: 27 });
  });

  it('counts what is left, and what is over', () => {
    expect(pointBuyStatus(s(15, 14, 13, 12, 8, 9))).toEqual({ kind: 'under', spent: 26, left: 1 });
    expect(pointBuyStatus(s(15, 14, 13, 10, 10, 8))).toEqual({ kind: 'under', spent: 25, left: 2 });
    expect(pointBuyStatus(s(15, 15, 13, 12, 10, 8))).toEqual({ kind: 'over', spent: 29, over: 2 });
    expect(pointBuyStatus(s(15, 15, 14, 12, 10, 8))).toEqual({ kind: 'over', spent: 31, over: 4 });
  });

  it('names each score out of range and which side it is on', () => {
    expect(pointBuyStatus(s(16, 8, 8, 8, 8, 7))).toEqual({
      kind: 'range',
      out: [
        { ability: 'str', value: 16, side: 'high' },
        { ability: 'cha', value: 7, side: 'low' },
      ],
    });
  });
});

describe('stepCost', () => {
  it('is what one more point costs, and nothing past 15', () => {
    expect(stepCost(8)).toBe(1);
    expect(stepCost(13)).toBe(2);
    expect(stepCost(15)).toBeUndefined();
    expect(stepCost(3)).toBeUndefined();
  });
});

describe('keepsOnPointBuySwitch', () => {
  it('keeps a legal spread and resets the rest', () => {
    expect(keepsOnPointBuySwitch(standardInOrder())).toBe(true);
    expect(keepsOnPointBuySwitch(s(10, 10, 10, 10, 10, 10))).toBe(false);
    expect(keepsOnPointBuySwitch(s(16, 16, 8, 8, 8, 8))).toBe(false);
    expect(keepsOnPointBuySwitch(s(15, 15, 15, 12, 8, 8))).toBe(false);
  });
});

describe('abilityIssue', () => {
  it('reads each method on its own terms', () => {
    const all = (n: number) => s(n, n, n, n, n, n);
    expect(abilityIssue({ method: 'standard', base: all(10) })).toBe(
      'Ability scores not assigned (all still 10)',
    );
    expect(abilityIssue({ method: 'standard', base: s(12, 16, 14, 10, 15, 8) })).toBe(
      "Scores aren't the standard array",
    );
    expect(abilityIssue({ method: 'standard', base: standardInOrder() })).toBeUndefined();
    expect(abilityIssue({ method: 'pointbuy', base: s(16, 8, 8, 8, 8, 8) })).toBe(
      'Point-buy scores outside 8 to 15 (STR 16)',
    );
    expect(abilityIssue({ method: 'pointbuy', base: s(15, 15, 14, 12, 10, 8) })).toBe(
      'Point buy over budget (31 of 27)',
    );
    expect(abilityIssue({ method: 'pointbuy', base: all(8) })).toBe(
      'Ability scores not assigned (all still 8)',
    );
    // Points left over are legal: the step says so, Review does not nag.
    expect(abilityIssue({ method: 'pointbuy', base: s(15, 14, 13, 10, 10, 8) })).toBeUndefined();
    expect(abilityIssue({ method: 'manual', base: s(18, 3, 16, 10, 15, 8) })).toBeUndefined();
    expect(abilityIssue({ method: 'manual', base: all(10) })).toBe(
      'Ability scores not assigned (all still 10)',
    );
    expect(abilityIssue({ method: 'roll', base: s(12, 16, 14, 10, 15, 8) })).toBeUndefined();
  });
});
