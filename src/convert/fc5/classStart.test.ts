import { describe, expect, it } from 'vitest';
import { engineContextFor } from '../../data5e/engineAdapter';
import { mergeHomebrew, normalizeDataset } from '../../data5e/normalize';
import { deriveSheet } from '../../engine/derive';
import { multiclassRequirementText } from '../../engine/multiclass';
import { newCharacterDoc } from '../../engine/types';
import { parseXml } from '../xml';
import { convertClass } from './class';
import { isMulticlassNote, readEquipment, readMulticlass, readPrimaryAbility } from './classStart';
import { convertFc5Compendium, fc5Context } from './compendium';
import { readText } from './text';

/** A note's text as the converter reads it, `•` items a list as Fight Club writes them. */
const entries = (text: string) => readText([text]).entries;

describe('isMulticlassNote', () => {
  it('is a note on a later class, either edition', () => {
    expect(isMulticlassNote('Multiclass Ember Knight')).toBe(true);
    expect(isMulticlassNote('Becoming An Ember Knight As A Multiclass Character')).toBe(true);
    expect(isMulticlassNote('Starting Ember Knight')).toBe(false);
  });
});

describe('readMulticlass', () => {
  const PHB = `If your group uses the optional rule on multiclassing, here's what you need to know.
Ability Score Minimum:
As a multiclass character, you must have at least the following ability score(s).
	• Strength 13, and
	• Charisma 13

Proficiencies Gained:
	• Armor: light armor, medium armor, shields
	• Weapons: simple weapons, martial weapons
	• Tools: none`;

  it('reads a minimum over two items and the proficiencies a later class gains', () => {
    expect(readMulticlass(entries(PHB))).toEqual({
      requirements: { str: 13, cha: 13 },
      armor: 'light armor, medium armor, shields',
      weapons: 'simple weapons, martial weapons',
      tools: 'none',
      unread: [],
    });
  });

  it('reads any one of several abilities', () => {
    const one = (line: string) =>
      readMulticlass(entries(`Ability Score Minimum:\n\t• ${line}`))?.requirements;
    expect(one('Strength 13 or Dexterity 13')).toEqual({ or: [{ str: 13 }, { dex: 13 }] });
    expect(one('Strength, Dexterity, or Constitution 13')).toEqual({
      or: [{ str: 13 }, { dex: 13 }, { con: 13 }],
    });
    expect(one('Dexterity 13 and Wisdom 13')).toEqual({ dex: 13, wis: 13 });
  });

  it('keeps a minimum of both kinds as unread', () => {
    expect(
      readMulticlass(
        entries('Ability Score Minimum:\n\t• Strength 13 and Charisma 13 or Wisdom 15'),
      ),
    ).toEqual({ unread: ['strength 13 and charisma 13 or wisdom 15'] });
  });

  it('reads a 2024 note, which names no minimum', () => {
    expect(
      readMulticlass(
        entries(`Core Ember Knight Traits:
	• Hit Point Die: D10 per Ember Knight level
	• Weapon Proficiencies: Martial weapons
	• Armor Training: Light and Medium armor and Shields`),
      ),
    ).toEqual({
      weapons: 'Martial weapons',
      armor: 'Light and Medium armor and Shields',
      unread: [],
    });
  });

  it('is undefined for a note of rules alone', () => {
    expect(
      readMulticlass(entries('When you gain a new level in a class, you get its features.')),
    ).toBe(undefined);
  });
});

describe('readPrimaryAbility', () => {
  const primary = (line: string) =>
    readPrimaryAbility(entries(`Core Ember Knight Traits:\n\t• Primary Ability: ${line}`));

  it('writes either of two abilities, or both, as XPHB does', () => {
    expect(primary('Strength or Dexterity')).toEqual([{ str: true }, { dex: true }]);
    expect(primary('Dexterity and Wisdom')).toEqual([{ dex: true, wis: true }]);
    expect(primary('Charisma')).toEqual([{ cha: true }]);
  });

  it('is undefined for both kinds or anything else', () => {
    expect(primary('Strength and Dexterity or Wisdom')).toBeUndefined();
    expect(primary('Whichever suits you')).toBeUndefined();
  });
});

describe('readEquipment', () => {
  it('reads the list after its lead-in', () => {
    expect(
      readEquipment(
        entries(`You are proficient with the following items.
	• Armor: light armor

You begin play with the following equipment, in addition to any equipment provided by your background.
	• (a) a greataxe or (b) any martial melee weapon
	• An explorer's pack, and four javelins

If you forgo this starting equipment, roll for gold.`),
      ),
    ).toEqual([
      '(a) a greataxe or (b) any martial melee weapon',
      "An explorer's pack, and four javelins",
    ]);
  });
});

describe('a class with start notes', () => {
  const note = (name: string, text: string) =>
    `<feature optional="YES"><name>${name}</name><text>${text}</text></feature>`;
  const KNIGHT = `<class><name>Ember Knight</name><hd>10</hd>
    <proficiency>Strength, Constitution, Athletics, Intimidation, Perception</proficiency>
    <numSkills>2</numSkills><armor>Light Armor, Shields</armor><weapons>Simple Weapons</weapons>
    <wealth>5d4x10</wealth>
    <autolevel level="1">
      ${note('Starting Ember Knight', 'You begin play with the following equipment.\n\t• (a) a longsword or (b) two handaxes\n\t• A shield')}
      ${note('Multiclass Ember Knight', 'Ability Score Minimum:\n\t• Strength 13 or Constitution 13\nProficiencies Gained:\n\t• Armor: shields\n\t• Weapons: simple weapons\n\t• Skills: Choose one skill from the class skill list')}
      <feature><name>Ember Strike</name><text>x</text></feature>
    </autolevel></class>`;

  it('writes multiclassing and starting equipment, and reports nothing more', () => {
    const result = convertClass(parseXml(KNIGHT), fc5Context('ember_homebrew.xml'));
    if ('skip' in result) throw new Error(result.skip);
    expect(result.entity.multiclassing).toEqual({
      requirements: { or: [{ str: 13 }, { con: 13 }] },
      proficienciesGained: {
        armor: ['shield'],
        armorProficiencies: [{ shield: true }],
        weapons: ['simple'],
        skills: [{ choose: { from: ['athletics', 'intimidation', 'perception'], count: 1 } }],
      },
    });
    expect(result.entity.startingEquipment).toEqual({
      additionalFromBackground: true,
      default: ['(a) a longsword or (b) two handaxes', 'A shield'],
      goldAlternative: '{@dice 5d4 × 10|5d4 × 10|Starting Gold}',
    });
    expect(result.reasons).toEqual([]);
  });

  it('reports a skill line it cannot read', () => {
    const odd = KNIGHT.replace(
      'Choose one skill from the class skill list',
      'Whatever the GM says',
    );
    const result = convertClass(parseXml(odd), fc5Context('ember_homebrew.xml'));
    if ('skip' in result) throw new Error(result.skip);
    expect(result.reasons).toEqual(['its multiclass skills ("Whatever the GM says") are not read']);
  });

  it('reads a skill of your choice, a skill by name, and a choice from named skills', () => {
    const skillsOf = (line: string) => {
      const result = convertClass(
        parseXml(KNIGHT.replace('Choose one skill from the class skill list', line)),
        fc5Context('ember_homebrew.xml'),
      );
      if ('skip' in result) throw new Error(result.skip);
      const mc = result.entity.multiclassing as { proficienciesGained: { skills?: unknown } };
      return mc.proficienciesGained.skills;
    };
    expect(skillsOf('proficiency in one skill of your choice')).toEqual([{ any: 1 }]);
    expect(skillsOf('Survival')).toEqual([{ survival: true }]);
    expect(skillsOf('Choose 1 from Athletics or Stealth')).toEqual([
      { choose: { from: ['athletics', 'stealth'], count: 1 } },
    ]);
  });

  it('writes a 2024 class’s primary ability', () => {
    const result = convertClass(
      parseXml(
        KNIGHT.replace(
          'You begin play',
          'Core Ember Knight Traits:\n\t• Primary Ability: Strength or Constitution\nYou begin play',
        ),
      ),
      fc5Context('ember_homebrew.xml'),
    );
    if ('skip' in result) throw new Error(result.skip);
    expect(result.entity.primaryAbility).toEqual([{ str: true }, { con: true }]);
  });

  it('gives the sheet its minimum and a later class its proficiencies', () => {
    const ASH = `<class><name>Ash Sage</name><hd>6</hd><proficiency>Intelligence, Wisdom</proficiency>
      <autolevel level="1"><feature><name>Ash Lore</name><text>x</text></feature></autolevel></class>`;
    const { json } = convertFc5Compendium(parseXml(`<compendium>${ASH}${KNIGHT}</compendium>`), {
      fileName: 'ember_homebrew.xml',
    });
    const reg = normalizeDataset(new Map());
    mergeHomebrew(reg, new Map([['ember', json]]));
    const classes = (json.class ?? []) as Record<string, unknown>[];
    const knight = classes.find((c) => c.name === 'Ember Knight');
    expect(multiclassRequirementText(knight)).toBe('STR 13 or CON 13');
    const doc = newCharacterDoc('e', 'E', 'v2.41.0');
    doc.classes = classes.map((c) => ({
      ref: { name: String(c.name), source: String(c.source) },
      levels: 1,
      hp: ['avg' as const],
    }));
    const sheet = deriveSheet(doc, engineContextFor(reg));
    // The sage has no armor: the shield is the knight's, as a later class gains it.
    expect(sheet.armorProfs).toEqual(['shield']);
    expect(sheet.pending.map((p) => p.label)).toContain('Class skill proficiency');
  });
});
