import { describe, expect, it } from 'vitest';
import { classifyKnown } from './SpellManager';

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
