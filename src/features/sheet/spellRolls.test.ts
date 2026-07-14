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
      { expr: 'd4', label: 'Guidance roll', variant: 'dice' },
    ]);
  });
});
