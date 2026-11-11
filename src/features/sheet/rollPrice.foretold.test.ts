// Inspiration and Portent's foretold numbers as the sheet prices them: offered
// only while the character has them, and paid for by spending them.
import { describe, expect, it } from 'vitest';
import type { RollEffects } from '@/engine/playRules';
import type { DerivedResource, PlayState } from '@/engine/types';
import { payOffer, pricedRollEffects, refundOffer } from './rollPrice';

const PORTENT: DerivedResource = {
  key: 'portent',
  label: 'Portent',
  max: 2,
  resetOn: 'long',
  origin: 'Portent',
  foretell: true,
};
const sheet = { actions: [], resources: [PORTENT] };
const none: RollEffects = { dice: [], offers: [], advantage: [], disadvantage: [] };

const play = (
  extra: Partial<PlayState> = {},
): Pick<PlayState, 'resources' | 'turn'> & Partial<PlayState> => ({
  resources: [],
  turn: { action: false, bonus: false, reaction: false },
  inspiration: false,
  ...extra,
});

describe('Inspiration, priced', () => {
  const reroll: RollEffects = {
    ...none,
    rerolls: [{ source: 'Heroic Inspiration', die: 'one', atMost: 20, inspiration: true }],
  };
  const claim: RollEffects = {
    ...none,
    paid: [{ source: 'Inspiration', advantage: true, inspiration: true }],
  };
  const spent = { spends: [], reaction: false, words: 'is spent', inspiration: true };

  it('offers Heroic Inspiration’s reroll of one die while the character has it', () => {
    expect(pricedRollEffects(reroll, sheet, play({ inspiration: true })).rerollOffers).toEqual([
      {
        source: 'Heroic Inspiration',
        die: 'one',
        atMost: 20,
        ifFailed: false,
        pay: spent,
      },
    ]);
  });

  it('offers 2014 Inspiration’s advantage as a claim while the character has it', () => {
    expect(pricedRollEffects(claim, sheet, play({ inspiration: true })).declare).toEqual([
      { source: 'Inspiration', mode: 'adv', when: '', pay: spent },
    ]);
  });

  it('offers neither once it is spent, or with no play state', () => {
    for (const p of [play(), undefined]) {
      const r = pricedRollEffects(reroll, sheet, p);
      expect(r.rerollOffers).toBeUndefined();
      expect(pricedRollEffects(claim, sheet, p).declare).toBeUndefined();
    }
  });

  it('never prices it as a Use, whatever the sheet names Inspiration', () => {
    const named = {
      actions: [{ economy: 'none' as const, label: 'Inspiration', origin: 'Inspiration' }],
      resources: [{ ...PORTENT, key: 'inspiration', label: 'Inspiration', foretell: false }],
    };
    expect(pricedRollEffects(claim, named, play()).declare).toBeUndefined();
    expect(pricedRollEffects(claim, named, play({ inspiration: true })).declare?.[0]?.pay).toEqual(
      spent,
    );
  });
});

describe('foretold numbers, priced', () => {
  const told = (v: number) => ({
    source: 'Portent',
    v,
    pay: {
      spends: [{ key: 'portent', max: 2, amount: 1 }],
      reaction: false,
      words: `uses the foretold ${v}`,
      foretold: { key: 'portent', v },
    },
  });

  it('offers each number kept, once a number, with nothing else on the roll', () => {
    const p = play({ foretold: { portent: [17, 4, 17] } });
    expect(pricedRollEffects(none, sheet, p)).toEqual({ ...none, foretold: [told(17), told(4)] });
  });

  it('offers none while the pool has no use left, or before any are rolled', () => {
    const spentAll = play({ foretold: { portent: [9] }, resources: [{ key: 'portent', used: 2 }] });
    expect(pricedRollEffects(none, sheet, spentAll)).toBe(none);
    expect(pricedRollEffects(none, sheet, play())).toBe(none);
    expect(pricedRollEffects(none, sheet, undefined)).toBe(none);
  });

  it('offers no more numbers than the uses left, as the Play tab shows them', () => {
    const p = play({ foretold: { portent: [15, 6] }, resources: [{ key: 'portent', used: 1 }] });
    expect(pricedRollEffects(none, sheet, p).foretold).toEqual([told(15)]);
  });

  it('offers only a foretelling pool’s numbers', () => {
    const counted = { ...sheet, resources: [{ ...PORTENT, foretell: false }] };
    expect(pricedRollEffects(none, counted, play({ foretold: { portent: [11] } }))).toBe(none);
  });
});

describe('paying with Inspiration or a foretold number, and giving it back', () => {
  const fresh = (extra: Partial<PlayState> = {}): PlayState =>
    ({ resources: [], inspiration: false, ...extra }) as unknown as PlayState;

  it('spends Inspiration, and pays nothing without it', () => {
    const pay = { spends: [], reaction: false, words: 'is spent', inspiration: true };
    const p = fresh({ inspiration: true });
    expect(payOffer(p, pay)).toBe(true);
    expect(p.inspiration).toBe(false);
    expect(payOffer(p, pay)).toBe(false);
    refundOffer(p, pay);
    expect(p.inspiration).toBe(true);
  });

  it('takes one of the number and the pool’s use, and gives both back', () => {
    const pay = {
      spends: [{ key: 'portent', max: 3, amount: 1 }],
      reaction: false,
      words: 'uses the foretold 12',
      foretold: { key: 'portent', v: 12 },
    };
    const p = fresh({ foretold: { portent: [12, 5, 12] } });
    expect(payOffer(p, pay)).toBe(true);
    expect(p.foretold).toEqual({ portent: [5, 12] });
    expect(p.resources).toEqual([{ key: 'portent', used: 1 }]);
    refundOffer(p, pay);
    expect(p.foretold).toEqual({ portent: [5, 12, 12] });
    expect(p.resources).toEqual([{ key: 'portent', used: 0 }]);
  });

  it('leaves no empty list behind, and pays nothing for a number gone', () => {
    const pay = {
      spends: [{ key: 'portent', max: 2, amount: 1 }],
      reaction: false,
      words: 'uses the foretold 3',
      foretold: { key: 'portent', v: 3 },
    };
    const p = fresh({ foretold: { portent: [3] } });
    expect(payOffer(p, pay)).toBe(true);
    expect(p).not.toHaveProperty('foretold');
    expect(payOffer(p, pay)).toBe(false);
    expect(p.resources).toEqual([{ key: 'portent', used: 1 }]);
    const other = fresh({ foretold: { portent: [3], other: [8] } });
    payOffer(other, pay);
    expect(other.foretold).toEqual({ other: [8] });
  });

  it('pays nothing at all when the use is gone, though the number is kept', () => {
    const pay = {
      spends: [{ key: 'portent', max: 2, amount: 1 }],
      reaction: false,
      words: 'uses the foretold 3',
      foretold: { key: 'portent', v: 3 },
    };
    const p = fresh({ foretold: { portent: [3] }, resources: [{ key: 'portent', used: 2 }] });
    expect(payOffer(p, pay)).toBe(false);
    expect(p.foretold).toEqual({ portent: [3] });
  });
});
