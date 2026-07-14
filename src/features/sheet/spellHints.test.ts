import { describe, expect, it } from 'vitest';
import { isRecommendedStarter, recommendedStarters } from './spellHints';

describe('spellHints', () => {
  it('returns curated starters for known classes and none for others', () => {
    expect(recommendedStarters('Wizard')?.cantrips).toContain('Fire Bolt');
    expect(recommendedStarters('wizard')?.level1).toContain('Magic Missile');
    expect(recommendedStarters('Fighter')).toBeUndefined();
  });

  it('flags recommended cantrips and 1st-level spells, case/apostrophe-insensitive', () => {
    expect(isRecommendedStarter('Warlock', 'Eldritch Blast', 0)).toBe(true);
    expect(isRecommendedStarter('warlock', 'hex', 1)).toBe(true);
    // Curly apostrophe in the data must still match the curated straight/curly form.
    expect(isRecommendedStarter('Ranger', 'Hunter’s Mark', 1)).toBe(true);
    expect(isRecommendedStarter('Bard', "Tasha's Hideous Laughter", 1)).toBe(true);
  });

  it('only treats cantrips and 1st-level as starters, and rejects non-picks', () => {
    // Fire Bolt is a wizard cantrip, not a level-1 pick.
    expect(isRecommendedStarter('Wizard', 'Fire Bolt', 1)).toBe(false);
    expect(isRecommendedStarter('Wizard', 'Fireball', 3)).toBe(false);
    expect(isRecommendedStarter('Wizard', 'Wish', 9)).toBe(false);
  });
});
