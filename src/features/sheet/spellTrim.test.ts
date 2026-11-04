import { describe, expect, it } from 'vitest';
import type { EntityRef } from '@/engine/types';
import {
  applySpellTrim,
  arcanumOverage,
  countPrepared,
  describeTrim,
  isArcanumLevel,
  isEmptyTrim,
  planSpellTrim,
  spellLimits,
} from './spellTrim';

const LEVELS: Record<string, number> = {
  light: 0,
  'mage hand': 0,
  'fire bolt': 0,
  shield: 1,
  sleep: 1,
  bless: 1,
  'magic missile': 1,
  fireball: 3,
  eyebite: 6,
  'circle of death': 6,
  'finger of death': 7,
  etherealness: 7,
  foresight: 9,
};
const levelOf = (r: EntityRef) => LEVELS[r.name.toLowerCase()];
const ref = (name: string): EntityRef => ({ name, source: 'PHB' });
const refs = (...names: string[]) => names.map(ref);
const namesOf = (list: readonly EntityRef[]) => list.map((r) => r.name);

const emptyPlan = {
  forgetCantrips: [],
  forgetKnown: [],
  forgetArcanum: [],
  unprepareRedundant: [],
  unprepare: [],
};

/**
 * A warlock 13 as the engine derives one: Mystic Arcanum at 6th and 7th level.
 * 2014 data caps spells known; 2024 data caps spells prepared instead.
 */
const warlock2014 = spellLimits({ mode: 'pact', spellsKnownMax: 2, mysticArcanum: [6, 7] });
const warlock2024 = spellLimits({ mode: 'pact', preparedMax: 2, mysticArcanum: [6, 7] });

describe('spellLimits (GAME-007)', () => {
  it('holds only known/pact casters to a spells-known limit', () => {
    const base = { cantripsKnown: 3, preparedMax: 4, spellsKnownMax: 2 };
    expect(spellLimits({ ...base, mode: 'known' }).known).toBe(2);
    expect(spellLimits({ ...base, mode: 'pact' }).known).toBe(2);
    expect(spellLimits({ ...base, mode: 'prepared' }).known).toBeUndefined();
    expect(spellLimits({ ...base, mode: 'spellbook' }).known).toBeUndefined();
    expect(spellLimits({ ...base, mode: 'spellbook' })).toMatchObject({ cantrips: 3, prepared: 4 });
  });

  it('carries the arcanum levels of a pact caster, even before the first', () => {
    expect(warlock2014.arcanum).toEqual([6, 7]);
    expect(spellLimits({ mode: 'pact', mysticArcanum: [] }).arcanum).toEqual([]);
    expect(spellLimits({ mode: 'known' }).arcanum).toBeUndefined();
  });
});

describe('Mystic Arcanum counting (both editions)', () => {
  it('treats 6th level and up as arcana for a pact caster only', () => {
    expect(isArcanumLevel(warlock2014, 5)).toBe(false);
    expect(isArcanumLevel(warlock2014, 6)).toBe(true);
    // Not open at warlock 13 yet, and still never a spell known.
    expect(isArcanumLevel(warlock2014, 9)).toBe(true);
    expect(isArcanumLevel(spellLimits({ mode: 'pact', mysticArcanum: [] }), 6)).toBe(true);
    expect(isArcanumLevel(spellLimits({ mode: 'known', spellsKnownMax: 9 }), 6)).toBe(false);
    expect(isArcanumLevel(warlock2014, undefined)).toBe(false);
  });

  it('leaves arcana out of the prepared count, and nothing else', () => {
    const prepared = refs('Shield', 'Eyebite', 'Mystery', 'Finger of Death');
    expect(countPrepared(prepared, warlock2024, levelOf)).toBe(2);
    expect(countPrepared(prepared, { prepared: 2 }, levelOf)).toBe(4);
  });

  it('counts picks past one at each arcanum level the class has', () => {
    expect(arcanumOverage({ 6: 1, 7: 1 }, warlock2014)).toBe(0);
    expect(arcanumOverage({ 6: 3, 7: 2 }, warlock2014)).toBe(3);
    // 9th is not open at warlock 13: those picks are flagged as above the level.
    expect(arcanumOverage({ 9: 2 }, warlock2014)).toBe(0);
    expect(arcanumOverage({ 6: 2 }, {})).toBe(0);
  });

  it('keeps the arcana of a 2014 warlock off its spells known', () => {
    const state = { known: refs('Shield', 'Sleep', 'Eyebite', 'Finger of Death'), prepared: [] };
    expect(isEmptyTrim(planSpellTrim({ state, limits: warlock2014, levelOf }))).toBe(true);
    // A third spell of 1st to 5th level is still over, and only it goes.
    const over = planSpellTrim({
      state: { ...state, known: [...state.known, ref('Fireball')] },
      limits: warlock2014,
      levelOf,
    });
    expect(namesOf(over.forgetKnown)).toEqual(['Fireball']);
    expect(over.forgetArcanum).toEqual([]);
  });

  it('keeps the arcana of a 2024 warlock off its prepared spells', () => {
    const picks = refs('Shield', 'Sleep', 'Eyebite', 'Finger of Death');
    const state = { known: picks, prepared: picks };
    expect(isEmptyTrim(planSpellTrim({ state, limits: warlock2024, levelOf }))).toBe(true);
    const over = planSpellTrim({
      state: { known: [...picks, ref('Fireball')], prepared: [...picks, ref('Fireball')] },
      limits: warlock2024,
      levelOf,
    });
    expect(namesOf(over.unprepare)).toEqual(['Fireball']);
  });

  it('forgets the newest extra pick at each open arcanum level', () => {
    const state = {
      known: refs('Eyebite', 'Circle of Death', 'Finger of Death', 'Foresight', 'Etherealness'),
      prepared: refs('Circle of Death'),
    };
    const plan = planSpellTrim({ state, limits: warlock2014, levelOf });
    // Level 6 and 7 each keep their first pick; 9th is not open, so it stays.
    expect(namesOf(plan.forgetArcanum)).toEqual(['Circle of Death', 'Etherealness']);
    expect(plan.forgetKnown).toEqual([]);
    const sc = structuredClone(state);
    applySpellTrim(sc, plan);
    expect(namesOf(sc.known)).toEqual(['Eyebite', 'Finger of Death', 'Foresight']);
    expect(sc.prepared).toEqual([]);
  });
});

describe('planSpellTrim (GAME-007)', () => {
  it('unprepares the two most recently prepared and keeps them known', () => {
    const state = {
      known: refs('Shield', 'Sleep', 'Bless', 'Magic Missile'),
      prepared: refs('Shield', 'Sleep', 'Bless', 'Magic Missile'),
    };
    const plan = planSpellTrim({ state, limits: { prepared: 2 }, levelOf });
    expect(namesOf(plan.unprepare)).toEqual(['Magic Missile', 'Bless']);
    expect(plan.forgetKnown).toEqual([]);

    const sc = structuredClone(state);
    applySpellTrim(sc, plan);
    expect(namesOf(sc.prepared)).toEqual(['Shield', 'Sleep']);
    expect(namesOf(sc.known)).toEqual(['Shield', 'Sleep', 'Bless', 'Magic Missile']);
  });

  it('unprepares a spell an always-prepared grant covers before anything else', () => {
    const state = {
      known: refs('Bless', 'Shield', 'Sleep'),
      prepared: refs('Bless', 'Shield', 'Sleep'),
    };
    const plan = planSpellTrim({
      state,
      limits: { prepared: 2 },
      levelOf,
      alwaysPrepared: [ref('Bless')],
    });
    expect(namesOf(plan.unprepareRedundant)).toEqual(['Bless']);
    expect(plan.unprepare).toEqual([]);
  });

  it('matches a grant with no source by name', () => {
    const state = { known: refs('Bless', 'Shield'), prepared: refs('Bless', 'Shield') };
    const plan = planSpellTrim({
      state,
      limits: { prepared: 1 },
      levelOf,
      alwaysPrepared: [{ name: 'bless', source: '' }],
    });
    expect(namesOf(plan.unprepareRedundant)).toEqual(['Bless']);
    // A grant that does name a source must match it exactly.
    const other = planSpellTrim({
      state,
      limits: { prepared: 1 },
      levelOf,
      alwaysPrepared: [{ name: 'Bless', source: 'XPHB' }],
    });
    expect(other.unprepareRedundant).toEqual([]);
    expect(namesOf(other.unprepare)).toEqual(['Shield']);
  });

  it('forgets the latest cantrips, from known and prepared', () => {
    const state = {
      known: refs('Light', 'Shield', 'Mage Hand', 'Fire Bolt'),
      prepared: refs('Shield', 'Fire Bolt'),
    };
    const plan = planSpellTrim({ state, limits: { cantrips: 1 }, levelOf });
    expect(namesOf(plan.forgetCantrips)).toEqual(['Fire Bolt', 'Mage Hand']);
    const sc = structuredClone(state);
    applySpellTrim(sc, plan);
    expect(namesOf(sc.known)).toEqual(['Light', 'Shield']);
    expect(namesOf(sc.prepared)).toEqual(['Shield']);
  });

  it('forgets leveled spells only when a spells-known limit applies', () => {
    const state = { known: refs('Shield', 'Sleep', 'Fireball'), prepared: [] };
    const known = planSpellTrim({
      state,
      limits: spellLimits({ mode: 'known', spellsKnownMax: 2 }),
      levelOf,
    });
    expect(namesOf(known.forgetKnown)).toEqual(['Fireball']);
    const prepared = planSpellTrim({
      state,
      limits: spellLimits({ mode: 'prepared', spellsKnownMax: 2 }),
      levelOf,
    });
    expect(isEmptyTrim(prepared)).toBe(true);
  });

  it('never forgets a spell whose level is unknown', () => {
    const state = { known: refs('Shield', 'Homebrew Bolt', 'Mystery'), prepared: [] };
    const plan = planSpellTrim({ state, limits: { cantrips: 0, known: 0 }, levelOf });
    expect(namesOf(plan.forgetKnown)).toEqual(['Shield']);
    expect(plan.forgetCantrips).toEqual([]);
  });

  it('recounts prepared after forgetting, so a forgotten spell is not also unprepared', () => {
    // Known over by 1 and prepared over by 1: forgetting Fireball unprepares it,
    // which already brings prepared back to the limit.
    const state = {
      known: refs('Shield', 'Sleep', 'Fireball'),
      prepared: refs('Shield', 'Sleep', 'Fireball'),
    };
    const plan = planSpellTrim({ state, limits: { known: 2, prepared: 2 }, levelOf });
    expect(namesOf(plan.forgetKnown)).toEqual(['Fireball']);
    expect(plan.unprepare).toEqual([]);
  });

  it('counts prepared as the cue does, cantrips and unknown levels included', () => {
    const state = {
      known: refs('Shield', 'Mystery', 'Light'),
      prepared: refs('Shield', 'Mystery', 'Light'),
    };
    const plan = planSpellTrim({ state, limits: { prepared: 1 }, levelOf });
    expect(namesOf(plan.unprepare)).toEqual(['Light', 'Mystery']);
  });

  it('is empty within limits', () => {
    const state = { known: refs('Light', 'Shield'), prepared: refs('Shield') };
    const plan = planSpellTrim({
      state,
      limits: { cantrips: 1, prepared: 1, known: 1 },
      levelOf,
    });
    expect(plan).toEqual(emptyPlan);
    expect(isEmptyTrim(plan)).toBe(true);
  });
});

describe('describeTrim (GAME-007)', () => {
  it('lists a doubled entry once, and tells same-named spells apart by book', () => {
    const plan = {
      ...emptyPlan,
      unprepare: [
        { name: 'Bless', source: 'PHB' },
        { name: 'Bless', source: 'PHB' },
        { name: 'Shield', source: 'PHB' },
        { name: 'Shield', source: 'XPHB' },
      ],
    };
    expect(describeTrim(plan, 'prepared')).toEqual([
      'Unprepare Bless, Shield (PHB), Shield (XPHB) (still known)',
    ]);
  });

  it('names every spell the trim removes, one line per kind', () => {
    const plan = {
      forgetCantrips: refs('Light'),
      forgetKnown: refs('Fireball', 'Sleep'),
      forgetArcanum: refs('Circle of Death'),
      unprepareRedundant: refs('Bless'),
      unprepare: refs('Shield'),
    };
    expect(describeTrim(plan, 'known')).toEqual([
      'Forget cantrip Light',
      'Forget Fireball, Sleep',
      'Forget Circle of Death (one Mystic Arcanum per spell level)',
      'Unprepare Bless (always prepared anyway)',
      'Unprepare Shield (still known)',
    ]);
    expect(
      describeTrim({ ...emptyPlan, forgetCantrips: refs('Light', 'Mage Hand') }, 'known'),
    ).toEqual(['Forget cantrips Light, Mage Hand']);
    expect(describeTrim({ ...emptyPlan, unprepare: refs('Shield') }, 'spellbook')).toEqual([
      'Unprepare Shield (still in your spellbook)',
    ]);
    expect(describeTrim(emptyPlan, 'prepared')).toEqual([]);
  });
});
