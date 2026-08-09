import { describe, expect, it } from 'vitest';
import { rollDetail } from './format';
import { roll } from './roll';

/** Deterministic RNG so the printed faces are the ones under test. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 1;
};

describe('rollDetail', () => {
  it('prints faces then modifiers', () => {
    expect(rollDetail(roll('2d6+3', { rng: seq(4, 5) }))).toBe('[4,5] +3');
  });

  it('parenthesizes dropped dice', () => {
    expect(rollDetail(roll('4d6dl1', { rng: seq(2, 6, 3, 5) }))).toBe('[(2),6,3,5]');
  });

  it('keeps a negative modifier signed', () => {
    expect(rollDetail(roll('1d20-2', { rng: seq(11) }))).toBe('[11] -2');
  });

  it('shows a multiplier as its own factor', () => {
    expect(rollDetail(roll('1d4×10', { rng: seq(3) }))).toBe('[3] ×10');
  });
});
