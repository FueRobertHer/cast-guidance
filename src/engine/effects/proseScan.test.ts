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
