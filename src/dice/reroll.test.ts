import { describe, expect, it } from 'vitest';
import { rollDetail } from './format';
import { canReroll, rawTotal, rerollD20, withRaw } from './reroll';
import { roll } from './roll';
import type { RollResult } from './types';

/** A d20 test rolled with these faces, in order. */
function rolled(expr: string, faces: number[], advantage?: 'adv' | 'dis'): RollResult {
  const queue = [...faces];
  return roll(expr, {
    ...(advantage !== undefined ? { advantage } : {}),
    rng: () => {
      const face = queue.shift();
      if (face === undefined) throw new Error('rolled more dice than the test set up');
      return face;
    },
  });
}
const faces = (...list: number[]) => {
  const queue = [...list];
  return () => {
    const face = queue.shift();
    if (face === undefined) throw new Error('rerolled more dice than the test set up');
    return face;
  };
};
const d20 = (r: RollResult) => {
  const t = r.terms[0];
  return t?.kind === 'dice' ? t.rolls : [];
};
const words = (r: RollResult) =>
  rollDetail(r)
    .map((p) => (p.dropped ? `~${p.text}~` : p.text))
    .join('');

describe('rerollD20', () => {
  it('rerolls the d20 of a plain roll, sets the old one aside, and keeps the new one', () => {
    const r = rerollD20(rolled('1d20+5', [7]), { source: 'Indomitable' }, faces(15));
    expect(r?.total).toBe(20);
    expect(r?.meta?.d20).toEqual({ natural: 15 });
    expect(d20(r as RollResult)).toEqual([
      { v: 7, kept: false, out: true },
      { v: 15, kept: true },
    ]);
    expect(r?.meta?.rerolled).toEqual(['Indomitable']);
    expect(words(r as RollResult)).toBe('d20 [~7~, 15] Indomitable reroll + 5');
  });

  it('keeps the new roll even when it is lower: the new roll stands', () => {
    const r = rerollD20(rolled('1d20+2', [12]), { source: 'Diamond Soul' }, faces(3));
    expect(r?.total).toBe(5);
    expect(r?.meta?.d20).toEqual({ natural: 3 });
  });

  it('rerolls both dice of advantage, and keeps the higher new one', () => {
    const r = rerollD20(rolled('1d20+1', [4, 6], 'adv'), { source: 'Indomitable' }, faces(9, 17));
    expect(r?.total).toBe(18);
    expect(d20(r as RollResult).map((x) => [x.v, x.kept, x.out === true])).toEqual([
      [4, false, true],
      [6, false, true],
      [9, false, false],
      [17, true, false],
    ]);
  });

  it('keeps the lower new die under disadvantage', () => {
    const r = rerollD20(rolled('1d20', [14, 16], 'dis'), { source: 'Living Legend' }, faces(2, 19));
    expect(r?.total).toBe(2);
  });

  it('adds a bonus with the new roll, as a term named for its source', () => {
    const r = rerollD20(
      rolled('1d20+3', [5]),
      { source: 'Indomitable', bonus: 13 },
      faces(8),
    ) as RollResult;
    expect(r.total).toBe(24);
    expect(r.terms.at(-1)).toEqual({ kind: 'mod', value: 13 });
    expect(r.meta?.from).toEqual([{ term: 2, source: 'Indomitable' }]);
    expect(words(r)).toBe('d20 [~5~, 8] Indomitable reroll + 3 + 13 Indomitable');
  });

  it('rerolls a 1 (Halfling Luck), and only a die that shows one', () => {
    const luck = { source: 'Luck', die: 'one' as const, atMost: 1 };
    expect(rerollD20(rolled('1d20', [2]), luck, faces(20))).toBeUndefined();
    const r = rerollD20(rolled('1d20+4', [1]), luck, faces(11));
    expect(r?.total).toBe(15);
    expect(r?.meta?.d20).toEqual({ natural: 11 });
  });

  it('rerolls only a 1 when a reroll of one die names no most', () => {
    const one = { source: 'Luck', die: 'one' as const };
    expect(canReroll(rolled('1d20', [2]), one)).toBe(false);
    expect(canReroll(rolled('1d20', [1]), one)).toBe(true);
  });

  it("rerolls advantage's 1 that was not kept, and keeps whichever is higher after", () => {
    const luck = { source: 'Luck', die: 'one' as const, atMost: 1 };
    const r = rerollD20(rolled('1d20', [1, 12], 'adv'), luck, faces(18)) as RollResult;
    expect(d20(r).map((x) => [x.v, x.kept, x.out === true])).toEqual([
      [1, false, true],
      [12, false, false],
      [18, true, false],
    ]);
    expect(r.total).toBe(18);
  });

  it("rerolls disadvantage's kept 1 first, then keeps the lower again", () => {
    const luck = { source: 'Luck', die: 'one' as const, atMost: 1 };
    const r = rerollD20(rolled('1d20', [9, 1], 'dis'), luck, faces(15)) as RollResult;
    expect(r.total).toBe(9);
    expect(d20(r)[1]).toEqual({ v: 1, kept: false, out: true });
  });

  it('rerolls the lowest die that shows low enough (Survivor, 9 or lower), so advantage never loses its kept die', () => {
    const low = { source: 'Survivor', die: 'one' as const, atMost: 9 };
    const r = rerollD20(rolled('1d20', [8, 3], 'adv'), low, faces(16)) as RollResult;
    expect(d20(r).map((x) => [x.v, x.kept, x.out === true])).toEqual([
      [8, false, false],
      [3, false, true],
      [16, true, false],
    ]);
    expect(r.total).toBe(16);
    // A worse new die leaves the 8 kept.
    expect(rerollD20(rolled('1d20', [8, 3], 'adv'), low, faces(1))?.total).toBe(8);
    expect(canReroll(rolled('1d20', [10]), low)).toBe(false);
  });

  it("rerolls disadvantage's kept die when both show low enough", () => {
    const low = { source: 'Survivor', die: 'one' as const, atMost: 9 };
    const r = rerollD20(rolled('1d20', [8, 3], 'dis'), low, faces(12)) as RollResult;
    expect(d20(r).map((x) => x.out === true)).toEqual([false, true, false]);
    expect(r.total).toBe(8);
  });

  it('rerolls the lower die of advantage (Elven Accuracy), and nothing without advantage', () => {
    const elven = { source: 'Elven Accuracy', die: 'low' as const };
    expect(canReroll(rolled('1d20', [5]), elven)).toBe(false);
    expect(canReroll(rolled('1d20', [5, 9], 'dis'), elven)).toBe(false);
    const r = rerollD20(rolled('1d20', [5, 9], 'adv'), elven, faces(14)) as RollResult;
    expect(d20(r).map((x) => [x.v, x.kept, x.out === true])).toEqual([
      [5, false, true],
      [9, false, false],
      [14, true, false],
    ]);
    // A low new die leaves the higher one kept.
    const low = rerollD20(rolled('1d20', [5, 9], 'adv'), elven, faces(2)) as RollResult;
    expect(low.total).toBe(9);
  });

  it('rolls one d20 more and keeps the best of them all (2014 Lucky), even under disadvantage', () => {
    const lucky = { source: 'Lucky', die: 'extra' as const };
    const r = rerollD20(rolled('1d20+2', [3, 15], 'dis'), lucky, faces(11)) as RollResult;
    expect(r.total).toBe(17);
    expect(r.meta?.d20).toEqual({ natural: 15 });
    // The others are set aside: a later reroll never picks them.
    expect(d20(r).map((x) => [x.v, x.kept, x.out === true])).toEqual([
      [3, false, true],
      [15, true, false],
      [11, false, true],
    ]);
  });

  it('never picks a die a reroll set aside', () => {
    const luck = { source: 'Luck', die: 'one' as const, atMost: 1 };
    const once = rerollD20(rolled('1d20', [1, 1], 'adv'), luck, faces(1)) as RollResult;
    // The first 1 is out; the second and the new 1 are live, so it can go again.
    const twice = rerollD20(once, luck, faces(6)) as RollResult;
    expect(d20(twice).filter((x) => x.out === true)).toHaveLength(2);
    expect(twice.total).toBe(6);
    expect(twice.meta?.rerolled).toEqual(['Luck', 'Luck']);
  });

  it("settles an attack's crit again by its range", () => {
    const attack = (crit: boolean, critFrom?: number) => ({
      ...rolled('1d20+5', [4]),
      meta: {
        d20: { natural: 4 },
        attack: { by: 'c1', of: 'Longsword', crit, ...(critFrom ? { critFrom } : {}) },
      },
    });
    expect(rerollD20(attack(false), { source: 'Seeking Spell' }, faces(20))?.meta?.attack).toEqual({
      by: 'c1',
      of: 'Longsword',
      crit: true,
    });
    expect(
      rerollD20(attack(false, 19), { source: 'Seeking Spell' }, faces(19))?.meta?.attack?.crit,
    ).toBe(true);
    expect(
      rerollD20(attack(false), { source: 'Seeking Spell' }, faces(19))?.meta?.attack?.crit,
    ).toBe(false);
  });

  it('changes nothing that does not lead with a d20', () => {
    expect(rerollD20(rolled('2d6+1', [3, 4]), { source: 'Indomitable' })).toBeUndefined();
  });

  it('leaves the roll it was given as it was', () => {
    const before = rolled('1d20', [1]);
    const copy = structuredClone(before);
    rerollD20(before, { source: 'Luck', die: 'one', atMost: 1 }, faces(9));
    expect(before).toEqual(copy);
  });
});

describe('rerollD20 setting a number', () => {
  const talent = { source: 'Reliable Talent', to: 10, atMost: 9 };
  const noDie = () => {
    throw new Error('a set rolls no die');
  };

  it('sets a kept d20 of 9 or lower to 10, the die it replaces set aside', () => {
    const r = rerollD20(rolled('1d20+7', [4]), talent, noDie) as RollResult;
    expect(r.total).toBe(17);
    expect(r.meta?.d20).toEqual({ natural: 10 });
    expect(d20(r)).toEqual([
      { v: 4, kept: false, out: true },
      { v: 10, kept: true },
    ]);
    expect(r.meta?.setBy).toEqual(['Reliable Talent']);
    expect(r.meta?.rerolled).toBeUndefined();
    expect(words(r)).toBe('d20 [~4~, 10] set by Reliable Talent + 7');
  });

  it('sets a 9 but not a 10 or more', () => {
    expect(rerollD20(rolled('1d20', [9]), talent, noDie)?.total).toBe(10);
    expect(rerollD20(rolled('1d20', [10]), talent, noDie)).toBeUndefined();
    expect(rerollD20(rolled('1d20', [15]), talent, noDie)).toBeUndefined();
    expect(canReroll(rolled('1d20', [9]), talent)).toBe(true);
    expect(canReroll(rolled('1d20', [10]), talent)).toBe(false);
  });

  it('sets only the die kept: under advantage a low die not kept changes nothing', () => {
    expect(rerollD20(rolled('1d20', [3, 14], 'adv'), talent, noDie)).toBeUndefined();
    const adv = rerollD20(rolled('1d20+1', [6, 3], 'adv'), talent, noDie) as RollResult;
    expect(adv.total).toBe(11);
    expect(d20(adv)).toEqual([
      { v: 6, kept: false, out: true },
      { v: 3, kept: false },
      { v: 10, kept: true },
    ]);
    const dis = rerollD20(rolled('1d20+1', [3, 15], 'dis'), talent, noDie) as RollResult;
    expect(dis.total).toBe(11);
    expect(dis.meta?.d20).toEqual({ natural: 10 });
  });

  it('sets any roll under the number when no most is named (Stroke of Luck), never a 20', () => {
    const luck = { source: 'Stroke of Luck', to: 20 };
    expect(rerollD20(rolled('1d20+3', [19]), luck, noDie)?.total).toBe(23);
    expect(rerollD20(rolled('1d20+3', [1]), luck, noDie)?.meta?.d20).toEqual({ natural: 20 });
    expect(rerollD20(rolled('1d20+3', [20]), luck, noDie)).toBeUndefined();
  });

  it("settles an attack's crit by the number it sets", () => {
    const attack = (face: number, critFrom?: number) => ({
      ...rolled('1d20+5', [face]),
      meta: {
        d20: { natural: face },
        attack: { by: 'c1', of: 'Dagger', crit: false, ...(critFrom ? { critFrom } : {}) },
      },
    });
    const luck = { source: 'Stroke of Luck', to: 20 };
    expect(rerollD20(attack(4), luck)?.meta?.attack).toEqual({
      by: 'c1',
      of: 'Dagger',
      crit: true,
    });
    expect(rerollD20(attack(1), talent)?.meta?.attack?.crit).toBe(false);
    expect(rerollD20(attack(1), { ...talent, to: 19 }, noDie)?.meta?.attack?.crit).toBe(false);
    expect(rerollD20(attack(1, 19), { ...talent, to: 19 }, noDie)?.meta?.attack?.crit).toBe(true);
  });

  it('names every set in order, after the rerolls before it', () => {
    const lucky = rerollD20(
      rolled('1d20', [1]),
      { source: 'Luck', die: 'one', atMost: 1 },
      faces(3),
    );
    const r = rerollD20(lucky as RollResult, talent, noDie) as RollResult;
    expect(r.total).toBe(10);
    expect(r.meta?.rerolled).toEqual(['Luck']);
    expect(r.meta?.setBy).toEqual(['Reliable Talent']);
    expect(words(r)).toBe('d20 [~1~, ~3~, 10] Luck reroll set by Reliable Talent');
    const again = rerollD20(
      rerollD20(
        rolled('1d20', [2]),
        { ...talent, source: 'Ear for Deceit', to: 8, atMost: 7 },
        noDie,
      ) as RollResult,
      talent,
      noDie,
    ) as RollResult;
    expect(again.total).toBe(10);
    expect(again.meta?.setBy).toEqual(['Ear for Deceit', 'Reliable Talent']);
  });

  it('leaves the roll it was given as it was', () => {
    const before = rolled('1d20', [2]);
    const copy = structuredClone(before);
    rerollD20(before, talent, noDie);
    expect(before).toEqual(copy);
  });
});

describe('rerollD20 holding a total up', () => {
  const might = { source: 'Indomitable Might', floor: 18 };

  it('counts a total under the floor as the floor, and says what the terms came to', () => {
    const r = rerollD20(rolled('1d20+4', [5]), might) as RollResult;
    expect(r.total).toBe(18);
    expect(r.meta?.floor).toEqual({ at: 18, source: 'Indomitable Might', raw: 9 });
    expect(r.meta?.d20).toEqual({ natural: 5 });
    expect(rawTotal(r)).toBe(9);
    expect(words(r)).toBe('d20 [5] + 4 = 9, set to 18 by Indomitable Might');
  });

  it('changes nothing at or over the floor, nor under a floor as high', () => {
    expect(rerollD20(rolled('1d20+4', [14]), might)).toBeUndefined();
    expect(rerollD20(rolled('1d20+4', [15]), might)).toBeUndefined();
    const held = rerollD20(rolled('1d20+4', [5]), might) as RollResult;
    expect(rerollD20(held, might)).toBeUndefined();
    expect(canReroll(rolled('1d20+4', [5]), might)).toBe(true);
  });

  it('keeps holding through a reroll, counted from what the terms come to', () => {
    const held = rerollD20(rolled('1d20+4', [5]), might) as RollResult;
    const low = rerollD20(held, { source: 'Indomitable' }, faces(2)) as RollResult;
    expect(low.total).toBe(18);
    expect(low.meta?.floor?.raw).toBe(6);
    const high = rerollD20(held, { source: 'Indomitable' }, faces(19)) as RollResult;
    expect(high.total).toBe(23);
    expect(words(high)).toBe('d20 [~5~, 19] Indomitable reroll + 4');
    const set = rerollD20(held, { source: 'Reliable Talent', to: 10, atMost: 9 }) as RollResult;
    expect(set.total).toBe(18);
    expect(set.meta?.floor?.raw).toBe(14);
  });

  it('counts a new total against the floor with withRaw, and a roll with none as it is', () => {
    const held = rerollD20(rolled('1d20+4', [5]), might) as RollResult;
    expect(withRaw(held, 12).total).toBe(18);
    expect(withRaw(held, 21)).toMatchObject({ total: 21, meta: { floor: { raw: 21 } } });
    expect(withRaw(rolled('1d20', [3]), 7).total).toBe(7);
    expect(rawTotal(rolled('1d20', [3]))).toBe(3);
  });
});
