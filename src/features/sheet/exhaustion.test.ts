import { describe, expect, it } from 'vitest';
import { exhaustionInfo, exhaustionLevel } from './exhaustion';

describe('exhaustionLevel', () => {
  it('reads the level and clamps to 0–6', () => {
    expect(exhaustionLevel([])).toBe(0);
    expect(exhaustionLevel([{ id: 'Poisoned' }])).toBe(0);
    expect(exhaustionLevel([{ id: 'Exhaustion', level: 3 }])).toBe(3);
    expect(exhaustionLevel([{ id: 'Exhaustion', level: 9 }])).toBe(6);
  });
});

describe('exhaustionInfo — 2014 cumulative table', () => {
  it('halves speed at 2, zeroes it at 5', () => {
    expect(exhaustionInfo(0, '2014').speedAfter(30)).toBe(30);
    expect(exhaustionInfo(1, '2014').speedAfter(30)).toBe(30);
    expect(exhaustionInfo(2, '2014').speedAfter(30)).toBe(15);
    expect(exhaustionInfo(5, '2014').speedAfter(30)).toBe(0);
  });

  it('accumulates effect lines and flags death at 6', () => {
    expect(exhaustionInfo(1, '2014').lines).toContain('Disadvantage on ability checks');
    expect(exhaustionInfo(4, '2014').lines).toContain('Hit point maximum halved');
    expect(exhaustionInfo(4, '2014').dead).toBe(false);
    expect(exhaustionInfo(6, '2014').dead).toBe(true);
  });
});

describe('exhaustionInfo — 2024 linear penalties', () => {
  it('reduces speed by 5 ft per level and states the d20 penalty', () => {
    expect(exhaustionInfo(3, '2024').speedAfter(30)).toBe(15); // 30 - 15
    expect(exhaustionInfo(3, '2024').lines).toContain(
      '−6 to all d20 tests (checks, attacks, saves)',
    );
    expect(exhaustionInfo(6, '2024').dead).toBe(true);
    expect(exhaustionInfo(6, '2024').speedAfter(30)).toBe(0);
  });
});
