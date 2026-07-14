import { describe, expect, it } from 'vitest';
import type { DerivedSheet, PlayState } from '@/engine/types';
import { emptyPlayState } from '@/engine/types';
import { clampPlayStateToMax, detectPlayStateOverages } from './playStateLimits';

/** Minimal derived sheet carrying only the fields these helpers read. */
function sheet(over: {
  maxHp?: number;
  slots?: number[];
  pactSlots?: number;
  hitDice?: Record<string, number>;
  resources?: Array<{ key: string; label: string; max: number }>;
}): DerivedSheet {
  return {
    maxHp: { value: over.maxHp ?? 10, base: 0, overridden: false, parts: [] },
    spellcasting: [
      {
        classUid: 'c',
        className: 'Test',
        ability: 'int',
        saveDc: { value: 0, base: 0, overridden: false, parts: [] },
        attackMod: { value: 0, base: 0, overridden: false, parts: [] },
        slots: over.slots ?? [],
        ...(over.pactSlots !== undefined ? { pactSlots: { count: over.pactSlots, level: 1 } } : {}),
      },
    ],
    hitDice: over.hitDice ?? {},
    resources: (over.resources ?? []).map((r) => ({ ...r, resetOn: 'long' as const, origin: 'x' })),
  } as unknown as DerivedSheet;
}

function play(over: Partial<PlayState>): PlayState {
  return { ...emptyPlayState(), ...over };
}

describe('detectPlayStateOverages', () => {
  it('finds nothing when everything is within limits', () => {
    const p = play({ currentHp: 8, slotsSpent: [1, 0], pactSlotsSpent: 0 });
    const s = sheet({ maxHp: 10, slots: [3, 2] });
    expect(detectPlayStateOverages(p, s)).toEqual([]);
  });

  it('flags HP above the derived max', () => {
    const found = detectPlayStateOverages(play({ currentHp: 15 }), sheet({ maxHp: 10 }));
    expect(found).toContainEqual({ kind: 'hp', label: 'Current HP', current: 15, max: 10 });
  });

  it('flags spent leveled slots above the new max', () => {
    // Build dropped level-2 slots from 2 to 1, but 2 were still marked spent.
    const found = detectPlayStateOverages(
      play({ slotsSpent: [0, 2] }),
      sheet({ maxHp: 10, slots: [3, 1] }),
    );
    expect(found).toContainEqual({
      kind: 'slots',
      label: 'Level 2 spell slots spent',
      current: 2,
      max: 1,
    });
  });

  it('flags pact slots, hit dice, and vanished resources', () => {
    const p = play({
      pactSlotsSpent: 2,
      hitDiceSpent: { d10: 5 },
      resources: [{ key: 'rage', used: 3 }],
    });
    const s = sheet({ maxHp: 10, pactSlots: 1, hitDice: { d10: 3 }, resources: [] });
    const found = detectPlayStateOverages(p, s);
    expect(found).toContainEqual({
      kind: 'pactSlots',
      label: 'Pact slots spent',
      current: 2,
      max: 1,
    });
    expect(found).toContainEqual({
      kind: 'hitDice',
      label: 'd10 hit dice spent',
      current: 5,
      max: 3,
    });
    expect(found).toContainEqual({ kind: 'resource', label: 'rage used', current: 3, max: 0 });
  });
});

describe('clampPlayStateToMax', () => {
  it('clamps only over-limit values and leaves the rest untouched', () => {
    const p = play({
      currentHp: 15,
      slotsSpent: [1, 2],
      pactSlotsSpent: 2,
      hitDiceSpent: { d10: 5 },
      resources: [{ key: 'rage', used: 3 }],
    });
    const s = sheet({ maxHp: 10, slots: [3, 1], pactSlots: 1, hitDice: { d10: 3 }, resources: [] });
    clampPlayStateToMax(p, s);
    expect(p.currentHp).toBe(10);
    expect(p.slotsSpent).toEqual([1, 1]); // level-1 (1<=3) untouched, level-2 clamped 2->1
    expect(p.pactSlotsSpent).toBe(1);
    expect(p.hitDiceSpent.d10).toBe(3);
    expect(p.resources).toEqual([{ key: 'rage', used: 0 }]);
    // Nothing over-limit remains.
    expect(detectPlayStateOverages(p, s)).toEqual([]);
  });
});
