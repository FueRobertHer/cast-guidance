import { afterEach, describe, expect, it } from 'vitest';
import { cryptoRng, roll, setTableCrit } from './roll';

afterEach(() => setTableCrit('doubleDice'));

/** RNG stub that returns a fixed sequence regardless of sides. */
function seq(...values: number[]): (sides: number) => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] as number;
    i++;
    return v;
  };
}

describe('roll', () => {
  it('sums dice and modifiers', () => {
    const r = roll('2d6+3', { rng: seq(4, 5) });
    expect(r.total).toBe(12);
    expect(r.terms).toEqual([
      {
        kind: 'dice',
        sign: 1,
        sides: 6,
        rolls: [
          { v: 4, kept: true },
          { v: 5, kept: true },
        ],
      },
      { kind: 'mod', value: 3 },
    ]);
  });

  it('handles negative dice terms', () => {
    const r = roll('10 - 1d4', { rng: seq(3) });
    expect(r.total).toBe(7);
  });

  it('multiplies by constant and dice factors', () => {
    expect(roll('1d4×10', { rng: seq(3) }).total).toBe(30);
    const result = roll('1d10×1d10', { rng: seq(3, 4) });
    expect(result.total).toBe(12);
    expect(result.terms.at(-1)).toEqual({
      kind: 'multiplier',
      value: 4,
      detail: {
        kind: 'dice',
        sign: 1,
        sides: 10,
        rolls: [{ v: 4, kept: true }],
      },
    });
  });

  it('keeps highest with kh', () => {
    const r = roll('2d20kh1', { rng: seq(7, 18) });
    expect(r.total).toBe(18);
    const dice = r.terms[0];
    if (dice?.kind !== 'dice') throw new Error('expected dice term');
    expect(dice.rolls).toEqual([
      { v: 7, kept: false },
      { v: 18, kept: true },
    ]);
  });

  it('keeps lowest with kl', () => {
    const r = roll('2d20kl1', { rng: seq(7, 18) });
    expect(r.total).toBe(7);
  });

  it('drops lowest with dl (4d6dl1 ability roll)', () => {
    const r = roll('4d6dl1', { rng: seq(3, 1, 6, 4) });
    expect(r.total).toBe(13);
    const dice = r.terms[0];
    if (dice?.kind !== 'dice') throw new Error('expected dice term');
    expect(dice.rolls.map((x) => x.kept)).toEqual([true, false, true, true]);
  });

  it('drops highest with dh', () => {
    const r = roll('3d6dh1', { rng: seq(2, 6, 4) });
    expect(r.total).toBe(6);
  });

  it('breaks ties by position when keeping', () => {
    const r = roll('2d20kh1', { rng: seq(10, 10) });
    const dice = r.terms[0];
    if (dice?.kind !== 'dice') throw new Error('expected dice term');
    expect(dice.rolls).toEqual([
      { v: 10, kept: true },
      { v: 10, kept: false },
    ]);
    expect(r.total).toBe(10);
  });

  describe('advantage / disadvantage', () => {
    it('rewrites a leading 1d20 to 2d20kh1 under advantage', () => {
      const r = roll('1d20+5', { advantage: 'adv', rng: seq(8, 15) });
      expect(r.total).toBe(20);
      expect(r.meta?.advantage).toBe('adv');
      expect(r.meta?.d20?.natural).toBe(15);
    });

    it('takes the lower die under disadvantage', () => {
      const r = roll('1d20+5', { advantage: 'dis', rng: seq(8, 15) });
      expect(r.total).toBe(13);
      expect(r.meta?.d20?.natural).toBe(8);
    });

    it('does not rewrite non-d20 or multi-die leading terms', () => {
      const r = roll('2d6+1', { advantage: 'adv', rng: seq(3, 4) });
      expect(r.total).toBe(8);
      const dice = r.terms[0];
      if (dice?.kind !== 'dice') throw new Error('expected dice term');
      expect(dice.rolls).toHaveLength(2);
    });

    it('does not rewrite an explicit 2d20kh1', () => {
      const r = roll('2d20kh1', { advantage: 'adv', rng: seq(4, 11) });
      const dice = r.terms[0];
      if (dice?.kind !== 'dice') throw new Error('expected dice term');
      expect(dice.rolls).toHaveLength(2);
      expect(r.total).toBe(11);
    });
  });

  describe('critical', () => {
    it('doubles dice counts but not modifiers', () => {
      const r = roll('2d6+4', { critical: true, rng: seq(1, 2, 3, 4) });
      expect(r.total).toBe(1 + 2 + 3 + 4 + 4);
      expect(r.meta?.critical).toBe(true);
      const dice = r.terms[0];
      if (dice?.kind !== 'dice') throw new Error('expected dice term');
      expect(dice.rolls).toHaveLength(4);
      expect(dice.maxed).toBeUndefined();
      expect(r.meta?.critRule).toBeUndefined();
    });

    // The Rules board's greataxe: 1d12 + 4, the d12 showing 9 (and 5 when rolled again).
    it('as written, rolls the dice twice: 2d12 + 4', () => {
      expect(roll('1d12+4', { critical: true, rng: seq(9, 5) }).total).toBe(18);
    });

    it('under max then roll, counts each die at its maximum and rolls it: 12 + 1d12 + 4', () => {
      const r = roll('1d12+4', { critical: true, crit: 'maxPlusRoll', rng: seq(5) });
      expect(r.total).toBe(12 + 5 + 4);
      expect(r.meta).toMatchObject({ critical: true, critRule: 'maxPlusRoll' });
      const dice = r.terms[0];
      if (dice?.kind !== 'dice') throw new Error('expected dice term');
      expect(dice.rolls).toEqual([
        { v: 12, kept: true },
        { v: 5, kept: true },
      ]);
      expect(dice.maxed).toBe(1);
    });

    it('under double the total, rolls once and doubles the dice and modifiers: (1d12 + 4) x 2', () => {
      const r = roll('1d12+4', { critical: true, crit: 'doubleTotal', rng: seq(9) });
      expect(r.total).toBe((9 + 4) * 2);
      expect(r.terms.at(-1)).toEqual({
        kind: 'multiplier',
        value: 2,
        detail: { kind: 'mod', value: 2 },
      });
      expect(r.meta?.critRule).toBe('doubleTotal');
    });

    it('follows the table’s rule unless the roll names its own, and only on a critical', () => {
      setTableCrit('maxPlusRoll');
      expect(roll('1d6+1', { critical: true, rng: seq(2) }).total).toBe(6 + 2 + 1);
      expect(roll('1d6+1', { critical: true, crit: 'doubleDice', rng: seq(2, 3) }).total).toBe(6);
      expect(roll('1d6+1', { rng: seq(2) }).total).toBe(3);
      setTableCrit('doubleTotal');
      expect(roll('1d6+1', { critical: true, rng: seq(2) }).total).toBe(6);
      expect(roll('1d6+1', { rng: seq(2) }).meta).toBeUndefined();
    });
  });

  it('reports the natural d20 on a plain roll', () => {
    const r = roll('1d20+7', { rng: seq(20) });
    expect(r.meta?.d20?.natural).toBe(20);
    expect(r.total).toBe(27);
  });

  it('does not report d20 meta for damage rolls', () => {
    const r = roll('2d6+3', { rng: seq(1, 1) });
    expect(r.meta).toBeUndefined();
  });

  it('carries label and origin', () => {
    const r = roll('1d20', { label: 'Stealth check', origin: 'skill', rng: seq(10) });
    expect(r.label).toBe('Stealth check');
    expect(r.origin).toBe('skill');
  });

  it('accepts a pre-parsed ast', () => {
    const r = roll(
      { expr: '1d4', terms: [{ kind: 'dice', sign: 1, count: 1, sides: 4 }] },
      { rng: seq(2) },
    );
    expect(r.total).toBe(2);
  });
});

describe('cryptoRng', () => {
  it('stays in range across many rolls', () => {
    for (const sides of [2, 6, 20, 100]) {
      for (let i = 0; i < 1000; i++) {
        const v = cryptoRng(sides);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(sides);
      }
    }
  });

  it('hits both extremes of a d6 within 1000 rolls', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(cryptoRng(6));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(6)).toBe(true);
  });
});
