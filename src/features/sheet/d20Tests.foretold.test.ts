// @vitest-environment jsdom
// A d20 test whose d20 is a number Portent foretold, chosen in the roll prompt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rollDetail } from '@/dice/format';
import type { RollResult } from '@/dice/types';
import { d20Effects } from '@/engine/conditions';
import type { RollEffects } from '@/engine/playRules';
import { rollTone } from '@/ui/rollTone';
import { d20Ask } from './d20Tests';

/** The faces the next dice show, in order (the roller draws from crypto). */
function nextFaces(...faces: number[]) {
  const queue = [...faces];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
    const face = queue.shift();
    if (face === undefined) throw new Error('rolled more dice than the test set up');
    if (buf instanceof Uint32Array) buf[0] = face - 1;
    return buf;
  });
}

afterEach(() => vi.restoreAllMocks());

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
const riders = (over: Partial<RollEffects> = {}): RollEffects => ({
  dice: [],
  offers: [],
  advantage: [],
  disadvantage: [],
  ...over,
});
const words = (r: RollResult) =>
  rollDetail(r)
    .map((p) => (p.dropped ? `~${p.text}~` : p.text))
    .join('');

describe('a foretold number in place of the d20', () => {
  it('is the d20, with the effects’ dice still rolled and no mode, and the working says so', () => {
    const ask = d20Ask('1d20+5', {
      label: 'WIS save',
      riders: riders({
        advantage: ['Foresight'],
        dice: [{ dice: '1d4', source: 'Bless' }],
        foretold: [told(17), told(4)],
      }),
    });
    expect(ask.foretold.map((f) => f.v)).toEqual([17, 4]);
    expect(ask.formula()).toBe('d20 +5 + d4 Bless, advantage');
    expect(ask.formula({ foretold: 0 })).toBe('17 Portent +5 + d4 Bless');
    expect(ask.cueFor('adv', { foretold: 0 })).toBe(
      'Advantage does not count: Portent foretold the d20',
    );
    // Only Bless's d4 is rolled: one die for advantage's pair would throw here.
    nextFaces(3);
    const r = ask.roll({ mode: 'adv', foretold: 0 });
    expect(r.total).toBe(25);
    expect(r.meta?.d20).toEqual({ natural: 17 });
    expect(r.meta?.advantage).toBeUndefined();
    expect(r.meta?.foretold).toBe('Portent');
    expect(words(r)).toBe('d20 [17] foretold by Portent + 5 + d4 [3] Bless');
    expect(r.meta?.cue).toBe('Advantage does not count: Portent foretold the d20');
  });

  it('counts for nothing a mode picked by hand, and says so', () => {
    const ask = d20Ask('1d20+2', { label: 'DEX check', riders: riders({ foretold: [told(9)] }) });
    expect(ask.cueFor('dis', { foretold: 0 })).toBe(
      'Disadvantage does not count: Portent foretold the d20',
    );
    expect(ask.cueFor('normal', { foretold: 0 })).toBe('');
    nextFaces();
    const r = ask.roll({ mode: 'dis', foretold: 0 });
    expect(r.total).toBe(11);
    expect(r.terms[0]).toMatchObject({ kind: 'dice', sides: 20, rolls: [{ v: 9, kept: true }] });
  });

  it('crits an attack on a foretold 20 and misses it on a foretold 1, as a rolled one would', () => {
    const ask = () =>
      d20Ask('1d20+5', {
        label: 'Dagger attack',
        riders: riders({ foretold: [told(20), told(1)] }),
        settlesOnNatural: true,
        attack: { by: 'c1', of: 'Dagger' },
      });
    nextFaces();
    const crit = ask().roll({ foretold: 0 });
    expect(crit.meta?.attack?.crit).toBe(true);
    expect(rollTone(crit)).toBe('crit');
    const miss = ask().roll({ foretold: 1 });
    expect(miss.meta?.d20?.natural).toBe(1);
    expect(miss.meta?.attack?.crit).toBe(false);
  });

  it('is a roll the auto rerolls still reach: a foretold 1 is rerolled by Halfling Luck', () => {
    const luck = { source: 'Luck', die: 'one' as const, atMost: 1, auto: true, free: true };
    const ask = d20Ask('1d20', {
      label: 'STR check',
      riders: riders({ foretold: [told(1)], rerolls: [luck] }),
    });
    nextFaces(12);
    const r = ask.roll({ foretold: 0 });
    expect(r.total).toBe(12);
    // Rerolled, the d20 is no longer the foretold one.
    expect(r.meta?.foretold).toBeUndefined();
    expect(words(r)).toBe('d20 [~1~, 12] Luck reroll');
  });

  it('offers none on a roll that fails whatever the d20 shows', () => {
    const stunned = d20Effects([{ id: 'Stunned' }], '2014', { kind: 'save', ability: 'dex' });
    const ask = d20Ask('1d20+2', {
      label: 'DEX save',
      effects: stunned,
      riders: riders({ foretold: [told(18)] }),
    });
    expect(ask.foretold).toEqual([]);
  });

  it('rolls the d20 when no number is chosen', () => {
    const ask = d20Ask('1d20+2', { label: 'DEX check', riders: riders({ foretold: [told(9)] }) });
    nextFaces(14);
    const r = ask.roll();
    expect(r.total).toBe(16);
    expect(r.meta?.foretold).toBeUndefined();
  });
});
