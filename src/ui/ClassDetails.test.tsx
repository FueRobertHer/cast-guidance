// @vitest-environment jsdom
// Review item 5: the class info sheet in the creator showed only hit die,
// saves and caster type, so a player could not see what a class gives.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClassDetails, classFeaturesByLevel, classProficiencies } from './ClassDetails';

afterEach(cleanup);

const wizard = {
  name: 'Wizard',
  source: 'PHB',
  startingProficiencies: {
    weapons: ['daggers', 'darts', 'slings', 'quarterstaffs', 'light crossbows'],
    skills: [
      {
        choose: {
          from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'],
          count: 2,
        },
      },
    ],
  },
  classFeatures: [
    'Arcane Recovery|Wizard||1',
    'Spellcasting|Wizard||1',
    { classFeature: 'Arcane Tradition|Wizard||2', gainSubclassFeature: true },
    'Cantrip Formulas|Wizard||3|TCE',
    'Ability Score Improvement|Wizard||4|PHB',
  ],
};

const fighter = {
  name: 'Fighter',
  source: 'PHB',
  startingProficiencies: {
    armor: ['light', 'medium', 'heavy', '{@item shield|phb|shields}'],
    weapons: ['simple', 'martial'],
    tools: [{ "thieves' tools": true }],
    skills: [{ choose: { from: ['athletics', 'animal handling'], count: 2 } }],
  },
};

describe('classProficiencies', () => {
  it('lists armor, weapons, tools and skills in words, tags read as text', () => {
    expect(classProficiencies(fighter)).toEqual([
      ['Armor', 'light, medium, heavy, shields'],
      ['Weapons', 'simple, martial'],
      ['Tools', "thieves' tools"],
      ['Skills', 'Choose 2: Athletics, Animal Handling'],
    ]);
  });

  it('leaves out what a class does not have, and reads "any" skills', () => {
    expect(
      classProficiencies({
        name: 'Bard',
        source: 'PHB',
        startingProficiencies: { skills: [{ any: 3 }] },
      }),
    ).toEqual([['Skills', 'Any 3']]);
    expect(classProficiencies({ name: 'Nothing', source: 'X' })).toEqual([]);
  });
});

describe('classFeaturesByLevel', () => {
  it('groups features by level in order, and marks the subclass and optional ones', () => {
    expect(classFeaturesByLevel(wizard)).toEqual([
      { level: 1, names: ['Arcane Recovery', 'Spellcasting'] },
      { level: 2, names: ['Arcane Tradition (subclass)'] },
      { level: 3, names: ['Cantrip Formulas (optional)'] },
      { level: 4, names: ['Ability Score Improvement'] },
    ]);
  });
});

describe('read from the data', () => {
  it('takes a qualified line whole, and says which ones are optional', () => {
    expect(
      classProficiencies({
        name: 'Druid',
        source: 'PHB',
        startingProficiencies: {
          armor: ['light', { proficiency: 'shield', full: 'shields (druids will not wear metal)' }],
          weapons: ['simple', { proficiency: 'firearms', optional: true }],
          skills: [{ choose: { from: ['nature'], count: 1 } }, { any: 1 }],
        },
      }),
    ).toEqual([
      ['Armor', 'light, shields (druids will not wear metal)'],
      ['Weapons', 'simple, firearms (optional)'],
      ['Skills', 'Choose 1: Nature; Any 1'],
    ]);
  });

  it('skips a feature with no level rather than listing it at 0', () => {
    expect(
      classFeaturesByLevel({ name: 'X', source: 'PHB', classFeatures: ['Odd|X||', 'Fine|X||1'] }),
    ).toEqual([{ level: 1, names: ['Fine'] }]);
  });

  it('marks optional the features the data marks so, whatever book they are in', () => {
    const features = [
      {
        name: 'Cantrip Formulas',
        className: 'Wizard',
        level: 3,
        source: 'TCE',
        isClassFeatureVariant: true,
      },
      // A variant in the class's own book, and a plain feature cited from another.
      {
        name: 'Pet Specialization',
        className: 'Wizard',
        level: 3,
        source: 'PHB',
        isClassFeatureVariant: true,
      },
      { name: 'Borrowed', className: 'Wizard', level: 4, source: 'XGE' },
    ];
    const entity = {
      ...wizard,
      classFeatures: [
        'Cantrip Formulas|Wizard||3|TCE',
        'Pet Specialization|Wizard||3',
        'Borrowed|Wizard||4|XGE',
      ],
    };
    expect(classFeaturesByLevel(entity, features)).toEqual([
      { level: 3, names: ['Cantrip Formulas (optional)', 'Pet Specialization (optional)'] },
      { level: 4, names: ['Borrowed'] },
    ]);
  });
});

describe('ClassDetails', () => {
  it('shows proficiencies and features by level under headings', () => {
    render(<ClassDetails entity={wizard} />);
    expect(screen.getByRole('heading', { name: 'Proficiencies' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Features by level' })).toBeTruthy();
    expect(screen.getByText('Arcane Recovery, Spellcasting')).toBeTruthy();
  });

  it('draws nothing for a class with neither', () => {
    const { container } = render(<ClassDetails entity={{ name: 'Empty', source: 'X' }} />);
    expect(container.innerHTML).toBe('');
  });
});
