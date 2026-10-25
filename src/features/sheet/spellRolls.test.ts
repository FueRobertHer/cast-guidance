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

// Real v2.32.0 data: the secondary block carries a 5etools template variable,
// and the on-hit block starts at 5th level.
const greenFlameBlade: Entity = {
  name: 'Green-Flame Blade',
  source: 'TCE',
  level: 0,
  entries: [
    "On a hit, the target suffers the weapon attack's normal effects, and you can cause green fire to leap from the target to a different creature of your choice that you can see within 5 feet of it. The second creature takes fire damage equal to your spellcasting ability modifier.",
    "This spell's damage increases when you reach certain levels. At 5th level, the melee attack deals an extra {@damage 1d8} fire damage to the target on a hit, and the fire damage to the second creature increases to {@damage 1d8} + your spellcasting ability modifier. Both damage rolls increase by {@damage 1d8} at 11th level ({@damage 2d8} and {@damage 2d8}) and 17th level ({@damage 3d8} and {@damage 3d8}).",
  ],
  scalingLevelDice: [
    {
      label: 'fire damage to secondary creature',
      scaling: {
        '1': '{{spellcasting_mod}}',
        '5': '1d8 + {{spellcasting_mod}}',
        '11': '2d8 + {{spellcasting_mod}}',
        '17': '3d8 + {{spellcasting_mod}}',
      },
    },
    { label: 'fire damage on hit', scaling: { '5': '1d8', '11': '2d8', '17': '3d8' } },
  ],
};

const secondary = (expr: string) => ({
  expr,
  label: 'Green-Flame Blade fire damage to secondary creature',
  variant: 'damage',
});
const onHit = (expr: string) => ({
  expr,
  label: 'Green-Flame Blade fire damage on hit',
  variant: 'damage',
});

describe('spellRollActions: the spellcasting modifier template', () => {
  it.each([1, 2, 3, 4])('rolls only the modifier at level %i, with no on-hit die', (level) => {
    expect(
      spellRollActions(greenFlameBlade, { characterLevel: level, abilityModifier: 3 }),
    ).toEqual([secondary('3')]);
  });

  it.each([
    [5, '1d8'],
    [11, '2d8'],
    [17, '3d8'],
  ])('adds the modifier to the secondary die at level %i', (level, die) => {
    expect(
      spellRollActions(greenFlameBlade, { characterLevel: level, abilityModifier: 3 }),
    ).toEqual([secondary(`${die}+3`), onHit(die)]);
  });

  it('writes a negative modifier with its own sign', () => {
    expect(spellRollActions(greenFlameBlade, { characterLevel: 5, abilityModifier: -1 })).toEqual([
      secondary('1d8-1'),
      onHit('1d8'),
    ]);
  });

  it('offers no fixed roll of zero or less', () => {
    expect(spellRollActions(greenFlameBlade, { characterLevel: 1, abilityModifier: -1 })).toEqual(
      [],
    );
    expect(spellRollActions(greenFlameBlade, { characterLevel: 1, abilityModifier: 0 })).toEqual(
      [],
    );
    expect(spellRollActions(greenFlameBlade, { characterLevel: 5, abilityModifier: 0 })).toEqual([
      secondary('1d8'),
      onHit('1d8'),
    ]);
  });

  it('drops the term when no modifier is known', () => {
    // Level 1 leaves nothing to roll, and the prose's 5th-level dice stay
    // description rather than turning into chips.
    expect(spellRollActions(greenFlameBlade, { characterLevel: 1 })).toEqual([]);
    expect(spellRollActions(greenFlameBlade, { characterLevel: 5 })).toEqual([
      secondary('1d8'),
      onHit('1d8'),
    ]);
  });

  it('gives a sheet with no class yet the 1st-level rolls, not 5th-level dice', () => {
    // Level 0 rolls as level 1: the modifier alone, and no on-hit die.
    expect(spellRollActions(greenFlameBlade, { characterLevel: 0, abilityModifier: 2 })).toEqual([
      secondary('2'),
    ]);
    expect(spellRollActions(greenFlameBlade, { characterLevel: 0 })).toEqual([]);
  });

  it('drops a roll carrying any other template it cannot fill', () => {
    const spell: Entity = {
      name: 'Template Test',
      level: 0,
      entries: ['Deals {@damage 1d6} cold damage.'],
      scalingLevelDice: { label: 'cold damage', scaling: { '1': '1d6+{{summon_level}}' } },
    };
    expect(spellRollActions(spell, { characterLevel: 1, abilityModifier: 3 })).toEqual([]);
  });

  it('keeps the prose dice when the block has no scaling table', () => {
    const spell: Entity = {
      name: 'Broken Block',
      level: 0,
      entries: ['Deals {@damage 1d6} cold damage.'],
      scalingLevelDice: { label: 'cold damage' },
    };
    expect(spellRollActions(spell, { characterLevel: 1 })).toEqual([
      { expr: '1d6', label: 'Broken Block cold damage', variant: 'damage' },
    ]);
  });
});

describe('spellRollActions on hostile text', () => {
  it('still reads a slot-scaled roll through the bounded patterns', () => {
    const fireball: Entity = {
      name: 'Fireball',
      level: 3,
      entries: ['Each creature takes {@damage 8d6} fire damage.'],
      entriesHigherLevel: ['The damage increases by {@scaledamage 8d6|3-9|1d6} per slot level.'],
    };
    expect(spellRollActions(fireball, { characterLevel: 5, slotLevel: 5 })).toEqual([
      { expr: '10d6', label: 'Fireball fire damage', variant: 'damage' },
    ]);
  });

  it('stays linear on a long run of unclosed dice tags', () => {
    // Each unclosed tag made the old patterns walk the rest of the string, so
    // these took about thirteen and twelve seconds on a fast machine. The
    // budget here is the test timeout.
    const spell: Entity = {
      name: 'Hostile',
      level: 1,
      entries: ['Takes {@damage 1d6} fire damage.', '{@damage '.repeat(45_000)],
      entriesHigherLevel: ['{@scaledamage '.repeat(32_000)],
    };
    expect(spellRollActions(spell, { characterLevel: 1, slotLevel: 2 })).toEqual([
      { expr: '1d6', label: 'Hostile fire damage', variant: 'damage' },
    ]);
  }, 2000);
});
