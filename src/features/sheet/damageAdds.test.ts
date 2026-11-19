import { describe, expect, it } from 'vitest';
import type { RollEffects } from '@/engine/playRules';
import type { AttackRow, DerivedSheet, FeatureCard } from '@/engine/types';
import { SLOT_COST } from '@/engine/types';
import type { WeaponFeat } from './damageAdds';
import {
  actionKey,
  againstOf,
  damageAdds,
  damageParts,
  entriesText,
  featReaches,
  hitSpell,
  oncePerTurn,
  weaponFeats,
  weaponNeed,
} from './damageAdds';

function row(over: Partial<AttackRow> = {}): AttackRow {
  return {
    label: 'Longsword',
    toHit: { value: 5, base: 5, overridden: false, parts: [] },
    damage: '1d8+3',
    extraDamage: [],
    properties: [],
    origin: 'Weapon',
    ...over,
  };
}

function feature(name: string, entries: unknown, label = 'Rogue'): FeatureCard {
  return {
    name,
    origin: { label, uid: label, type: 'class' },
    entries,
  } as unknown as FeatureCard;
}

const abilities = { str: { mod: 3 }, dex: { mod: 4 } } as unknown as DerivedSheet['abilities'];

describe('entriesText', () => {
  it('returns a string as it is', () => {
    expect(entriesText('Once per turn')).toBe('Once per turn');
  });

  it('joins nested arrays with spaces', () => {
    expect(entriesText(['a', ['b', 'c']])).toBe('a b c');
  });

  it('reads the entries, items and entry keys of an object', () => {
    expect(entriesText({ entries: 'x' }).trim()).toBe('x');
    expect(entriesText({ items: 'z' }).trim()).toBe('z');
    expect(entriesText({ entry: 'w' }).trim()).toBe('w');
    expect(entriesText({ entries: ['p', { items: ['q'] }], entry: 'r' }).split(/\s+/)).toEqual(
      expect.arrayContaining(['p', 'q', 'r']),
    );
  });

  it('gives an empty string for non-string values', () => {
    expect(entriesText(5)).toBe('');
    expect(entriesText(null)).toBe('');
    expect(entriesText(undefined)).toBe('');
    expect(entriesText(true)).toBe('');
  });
});

describe('oncePerTurn', () => {
  it.each([
    'Once per turn, you can deal extra damage.',
    'Once on each of your turns when you hit',
    'You can deal this extra damage only once per turn.',
    'once during each of your turns',
  ])('is true for %j', (text) => {
    expect(oncePerTurn(text)).toBe(true);
  });

  it.each([
    'When you hit a creature with a melee weapon attack, you can expend one spell slot',
    'once per day',
  ])('is false for %j', (text) => {
    expect(oncePerTurn(text)).toBe(false);
  });
});

describe('weaponNeed', () => {
  it('needs a finesse or ranged weapon', () => {
    expect(weaponNeed('The attack must use a finesse or a ranged weapon.')).toBe('finesseOrRanged');
  });

  it('needs a melee weapon', () => {
    expect(weaponNeed('When you hit a creature with a melee weapon attack')).toBe('melee');
  });

  it('needs any weapon for a generic weapon attack', () => {
    expect(weaponNeed('when you hit a creature with a weapon attack')).toBe('any');
  });

  it('needs any weapon when the text mentions both melee and ranged', () => {
    expect(weaponNeed('When you hit with a melee weapon attack or a ranged weapon attack')).toBe(
      'any',
    );
  });
});

describe('damageParts', () => {
  it('names the ability modifier alone', () => {
    expect(damageParts(row({ ability: 'str' }), '1d8+3', abilities)).toBe('STR +3');
  });

  it('adds the magic bonus from the to-hit parts', () => {
    const a = row({
      ability: 'str',
      toHit: {
        value: 5,
        base: 5,
        overridden: false,
        parts: [{ label: 'Magic bonus', amount: 1 }],
      },
    });
    expect(damageParts(a, '1d8+4', abilities)).toBe('STR +3 · Magic +1');
  });

  it('names a damage feature with what it adds past the ability', () => {
    expect(damageParts(row({ ability: 'str', damageFrom: ['Rage'] }), '1d8+5', abilities)).toBe(
      'STR +3 · Rage +2',
    );
  });

  it('joins two damage features with "and"', () => {
    const a = row({ ability: 'str', damageFrom: ['Rage', 'Dueling'] });
    expect(damageParts(a, '1d8+7', abilities)).toBe('STR +3 · Rage and Dueling +4');
  });

  it('gives an empty string for an attack with no ability', () => {
    expect(damageParts(row({ ability: undefined }), '1d8+3', abilities)).toBe('');
  });
});

describe('actionKey', () => {
  it('joins origin, label and economy', () => {
    expect(actionKey({ origin: 'Rogue', label: 'Sneak Attack', economy: 'none' })).toBe(
      'Rogue:Sneak Attack:none',
    );
  });
});

describe('damageAdds', () => {
  const sneakFeature = feature('Sneak Attack', [
    'Once per turn, you can deal extra damage. The attack must use a finesse or a ranged weapon.',
  ]);
  const sneak: DerivedSheet['actions'][number] = {
    economy: 'none',
    label: 'Sneak Attack',
    roll: '2d6',
    origin: 'Rogue',
  };
  const smiteFeature = feature(
    'Divine Smite',
    ['When you hit a creature with a melee weapon attack, you can expend a spell slot.'],
    'Paladin',
  );
  const smite: DerivedSheet['actions'][number] = {
    economy: 'none',
    label: 'Divine Smite',
    origin: 'Paladin',
    cost: {
      resource: SLOT_COST,
      amount: 1,
      slotDice: { die: 8, base: 1, maxDice: 5 },
    },
  };
  const noOffers: RollEffects['offers'] = [];

  it('offers Sneak Attack on a finesse melee weapon', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const out = damageAdds({ actions: [sneak], features: [sneakFeature] }, a, noOffers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'Rogue:Sneak Attack:none',
      source: 'Sneak Attack',
      dice: '2d6',
      kind: 'action',
      oncePerTurn: true,
      action: sneak,
    });
  });

  it('offers Sneak Attack on a ranged weapon', () => {
    const a = row({ ability: 'dex', ranged: true, properties: [] });
    const out = damageAdds({ actions: [sneak], features: [sneakFeature] }, a, noOffers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'action', dice: '2d6' });
  });

  it('does not offer Sneak Attack on a plain melee weapon', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    expect(damageAdds({ actions: [sneak], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('does not offer an action with a save', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const withSave = { ...sneak, save: { targetAbility: 'dex' as const, dc: 14 } };
    expect(damageAdds({ actions: [withSave], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('does not offer an action that heals', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const heals = { ...sneak, heals: true };
    expect(damageAdds({ actions: [heals], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('does not offer an action of plain dice', () => {
    const a = row({ ability: 'dex', ranged: false, properties: ['finesse'] });
    const plain = { ...sneak, plainDice: true };
    expect(damageAdds({ actions: [plain], features: [sneakFeature] }, a, noOffers)).toEqual([]);
  });

  it('offers Divine Smite as a slot on a melee weapon, with no dice', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const out = damageAdds({ actions: [smite], features: [smiteFeature] }, a, noOffers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'Paladin:Divine Smite:none',
      source: 'Divine Smite',
      kind: 'slot',
      oncePerTurn: false,
    });
    expect(out[0]?.dice).toBeUndefined();
  });

  it('does not offer Divine Smite on a ranged weapon', () => {
    const a = row({ ability: 'dex', ranged: true, properties: [] });
    expect(damageAdds({ actions: [smite], features: [smiteFeature] }, a, noOffers)).toEqual([]);
  });

  it('offers a Bardic Inspiration effect die with a College of Valor note', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const offers: RollEffects['offers'] = [
      { dice: '1d8', source: 'Bardic Inspiration', effectId: 'b1', once: true, ifFailed: false },
    ];
    const out = damageAdds({ actions: [], features: [] }, a, offers);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'b1',
      source: 'Bardic Inspiration',
      dice: '1d8',
      kind: 'effect',
      oncePerTurn: false,
      effectId: 'b1',
    });
    expect(out[0]?.note).toContain('College of Valor');
  });

  it('offers nothing for an effect from another source', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const offers: RollEffects['offers'] = [
      { dice: '1d4', source: 'Guidance', effectId: 'g1', once: true, ifFailed: false },
    ];
    expect(damageAdds({ actions: [], features: [] }, a, offers)).toEqual([]);
  });

  it('offers nothing for a Bardic Inspiration effect that is not once only', () => {
    const a = row({ ability: 'str', ranged: false, properties: [] });
    const offers: RollEffects['offers'] = [
      { dice: '1d8', source: 'Bardic Inspiration', effectId: 'b2', once: false, ifFailed: false },
    ];
    expect(damageAdds({ actions: [], features: [] }, a, offers)).toEqual([]);
  });
});

function spell(over: Record<string, unknown> = {}): unknown {
  return {
    name: 'Test Spell',
    level: 1,
    time: [{ number: 1, unit: 'bonus' }],
    range: { type: 'point', distance: { type: 'feet', amount: 90 } },
    entries: [],
    ...over,
  };
}

const ON_HIT_TIME = [
  {
    number: 1,
    unit: 'bonus',
    condition:
      'which you take immediately after hitting a target with a Melee weapon or an Unarmed Strike',
  },
];

describe('againstOf', () => {
  it('reads "an undead or a fiend"', () => {
    expect(againstOf('The damage increases by 1d8 if the target is an undead or a fiend.')).toEqual(
      { dice: '1d8', who: 'a Fiend or Undead' },
    );
  });

  it('reads "a Fiend or an Undead"', () => {
    expect(againstOf('The damage increases by 1d8 if the target is a Fiend or an Undead.')).toEqual(
      { dice: '1d8', who: 'a Fiend or Undead' },
    );
  });

  it('gives undefined when no sentence says so', () => {
    expect(againstOf('The target takes an extra 2d8 radiant damage from the attack.')).toBe(
      undefined,
    );
  });
});

describe('hitSpell cast as you hit', () => {
  const searing2024 = spell({
    time: ON_HIT_TIME,
    entries: [
      'As you hit the target, it takes an extra {@damage 1d6} Fire damage from the attack. At the start of each of its turns, it takes {@damage 1d6} Fire damage.',
    ],
  });

  it('reads a 2024 smite as cast on the hit, with its dice and type', () => {
    expect(hitSpell(searing2024, false)).toEqual({
      how: 'cast',
      every: false,
      on: false,
      need: 'melee',
      dice: '1d6',
      damageType: 'fire',
    });
  });

  it('still reads it as cast while running', () => {
    expect(hitSpell(searing2024, true)).toMatchObject({ how: 'cast', need: 'melee' });
  });

  it('reads the 2024 Divine Smite with its d8 against a Fiend or Undead', () => {
    const smite = spell({
      time: ON_HIT_TIME,
      entries: [
        'The target takes an extra {@damage 2d8} Radiant damage from the attack. The damage increases by {@damage 1d8} if the target is a Fiend or an Undead.',
      ],
    });
    expect(hitSpell(smite, false)).toMatchObject({
      how: 'cast',
      dice: '2d8',
      damageType: 'radiant',
      against: { dice: '1d8', who: 'a Fiend or Undead' },
    });
  });

  it('gives undefined for Ensnaring Strike, whose damage comes later', () => {
    const ensnaring = spell({
      time: ON_HIT_TIME,
      entries: [
        'As you hit the target, grasping vines appear and try to restrain it. While Restrained, the target takes {@damage 1d6} Piercing damage at the start of each of its turns.',
      ],
    });
    expect(hitSpell(ensnaring, false)).toBe(undefined);
    expect(hitSpell(ensnaring, true)).toBe(undefined);
  });
});

describe('hitSpell while concentrating', () => {
  it('reads 2014 Hex as running, every hit, on, with a note on the target', () => {
    const hex = spell({
      entries: [
        'Until the spell ends, you deal an extra {@damage 1d6} necrotic damage to the target whenever you hit it with an attack.',
      ],
    });
    const got = hitSpell(hex, true);
    expect(got).toMatchObject({
      how: 'running',
      every: true,
      on: true,
      need: 'any',
      dice: '1d6',
      damageType: 'necrotic',
    });
    expect(got?.note).toContain('target');
  });

  it('gives undefined for Hex when not concentrating', () => {
    const hex = spell({
      entries: [
        'Until the spell ends, you deal an extra {@damage 1d6} necrotic damage to the target whenever you hit it with an attack.',
      ],
    });
    expect(hitSpell(hex, false)).toBe(undefined);
  });

  it('reads 2014 Searing Smite as one next hit, melee, not on', () => {
    const searing = spell({
      range: { type: 'point', distance: { type: 'self' } },
      entries: [
        "The next time you hit a creature with a melee weapon attack during the spell's duration, your weapon flares with white-hot intensity, and the attack deals an extra {@damage 1d6} fire damage to the target and causes the target to ignite in flames.",
      ],
    });
    expect(hitSpell(searing, true)).toMatchObject({
      how: 'running',
      every: false,
      on: false,
      need: 'melee',
      dice: '1d6',
      damageType: 'fire',
    });
  });

  it('reads 2014 Divine Favor as every hit, on, for the character', () => {
    const favor = spell({
      range: { type: 'point', distance: { type: 'self' } },
      entries: ['Your weapon attacks deal an extra {@damage 1d4} radiant damage on a hit.'],
    });
    expect(hitSpell(favor, true)).toMatchObject({
      how: 'running',
      every: true,
      on: true,
      dice: '1d4',
      damageType: 'radiant',
    });
  });

  it('reads Holy Weapon as every hit but not on, since it is bound to a weapon', () => {
    const holy = spell({
      range: { type: 'point', distance: { type: 'touch' } },
      entries: [
        'Until the spell ends, the weapon deals an extra {@damage 2d8} radiant damage on a hit.',
      ],
    });
    expect(hitSpell(holy, true)).toMatchObject({
      how: 'running',
      every: true,
      on: false,
      dice: '2d8',
      damageType: 'radiant',
    });
  });

  it('reads Spirit Shroud as on, with a note on the 10 feet', () => {
    const shroud = spell({
      range: { type: 'point', distance: { type: 'self' } },
      entries: [
        'Until the spell ends, any attack you make deals {@damage 1d8} extra damage when you hit a creature within 10 feet of you.',
      ],
    });
    const got = hitSpell(shroud, true);
    expect(got).toMatchObject({ how: 'running', on: true, dice: '1d8' });
    expect(got?.note).toContain('10 feet');
  });

  it('gives undefined for a value that is not an object', () => {
    expect(hitSpell(undefined, true)).toBe(undefined);
    expect(hitSpell(null, true)).toBe(undefined);
    expect(hitSpell('Hex', true)).toBe(undefined);
  });
});

describe('weaponFeats', () => {
  const gwm2014 = {
    name: 'Great Weapon Master',
    entries: [
      "You've learned to put the weight of a weapon to your advantage...",
      {
        type: 'list',
        items: [
          "Before you make a melee attack with a heavy weapon that you are proficient with, you can choose to take a -5 penalty to the attack roll. If the attack hits, you add +10 to the attack's damage.",
        ],
      },
    ],
  };

  it('reads 2014 Great Weapon Master as a heavy melee power', () => {
    expect(weaponFeats([gwm2014])).toEqual([
      { kind: 'power', source: 'Great Weapon Master', need: 'heavyMelee' },
    ]);
  });

  it('reads a true minus sign in the -5 penalty the same way', () => {
    const withMinus = {
      name: 'Great Weapon Master',
      entries: [
        "Before you make a melee attack with a heavy weapon that you are proficient with, you can choose to take a −5 penalty to the attack roll. If the attack hits, you add +10 to the attack's damage.",
      ],
    };
    expect(weaponFeats([withMinus])).toEqual([
      { kind: 'power', source: 'Great Weapon Master', need: 'heavyMelee' },
    ]);
  });

  it('reads 2014 Sharpshooter as a ranged power', () => {
    const sharp = {
      name: 'Sharpshooter',
      entries: [
        "Before you make an attack with a ranged weapon that you are proficient with, you can choose to take a -5 penalty to the attack roll. If the attack hits, you add +10 to the attack's damage.",
      ],
    };
    expect(weaponFeats([sharp])).toEqual([
      { kind: 'power', source: 'Sharpshooter', need: 'ranged' },
    ]);
  });

  it('reads 2024 Great Weapon Master as heavy mastery from its nested entry', () => {
    const gwm2024 = {
      name: 'Great Weapon Master',
      entries: [
        {
          type: 'entries',
          name: 'Heavy Weapon Mastery',
          entries: [
            'When you hit a creature with a weapon that has the Heavy property as part of the Attack action on your turn, you can cause the weapon to deal extra damage to the target. The extra damage equals your Proficiency Bonus.',
          ],
        },
      ],
    };
    expect(weaponFeats([gwm2024])).toEqual([
      { kind: 'heavyMastery', source: 'Great Weapon Master', need: 'heavy' },
    ]);
  });

  it('reads 2014 Savage Attacker as a melee savage feat, decided once the damage shows', () => {
    const savage = {
      name: 'Savage Attacker',
      entries: [
        "Once per turn when you roll damage for a melee weapon attack, you can reroll the weapon's damage dice and use either total.",
      ],
    };
    expect(weaponFeats([savage])).toEqual([
      { kind: 'savage', source: 'Savage Attacker', need: 'melee', after: true },
    ]);
  });

  it('reads 2024 Savage Attacker as an any-weapon savage feat', () => {
    const savage = {
      name: 'Savage Attacker',
      entries: [
        "Once per turn when you hit a target with a weapon, you can roll the weapon's damage dice twice and use either roll against the target.",
      ],
    };
    expect(weaponFeats([savage])).toEqual([
      { kind: 'savage', source: 'Savage Attacker', need: 'any' },
    ]);
  });

  it('takes the source name without a trailing parenthesis', () => {
    const savage = {
      name: 'Savage Attacker (Origin)',
      entries: [
        "Once per turn when you hit a target with a weapon, you can roll the weapon's damage dice twice and use either roll against the target.",
      ],
    };
    expect(weaponFeats([savage])[0]?.source).toBe('Savage Attacker');
  });

  it('gives nothing for an unrelated feat', () => {
    expect(
      weaponFeats([{ name: 'Alert', entries: ['You gain a +5 bonus to initiative.'] }]),
    ).toEqual([]);
  });
});

describe('featReaches', () => {
  const PROFICIENT = [{ label: 'Proficiency', amount: 2 }];
  const proficient = (over: Partial<AttackRow> = {}): AttackRow =>
    row({ toHit: { value: 5, base: 5, overridden: false, parts: PROFICIENT }, ...over });
  const power = (need: WeaponFeat['need']): WeaponFeat => ({
    kind: 'power',
    source: 'Feat',
    need,
  });

  it('reaches a proficient melee heavy weapon with a heavyMelee power', () => {
    expect(
      featReaches(power('heavyMelee'), proficient({ properties: ['heavy'], ranged: false })),
    ).toBe(true);
  });

  it('does not reach a heavyMelee power without the Proficiency part', () => {
    expect(featReaches(power('heavyMelee'), row({ properties: ['heavy'], ranged: false }))).toBe(
      false,
    );
  });

  it('does not reach a heavyMelee power with a ranged heavy weapon', () => {
    expect(
      featReaches(power('heavyMelee'), proficient({ properties: ['heavy'], ranged: true })),
    ).toBe(false);
  });

  it('does not reach a heavyMelee power with a light melee weapon', () => {
    expect(featReaches(power('heavyMelee'), proficient({ properties: [], ranged: false }))).toBe(
      false,
    );
  });

  it('reaches a proficient ranged weapon with a ranged power only', () => {
    expect(featReaches(power('ranged'), proficient({ ranged: true }))).toBe(true);
    expect(featReaches(power('ranged'), proficient({ ranged: false }))).toBe(false);
  });

  it('reaches heavy weapons, melee or ranged, with heavyMastery', () => {
    const mastery: WeaponFeat = { kind: 'heavyMastery', source: 'GWM', need: 'heavy' };
    expect(featReaches(mastery, row({ properties: ['heavy'], ranged: false }))).toBe(true);
    expect(featReaches(mastery, row({ properties: ['heavy'], ranged: true }))).toBe(true);
  });

  it('does not reach light weapons with heavyMastery', () => {
    const mastery: WeaponFeat = { kind: 'heavyMastery', source: 'GWM', need: 'heavy' };
    expect(featReaches(mastery, row({ properties: ['light'], ranged: false }))).toBe(false);
    expect(featReaches(mastery, row({ properties: ['light'], ranged: true }))).toBe(false);
  });

  it('reaches melee rows, not ranged ones, with a melee savage feat', () => {
    const savage: WeaponFeat = { kind: 'savage', source: 'Savage Attacker', need: 'melee' };
    expect(featReaches(savage, row({ ranged: false }))).toBe(true);
    expect(featReaches(savage, row({ ranged: true }))).toBe(false);
  });

  it('reaches every row with an any savage feat', () => {
    const savage: WeaponFeat = { kind: 'savage', source: 'Savage Attacker', need: 'any' };
    expect(featReaches(savage, row({ ranged: false }))).toBe(true);
    expect(featReaches(savage, row({ ranged: true }))).toBe(true);
  });
});
