import { describe, expect, it } from 'vitest';
import { idleChargePools } from '@/engine/curated/itemCharges';
import type { DerivedSheet, EquipmentEntry, PlayState } from '@/engine/types';
import { backCaption, longRest, shortRest } from './rest';

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

  describe('a pool that regains some on a short rest', () => {
    const dice = {
      key: 'dice',
      label: 'Test Dice (d8)',
      max: 6,
      resetOn: 'long',
      regainOnShort: 1,
      origin: 'Test',
    } as const;
    const withDice = (over: object = {}) => sheet({ resources: [{ ...dice, ...over }] });
    const used = (p: PlayState) => p.resources.find((r) => r.key === 'dice')?.used;

    it('gives back that many and says so', () => {
      const p = play({ resources: [{ key: 'dice', used: 3 }] });
      expect(shortRest(p, withDice())).toEqual(['1 Test Dice (d8)']);
      expect(used(p)).toBe(2);
    });

    it('gives back no more than was spent', () => {
      const p = play({ resources: [{ key: 'dice', used: 2 }] });
      expect(shortRest(p, withDice({ regainOnShort: 4 }))).toEqual(['2 Test Dice (d8)']);
      expect(used(p)).toBe(0);
    });

    it('says nothing when none were spent', () => {
      expect(shortRest(play(), withDice())).toEqual([]);
      const p = play({ resources: [{ key: 'dice', used: 0 }] });
      expect(shortRest(p, withDice())).toEqual([]);
    });

    it('counts uses past the maximum as all spent, so one really comes back', () => {
      const p = play({ resources: [{ key: 'dice', used: 9 }] });
      shortRest(p, withDice());
      expect(used(p)).toBe(5);
    });

    it('resets a short-rest pool in full, whatever else it says', () => {
      const p = play({ resources: [{ key: 'dice', used: 3 }] });
      expect(shortRest(p, withDice({ resetOn: 'short' }))).toEqual(['Test Dice (d8)']);
      expect(used(p)).toBeUndefined();
    });

    it('still comes back in full on a long rest', () => {
      const p = play({ resources: [{ key: 'dice', used: 3 }] });
      longRest(p, withDice(), '2024');
      expect(p.resources).toEqual([]);
    });
  });
});

describe('backCaption', () => {
  it('says the one rest for a pool that comes back all at once', () => {
    expect(backCaption({ resetOn: 'short' })).toBe('Back on a short rest');
    expect(backCaption({ resetOn: 'long' })).toBe('Back on a long rest');
    expect(backCaption({ resetOn: 'short', regainOnShort: 1 })).toBe('Back on a short rest');
  });

  it('says both rests for one that comes back in part', () => {
    expect(backCaption({ resetOn: 'long', regainOnShort: 1 })).toBe(
      'One back on a short rest, all on a long rest',
    );
    expect(backCaption({ resetOn: 'long', regainOnShort: 4 })).toBe(
      '4 back on a short rest, all on a long rest',
    );
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

  it('refills to the maximum the ended effects left, and lets their temp HP go', () => {
    // Aid ended by the rest took 5 off a 20 maximum the sheet still shows.
    const p = play({ currentHp: 3, tempHp: 4, tempHpFrom: 'hero' });
    const restored = longRest(p, sheet(), '2014', -5);
    expect(p.currentHp).toBe(15);
    expect(restored).toContain('+12 HP');
    expect(p.tempHp).toBe(0);
    expect('tempHpFrom' in p).toBe(false);
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

describe("an item's charges on a long rest", () => {
  const staff = {
    key: 'item-charges:s1',
    label: 'Staff of Healing charges',
    max: 10,
    resetOn: 'long',
    regainRoll: '1d6+4',
    origin: 'Staff of Healing',
  } as const;

  it('gives back what the dawn roll says, and keeps the rest spent', () => {
    const p = play({ resources: [{ key: staff.key, used: 9 }] });
    const restored = longRest(p, sheet({ resources: [staff] }), '2024', 0, () => 6);
    expect(p.resources).toEqual([{ key: staff.key, used: 3 }]);
    expect(restored).toContain('6 Staff of Healing charges');
    // Only charges were spent, so no other pool is said to come back.
    expect(restored).not.toContain('resources');
  });

  it('refills it when the roll covers what was spent', () => {
    const p = play({
      resources: [
        { key: staff.key, used: 4 },
        { key: 'ki', used: 2 },
      ],
    });
    const restored = longRest(p, sheet({ resources: [staff] }), '2024', 0, () => 9);
    expect(p.resources).toEqual([]);
    expect(restored).toEqual(expect.arrayContaining(['4 Staff of Healing charges', 'resources']));
  });

  it('says when the charges come back', () => {
    expect(backCaption(staff)).toBe('1d6+4 back at dawn (a long rest)');
  });

  it('gives back the dawn roll of an item put away, whose pool the sheet leaves out', () => {
    const equipment: EquipmentEntry[] = [
      {
        id: 's1',
        ref: { name: 'Staff of Healing', source: 'XDMG' },
        qty: 1,
        equipped: false,
        attuned: true,
      },
      // Its pool is on the sheet: not idle.
      {
        id: 's2',
        ref: { name: 'Staff of Healing', source: 'XDMG' },
        qty: 1,
        equipped: true,
        attuned: true,
      },
      { id: 'r1', ref: { name: 'Rope', source: 'XPHB' }, qty: 1, equipped: false, attuned: false },
    ];
    const worn = { ...staff, key: 'item-charges:s2' };
    const idle = idleChargePools(equipment, [worn]);
    expect(idle).toEqual([staff]);

    const p = play({ resources: [{ key: staff.key, used: 8 }] });
    const restored = longRest(p, sheet({ resources: [worn] }), '2024', 0, () => 5, idle);
    expect(p.resources).toEqual([{ key: staff.key, used: 3 }]);
    expect(restored).toEqual(['5 Staff of Healing charges']);
  });
});
