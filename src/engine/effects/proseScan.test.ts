import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type EffectInput, type EffectOrigin, newCharacterDoc } from '../types';
import { Collector } from './base';
import { flattenEntries, proseScanFeature } from './proseScan';
import { collectRace } from './race';

const origin: EffectOrigin = { label: 'Trait', uid: 'race|x', type: 'race' };

function scan(name: string, entries: unknown): EffectInput[] {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
  proseScanFeature(col, name, entries, origin);
  return col.effects;
}

describe('flattenEntries', () => {
  it('walks nested entries/entry/items and lowercases', () => {
    expect(flattenEntries([{ entries: ['Hello'] }, { entry: 'World' }, { items: ['A'] }])).toBe(
      'hello world a',
    );
  });

  it('keeps the display text of {@tag ...} markup and folds apostrophes', () => {
    expect(flattenEntries('Cast {@spell bless|phb} once')).toBe('cast bless once');
    expect(flattenEntries('It’s fine')).toBe("it's fine");
  });

  it('reads a three-part tag by its display text, not its name', () => {
    expect(flattenEntries('your {@variantrule Proficiency|XPHB|Proficiency Bonus}')).toBe(
      'your proficiency bonus',
    );
    expect(flattenEntries('a 15-foot {@variantrule Cone [Area of Effect]|XPHB|Cone}')).toBe(
      'a 15-foot cone',
    );
    expect(
      flattenEntries('a {@variantrule Short Rest|XPHB|Short} or {@variantrule Long Rest|XPHB}'),
    ).toBe('a short or long rest');
  });

  it('keeps the body of tags whose third part is not display text', () => {
    expect(flattenEntries('{@scaledamage 8d6|3-9|1d6}')).toBe('8d6');
    expect(flattenEntries('{@filter Light|items|type=martial weapon}')).toBe('light');
  });

  it('reads each string on its own, so an unclosed tag leaves the next one readable', () => {
    expect(
      flattenEntries([
        'broken {@spell bless',
        'your {@variantrule Proficiency|XPHB|Proficiency Bonus}',
      ]),
    ).toBe('broken {@spell bless your proficiency bonus');
  });

  it('is empty for non-text content', () => {
    expect(flattenEntries(undefined)).toBe('');
    expect(flattenEntries([{ type: 'table' }])).toBe('');
  });
});

describe('proseScanFeature — limited-use detection', () => {
  const resource = (effects: EffectInput[]) =>
    effects.find((e): e is Extract<EffectInput, { kind: 'resource' }> => e.kind === 'resource');

  it('emits a once-per-long-rest resource', () => {
    const r = resource(scan('Breath', ['You can use it once per long rest.']));
    expect(r).toMatchObject({ kind: 'resource', label: 'Breath', max: 1, resetOn: 'long' });
  });

  it('resets on a short rest when the prose says so', () => {
    const r = resource(
      scan('Trick', ['You can use it twice, and you regain all uses on a short or long rest.']),
    );
    expect(r?.resetOn).toBe('short');
    expect(r?.max).toBe(2);
  });

  it('reads a proficiency-bonus number of uses', () => {
    const r = resource(
      scan('Channel', ['You can use it a number of times equal to your proficiency bonus.']),
    );
    expect(r?.max).toBe('profBonus');
  });

  it('adds nothing when there is no usage wording', () => {
    expect(scan('Flavor', ['You have a keen sense of smell.'])).toEqual([]);
  });

  it('reads an ability-modifier number of uses (Cleansing Touch wording)', () => {
    const r = resource(
      scan('Cleansing Touch', [
        'You can use this feature a number of times equal to your Charisma modifier (a minimum of once). You regain expended uses when you finish a long rest.',
      ]),
    );
    expect(r).toMatchObject({ max: 'abilityMod:cha', resetOn: 'long' });
  });

  it('reads a "1 + modifier" number of uses (Divine Sense wording)', () => {
    const r = resource(
      scan('Divine Sense', [
        'As an action, you can open your awareness to detect such forces.',
        'You can use this feature a number of times equal to 1 + your Charisma modifier. When you finish a long rest, you regain all expended uses.',
      ]),
    );
    expect(r).toMatchObject({ max: 'abilityModPlus1:cha', resetOn: 'long' });
  });

  it('takes the reset from the clause that returns the uses, not any rest it mentions', () => {
    // Star Map: the short rest here is when a replacement ritual can happen.
    const ritual = resource(
      scan('Star Map', [
        'You can do so a number of times equal to your {@variantrule Proficiency|XPHB|Proficiency Bonus}, and you regain all expended uses when you finish a {@variantrule Long Rest|XPHB}. A ceremony to replace the map can be performed during a {@variantrule Short Rest|XPHB|Short} or {@variantrule Long Rest|XPHB}.',
      ]),
    );
    expect(ritual?.resetOn).toBe('long');

    // Mist Walker: the short rest here is when the mists drain you.
    const drain = resource(
      scan('Mist Walker', [
        'You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest. Whenever you finish a short rest in that area, make a Constitution saving throw.',
      ]),
    );
    expect(drain?.resetOn).toBe('long');
  });

  it.each([
    'You regain one expended use when you finish a short rest, and you regain all expended uses when you finish a long rest.',
    'You regain one of its expended uses when you finish a short rest, and you regain all expended uses when you finish a long rest.',
    'You regain all expended uses when you finish a long rest, and you regain one expended use when you finish a short rest.',
  ])('resets on a short rest when that rest returns even one use: %s', (returning) => {
    const r = resource(scan('Second Wind', [`You can use it twice. ${returning}`]));
    expect(r).toMatchObject({ max: 2, resetOn: 'short' });
  });
});

describe('proseScanFeature on 2024 tagged prose', () => {
  const resource = (effects: EffectInput[]) =>
    effects.find((e): e is Extract<EffectInput, { kind: 'resource' }> => e.kind === 'resource');
  const action = (effects: EffectInput[]) =>
    effects.find((e): e is Extract<EffectInput, { kind: 'action' }> => e.kind === 'action');

  /** The shape of the XPHB trait: a typed save, a choice of area, proficiency-bonus uses. */
  const BREATH_WEAPON = [
    'You can replace one of your attacks with a breath in either a 15-foot {@variantrule Cone [Area of Effect]|XPHB|Cone} or a 30-foot {@variantrule Line [Area of Effect]|XPHB|Line}. Each creature there must make a Dexterity saving throw ({@dc 8} plus your Constitution modifier and {@variantrule Proficiency|XPHB|Proficiency Bonus}) or take {@damage 1d10} Fire damage.',
    'You can use this a number of times equal to your {@variantrule Proficiency|XPHB|Proficiency Bonus}, and you regain all expended uses when you finish a {@variantrule Long Rest|XPHB}.',
  ];

  it('gives Adrenaline Rush its proficiency-bonus uses and bonus action', () => {
    const effects = scan('Adrenaline Rush', [
      'You can take the {@action Dash|XPHB} action as a {@variantrule Bonus Action|XPHB}.',
      'You can use this trait a number of times equal to your {@variantrule Proficiency|XPHB|Proficiency Bonus}, and you regain all expended uses when you finish a {@variantrule Short Rest|XPHB|Short} or {@variantrule Long Rest|XPHB}.',
    ]);
    expect(resource(effects)).toMatchObject({
      label: 'Adrenaline Rush',
      max: 'profBonus',
      resetOn: 'short',
    });
    expect(action(effects)).toMatchObject({ label: 'Adrenaline Rush', economy: 'bonus' });
  });

  it('gives Breath Weapon its action, uses, save and damage type', () => {
    const effects = scan('Breath Weapon', BREATH_WEAPON);
    expect(resource(effects)).toMatchObject({ max: 'profBonus', resetOn: 'long' });
    expect(action(effects)).toMatchObject({
      economy: 'action',
      roll: '1d10',
      note: 'fire',
      save: { targetAbility: 'dex', dcAbility: 'con' },
    });
  });

  function collectBreathWeapon(raceName: string, rulesVersion: '2014' | '2024'): EffectInput[] {
    const race = {
      name: raceName,
      source: 'XPHB',
      entries: [{ name: 'Breath Weapon', type: 'entries', entries: BREATH_WEAPON }],
    };
    const doc = newCharacterDoc('c', 'H', 't');
    doc.rulesVersion = rulesVersion;
    doc.race = { name: race.name, source: race.source };
    const col = new Collector(doc, { get: () => race, byType: () => [race] });
    collectRace(col);
    return col.effects;
  }

  // "in either a ... or a ..." is a choice, not one area the scanner can state.
  // A character switched to 2014 rules keeps the race, and its prose still offers it.
  it.each([
    '2024',
    '2014',
  ] as const)('gets the Breath Weapon area from the ancestry table on a %s character', (rulesVersion) => {
    const effects = collectBreathWeapon('Dragonborn (Red)', rulesVersion);
    expect(resource(effects)).toMatchObject({ max: 'profBonus', resetOn: 'long' });
    expect(action(effects)).toMatchObject({
      label: 'Breath Weapon',
      economy: 'action',
      note: 'fire · 15 ft cone or 30 ft line',
      save: { targetAbility: 'dex', dcAbility: 'con' },
    });
  });

  it('leaves a scanned damage type alone when the ancestry table disagrees', () => {
    // The table's type for black is acid; this prose says fire.
    expect(action(collectBreathWeapon('Dragonborn (Black)', '2024'))?.note).toBe('fire');
  });

  it('reads a per-level HP rider worded through a tag (Dwarven Toughness)', () => {
    const effects = scan('Dwarven Toughness', [
      'Your {@variantrule Hit Points|XPHB|Hit Point} maximum increases by 1 whenever you gain a level.',
    ]);
    expect(effects).toMatchObject([{ kind: 'hpPerLevel', amount: 1 }]);
  });
});

describe('proseScanFeature reaction wording', () => {
  const economies = (entries: unknown) =>
    scan('Trait', entries).flatMap((e) => (e.kind === 'action' ? [e.economy] : []));

  it('keeps the 2014 phrasings', () => {
    expect(economies(['As a reaction, you can halve the damage.'])).toEqual(['reaction']);
    expect(economies(['You can use your reaction to halve the damage.'])).toEqual(['reaction']);
  });

  it.each([
    ['you can', 'When an attacker hits you, you can take a Reaction to halve the damage.'],
    ['you must', 'To help another creature, you must take a Reaction to do so.'],
    // How the 2024 data really writes it, tag and all.
    ['the tagged rule', 'When you fall, you can take a {@variantrule Reaction|XPHB} to slow it.'],
  ])('reads the 2024 phrasing: %s', (_, prose) => {
    expect(economies([prose])).toEqual(['reaction']);
  });

  it.each([
    ['a familiar', 'Your familiar can take a Reaction to add a bonus to the armor class.'],
    ['a mount', 'Your mount can take a {@variantrule Reaction|XPHB} to move up to its speed.'],
    ['each target', 'Each target can then take a Reaction to also teleport up to 30 feet.'],
    ['each ally', 'Each of those allies can immediately take a Reaction to move.'],
    ['one creature', 'The creature can also immediately take a Reaction to teleport.'],
  ])('leaves out a Reaction that %s takes', (_, prose) => {
    expect(economies([prose])).toEqual([]);
  });

  it('does not read a Reaction the prose forbids', () => {
    expect(economies(["While the rage lasts, you can't take a Reaction."])).toEqual([]);
  });

  it('gives the 2024 chip what a limited-use chip carries', () => {
    const effects = scan('Trait', [
      "When you fail a save, you can take a Reaction to roll 1d4 and add it. You can't use this feature again until you finish a long rest.",
    ]);
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'reaction', roll: '1d4' }),
    );
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', max: 1, resetOn: 'long' }),
    );
  });
});

describe('proseScanFeature rolls', () => {
  const action = (entries: string) =>
    scan('Trait', entries).find((e) => e.kind === 'action') as
      | (EffectInput & { kind: 'action' })
      | undefined;

  it('marks dice in a sentence about regaining hit points as a heal', () => {
    const heal = action('Once per long rest, as a bonus action, you regain 1d10 + 2 hit points.');
    expect(heal?.roll).toBe('1d10+2');
    expect(heal?.heals).toBe(true);
  });

  it('leaves damage dice as damage where the same sentence heals you by their result', () => {
    const drain = action(
      'Once per long rest, as a bonus action, a creature takes 2d6 necrotic damage, and you regain hit points equal to half of it.',
    );
    expect(drain?.roll).toBe('2d6');
    expect(drain?.heals).toBe(false);
  });

  it('leaves damage dice as they were, even beside a sentence about regaining a use', () => {
    const breath = action(
      'Once per long rest, as a bonus action, each creature takes 2d6 fire damage. You regain hit points only by resting.',
    );
    expect(breath).toMatchObject({ roll: '2d6', heals: false, plainDice: false });
  });

  it.each([
    ['dice then damage', 'a creature takes 2d6 damage.', '2d6'],
    ['dice then a type', 'a creature takes 2d6 fire damage.', '2d6'],
    ['dice then two types', 'a creature takes 2d8 lightning or thunder damage.', '2d8'],
    ['dice then a list of types', 'a creature takes 1d6 acid, cold, or fire damage.', '1d6'],
    ['dice then a modifier', 'it deals 1d8 + your Strength modifier slashing damage.', '1d8'],
    ['dice then extra damage', 'your weapon deals 1d6 extra damage.', '1d6'],
    ['an explicit 1d20', 'a creature takes 1d20 fire damage.', '1d20'],
    ['a type then dice', 'a creature takes cold damage equal to 1d8.', '1d8'],
    ['damage that grows', 'your attack hits, and this damage increases by 1d6.', '1d6'],
  ])('reads dice as damage only where the prose says they deal it: %s', (_, sentence, roll) => {
    const hit = action(`Once per long rest, as a bonus action, ${sentence}`);
    expect(hit).toMatchObject({ roll, heals: false, plainDice: false });
  });

  it.each([
    ['temporary hit points', 'an ally gains temporary hit points equal to 2d6.', '2d6'],
    ['damage reduced', 'when you take damage, you reduce the damage taken by 1d4.', '1d4'],
    ['a bonus die', 'an ally can roll a d8 and add it to an attack roll.', '1d8'],
    ['a die swapped for another', 'you can roll 1d6 instead of 1d4.', '1d6'],
    ['less damage taken', 'you take 1d6 less damage.', '1d6'],
    ['a die rolled ahead of damage', 'you can roll 1d6 before damage is dealt.', '1d6'],
    ['a bonus to a damage roll', 'an ally adds 1d8 as a bonus to the damage roll.', '1d8'],
  ])('reads other dice as plain dice: %s', (_, sentence, roll) => {
    const die = action(`Once per long rest, as a bonus action, ${sentence}`);
    expect(die).toMatchObject({ roll, heals: false, plainDice: true });
  });

  it.each([
    'a creature returns to life, regaining a number of hit points equal to 4d10.',
    'a creature returns to life with a number of hit points equal to 4d10.',
  ])('reads hit points brought back as a heal (Hand of Ultimate Mercy wording): %s', (sentence) => {
    const heal = action(`Once per long rest, as a bonus action, ${sentence}`);
    expect(heal).toMatchObject({ roll: '4d10', heals: true, plainDice: false });
  });

  it('keeps damage as damage when it comes first in a sentence that also heals', () => {
    const drain = action(
      'Once per long rest, as a bonus action, a creature takes necrotic damage equal to 1d6, and you regain hit points equal to half of it.',
    );
    expect(drain).toMatchObject({ roll: '1d6', heals: false, plainDice: false });
  });

  it('offers no roll for a d20 it only mentions, nor reads one in place of real dice', () => {
    const test = action(
      'Once per long rest, as a bonus action, you have advantage on d20 tests for 1 hour.',
    );
    expect(test?.economy).toBe('bonus');
    expect(test?.roll).toBeUndefined();
    expect(test?.plainDice).toBe(false);

    const later = action(
      'Once per long rest, as a bonus action, a creature that rolls a d20 takes 2d6 fire damage.',
    );
    expect(later).toMatchObject({ roll: '2d6', plainDice: false });
  });
});

describe('proseScanFeature natural weapons', () => {
  const weapon = (effects: EffectInput[]) =>
    effects.find(
      (e): e is Extract<EffectInput, { kind: 'naturalWeapon' }> => e.kind === 'naturalWeapon',
    );

  it('reads the type-first phrasing (Satyr Ram, MOT)', () => {
    const w = weapon(
      scan('Ram', [
        'You can use your head and horns to make unarmed strikes. If you hit with them, you deal bludgeoning damage equal to {@damage 1d4} + your Strength modifier.',
      ]),
    );
    expect(w).toMatchObject({
      label: 'Ram',
      dice: '1d4',
      damageType: 'bludgeoning',
      ability: 'str',
    });
  });

  it('reads the dice-first phrasing (Satyr Ram, MPMM)', () => {
    const w = weapon(
      scan('Ram', [
        'You can use your head and horns to make unarmed strikes. When you hit with them, the strike deals {@damage 1d6} + your Strength modifier bludgeoning damage, instead of the bludgeoning damage normal for an unarmed strike.',
      ]),
    );
    expect(w).toMatchObject({
      label: 'Ram',
      dice: '1d6',
      damageType: 'bludgeoning',
      ability: 'str',
    });
  });

  it('takes the ability from the damage phrase, not elsewhere in the trait', () => {
    // Dhampir: the bite adds CON. A Naga-style trait names CON only in its save
    // DC, so the modifier has to come from the damage sentence itself.
    const bite = weapon(
      scan('Vampiric Bite', [
        'When you use your unarmed strike and deal damage, you can choose to bite with your fangs. You deal piercing damage equal to {@damage 1d4} plus your Constitution modifier instead of the normal damage of an unarmed strike.',
      ]),
    );
    expect(bite).toMatchObject({ dice: '1d4', damageType: 'piercing', ability: 'con' });

    const maw = weapon(
      scan('Natural Weapons', [
        'Your fanged maw is a natural weapon, which you can use to make unarmed strikes. If you hit with your bite, you deal piercing damage equal to {@damage 1d4} + your Strength modifier, and your target must make a Constitution saving throw ({@dc 8} + your proficiency bonus + your Constitution modifier).',
      ]),
    );
    expect(maw?.ability).toBe('str');
  });

  it('ignores a weapon that belongs to a named sub-option (Shifter Longtooth)', () => {
    // Only the Longtooth shifter gets the bite, and only while shifted, so the
    // trait itself must not arm every Beasthide and Swiftstride.
    const w = weapon(
      scan('Shifting', [
        'As a bonus action, you can assume a more bestial appearance.',
        'Whenever you shift, you gain an additional benefit based on one of the following options:',
        {
          type: 'list',
          items: [
            {
              type: 'item',
              name: 'Longtooth',
              entry:
                'You can use your elongated fangs to make an unarmed strike. If you hit with your fangs, you can deal piercing damage equal to {@damage 1d6} + your Strength modifier, instead of the bludgeoning damage normal for an unarmed strike.',
            },
            { type: 'item', name: 'Beasthide', entry: 'You gain temporary hit points.' },
          ],
        },
      ]),
    );
    expect(w).toBeUndefined();
  });

  it('does not turn dice mentioned outside unarmed-strike wording into a weapon', () => {
    expect(
      weapon(scan('Mirthful Leaps', ['Whenever you make a long or high jump, you can roll a d8.'])),
    ).toBeUndefined();
  });
});

describe('proseScanFeature unarmed strike upgrades', () => {
  const weapon = (effects: EffectInput[]) =>
    effects.find(
      (e): e is Extract<EffectInput, { kind: 'naturalWeapon' }> => e.kind === 'naturalWeapon',
    );
  const punch = (effects: EffectInput[]) =>
    effects.find(
      (e): e is Extract<EffectInput, { kind: 'unarmedDamage' }> => e.kind === 'unarmedDamage',
    );

  it('treats a bigger die on an ordinary punch as an upgrade, not a weapon', () => {
    // Unarmed Fighting deals the same damage type off the same ability as the
    // built-in unarmed strike, so its own row would be a strictly better copy.
    const effects = scan('Unarmed Fighting', [
      'When you hit with your unarmed strike and deal damage, you can deal bludgeoning damage equal to {@damage 1d6} plus your Strength modifier instead of the normal damage of an unarmed strike.',
    ]);
    expect(punch(effects)).toMatchObject({ label: 'Unarmed Fighting', dice: '1d6' });
    expect(weapon(effects)).toBeUndefined();
  });

  it('keeps a weapon row when the trait names a body part', () => {
    // Same "instead of the normal damage" wording as the feats above, but a
    // Ram is a distinct thing to attack with.
    const effects = scan('Ram', [
      'You can use your head and horns to make unarmed strikes. When you hit with them, the strike deals {@damage 1d6} + your Strength modifier bludgeoning damage, instead of the bludgeoning damage normal for an unarmed strike.',
    ]);
    expect(weapon(effects)).toMatchObject({ label: 'Ram' });
    expect(punch(effects)).toBeUndefined();
  });

  it('keeps a weapon row when the damage or ability differs from a punch', () => {
    // A Dhampir's bite names no natural weapon, but piercing off CON is a real
    // choice against a bludgeoning STR punch, not a replacement for it.
    const effects = scan('Vampiric Bite', [
      'When you use your unarmed strike and deal damage, you can choose to bite with your fangs. You deal piercing damage equal to {@damage 1d4} plus your Constitution modifier instead of the normal damage of an unarmed strike.',
    ]);
    expect(weapon(effects)).toMatchObject({ ability: 'con', damageType: 'piercing' });
    expect(punch(effects)).toBeUndefined();
  });
});
