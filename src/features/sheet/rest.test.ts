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

  it('leaves a used Mystic Arcanum used: only a long rest brings it back', () => {
    const p = play({ pactSlotsSpent: 2, arcanumUsed: [6] });
    const restored = shortRest(p, sheet());
    expect(p.arcanumUsed).toEqual([6]);
    expect(restored).not.toContain('Mystic Arcanum');
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
    const restored = longRest(p, sheet(), '2014');
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

  it('regains every Mystic Arcanum, and saves as if none had been tracked', () => {
    const p = play({ arcanumUsed: [6, 8] });
    const restored = longRest(p, sheet(), '2024');
    expect('arcanumUsed' in p).toBe(false);
    expect(restored).toContain('Mystic Arcanum');
    // Nothing to regain says nothing.
    expect(longRest(play(), sheet(), '2014')).not.toContain('Mystic Arcanum');
  });

  it('lowers exhaustion before healing, so the rest that lifts 2014 level 4 heals to full', () => {
    const p = play({ currentHp: 6, conditions: [{ id: 'Exhaustion', level: 4 }] });
    const restored = longRest(p, sheet(), '2014');
    expect(p.conditions).toEqual([{ id: 'Exhaustion', level: 3 }]);
    expect(p.currentHp).toBe(20);
    expect(restored).toContain('+14 HP');
  });

  it('heals to the halved 2014 maximum while exhaustion stays at 4 or more', () => {
    const p = play({ currentHp: 6, conditions: [{ id: 'Exhaustion', level: 5 }] });
    longRest(p, sheet(), '2014');
    expect(p.currentHp).toBe(10);
    // 2024 exhaustion never touches the maximum.
    const q = play({ currentHp: 6, conditions: [{ id: 'Exhaustion', level: 5 }] });
    longRest(q, sheet(), '2024');
    expect(q.currentHp).toBe(20);
  });

  it('clears exhaustion entirely when it was at level 1', () => {
    const p = play({ conditions: [{ id: 'Exhaustion', level: 1 }] });
    longRest(p, sheet(), '2014');
    expect(p.conditions.some((c) => c.id === 'Exhaustion')).toBe(false);
  });

  it('regains half of a single-class pool of hit dice (minimum 1)', () => {
    const p = play({ hitDiceSpent: { d8: 4 } });
    const restored = longRest(p, sheet({ hitDice: { d8: 4 } }), '2014');
    expect(p.hitDiceSpent.d8).toBe(2); // 4 total -> regain 2
    expect(restored).toContain('2 hit dice');
  });

  it('regains at least one hit die even for a level-1 character', () => {
    const p = play({ hitDiceSpent: { d10: 1 } });
    longRest(p, sheet({ hitDice: { d10: 1 } }), '2014'); // floor(1/2)=0 -> min 1
    expect(p.hitDiceSpent.d10).toBe(0);
  });

  it('regains half the TOTAL hit dice for a multiclass, largest die first', () => {
    // 3 Fighter d10 + 3 Wizard d6 = 6 total -> regain 3 (not 1-per-type=2).
    const p = play({ hitDiceSpent: { d10: 3, d6: 3 } });
    const restored = longRest(p, sheet({ hitDice: { d10: 3, d6: 3 } }), '2014');
    // Largest die first: 3 back from d10 exhausts the budget of 3.
    expect(p.hitDiceSpent.d10).toBe(0);
    expect(p.hitDiceSpent.d6).toBe(3);
    expect(restored).toContain('3 hit dice');
  });

  it('never regains more dice than were spent', () => {
    const p = play({ hitDiceSpent: { d10: 1, d6: 0 } });
    longRest(p, sheet({ hitDice: { d10: 3, d6: 3 } }), '2014'); // budget 3, but only 1 spent
    expect(p.hitDiceSpent.d10).toBe(0);
    expect(p.hitDiceSpent.d6).toBe(0);
  });

  it('spills leftover budget from the largest die to the next-smaller one', () => {
    // Total 8 -> budget 4. d10 has only 1 spent (regain 1), remaining 3 fills d6.
    const p = play({ hitDiceSpent: { d10: 1, d6: 5 } });
    longRest(p, sheet({ hitDice: { d10: 2, d6: 6 } }), '2014');
    expect(p.hitDiceSpent.d10).toBe(0); // 1 - 1
    expect(p.hitDiceSpent.d6).toBe(2); // 5 - 3
  });

  it('still regains an unparseable die key (sorted last, not dropped)', () => {
    const p = play({ hitDiceSpent: { dX: 4 } });
    longRest(p, sheet({ hitDice: { dX: 4 } }), '2014'); // total 4 -> budget 2
    expect(p.hitDiceSpent.dX).toBe(2);
  });
});
