import { describe, expect, it, vi } from 'vitest';
import { type DerivedSheet, newCharacterDoc, type PlayState } from '@/engine/types';
import {
  hitDiceLeft,
  hitDiePlan,
  hitDieRoll,
  slotDiceAt,
  slotLeft,
  slotPlan,
  slotPriceWords,
  slotsLeftFor,
  slotWays,
} from './slotCost';

const sheetWith = (
  slots: number[],
  pactSlots?: { count: number; level: number },
  hitDice: Record<string, number> = { d10: 5 },
) =>
  ({
    spellcasting: [
      { slots, ...(pactSlots !== undefined ? { pactSlots } : {}) },
    ] as unknown as DerivedSheet['spellcasting'],
    hitDice,
  }) as DerivedSheet;

const playWith = (over: Partial<PlayState> = {}): PlayState => ({
  ...newCharacterDoc('c', 'H', 't').play,
  ...over,
});

const PALADIN = sheetWith([4, 3, 2]);
const tiles = (ways: ReturnType<typeof slotWays>) =>
  ways.map(
    (w) => `${w.title}: ${w.tiles.map((t) => `${t.resource.level}${t.ok ? '' : 'x'}`).join(' ')}`,
  );

describe('slotWays', () => {
  it('offers each slot level from the lowest the price takes, spent ones marked', () => {
    const play = playWith({ slotsSpent: [4, 1, 0] });
    expect(tiles(slotWays(PALADIN, play, {}))).toEqual(['Spell slots: 1x 2 3']);
    expect(tiles(slotWays(PALADIN, play, { minLevel: 2 }))).toEqual(['Spell slots: 2 3']);
    expect(slotsLeftFor(PALADIN, play, {})).toBe(4);
    expect(slotsLeftFor(PALADIN, play, { minLevel: 5 })).toBe(0);
  });

  it('adds the pact slot, and offers only it for a Pact Magic price', () => {
    const both = sheetWith([2], { count: 2, level: 3 });
    const play = playWith({ pactSlotsSpent: 1 });
    expect(tiles(slotWays(both, play, {}))).toEqual(['Spell slots: 1', 'Pact slots: 3']);
    expect(tiles(slotWays(both, play, { pactOnly: true }))).toEqual(['Pact slots: 3']);
    expect(slotsLeftFor(both, play, { pactOnly: true })).toBe(1);
    expect(tiles(slotWays(both, play, { pactOnly: true, minLevel: 4 }))).toEqual([]);
  });
});

describe('slotLeft', () => {
  it('says whether that slot is still there to spend', () => {
    expect(slotLeft(PALADIN, playWith({ slotsSpent: [3] }), { kind: 'slot', level: 1 })).toBe(true);
    expect(slotLeft(PALADIN, playWith({ slotsSpent: [4] }), { kind: 'slot', level: 1 })).toBe(
      false,
    );
    const pact = sheetWith([], { count: 1, level: 2 });
    expect(slotLeft(pact, playWith({ pactSlotsSpent: 1 }), { kind: 'pact', level: 2 })).toBe(false);
  });
});

describe('slotDiceAt', () => {
  it('rolls Divine Smite as 2d8 at 1st, one more a level, to 5d8', () => {
    const smite = { die: 8, base: 1, maxDice: 5 };
    expect([1, 2, 4, 5, 9].map((l) => slotDiceAt(smite, l))).toEqual([
      '2d8',
      '3d8',
      '5d8',
      '5d8',
      '5d8',
    ]);
    expect(slotDiceAt({ die: 8, base: 0, heals: true }, 3)).toBe('3d8');
  });
});

describe('slotPriceWords', () => {
  it('says the price', () => {
    expect(slotPriceWords({})).toBe('a spell slot');
    expect(slotPriceWords({ minLevel: 5 })).toBe('a level 5+ spell slot');
    expect(slotPriceWords({ pactOnly: true })).toBe('a Pact Magic slot');
  });
});

describe('slotPlan', () => {
  const plan = (over: Partial<Parameters<typeof slotPlan>[0]> = {}) =>
    slotPlan({
      id: 'row',
      title: 'Divine Smite',
      verb: 'Use',
      sheet: PALADIN,
      play: playWith({ slotsSpent: [4] }),
      price: {},
      dice: { die: 8, base: 1, maxDice: 5 },
      pay: () => {},
      ...over,
    });

  it('starts on the lowest slot that can pay, and rolls its dice', () => {
    const p = plan();
    expect(p.verb).toBe('Use');
    expect(p.picked).toBe('slot-2');
    expect(p.dice('slot-2')).toEqual({ expr: '3d8', label: 'Divine Smite', kind: 'damage' });
    expect(p.dice('slot-3')?.expr).toBe('4d8');
    expect(p.line('slot-3')).toBe('3rd level: 4d8');
    expect(p.note('slot-3')).toBe('Spends a 3rd-level slot.');
  });

  it('pays with no tile that cannot pay', () => {
    const pay = vi.fn();
    const p = plan({ pay });
    p.cast('slot-1');
    expect(pay).not.toHaveBeenCalled();
    p.cast('slot-3');
    expect(pay).toHaveBeenCalledWith({ kind: 'slot', level: 3 });
  });

  it('rolls damage twice when the attack it goes with crit, asked as it rolls', () => {
    let crit = false;
    const p = plan({ crit: () => crit });
    expect(p.dice('slot-2')).not.toHaveProperty('crit');
    crit = true;
    expect(p.dice('slot-2')).toMatchObject({ crit: true });
  });

  it('heals, or rolls plain dice, with the line naming what the roll adds', () => {
    expect(plan({ dice: { die: 8, base: 0, heals: true } }).dice('slot-2')?.kind).toBe('heal');
    const ward = plan({
      dice: { die: 6, base: 0, plain: true, plus: 'your spellcasting modifier' },
    });
    expect(ward.dice('slot-2')).toMatchObject({ expr: '2d6', kind: undefined });
    expect(ward.line('slot-2')).toBe('2nd level: 2d6 + your spellcasting modifier');
  });

  it('rolls nothing for a price with no dice, and says only the level', () => {
    const p = plan({ dice: undefined, verb: 'Restore', price: { minLevel: 3 } });
    expect(p.picked).toBe('slot-3');
    expect(p.dice('slot-3')).toBeUndefined();
    expect(p.line('slot-3')).toBe('3rd level');
  });
});

describe('Hit Point Dice', () => {
  const multi = sheetWith([], undefined, { d8: 2, d10: 3 });

  it('lists what is left of each size, largest first', () => {
    expect(hitDiceLeft(multi, playWith({ hitDiceSpent: { d10: 3 } }))).toEqual([
      { die: 'd10', left: 0 },
      { die: 'd8', left: 2 },
    ]);
  });

  it('rolls the die, with the Constitution modifier only where the feature adds it', () => {
    expect(hitDieRoll('d10', 'roll', 3)).toBe('1d10');
    expect(hitDieRoll('d10', 'rollPlusCon', 3)).toBe('1d10+3');
    expect(hitDieRoll('d8', 'rollPlusCon', -1)).toBe('1d8-1');
  });

  it('offers a tile a size, starting on the largest left, and pays the one picked', () => {
    const pay = vi.fn();
    const p = hitDiePlan({
      id: 'row',
      title: 'Durable',
      sheet: multi,
      play: playWith({ hitDiceSpent: { d10: 3 } }),
      heals: 'roll',
      conMod: 2,
      pay,
    });
    expect(p.groups[0]?.tiles.map((t) => [t.head, t.ok])).toEqual([
      ['d10', false],
      ['d8', true],
    ]);
    expect(p.picked).toBe('d8');
    expect(p.dice('d8')).toEqual({ expr: '1d8', label: 'Durable', kind: 'heal' });
    p.cast('d10');
    expect(pay).not.toHaveBeenCalled();
    p.cast('d8');
    expect(pay).toHaveBeenCalledWith('d8');
  });
});
