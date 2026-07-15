import { describe, expect, it } from 'vitest';
import { type CharacterDoc, emptyPlayState, type SpellcastingBlock } from '@/engine/types';
import { availableCastResources, castSpell, classifyKnown, nextCastResource } from './SpellManager';

const value = { value: 0, base: 0, overridden: false, parts: [] };

function block(overrides: Partial<SpellcastingBlock> = {}): SpellcastingBlock {
  return {
    classUid: 'mage|tst',
    className: 'Mage',
    ability: 'int',
    mode: 'known',
    saveDc: value,
    attackMod: value,
    slots: [4, 3, 2],
    ...overrides,
  };
}

describe('nextCastResource', () => {
  it('previews cantrips without a resource', () => {
    expect(nextCastResource(block(), emptyPlayState(), 0)).toEqual({ kind: 'cantrip', level: 0 });
  });

  it('uses the same pact-first and shared-slot fallback order as casting', () => {
    const play = emptyPlayState();
    const caster = block({ pactSlots: { count: 2, level: 3 } });
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'pact', level: 3 });
    play.pactSlotsSpent = 2;
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'slot', level: 1 });
    play.slotsSpent[0] = 4;
    expect(nextCastResource(caster, play, 1)).toEqual({ kind: 'slot', level: 2 });
  });

  it('keeps an exhausted cast possible but labels it as no resource', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(nextCastResource(block(), play, 1)).toEqual({ kind: 'none', level: 1 });
  });
});

describe('availableCastResources (GAME-001 upcast options)', () => {
  it('lists every slot level >= the spell level that still has a slot, plus pact', () => {
    const play = emptyPlayState();
    const caster = block({ slots: [4, 3, 2], pactSlots: { count: 2, level: 3 } });
    expect(availableCastResources(caster, play, 1)).toEqual([
      { kind: 'slot', level: 1 },
      { kind: 'slot', level: 2 },
      { kind: 'slot', level: 3 },
      { kind: 'pact', level: 3 },
    ]);
  });

  it('excludes exhausted slot levels and an exhausted pact pool', () => {
    const play = emptyPlayState();
    play.slotsSpent = [4, 0, 2, 0, 0, 0, 0, 0, 0]; // L1 and L3 tapped out
    play.pactSlotsSpent = 2;
    const caster = block({ slots: [4, 3, 2], pactSlots: { count: 2, level: 3 } });
    expect(availableCastResources(caster, play, 1)).toEqual([{ kind: 'slot', level: 2 }]);
  });

  it('returns nothing for a cantrip or when fully tapped out', () => {
    const play = emptyPlayState();
    expect(availableCastResources(block(), play, 0)).toEqual([]);
    play.slotsSpent = [4, 3, 2, 0, 0, 0, 0, 0, 0];
    expect(availableCastResources(block(), play, 1)).toEqual([]);
  });
});

describe('castSpell resource override (GAME-001)', () => {
  const runCast = (
    caster: SpellcastingBlock,
    level: number,
    resource?: Parameters<typeof castSpell>[4],
  ) => {
    const doc = { play: emptyPlayState() } as CharacterDoc;
    castSpell((recipe) => recipe(doc), caster, level, { name: 'X', source: 'y' }, resource);
    return doc.play;
  };

  it('spends the chosen higher slot (upcast) instead of the lowest', () => {
    const play = runCast(block({ slots: [4, 3, 2] }), 1, { kind: 'slot', level: 3 });
    expect(play.slotsSpent[2]).toBe(1); // level 3 spent
    expect(play.slotsSpent[0]).toBe(0); // level 1 untouched
  });

  it('spends the pact pool when the pact resource is chosen', () => {
    const play = runCast(block({ slots: [4, 3, 2], pactSlots: { count: 2, level: 3 } }), 1, {
      kind: 'pact',
      level: 3,
    });
    expect(play.pactSlotsSpent).toBe(1);
    expect(play.slotsSpent.every((n) => n === 0)).toBe(true);
  });

  it('falls back to the lowest slot when no override is given', () => {
    const play = runCast(block({ slots: [4, 3, 2] }), 1);
    expect(play.slotsSpent[0]).toBe(1); // lowest (level 1)
  });
});

describe('classifyKnown (GAME-007 over-limit counting)', () => {
  const known = [
    { name: 'Fire Bolt', source: 'phb' }, // cantrip
    { name: 'Light', source: 'phb' }, // cantrip
    { name: 'Bless', source: 'phb' }, // level 1
    { name: 'Fireball', source: 'phb' }, // level 3
  ];
  const levels: Record<string, number> = { 'fire bolt': 0, light: 0, bless: 1, fireball: 3 };
  const levelOf = (r: { name: string; source: string }) => levels[r.name.toLowerCase()];

  it('separates cantrips from leveled spells', () => {
    expect(classifyKnown(known, levelOf)).toEqual({ cantrips: 2, leveled: 2 });
  });

  it('counts a spell whose level cannot be resolved as neither (no over-count)', () => {
    // A missing/unloaded registry entry must not inflate the leveled count and
    // fire a false over-limit cue.
    expect(classifyKnown(known, () => undefined)).toEqual({ cantrips: 0, leveled: 0 });
  });

  it('is independent of any incidental order/subset — pure over the given lookup', () => {
    // The lookup, not a filtered on-screen list, decides the count: passing only
    // the cantrips yields leveled 0 regardless of what a search box shows.
    expect(classifyKnown(known.slice(0, 2), levelOf)).toEqual({ cantrips: 2, leveled: 0 });
  });
});
