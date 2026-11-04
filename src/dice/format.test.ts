import { describe, expect, it } from 'vitest';
import { rollDetail } from './format';
import { roll } from './roll';

/** Deterministic RNG so the printed faces are the ones under test. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 1;
};

/** The working as one string, a dropped die in tildes as it is struck on screen. */
const detail = (result: ReturnType<typeof roll>) =>
  rollDetail(result)
    .map((p) => (p.dropped === true ? `~${p.text}~` : p.text))
    .join('');

describe('rollDetail', () => {
  it('prints faces then modifiers', () => {
    expect(detail(roll('2d6+3', { rng: seq(4, 5) }))).toBe('2d6 [4, 5] + 3');
  });

  it('names a single die without a count', () => {
    expect(detail(roll('1d8', { rng: seq(5) }))).toBe('d8 [5]');
  });

  it('marks dropped dice, and counts only the dice that were kept', () => {
    expect(detail(roll('4d6dl1', { rng: seq(2, 6, 3, 5) }))).toBe('3d6 [~2~, 6, 3, 5]');
  });

  it('writes a negative modifier with a true minus', () => {
    expect(detail(roll('1d20-2', { rng: seq(11) }))).toBe('d20 [11] − 2');
  });

  it('names the mode that rolled the second d20, after the dice', () => {
    expect(detail(roll('1d20+3', { rng: seq(17, 4), advantage: 'adv' }))).toBe(
      'd20 [17, ~4~] advantage + 3',
    );
    expect(detail(roll('1d20+3', { rng: seq(17, 4), advantage: 'dis' }))).toBe(
      'd20 [~17~, 4] disadvantage + 3',
    );
  });

  it('says nothing of a mode that rolled no second d20', () => {
    expect(detail(roll('1d6', { rng: seq(4), advantage: 'adv' }))).toBe('d6 [4]');
    expect(detail(roll('2d6+3', { rng: seq(4, 5), advantage: 'dis' }))).toBe('2d6 [4, 5] + 3');
  });

  it('says nothing of a modifier of zero', () => {
    expect(detail(roll('1d20+0', { rng: seq(7) }))).toBe('d20 [7]');
  });

  it('signs a second die group', () => {
    expect(detail(roll('1d8+1d6-1d4', { rng: seq(5, 3, 2) }))).toBe('d8 [5] + d6 [3] − d4 [2]');
  });

  it('shows a multiplier as its own factor', () => {
    expect(detail(roll('1d4×10', { rng: seq(3) }))).toBe('d4 [3] × 10');
    expect(detail(roll('1d10×1d10', { rng: seq(3, 7) }))).toBe('d10 [3] × d10 [7]');
  });
});
