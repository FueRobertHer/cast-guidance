import { describe, expect, it } from 'vitest';
import { parseXml } from '../xml';
import {
  convertClassOption,
  isClassOption,
  isOnOfficialList,
  readOptionPrerequisite,
} from './classOption';
import { fc5Context } from './compendium';

const option = (fields: string) => parseXml(`<spell>${fields}</spell>`);

describe('isClassOption', () => {
  it('is an entry with no school on a list that is not a plain class list', () => {
    expect(
      isClassOption(
        option(
          '<name>Invocation: Ember Sight</name><level>0</level><classes>Eldritch Invocations</classes>',
        ),
      ),
    ).toBe(true);
    expect(
      isClassOption(
        option(
          '<name>Ash Rite</name><level>0</level><classes>Ember Knight (Order of Ash): Rites</classes>',
        ),
      ),
    ).toBe(true);
  });

  it('is not a spell that only lost its school, on spell lists of classes or subclasses', () => {
    expect(
      isClassOption(
        option('<name>Ember Lance</name><level>1</level><classes>Wizard, Cleric (Forge)</classes>'),
      ),
    ).toBe(false);
  });

  it('is not a starred copy of a spell, on whatever list', () => {
    expect(
      isClassOption(
        option(
          '<name>Ember Lance*</name><level>1</level><school>EV</school><classes>Monk (Way of the Four Elements)</classes>',
        ),
      ),
    ).toBe(false);
  });

  it('is not a spell that only lost its school', () => {
    expect(
      isClassOption(
        option('<name>Ember Lance</name><level>1</level><classes>Wizard, Sorcerer</classes>'),
      ),
    ).toBe(false);
    expect(
      isClassOption(
        option('<name>Ember Storm</name><level>5</level><classes>Ember Knight</classes>'),
      ),
    ).toBe(false);
  });

  it('is an entry with a school on an official option list', () => {
    expect(
      isClassOption(
        option(
          '<name>Arcane Shot: Ember Arrow</name><level>0</level><school>EV</school><classes>Fighter (Arcane Archer): Arcane Shot</classes>',
        ),
      ),
    ).toBe(true);
    expect(
      isClassOption(
        option(
          '<name>Ember Arrow</name><level>1</level><school>EV</school><classes>Fighter [5.5e] (Arcane Archer)</classes>',
        ),
      ),
    ).toBe(true);
    expect(
      isClassOption(
        option(
          '<name>Infusion: Ember Plate</name><level>0</level><school>EN</school><classes>Artificer Infusions</classes>',
        ),
      ),
    ).toBe(true);
  });

  it('is an entry named for its list on a subclass`s list', () => {
    expect(
      isClassOption(
        option(
          '<name>Trick Shot: Ember Shot</name><level>0</level><classes>Fighter (Gunslinger)</classes>',
        ),
      ),
    ).toBe(true);
  });

  it('is an entry with a school named for its list, on a list of no plain class', () => {
    expect(
      isClassOption(
        option(
          '<name>Ember Graft: Ashen Hide</name><level>0</level><school>T</school><classes>Tamer (Ember): Ember Grafts</classes>',
        ),
      ),
    ).toBe(true);
  });

  it('is not a spell with a school on subclass or school lists', () => {
    expect(
      isClassOption(
        option(
          '<name>Ember Lance*</name><level>1</level><school>EV</school><classes>Cleric (Forge)</classes>',
        ),
      ),
    ).toBe(false);
    expect(
      isClassOption(
        option(
          '<name>Ember Rite: Ash</name><level>1</level><school>EV</school><classes>School: Evocation, Ember Mage</classes>',
        ),
      ),
    ).toBe(false);
  });
});

describe('readOptionPrerequisite', () => {
  it('reads a level of the list`s class, a pact and anything else as text', () => {
    expect(
      readOptionPrerequisite(
        ['5th level, Pact of the Blade feature', 'Ember Lance cantrip'],
        'Warlock',
      ),
    ).toEqual([
      {
        level: { level: 5, class: { name: 'Warlock', visible: true } },
        pact: 'Blade',
        other: 'Ember Lance cantrip',
      },
    ]);
  });

  it('reads a bare level when the list has no class', () => {
    expect(readOptionPrerequisite(['level 7+'], undefined)).toEqual([{ level: 7 }]);
  });

  it('reads a level of the class the line names, in either order', () => {
    const warlock = (level: number) => ({
      level: { level, class: { name: 'Warlock', visible: true } },
    });
    expect(
      readOptionPrerequisite(['Level 2+ Warlock, a Warlock Cantrip That Deals Damage'], undefined),
    ).toEqual([{ ...warlock(2), other: 'a Warlock Cantrip That Deals Damage' }]);
    expect(readOptionPrerequisite(['5th-level warlock'], undefined)).toEqual([warlock(5)]);
    expect(readOptionPrerequisite(['Warlock Level 9+'], undefined)).toEqual([warlock(9)]);
    expect(readOptionPrerequisite(['Ember Level 3+'], 'Ember')).toEqual([
      { level: { level: 3, class: { name: 'Ember', visible: true } } },
    ]);
  });

  it('keeps a level of a class it does not know as text', () => {
    expect(readOptionPrerequisite(['5th-level tamer'], undefined)).toEqual([
      { other: '5th-level tamer' },
    ]);
  });

  it('reads nothing from no lines', () => {
    expect(readOptionPrerequisite([], 'Warlock')).toBeUndefined();
  });
});

describe('convertClassOption', () => {
  const ctx = fc5Context('ember.xml');

  it('gives an option on an official list its feature type and drops the list from its name', () => {
    const result = convertClassOption(
      option(
        '<name>Invocation: Ember Sight</name><level>0</level><classes>Eldritch Invocations</classes>' +
          '<text>Prerequisite: 5th level\nYou see through smoke.\nSource: Ember Codex p. 4</text>',
      ),
      ctx,
    );
    if ('skip' in result) throw new Error(result.skip);
    expect(result.kind).toBe('optionalfeature');
    expect(result.entity).toEqual({
      name: 'Ember Sight',
      source: 'FCEmberCodex',
      page: 4,
      featureType: ['EI'],
      prerequisite: [{ level: { level: 5, class: { name: 'Warlock', visible: true } } }],
      entries: ['You see through smoke.'],
    });
    expect(isOnOfficialList(result.entity)).toBe(true);
  });

  it('reads an official list marked (UA) as that list', () => {
    const result = convertClassOption(
      option(
        '<name>Invocation: Ember Sight</name><level>0</level><school>EV</school><classes>Eldritch Invocations (UA)</classes>',
      ),
      ctx,
    );
    if ('skip' in result) throw new Error(result.skip);
    expect(result.entity).toMatchObject({ name: 'Ember Sight', featureType: ['EI'] });
  });

  it('keeps an option on another list whole, with the list as its feature type', () => {
    const result = convertClassOption(
      option(
        '<name>Ash Rite</name><level>0</level><time>1 action</time>' +
          '<classes>Ember Knight (Order of Ash) : Rites</classes><text>Ash falls.</text>',
      ),
      ctx,
    );
    if ('skip' in result) throw new Error(result.skip);
    expect(result.entity).toMatchObject({
      name: 'Ash Rite',
      featureType: ['Ember Knight (Order of Ash): Rites'],
      entries: ['{@b Casting Time:} 1 action', 'Ash falls.'],
    });
    expect(isOnOfficialList(result.entity)).toBe(false);
  });
});
