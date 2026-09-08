import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { spellRollActions } from './spellRolls';

const fireBolt: Entity = {
  name: 'Fire Bolt',
  level: 0,
  entries: [
    'On a hit, the target takes {@damage 1d10} fire damage.',
    'Damage increases at 5th ({@damage 2d10}), 11th ({@damage 3d10}), and 17th ({@damage 4d10}).',
  ],
  scalingLevelDice: {
    label: 'fire damage',
    scaling: { '1': '1d10', '5': '2d10', '11': '3d10', '17': '4d10' },
  },
};

describe('spellRollActions', () => {
  it.each([
    [1, '1d10'],
    [5, '2d10'],
    [10, '2d10'],
    [11, '3d10'],
    [17, '4d10'],
    [20, '4d10'],
  ])('scales Fire Bolt at character level %i', (characterLevel, expr) => {
    expect(spellRollActions(fireBolt, { characterLevel })).toEqual([
      { expr, label: 'Fire Bolt fire damage', variant: 'damage' },
    ]);
  });

  it('applies slot scaling and the spellcasting modifier to healing', () => {
    const cureWounds: Entity = {
      name: 'Cure Wounds',
      level: 1,
      entries: [
        'A creature regains hit points equal to {@dice 1d8} + your spellcasting ability modifier.',
      ],
      entriesHigherLevel: [
        'The healing increases by {@scaledice 1d8|1-9|1d8} for each slot level above 1st.',
      ],
    };
    expect(
      spellRollActions(cureWounds, { characterLevel: 5, slotLevel: 3, abilityModifier: 3 }),
    ).toEqual([{ expr: '3d8+3', label: 'Cure Wounds healing', variant: 'dice' }]);
  });

  it('keeps distinct rolls for spells with multiple effects', () => {
    const spell: Entity = {
      name: 'Ice Test',
      level: 1,
      entries: [
        'The target takes {@damage 1d10} piercing damage, then nearby creatures take {@damage 2d6} cold damage.',
      ],
    };
    expect(spellRollActions(spell, { characterLevel: 1 })).toEqual([
      { expr: '1d10', label: 'Ice Test piercing damage', variant: 'damage' },
      { expr: '2d6', label: 'Ice Test cold damage', variant: 'damage' },
    ]);
  });

  it('surfaces non-damage dice such as Guidance', () => {
    const guidance: Entity = {
      name: 'Guidance',
      level: 0,
      entries: ['The target can roll a {@dice d4} and add it to an ability check.'],
    };
    expect(spellRollActions(guidance, { characterLevel: 1 })).toEqual([
      // Written as a bare "d4" in the book; a chip reading "d4" looks like an
      // instruction rather than a roll, so the count is spelled out.
      { expr: '1d4', label: 'Guidance roll', variant: 'dice' },
    ]);
  });
});

describe('spellRollActions: one chip per thing you actually roll', () => {
  // Real 5etools wording, where the ladder sentence tags its increment.
  const realFireBolt: Entity = {
    name: 'Fire Bolt',
    level: 0,
    entries: [
      'On a hit, the target takes {@damage 1d10} fire damage.',
      "This spell's damage increases by {@dice 1d10} when you reach 5th level ({@damage 2d10}), 11th level ({@damage 3d10}), and 17th level ({@damage 4d10}).",
    ],
    scalingLevelDice: {
      label: 'fire damage',
      scaling: { '1': '1d10', '5': '2d10', '11': '3d10', '17': '4d10' },
    },
  };

  it('drops the increment the ladder sentence quotes', () => {
    // The "+1d10 per tier" figure is a description of the scaling, and the chip
    // beside it already shows what this character rolls.
    expect(spellRollActions(realFireBolt, { characterLevel: 5 })).toEqual([
      { expr: '2d10', label: 'Fire Bolt fire damage', variant: 'damage' },
    ]);
  });

  it('shows the first tier to a sheet below the first tier', () => {
    // A character with no class yet is level 0. Every tier at once read as four
    // different attacks; the cantrip has one die and this is it.
    expect(spellRollActions(realFireBolt, { characterLevel: 0 })).toEqual([
      { expr: '1d10', label: 'Fire Bolt fire damage', variant: 'damage' },
    ]);
  });

  it('keeps a roll that merely sits near the word level', () => {
    const spell: Entity = {
      name: 'Level Test',
      level: 1,
      entries: ['The target takes {@damage 2d6} cold damage on a failed save at any level.'],
    };
    expect(spellRollActions(spell, { characterLevel: 1 })).toEqual([
      { expr: '2d6', label: 'Level Test cold damage', variant: 'damage' },
    ]);
  });
});

describe('spellRollActions: spells with two outcomes', () => {
  // Toll the Dead rolls a d8, or a d12 against a wounded target, so 5etools
  // gives it two scaling blocks in an array rather than one.
  const tollTheDead: Entity = {
    name: 'Toll the Dead',
    level: 0,
    entries: [
      'The target must succeed on a Wisdom saving throw or take {@damage 1d8} necrotic damage. If the target is missing any of its hit points, it instead takes {@damage 1d12} necrotic damage.',
      "The spell's damage increases by one die when you reach 5th level ({@damage 2d8} or {@damage 2d12}), 11th level ({@damage 3d8} or {@damage 3d12}), and 17th level ({@damage 4d8} or {@damage 4d12}).",
    ],
    scalingLevelDice: [
      { label: 'necrotic damage', scaling: { '1': '1d8', '5': '2d8', '11': '3d8', '17': '4d8' } },
      {
        label: 'necrotic damage to wounded creature',
        scaling: { '1': '1d12', '5': '2d12', '11': '3d12', '17': '4d12' },
      },
    ],
  };

  it('keeps one chip per outcome, at the right tier', () => {
    // An array of blocks used to match nothing, so the whole ladder came from
    // the prose instead: eight chips, at every level, for a two-choice spell.
    expect(spellRollActions(tollTheDead, { characterLevel: 5 })).toEqual([
      { expr: '2d8', label: 'Toll the Dead necrotic damage', variant: 'damage' },
      {
        expr: '2d12',
        label: 'Toll the Dead necrotic damage to wounded creature',
        variant: 'damage',
      },
    ]);
  });
});
