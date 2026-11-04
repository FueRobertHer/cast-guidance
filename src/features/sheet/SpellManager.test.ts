import { describe, expect, it } from 'vitest';
import { classifyKnown } from './SpellManager';
import { spellLimits } from './spellTrim';

describe('classifyKnown (GAME-007 over-limit counting)', () => {
  const known = [
    { name: 'Fire Bolt', source: 'phb' }, // cantrip
    { name: 'Light', source: 'phb' }, // cantrip
    { name: 'Bless', source: 'phb' }, // level 1
    { name: 'Fireball', source: 'phb' }, // level 3
  ];
  const levels: Record<string, number> = {
    'fire bolt': 0,
    light: 0,
    bless: 1,
    fireball: 3,
    eyebite: 6,
    'circle of death': 6,
    'finger of death': 7,
  };
  const levelOf = (r: { name: string; source: string }) => levels[r.name.toLowerCase()];

  it('separates cantrips from leveled spells', () => {
    expect(classifyKnown(known, levelOf)).toEqual({ cantrips: 2, leveled: 2, arcanum: {} });
  });

  it('counts a spell whose level cannot be resolved as neither (no over-count)', () => {
    // A missing/unloaded registry entry must not inflate the leveled count and
    // fire a false over-limit cue.
    expect(classifyKnown(known, () => undefined)).toEqual({
      cantrips: 0,
      leveled: 0,
      arcanum: {},
    });
  });

  it('is independent of any incidental order/subset — pure over the given lookup', () => {
    // The lookup, not a filtered on-screen list, decides the count: passing only
    // the cantrips yields leveled 0 regardless of what a search box shows.
    expect(classifyKnown(known.slice(0, 2), levelOf)).toEqual({
      cantrips: 2,
      leveled: 0,
      arcanum: {},
    });
  });

  describe('Mystic Arcanum', () => {
    const withArcana = [
      ...known,
      { name: 'Eyebite', source: 'phb' },
      { name: 'Circle of Death', source: 'phb' },
      { name: 'Finger of Death', source: 'phb' },
    ];

    it('counts the 6th to 9th level picks of a warlock by level, not as spells known', () => {
      // The same in both editions: 2014 data caps spells known, 2024 prepared.
      for (const limits of [
        spellLimits({ mode: 'pact', spellsKnownMax: 2, mysticArcanum: [6, 7] }),
        spellLimits({ mode: 'pact', preparedMax: 2, mysticArcanum: [6, 7] }),
      ]) {
        expect(classifyKnown(withArcana, levelOf, limits)).toEqual({
          cantrips: 2,
          leveled: 2,
          arcanum: { 6: 2, 7: 1 },
        });
      }
    });

    it('counts a level the warlock has not opened yet as an arcanum too', () => {
      const limits = spellLimits({ mode: 'pact', spellsKnownMax: 2, mysticArcanum: [] });
      expect(classifyKnown(withArcana, levelOf, limits).leveled).toBe(2);
    });

    it('counts 6th level and up as spells known for any other caster', () => {
      const limits = spellLimits({ mode: 'known', spellsKnownMax: 9 });
      expect(classifyKnown(withArcana, levelOf, limits)).toEqual({
        cantrips: 2,
        leveled: 5,
        arcanum: {},
      });
    });
  });
});
