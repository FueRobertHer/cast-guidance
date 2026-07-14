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

  it('is undefined when the class declares no requirements', () => {
    expect(multiclassRequirementText({})).toBeUndefined();
    expect(multiclassRequirementText(undefined)).toBeUndefined();
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
