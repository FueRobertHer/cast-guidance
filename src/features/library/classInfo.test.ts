import { describe, expect, it } from 'vitest';
import { cellText, classProficiencies, classTable, proficiencyBonus } from './classInfo';

describe('classProficiencies (Gemini 43)', () => {
  it('reads the words, tagged names and choices the data writes', () => {
    expect(
      classProficiencies({
        name: 'Fighter',
        startingProficiencies: {
          armor: ['light', 'medium', 'heavy', 'shield'],
          weapons: ['simple', 'martial', { proficiency: 'firearms', optional: true }],
          tools: ["{@item thieves' tools|PHB}"],
          skills: [{ choose: { from: ['athletics', 'sleight of hand'], count: 2 } }],
        },
      }),
    ).toEqual([
      ['Armor', 'Light armor, Medium armor, Heavy armor, Shields'],
      ['Weapons', 'Simple weapons, Martial weapons, Firearms (optional rule)'],
      ['Tools', "{@item thieves' tools|PHB}"],
      ['Skills', 'Choose 2 from Athletics, Sleight of hand'],
    ]);
  });

  it("keeps a druid's shield caveat and counts any skills", () => {
    expect(
      classProficiencies({
        name: 'Druid',
        startingProficiencies: {
          armor: [{ proficiency: 'shield', full: 'shields (druids will not wear metal)' }],
          skills: [{ any: 3 }],
        },
      }),
    ).toEqual([
      ['Armor', 'Shields (druids will not wear metal)'],
      ['Skills', 'Any 3 skills'],
    ]);
  });

  it('reads 2024 tool objects when there is no tools list', () => {
    expect(
      classProficiencies({
        name: 'Bard',
        startingProficiencies: { toolProficiencies: [{ anyMusicalInstrument: 3 }] },
      }),
    ).toEqual([['Tools', 'Any 3 musical instruments']]);
  });

  it('is empty for a class that lists none', () => {
    expect(classProficiencies({ name: 'Homebrew' })).toEqual([]);
  });
});

describe('the class table', () => {
  it('has a proficiency bonus by level', () => {
    expect([1, 4, 5, 9, 13, 17, 20].map(proficiencyBonus)).toEqual([2, 2, 3, 4, 5, 6, 6]);
  });

  it('prints dice, bonuses, speeds and slots as the book does', () => {
    expect(cellText({ type: 'dice', toRoll: [{ number: 1, faces: 6 }] })).toBe('1d6');
    expect(cellText({ type: 'bonus', value: 2 })).toBe('+2');
    expect(cellText({ type: 'bonusSpeed', value: 10 })).toBe('+10 ft.');
    expect(cellText({ type: 'bonusSpeed', value: 0 })).toBe('-');
    expect(cellText(0, true)).toBe('-');
    expect(cellText(0)).toBe('0');
    expect(cellText('Unlimited')).toBe('Unlimited');
    expect(cellText(undefined)).toBe('-');
  });

  it("lays out every group's columns, a row a level", () => {
    const table = classTable({
      name: 'Wizard',
      classTableGroups: [
        { colLabels: ['Cantrips'], rows: [[3], [3]] },
        {
          title: 'Spell Slots per Spell Level',
          colLabels: ['1st', '2nd'],
          rowsSpellProgression: [
            [2, 0],
            [3, 0],
          ],
        },
      ],
    });
    expect(table.groups).toEqual([
      { title: undefined, labels: ['Cantrips'] },
      { title: 'Spell Slots per Spell Level', labels: ['1st', '2nd'] },
    ]);
    expect(table.rows).toHaveLength(20);
    expect(table.rows[0]).toEqual({ level: 1, cells: ['3', '2', '-'] });
    // Past what the data gives, a cell is blank rather than missing.
    expect(table.rows[5]).toEqual({ level: 6, cells: ['-', '-', '-'] });
  });

  it('is twenty plain rows for a class with no table of its own', () => {
    const table = classTable({ name: 'Homebrew' });
    expect(table.groups).toEqual([]);
    expect(table.rows[19]).toEqual({ level: 20, cells: [] });
  });
});
