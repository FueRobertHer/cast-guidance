import { describe, expect, it } from 'vitest';
import {
  meetsMulticlassRequirements,
  multiclassRequirementText,
  subclassUnlockLevel,
} from './multiclass';
import type { Ability, DataEntity } from './types';

const scores = (over: Partial<Record<Ability, number>>): Record<Ability, number> => ({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
  ...over,
});

const cls = (requirements: unknown): DataEntity => ({ multiclassing: { requirements } });

// The shape the pinned release writes (v2.41.0), as 5etools reads it: every
// score at the top of `requirements` is needed; the scores inside one `or`
// object are alternatives (the 2014 Fighter's `or: [{ str: 13, dex: 13 }]`).
// The Workshop and the converter write one-of as one score per `or` object,
// `or: [{ str: 13 }, { dex: 13 }]`, which reads as either too.

describe('multiclassRequirementText', () => {
  it('renders a single-ability requirement', () => {
    expect(multiclassRequirementText(cls({ str: 13 }))).toBe('STR 13');
  });

  it('renders an "and" requirement and an "or" alternative', () => {
    expect(multiclassRequirementText(cls({ str: 13, cha: 13 }))).toBe('STR 13 and CHA 13');
    expect(multiclassRequirementText(cls({ or: [{ str: 13 }, { dex: 13 }] }))).toBe(
      'STR 13 or DEX 13',
    );
  });

  it("says the book's Fighter needs Strength or Dexterity", () => {
    expect(multiclassRequirementText(cls({ or: [{ str: 13, dex: 13 }] }))).toBe('STR 13 or DEX 13');
  });

  it('says what the top needs, and then the alternatives', () => {
    expect(multiclassRequirementText(cls({ cha: 13, or: [{ str: 13, dex: 13 }] }))).toBe(
      'CHA 13, and STR 13 or DEX 13',
    );
  });

  it('is undefined when the class declares no requirements', () => {
    expect(multiclassRequirementText({})).toBeUndefined();
    expect(multiclassRequirementText(undefined)).toBeUndefined();
    // A copy writes null for what it drops (copyWriter.ts): none of this.
    expect(multiclassRequirementText({ multiclassing: null })).toBeUndefined();
    expect(multiclassRequirementText(cls({ or: [] }))).toBeUndefined();
  });
});

describe('meetsMulticlassRequirements', () => {
  it('passes when there are no requirements', () => {
    expect(meetsMulticlassRequirements({}, scores({}))).toBe(true);
  });

  it('checks a single-ability floor on final scores', () => {
    expect(meetsMulticlassRequirements(cls({ str: 13 }), scores({ str: 13 }))).toBe(true);
    expect(meetsMulticlassRequirements(cls({ str: 13 }), scores({ str: 12 }))).toBe(false);
  });

  it('requires every ability in an "and" requirement', () => {
    const c = cls({ str: 13, cha: 13 });
    expect(meetsMulticlassRequirements(c, scores({ str: 13, cha: 13 }))).toBe(true);
    expect(meetsMulticlassRequirements(c, scores({ str: 13, cha: 12 }))).toBe(false);
  });

  it('accepts either branch of an "or" requirement (fighter STR 13 or DEX 13)', () => {
    const c = cls({ or: [{ str: 13 }, { dex: 13 }] });
    expect(meetsMulticlassRequirements(c, scores({ dex: 15 }))).toBe(true);
    expect(meetsMulticlassRequirements(c, scores({ str: 15 }))).toBe(true);
    expect(meetsMulticlassRequirements(c, scores({ str: 12, dex: 12 }))).toBe(false);
  });
});

describe('meetsMulticlassRequirements on the shapes the release writes', () => {
  it("passes the book's Fighter on Strength or Dexterity alone", () => {
    const fighter = cls({ or: [{ str: 13, dex: 13 }] });
    expect(meetsMulticlassRequirements(fighter, scores({ str: 13 }))).toBe(true);
    expect(meetsMulticlassRequirements(fighter, scores({ dex: 13 }))).toBe(true);
    expect(meetsMulticlassRequirements(fighter, scores({ str: 12, dex: 12 }))).toBe(false);
  });

  it('needs every score at the top and one of the alternatives', () => {
    const c = cls({ cha: 13, or: [{ str: 13, dex: 13 }] });
    expect(meetsMulticlassRequirements(c, scores({ cha: 13, dex: 13 }))).toBe(true);
    expect(meetsMulticlassRequirements(c, scores({ cha: 12, dex: 13 }))).toBe(false);
    expect(meetsMulticlassRequirements(c, scores({ cha: 13 }))).toBe(false);
  });

  it("passes a copy's null and an empty list as no requirement", () => {
    const none = scores({ str: 3, dex: 3, con: 3, int: 3, wis: 3, cha: 3 });
    expect(meetsMulticlassRequirements({ multiclassing: null }, none)).toBe(true);
    expect(meetsMulticlassRequirements(cls({ or: [] }), none)).toBe(true);
  });
});

describe('subclassUnlockLevel', () => {
  it('reads the level from a gainSubclassFeature entry', () => {
    const c: DataEntity = {
      classFeatures: [
        'Fighting Style|Fighter||1',
        { classFeature: 'Martial Archetype|Fighter||3', gainSubclassFeature: true },
      ],
    };
    expect(subclassUnlockLevel(c)).toBe(3);
  });

  it('defaults to level 1 when none is marked', () => {
    expect(subclassUnlockLevel({ classFeatures: ['Feature|X||1'] })).toBe(1);
    expect(subclassUnlockLevel(undefined)).toBe(1);
  });
});
