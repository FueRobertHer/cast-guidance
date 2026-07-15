import { describe, expect, it } from 'vitest';
import type { DerivedSheet, PlayState } from '@/engine/types';
import { longRest, shortRest } from './rest';

/** Minimal DerivedSheet with just the fields the rest rules read. */
function sheet(over: Partial<DerivedSheet> = {}): DerivedSheet {
  return {
    maxHp: { value: 20, base: 20, overridden: false, parts: [] },
    hitDice: { d8: 4 },
    resources: [],
    ...over,
  } as DerivedSheet;
}

function play(over: Partial<PlayState> = {}): PlayState {
  return {
    currentHp: 20,
    tempHp: 0,
    hitDiceSpent: {},
    slotsSpent: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pactSlotsSpent: 0,
    conditions: [],
    deathSaves: { success: 0, fail: 0 },
    resources: [],
    inspiration: false,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    xp: 0,
    hpInitialized: true,
    ...over,
  } as PlayState;
}

describe('shortRest', () => {
  it('restores short-rest resources and pact slots, leaving long-rest ones alone', () => {
    const p = play({
      pactSlotsSpent: 2,
      resources: [
        { key: 'ki', used: 3 },
        { key: 'channel', used: 1 },
      ],
    });
    const s = sheet({
      resources: [
        { key: 'ki', label: 'Ki', resetOn: 'short' },
        { key: 'channel', label: 'Channel Divinity', resetOn: 'long' },
      ],
    } as Partial<DerivedSheet>);
    const restored = shortRest(p, s);
    expect(p.pactSlotsSpent).toBe(0);
    expect(p.resources.find((r) => r.key === 'ki')).toBeUndefined(); // reset
    expect(p.resources.find((r) => r.key === 'channel')?.used).toBe(1); // untouched
    expect(restored).toEqual(expect.arrayContaining(['Ki', 'pact slots']));
    expect(restored).not.toContain('Channel Divinity');
  });

  it('does not touch HP, spell slots, or hit dice', () => {
    const p = play({
      currentHp: 5,
      slotsSpent: [2, 0, 0, 0, 0, 0, 0, 0, 0],
      hitDiceSpent: { d8: 3 },
    });
    shortRest(p, sheet());
    expect(p.currentHp).toBe(5);
    expect(p.slotsSpent[0]).toBe(2);
    expect(p.hitDiceSpent.d8).toBe(3);
  });
});

describe('longRest', () => {
  it('restores HP/slots/resources/death saves and removes one exhaustion level', () => {
    const p = play({
      currentHp: 3,
      tempHp: 5,
      slotsSpent: [3, 1, 0, 0, 0, 0, 0, 0, 0],
      pactSlotsSpent: 1,
      resources: [{ key: 'ki', used: 2 }],
      deathSaves: { success: 1, fail: 2 },
      conditions: [{ id: 'Exhaustion', level: 3 }],
    });
    const restored = longRest(p, sheet());
    expect(p.currentHp).toBe(20);
    expect(p.tempHp).toBe(0);
    expect(p.slotsSpent.every((n) => n === 0)).toBe(true);
    expect(p.pactSlotsSpent).toBe(0);
    expect(p.resources).toEqual([]);
    expect(p.deathSaves).toEqual({ success: 0, fail: 0 });
    expect(p.conditions.find((c) => c.id === 'Exhaustion')?.level).toBe(2); // 3 -> 2
    expect(restored).toEqual(
      expect.arrayContaining(['+17 HP', 'spell slots', '1 exhaustion level']),
    );
  });

  it('clears exhaustion entirely when it was at level 1', () => {
    const p = play({ conditions: [{ id: 'Exhaustion', level: 1 }] });
    longRest(p, sheet());
    expect(p.conditions.some((c) => c.id === 'Exhaustion')).toBe(false);
  });

  it('regains half of a single-class pool of hit dice (minimum 1)', () => {
    const p = play({ hitDiceSpent: { d8: 4 } });
    const restored = longRest(p, sheet({ hitDice: { d8: 4 } }));
    expect(p.hitDiceSpent.d8).toBe(2); // 4 total -> regain 2
    expect(restored).toContain('2 hit dice');
  });

  it('regains at least one hit die even for a level-1 character', () => {
    const p = play({ hitDiceSpent: { d10: 1 } });
    longRest(p, sheet({ hitDice: { d10: 1 } })); // floor(1/2)=0 -> min 1
    expect(p.hitDiceSpent.d10).toBe(0);
  });

  it('regains half the TOTAL hit dice for a multiclass, largest die first', () => {
    // 3 Fighter d10 + 3 Wizard d6 = 6 total -> regain 3 (not 1-per-type=2).
    const p = play({ hitDiceSpent: { d10: 3, d6: 3 } });
    const restored = longRest(p, sheet({ hitDice: { d10: 3, d6: 3 } }));
    // Largest die first: 3 back from d10 exhausts the budget of 3.
    expect(p.hitDiceSpent.d10).toBe(0);
    expect(p.hitDiceSpent.d6).toBe(3);
    expect(restored).toContain('3 hit dice');
  });

  it('never regains more dice than were spent', () => {
    const p = play({ hitDiceSpent: { d10: 1, d6: 0 } });
    longRest(p, sheet({ hitDice: { d10: 3, d6: 3 } })); // budget 3, but only 1 spent
    expect(p.hitDiceSpent.d10).toBe(0);
    expect(p.hitDiceSpent.d6).toBe(0);
  });
});
