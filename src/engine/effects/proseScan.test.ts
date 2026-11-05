import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type EffectInput, type EffectOrigin, newCharacterDoc } from '../types';
import { Collector } from './base';
import { flattenEntries, proseScanFeature } from './proseScan';

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
    expect(breath?.roll).toBe('2d6');
    expect(breath?.heals).toBe(false);
  });

  it.each([
    ['a test', 'Once per long rest, when a creature makes a d20 test, you can use your reaction.'],
    ['a reroll', 'Once per long rest, you can use your reaction to force a reroll of the d20.'],
    [
      'a roll to come',
      'Once per long rest, when you are about to roll a d20, as a reaction, help.',
    ],
    ['a range', 'Once per long rest, as a bonus action, you crit on a 19 or 20 on the d20.'],
  ])('keeps the chip but rolls nothing for a bare d20 in %s', (_, prose) => {
    const chip = action(prose);
    expect(chip).toBeDefined();
    expect(chip?.roll).toBeUndefined();
    expect(chip?.heals).toBe(false);
  });

  it('skips a bare d20 for the die the feature really rolls', () => {
    const omen = action(
      'Once per long rest, when a creature is about to make a d20 test, you can take a reaction to roll 1d6 and add it.',
    );
    expect(omen?.roll).toBe('1d6');
  });

  it('still reads a bare smaller die and a counted d20', () => {
    expect(action('Once per long rest, you can use your reaction to roll a d12.')?.roll).toBe(
      '1d12',
    );
    expect(action('Once per long rest, as a bonus action, you can roll 1d20.')?.roll).toBe('1d20');
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
