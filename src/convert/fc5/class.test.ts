import { describe, expect, it } from 'vitest';
import { PACT_SLOTS, STANDARD_SLOTS } from '../../engine/calc/slots';
import { parseXml } from '../xml';
import {
  convertClass,
  convertClassAdditions,
  featureName,
  isStartNote,
  matchProgression,
} from './class';
import { fc5Context } from './compendium';
import type { ClassBinding, Fc5Result } from './context';

const FILE = 'ember_homebrew.xml';
const SOURCE = 'FCEmberHomebrew';

type Converted = Extract<Fc5Result, { kind: unknown }>;

function convert(body: string): Fc5Result {
  return convertClass(parseXml(`<class>${body}</class>`), fc5Context(FILE));
}

function converted(body: string): Converted {
  const result = convert(body);
  if ('skip' in result) throw new Error(`skipped: ${result.skip}`);
  return result;
}

const level = (n: number, inner: string, attrs = '') =>
  `<autolevel level="${n}"${attrs}>${inner}</autolevel>`;
const feature = (name: string, text = 'Text.', attrs = '') =>
  `<feature${attrs}><name>${name}</name><text>${text}</text></feature>`;

/** A full caster's slot rows, with three cantrips, as Fight Club writes them. */
function fullSlots(): string {
  return STANDARD_SLOTS.map((row, i) =>
    level(i + 1, `<slots>${[3, ...row].join(',')}</slots>`),
  ).join('');
}

/** A table's slots by level, for {@link matchProgression}. */
const fullTable = () => STANDARD_SLOTS.map((row) => [...row]);

describe('featureName', () => {
  it('drops a 2024 level ahead of the name and an edition marker after it', () => {
    expect(featureName('Level 2: Action Surge')).toBe('Action Surge');
    expect(featureName('Ember Strike [5.5e]')).toBe('Ember Strike');
  });

  it('names every Ability Score Improvement alike, as the engine finds them', () => {
    expect(featureName('Ability Score Improvement (2nd)')).toBe('Ability Score Improvement');
    expect(featureName('Level 4: Ability Score Improvement')).toBe('Ability Score Improvement');
  });
});

describe('isStartNote', () => {
  it('is a note on a first or later class', () => {
    expect(isStartNote('Starting Ember Knight')).toBe(true);
    expect(isStartNote('Multiclass Ember Knight')).toBe(true);
    expect(isStartNote('Becoming an Ember Knight As A Level 1 Character')).toBe(true);
    expect(isStartNote('Becoming A Wizard As A Multiclass Character')).toBe(true);
  });

  it('is not a feature', () => {
    expect(isStartNote('Fighting Style')).toBe(false);
    expect(isStartNote('Starting: Ember Knight')).toBe(false);
  });
});

describe('matchProgression', () => {
  it('reads a full caster', () => {
    expect(matchProgression(fullTable(), false)).toEqual({ progression: 'full', exact: true });
  });

  it('reads a half caster that rounds up, as the 2024 paladin does', () => {
    const rows = Array.from({ length: 20 }, (_, i) => [
      ...(STANDARD_SLOTS[Math.ceil((i + 1) / 2) - 1] ?? []),
    ]);
    expect(matchProgression(rows, false)).toEqual({ progression: 'artificer', exact: true });
  });

  it('reads pact magic only for slots that come back on a short rest', () => {
    const rows = PACT_SLOTS.map(([count, slotLevel]) =>
      Array.from({ length: 9 }, (_, i) => (i === slotLevel - 1 ? count : 0)),
    );
    expect(matchProgression(rows, true)).toEqual({ progression: 'pact', exact: true });
    expect(matchProgression(rows, false).progression).not.toBe('pact');
  });

  it('takes the progression a table matches most, and says it is not exact', () => {
    const rows = fullTable();
    rows[19] = [9, 9, 9, 9, 9, 9, 9, 9, 9];
    expect(matchProgression(rows, false)).toEqual({ progression: 'full', exact: false });
  });
});

describe('convertClass', () => {
  const FIGHTER = `
    <name>Ember Knight</name>
    <hd>10</hd>
    <proficiency>Strength, Constitution, Athletics, Intimidation, Perception</proficiency>
    <numSkills>2</numSkills>
    <armor>Light Armor, Medium Armor, Heavy Armor, Shields</armor>
    <weapons>Simple Weapons, Martial Weapons</weapons>
    <tools>None</tools>
    <wealth>5d4x10</wealth>
    <trait><name>Ember Knight</name><text>Knights of the ember.</text></trait>
    ${level(1, `${feature('Starting Ember Knight', 'Gear.', ' optional="YES"')}${feature('Ember Strike', 'You strike.')}<counter><name>Ember</name><value>2</value><reset>S</reset></counter>`)}
    ${level(2, `${feature('Level 2: Ash Step')}${feature('Fighting Style: Defense', 'x', ' optional="YES"')}`)}
    ${level(4, feature('Ability Score Improvement (1st)', 'Raise.'), ' scoreImprovement="YES"')}
    ${level(6, '', ' scoreImprovement="YES"')}
    ${level(21, feature('Past the End'))}
  `;

  it('reads the class fields', () => {
    const { entity, name, kind } = converted(FIGHTER);
    expect([kind, name]).toEqual(['class', 'Ember Knight']);
    expect(entity).toMatchObject({
      name: 'Ember Knight',
      source: SOURCE,
      hd: { number: 1, faces: 10 },
      proficiency: ['str', 'con'],
      startingProficiencies: {
        armor: ['light', 'medium', 'heavy', 'shield'],
        armorProficiencies: [{ light: true, medium: true, heavy: true, shield: true }],
        weapons: ['simple', 'martial'],
        skills: [{ choose: { from: ['athletics', 'intimidation', 'perception'], count: 2 } }],
      },
      startingEquipment: { goldAlternative: '{@dice 5d4 × 10|5d4 × 10|Starting Gold}' },
      fluff: { entries: ['Knights of the ember.'] },
    });
    expect(entity.startingProficiencies).not.toHaveProperty('tools');
  });

  it('lists its fixed features by reference, an ASI at each level marked for one', () => {
    const { entity, parts, reasons } = converted(FIGHTER);
    expect(entity.classFeatures).toEqual([
      `Ember Strike|Ember Knight|${SOURCE}|1`,
      `Ash Step|Ember Knight|${SOURCE}|2`,
      `Ability Score Improvement|Ember Knight|${SOURCE}|4`,
      `Ability Score Improvement|Ember Knight|${SOURCE}|6`,
    ]);
    expect(parts?.map((p) => [p.kind, p.entity.name, p.entity.level])).toEqual([
      ['classFeature', 'Ember Strike', 1],
      ['classFeature', 'Ash Step', 2],
      ['classFeature', 'Ability Score Improvement', 4],
      ['classFeature', 'Ability Score Improvement', 6],
    ]);
    expect(parts?.[0]?.entity).toEqual({
      name: 'Ember Strike',
      source: SOURCE,
      className: 'Ember Knight',
      classSource: SOURCE,
      level: 1,
      entries: ['You strike.'],
    });
    expect(reasons).toEqual([
      'levels past 20 are left out',
      "its optional features that are no list's options (Fighting Style: Defense) are not converted",
    ]);
    expect(entity.castGuidance).toEqual({
      v: 1,
      effects: [
        {
          kind: 'resource',
          key: 'ember',
          label: 'Ember',
          max: { byLevel: { '1': 2 } },
          reset: 'short',
        },
      ],
    });
  });

  it('keeps a fixed feature named like a start note, as a sidekick has one', () => {
    const { parts, reasons } = converted(
      `<name>Ash Sidekick</name><hd>8</hd>${level(1, feature('Starting Ash Sidekick', 'A sidekick.'))}`,
    );
    expect(parts?.map((p) => p.entity.name)).toEqual(['Starting Ash Sidekick']);
    expect(reasons).toEqual([]);
  });

  it("writes the edition's Ability Score Improvement where the file gives none", () => {
    const asi = (name: string) =>
      converted(`<name>${name}</name><hd>8</hd>${level(4, '', ' scoreImprovement="YES"')}`)
        .parts?.[0]?.entity.entries;
    expect(asi('Ash Monk')).toEqual([expect.stringMatching(/^You can increase one ability score/)]);
    expect(asi('Ash Monk [5.5e]')).toEqual([
      'You gain the Ability Score Improvement feat or another feat of your choice for which you qualify.',
    ]);
  });

  it('keeps refs whole when a name holds the ref separator', () => {
    const { name, entity, parts } = converted(
      `<name>Ash|Monk</name><hd>8</hd>${level(1, feature('Ash|Palm'))}`,
    );
    expect(name).toBe('Ash/Monk');
    expect(entity.classFeatures).toEqual([`Ash/Palm|Ash/Monk|${SOURCE}|1`]);
    expect(parts?.[0]?.entity).toMatchObject({ name: 'Ash/Palm', className: 'Ash/Monk' });
  });

  it('keeps one of a feature the file repeats at a level', () => {
    const { parts } = converted(`<name>Ash Monk</name><hd>8</hd>
      ${level(1, `${feature('Ash Palm')}${feature('Ash Palm [5.5e]')}`)}
      ${level(5, feature('Ash Palm'))}`);
    expect(parts?.map((p) => [p.entity.name, p.entity.level])).toEqual([
      ['Ash Palm', 1],
      ['Ash Palm', 5],
    ]);
  });

  it("names a feature's own book in its reference when it is not the class's", () => {
    const { entity, parts } = converted(`<name>Ash Monk</name><hd>8</hd>
      <trait><name>Ash Monk</name><text>Monks.\nSource: Ember Codex p. 3</text></trait>
      ${level(1, feature('Ash Palm', 'Palm.\nSource: Ash Almanac p. 9'))}`);
    expect(entity.source).toBe('FCEmberCodex');
    expect(entity.classFeatures).toEqual(['Ash Palm|Ash Monk|FCEmberCodex|1|FCAshAlmanac']);
    expect(parts?.[0]?.entity).toMatchObject({
      source: 'FCAshAlmanac',
      page: 9,
      classSource: 'FCEmberCodex',
    });
  });

  it('lists each tool as its own proficiency', () => {
    const { entity } = converted(
      "<name>Ash Monk</name><hd>8</hd><tools>Thieves' Tools, Tinker's Tools</tools>",
    );
    expect((entity.startingProficiencies as Record<string, unknown>).tools).toEqual([
      "Thieves' Tools",
      "Tinker's Tools",
    ]);
  });

  it('keeps the filter when another weapon in the list does not read', () => {
    const { entity } = converted(`<name>Ash Monk</name><hd>8</hd>
      <weapons>Simple weapons, Martial weapons that have the Light property, Ember Lance</weapons>`);
    expect(entity.startingProficiencies).toEqual({
      weapons: ['Simple weapons', 'Martial weapons that have the Light property', 'Ember Lance'],
      weaponProficiencies: [{ all: { fromFilter: 'type=martial weapon|property=light' } }],
    });
  });

  it('reads martial weapons of a property as a filter', () => {
    const { entity } = converted(`<name>Ash Monk</name><hd>8</hd>
      <weapons>Simple Weapons and Martial weapons that have the Light property</weapons>`);
    expect(entity.startingProficiencies).toEqual({
      weapons: ['simple', 'Martial weapons that have the Light property'],
      weaponProficiencies: [{ all: { fromFilter: 'type=martial weapon|property=light' } }],
    });
  });

  it('reads every skill as any, and a list with no count as given', () => {
    const all =
      'Acrobatics, Animal Handling, Arcana, Athletics, Deception, History, Insight, Intimidation, Investigation, Medicine, Nature, Perception, Performance, Persuasion, Religion, Sleight of Hand, Stealth, Survival';
    const any = converted(
      `<name>Ash Bard</name><hd>8</hd><proficiency>Dexterity, Charisma, ${all}</proficiency><numSkills>3</numSkills>`,
    );
    expect(any.entity.startingProficiencies).toEqual({ skills: [{ any: 3 }] });
    const given = converted(
      '<name>Ash Bard</name><hd>8</hd><proficiency>Dexterity, Stealth</proficiency>',
    );
    expect(given.entity.startingProficiencies).toEqual({ skills: [{ stealth: true }] });
  });

  it('says which proficiencies it could not read', () => {
    const { reasons } = converted(
      '<name>Ash Bard</name><hd>8</hd><proficiency>Dexterity, Juggling</proficiency>',
    );
    expect(reasons).toEqual(['its proficiencies (Juggling) are kept as text']);
  });

  it('skips a class entry with no hit die, which adds to a class of its name', () => {
    expect(convert(`<name>Fighter</name>${level(3, feature('Martial Archetype: Ash'))}`)).toEqual({
      skip: 'it adds to a class of that name, and only its subclasses convert',
    });
    expect(convert('<hd>8</hd>')).toEqual({ skip: 'it has no name' });
    expect(convert('<name>Ash Bard</name><hd>banana</hd>')).toEqual({
      skip: 'its hit die is not a die',
    });
    expect(converted('<name>Ash Bard</name><hd>d8</hd>').entity.hd).toEqual({
      number: 1,
      faces: 8,
    });
  });

  it('converts an auxiliary level, and says nothing stops a second level', () => {
    const { reasons } = converted(
      `<name>Auxiliary Level: Courier (Valda)</name><hd>8</hd>${level(1, feature('Courier Run'))}`,
    );
    expect(reasons).toEqual([
      'it is an auxiliary level, a class taken for one level only: nothing stops a second level, which gives only hit points',
    ]);
  });
});

describe('convertClass spellcasting', () => {
  const caster = (casting: string, extra = '') => `
    <name>Ash Mage</name><hd>6</hd><spellAbility>Intelligence</spellAbility>${extra}
    ${fullSlots()}
    ${level(1, feature('Spellcasting', casting))}
  `;

  it('reads a full caster with a prepared formula and its own slot table', () => {
    const { entity, reasons } = converted(
      caster(
        'You prepare a number of spells equal to your Intelligence modifier + your ash mage level.',
      ),
    );
    expect(entity).toMatchObject({
      spellcastingAbility: 'int',
      casterProgression: 'full',
      cantripProgression: Array(20).fill(3),
      preparedSpells: '<$level$> + <$int_mod$>',
    });
    expect(entity.classTableGroups).toEqual([
      {
        title: 'Spell Slots per Spell Level',
        colLabels: ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'],
        rowsSpellProgression: fullTable(),
      },
    ]);
    expect(reasons).toEqual([]);
  });

  it('reads half a level, and the class spellcasting ability', () => {
    const { entity } = converted(
      caster(
        'equal to your spellcasting ability modifier + half your ash mage level, rounded down',
      ),
    );
    expect(entity.preparedSpells).toBe('<$level$> / 2 + <$int_mod$>');
  });

  it('reads a prepared column from a table', () => {
    const rows = ['Level | Spells Prepared', '1st | 4', '5th | 9', '20th | 22'].join('\n');
    const { entity } = converted(caster(rows));
    const prepared = entity.preparedSpellsProgression as number[];
    expect([prepared[0], prepared[3], prepared[4], prepared[19]]).toEqual([4, 4, 9, 22]);
  });

  const BOOK =
    'You have a spellbook containing six 1st-level wizard spells. Each time you gain a level, you can add two wizard spells of your choice to your spellbook.';

  it('reads a spellbook beside the count prepared', () => {
    const { entity } = converted(
      caster(
        `${BOOK} You prepare a number of spells equal to your Intelligence modifier + your ash mage level.`,
      ),
    );
    expect(entity.spellsKnownProgressionFixed).toEqual([6, ...Array(19).fill(2)]);
    expect(entity.spellsKnownProgressionFixedAllowLowerLevel).toBe(true);
    expect(entity.preparedSpells).toBe('<$level$> + <$int_mod$>');
  });

  it('reads a 2024 spellbook, whose book is two words where spells are added', () => {
    const book2024 =
      'The book contains the level 1+ spells you know. It starts with six level 1 Wizard spells of your choice. Whenever you gain a Wizard level after 1, add two Wizard spells of your choice to your spell book.';
    const rows = ['Level | Spells Prepared', '1st | 4', '5th | 9'].join('\n');
    const { entity } = converted(caster(`${book2024}\n${rows}`));
    expect(entity.spellsKnownProgressionFixed).toEqual([6, ...Array(19).fill(2)]);
  });

  it('leaves out a spellbook with no count prepared, which would read as spells known', () => {
    const { entity, reasons } = converted(caster(BOOK));
    expect(entity.spellsKnownProgressionFixed).toBeUndefined();
    expect(reasons).toEqual(['how many spells it knows or prepares is kept as text']);
  });

  it("reads only the spellcasting feature's words, a third party's name for it too", () => {
    const formula = 'equal to your Intelligence modifier + your ash mage level';
    const read = (name: string) =>
      converted(`<name>Ash Mage</name><hd>6</hd><spellAbility>Intelligence</spellAbility>${fullSlots()}
        ${level(1, feature(name, `You can use it a number of times ${formula}.`))}`).entity
        .preparedSpells;
    expect(read('Ash Burst')).toBeUndefined();
    expect(read('Ashcasting')).toBe('<$level$> + <$int_mod$>');
    expect(read('Apothecary Magic')).toBe('<$level$> + <$int_mod$>');
  });

  it('reads a blank slot value as no row, not a row of zeros', () => {
    const { entity } =
      converted(`<name>Ash Mage</name><hd>6</hd><spellAbility>Intelligence</spellAbility>
      ${STANDARD_SLOTS.map((row, i) => level(i + 1, `<slots>${i === 1 ? '' : [3, ...row].join(',')}</slots>`)).join('')}`);
    expect(entity.casterProgression).not.toBe(undefined);
    const table = entity.classTableGroups as { rowsSpellProgression: number[][] }[];
    expect(table[0]?.rowsSpellProgression[1]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('reads a known count in words, from the first level with slots', () => {
    const { entity } = converted(
      caster(
        'You know four 1st-level spells of your choice. You learn one more at each level except 12th, 16th, 19th, and 20th.',
      ),
    );
    const known = entity.spellsKnownProgression as number[];
    expect(known.slice(0, 3)).toEqual([4, 5, 6]);
    expect([known[10], known[11], known[19]]).toEqual([14, 14, 19]);
  });

  it('says the count is text when nothing reads it', () => {
    const { entity, reasons } = converted(caster('You cast spells.'));
    expect(entity.preparedSpells).toBeUndefined();
    expect(reasons).toEqual(['how many spells it knows or prepares is kept as text']);
  });

  it('casts nothing of its own from a subclass slot row', () => {
    const { entity } =
      converted(`<name>Ash Knight</name><hd>10</hd><spellAbility>Intelligence</spellAbility>
      ${level(3, '<slots optional="YES">2,2</slots>')}`);
    expect(entity.casterProgression).toBeUndefined();
    expect(entity.spellcastingAbility).toBeUndefined();
  });

  it('gives a pact caster no slot table, the engine having its own', () => {
    const pact = PACT_SLOTS.map(([count, slotLevel], i) =>
      level(
        i + 1,
        `<slots>2,${Array.from({ length: 9 }, (_, j) => (j === slotLevel - 1 ? count : 0)).join(',')}</slots>`,
      ),
    ).join('');
    const { entity } = converted(
      `<name>Ash Pact</name><hd>8</hd><spellAbility>Charisma</spellAbility><slotsReset>S</slotsReset>${pact}`,
    );
    expect(entity.casterProgression).toBe('pact');
    expect(entity.classTableGroups).toBeUndefined();
  });

  it("keeps its own table for short-rest slots that are not the warlock's", () => {
    const rows = PACT_SLOTS.map(([count, slotLevel], i) =>
      Array.from({ length: 9 }, (_, j) => (j === slotLevel - 1 ? (i === 19 ? 3 : count) : 0)),
    );
    const { entity, reasons } = converted(
      `<name>Ash Pact</name><hd>8</hd><spellAbility>Charisma</spellAbility><slotsReset>S</slotsReset>${rows.map((r, i) => level(i + 1, `<slots>2,${r.join(',')}</slots>`)).join('')}`,
    );
    expect(entity.casterProgression).not.toBe('pact');
    const table = entity.classTableGroups as { rowsSpellProgression: number[][] }[];
    expect(table[0]?.rowsSpellProgression[19]).toEqual([0, 0, 0, 0, 3]);
    expect(reasons).toContain('its spell slots come back on a short rest, which is kept as text');
    expect(reasons.some((r) => r.startsWith('its spell slots follow no standard table'))).toBe(
      true,
    );
  });

  it('says a standard table that comes back on a short rest keeps that as text', () => {
    const { entity, reasons } =
      converted(`<name>Ash Mage</name><hd>6</hd><spellAbility>Intelligence</spellAbility><slotsReset>S</slotsReset>
      ${fullSlots()}${level(1, feature('Spellcasting', 'equal to your Intelligence modifier + your ash mage level'))}`);
    expect(entity.casterProgression).toBe('full');
    expect(reasons).toEqual(['its spell slots come back on a short rest, which is kept as text']);
  });
});

describe('convertClass picks', () => {
  const knight = (inner: string) => `<name>Ember Knight</name><hd>10</hd>${inner}`;
  const column = (counts: Record<number, number>) => {
    const rows: number[][] = [];
    let n = 0;
    for (let l = 1; l <= 20; l += 1) {
      n = counts[l] ?? n;
      rows.push([n]);
    }
    return { colLabels: ['Weapon Mastery'], rows };
  };

  it("reads a Weapon Mastery column from the feature's table", () => {
    const { entity } = converted(
      knight(
        level(
          1,
          feature(
            'Level 1: Weapon Mastery',
            'You use the mastery properties of three kinds of weapons.\n\nWeapon Mastery:\nFighter Level | Weapon Mastery\n1 | 3\n4 | 4\n10 | 5\n16 | 6',
          ),
        ),
      ),
    );
    expect(entity.classTableGroups).toEqual([column({ 1: 3, 4: 4, 10: 5, 16: 6 })]);
  });

  it('reads the counts some files give in a line, after the slot table a caster has', () => {
    const { entity } =
      converted(`<name>Ember Knight</name><hd>10</hd><spellAbility>Intelligence</spellAbility>
      ${fullSlots()}
      ${level(1, `${feature('Spellcasting', 'You prepare a number of spells equal to your Intelligence modifier + your ember knight level.')}${feature('Weapon Mastery', 'You use the mastery properties of two kinds of weapons. (2 at level 2, 3 at level 4, 4 at level 10)')}`)}`);
    const groups = entity.classTableGroups as Record<string, unknown>[];
    expect(groups.map((g) => g.title ?? g.colLabels)).toEqual([
      'Spell Slots per Spell Level',
      ['Weapon Mastery'],
    ]);
    expect(groups[1]).toEqual(column({ 1: 2, 4: 3, 10: 4 }));
  });

  it('writes no column for the two kinds the sheet assumes', () => {
    const { entity } = converted(
      knight(
        level(
          1,
          feature('Weapon Mastery', 'You use the mastery properties of two kinds of weapons.'),
        ),
      ),
    );
    expect(entity).not.toHaveProperty('classTableGroups');
  });

  it('gives Expertise again at the later level its text names, in either wording', () => {
    const refs = (text: string) =>
      converted(knight(level(3, feature('Expertise', text)))).entity.classFeatures;
    expect(
      refs(
        'At 3rd level, choose two of your skill proficiencies.\n\tAt 10th level, you can choose another two skill proficiencies to gain this benefit.',
      ),
    ).toEqual([`Expertise|Ember Knight|${SOURCE}|3`, `Expertise|Ember Knight|${SOURCE}|10`]);
    expect(
      refs(
        'You gain Expertise in two of your skill proficiencies.\n\tAt Ember Knight level 9, you gain Expertise in two more of your skill proficiencies of your choice.',
      ),
    ).toEqual([`Expertise|Ember Knight|${SOURCE}|3`, `Expertise|Ember Knight|${SOURCE}|9`]);
    expect(refs('Choose two skills.\n\tAt 10th level, your expertise improves.')).toEqual([
      `Expertise|Ember Knight|${SOURCE}|3`,
    ]);
  });

  it('keeps the later Expertise the file gives, wherever it sits in the file', () => {
    const first = level(
      3,
      feature(
        'Expertise',
        'Choose two skills.\n\tAt 10th level, you can choose another two skill proficiencies to gain this benefit.',
      ),
    );
    const own = level(10, feature('Expertise', 'Two more skills, your own words.'));
    for (const body of [first + own, own + first]) {
      const { entity, parts } = converted(knight(body));
      expect(entity.classFeatures).toEqual([
        `Expertise|Ember Knight|${SOURCE}|3`,
        `Expertise|Ember Knight|${SOURCE}|10`,
      ]);
      expect(parts?.find((p) => p.entity.level === 10)?.entity.entries).toEqual([
        'Two more skills, your own words.',
      ]);
    }
  });

  it('offers an official list its features count, and only one prompt where the file lists its options', () => {
    const warlock = converted(`<name>Warlock</name><hd>8</hd>
      ${level(2, feature('Eldritch Invocations', 'At 2nd level, you gain two eldritch invocations of your choice (added as spells in the Eldritch Invocation spell list).\n\nLevel | Invocations Known\n2 | 2\n5 | 3'))}`);
    expect(warlock.entity.optionalfeatureProgression).toEqual([
      { name: 'Eldritch Invocations', featureType: ['EI'], progression: { 2: 2, 5: 3 } },
    ]);
    const opt = ' optional="YES"';
    const sorcerer = converted(`<name>Sorcerer</name><hd>6</hd>
      ${level(3, `${feature('Metamagic', 'You gain two of the following Metamagic options of your choice.')}${feature('Metamagic: Careful Spell', 'Careful.', opt)}${feature('Metamagic: Distant Spell', 'Distant.', opt)}`)}`);
    expect(sorcerer.entity.optionalfeatureProgression).toEqual([
      { name: 'Metamagic', featureType: ['Sorcerer: Metamagic', 'MM'], progression: { 3: 2 } },
    ]);
  });
});

describe("convertClass another book's optional features", () => {
  const phb = (text: string) => `${text}\nSource: Player's Handbook p. 46`;
  const tce = (text: string) => `${text}\nSource: Tasha's Cauldron of Everything p. 24`;
  const CLASS = 'FCPlayerSHandbook';
  const TCE = 'FCTashaSCauldronOfEverything';
  const marked = (result: Converted) =>
    (result.parts ?? []).map((p) => [
      p.entity.name,
      p.entity.level,
      p.entity.isClassFeatureVariant === true,
    ]);

  it("marks a printing's features that cite another official book, once each", () => {
    const result = converted(`<name>Barbarian</name><hd>12</hd>
      ${level(1, feature('Rage', phb('You rage.')))}
      ${level(2, `${feature('Reckless Attack', phb('You attack.'))}${feature('Danger Sense', phb('You sense.'))}`)}
      ${level(3, feature('Primal Knowledge', tce('You gain proficiency in one skill.')))}
      ${level(4, `${feature('Ability Score Improvement', phb('Raise.'))}${feature('Martial Versatility', tce('Replace a style.'))}`)}
      ${level(8, `${feature('Ability Score Improvement', tce('Raise.'))}${feature('Martial Versatility', tce('Replace a style.'))}`)}
      ${level(9, feature('Rage', tce('You rage longer.')))}
      ${level(10, feature('Primal Knowledge', tce('You gain proficiency in one skill.')))}`);
    expect(result.entity.source).toBe(CLASS);
    expect(marked(result)).toEqual([
      ['Rage', 1, false],
      ['Reckless Attack', 2, false],
      ['Danger Sense', 2, false],
      ['Primal Knowledge', 3, true],
      ['Ability Score Improvement', 4, false],
      ['Martial Versatility', 4, true],
      ['Ability Score Improvement', 8, false],
      // Cited by the class's own book at 1, so the class's.
      ['Rage', 9, false],
    ]);
    expect(result.entity.classFeatures).toContain(`Primal Knowledge|Barbarian|${CLASS}|3|${TCE}`);
  });

  it('reads nothing of a variant into the class', () => {
    const { entity } = converted(`<name>Rogue</name><hd>8</hd>
      ${level(1, `${feature('Sneak Attack', phb('You strike.'))}${feature("Thieves' Cant", phb('You speak.'))}${feature('Weapon Mastery', tce('You use the mastery properties of three kinds of weapons.'))}`)}
      ${level(2, feature('Cunning Action', phb('You act.')))}
      ${level(3, feature('Expertise', tce('Choose two skills.\n\tAt 10th level, you can choose another two skill proficiencies to gain this benefit.')))}`);
    expect(entity.classFeatures).toEqual([
      `Sneak Attack|Rogue|${CLASS}|1`,
      `Thieves' Cant|Rogue|${CLASS}|1`,
      `Weapon Mastery|Rogue|${CLASS}|1|${TCE}`,
      `Cunning Action|Rogue|${CLASS}|2`,
      `Expertise|Rogue|${CLASS}|3|${TCE}`,
    ]);
    // Its Weapon Mastery count is not the class's.
    expect(entity).not.toHaveProperty('classTableGroups');
  });

  it("marks none when most of the class's names would be, its book then being the other", () => {
    // No description names the class's book, and its first feature cites Tasha's.
    const result = converted(`<name>Barbarian</name><hd>12</hd>
      ${level(1, `${feature('Primal Knowledge', tce('A skill.'))}${feature('Rage', phb('You rage.'))}`)}
      ${level(2, feature('Reckless Attack', phb('You attack.')))}`);
    expect(result.entity.source).toBe(TCE);
    expect(marked(result).every(([, , v]) => v === false)).toBe(true);
  });

  it('marks nothing on a homebrew class that borrows an official feature', () => {
    const own = (text: string) => `${text}\nSource: LaserLlama's Alternate Blood Hunter p. 2`;
    const result = converted(`<name>Blood Hunter (Alt. LaserLlama) [5.5e]</name><hd>10</hd>
      ${level(1, `${feature("Hunter's Bane", own('You hunt.'))}${feature('Weapon Mastery', "Masteries.\nSource: Player's Handbook (2024) p. 91")}`)}
      ${level(2, feature('Blood Rites', own('Rites.')))}`);
    expect(marked(result).every(([, , v]) => v === false)).toBe(true);
  });

  it('never marks an Ability Score Improvement, whatever book it cites', () => {
    const asi = (n: number) =>
      level(n, feature('Ability Score Improvement', tce('Raise.')), ' scoreImprovement="YES"');
    const { entity, parts } = converted(`<name>Fighter</name><hd>10</hd>
      ${level(1, `${feature('Second Wind', phb('You heal.'))}${feature('Fighting Style', phb('A style.'))}`)}
      ${level(2, feature('Action Surge', phb('You surge.')))}
      ${asi(4)}${asi(6)}${asi(8)}`);
    expect(entity.classFeatures).toEqual([
      `Second Wind|Fighter|${CLASS}|1`,
      `Fighting Style|Fighter|${CLASS}|1`,
      `Action Surge|Fighter|${CLASS}|2`,
      `Ability Score Improvement|Fighter|${CLASS}|4|${TCE}`,
      `Ability Score Improvement|Fighter|${CLASS}|6|${TCE}`,
      `Ability Score Improvement|Fighter|${CLASS}|8|${TCE}`,
    ]);
    expect(parts?.some((p) => p.entity.isClassFeatureVariant === true)).toBe(false);
  });

  it('keeps an Additional Spells feature as text, which nothing reads', () => {
    const result = converted(`<name>Paladin</name><hd>10</hd>
      ${level(1, `${feature('Divine Sense', phb('You sense.'))}${feature('Lay on Hands', phb('You heal.'))}`)}
      ${level(2, `${feature('Fighting Style', phb('A style.'))}${feature('Spellcasting', phb('You cast.'))}${feature('Divine Smite', phb('You smite.'))}${feature('Additional Paladin Spells', tce('You add these spells to your list.'))}${feature('Additional Fighting Style', tce('More styles.'))}`)}
      ${level(3, `${feature('Harness Divine Power', tce('You regain a slot.'))}${feature('Expanded Spells', tce('More spells.'))}`)}`);
    expect(marked(result).filter(([n]) => /^Additional|^Harness|Spells$/.test(String(n)))).toEqual([
      ['Additional Paladin Spells', 2, false],
      ['Additional Fighting Style', 2, true],
      ['Harness Divine Power', 3, true],
      ['Expanded Spells', 3, true],
    ]);
  });

  it("marks no subclass's feature, which goes to its subclass at each level", () => {
    const opt = ' optional="YES"';
    const result = converted(`<name>Paladin</name><hd>10</hd>
      ${level(1, `${feature('Divine Sense', phb('You sense.'))}${feature('Lay on Hands', phb('You heal.'))}`)}
      ${level(2, feature('Divine Smite', phb('You smite.')))}
      ${level(3, `${feature('Sacred Oath', phb('You swear.'))}${feature('Harness Divine Power', tce('You regain a slot.'))}${feature('Sacred Oath: Oath of Glory', tce('Glory.'), opt)}${feature('Oath Spells (Oath of Glory)', tce('Spells.'), opt)}${feature('Peerless Athlete (Oath of Glory)', tce('You run.'))}`)}
      ${level(7, feature('Aura of Alacrity (Oath of Glory)', tce('Faster.')))}
      ${level(18, feature('Aura of Alacrity (Oath of Glory)', tce('Farther.')))}`);
    expect(marked(result).filter(([, , v]) => v)).toEqual([['Harness Divine Power', 3, true]]);
    const glory = result.subclasses?.({ className: 'Paladin', classSource: CLASS })[0];
    expect(glory?.parts?.map((p) => [p.entity.name, p.entity.level])).toEqual([
      ['Oath of Glory', 3],
      ['Oath Spells', 3],
      ['Peerless Athlete', 3],
      ['Aura of Alacrity', 7],
      ['Aura of Alacrity', 18],
    ]);
  });
});

describe('subclasses', () => {
  const opt = ' optional="YES"';
  const BOUND: ClassBinding = { className: 'Ember Knight', classSource: SOURCE };
  const knight = (inner: string) =>
    `<name>Ember Knight</name><hd>10</hd><spellAbility>Intelligence</spellAbility>${inner}`;
  const subclassesOf = (body: string, bound = BOUND) => {
    const result = converted(body);
    return { result, subs: result.subclasses?.(bound) ?? [] };
  };

  const GUARD = knight(`
    ${level(3, `${feature('Ember Path', 'You choose a path.')}${feature('Ember Path: Ash Guard', 'Guards of ash.', opt)}${feature('Ash Ward (Ash Guard)', 'You ward.', opt)}${feature('Ember Path: Cinder Blade', 'Blades.', opt)}${feature('Cinder Edge (Cinder Blade)', 'You cut.', opt)}`)}
    ${level(7, feature('Ash Wall (Ash Guard)', 'A wall.', opt))}
  `);

  it('names what the class calls its subclasses, and opens the choice where it picks one', () => {
    const { result } = subclassesOf(GUARD);
    expect(result.entity.subclassTitle).toBe('Ember Path');
    expect(result.entity.classFeatures).toEqual([
      { classFeature: `Ember Path|Ember Knight|${SOURCE}|3`, gainSubclassFeature: true },
    ]);
    expect(result.reasons).toEqual([]);
  });

  it('makes each subclass of a pick and the choices that end in its name', () => {
    const { subs } = subclassesOf(GUARD);
    expect(subs.map((s) => [s.kind, s.name])).toEqual([
      ['subclass', 'Ash Guard'],
      ['subclass', 'Cinder Blade'],
    ]);
    const guard = subs[0];
    expect(guard?.entity).toEqual({
      name: 'Ash Guard',
      shortName: 'Ash Guard',
      source: SOURCE,
      className: 'Ember Knight',
      classSource: SOURCE,
      subclassFeatures: [
        `Ash Guard|Ember Knight|${SOURCE}|Ash Guard|${SOURCE}|3`,
        `Ash Ward|Ember Knight|${SOURCE}|Ash Guard|${SOURCE}|3`,
        `Ash Wall|Ember Knight|${SOURCE}|Ash Guard|${SOURCE}|7`,
      ],
    });
    expect(
      guard?.parts?.map((p) => [p.kind, p.entity.name, p.entity.level, p.entity.entries]),
    ).toEqual([
      ['subclassFeature', 'Ash Guard', 3, ['Guards of ash.']],
      ['subclassFeature', 'Ash Ward', 3, ['You ward.']],
      ['subclassFeature', 'Ash Wall', 7, ['A wall.']],
    ]);
    expect(guard?.parts?.[1]?.entity).toMatchObject({
      className: 'Ember Knight',
      classSource: SOURCE,
      subclassShortName: 'Ash Guard',
      subclassSource: SOURCE,
    });
  });

  it('puts a subclass on the class it is bound to', () => {
    const { subs } = subclassesOf(GUARD, { className: 'Fighter', classSource: 'PHB' });
    expect(subs[0]?.entity).toMatchObject({ className: 'Fighter', classSource: 'PHB' });
    expect(subs[0]?.entity.subclassFeatures).toContain(
      `Ash Ward|Fighter|PHB|Ash Guard|${SOURCE}|3`,
    );
  });

  it('reads the 2024 names, a group inside a group and a marker inside the group', () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Level 3: Ember Knight Subclass')}${feature('Ember Knight Subclass: Bogatyr (HB) [5.5e]', 'Heroes.', opt)}${feature('Level 3: Protector (Bogatyr (HB) [5.5e])', 'You protect.', opt)}`)}
      `),
    );
    expect(result.entity.subclassTitle).toBe('Ember Knight Subclass');
    expect(subs.map((s) => [s.name, s.parts?.map((p) => p.entity.name)])).toEqual([
      ['Bogatyr', ['Bogatyr', 'Protector']],
    ]);
  });

  it('finds a subclass by the last words of its name, where the class has a feature for the label', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Order')}${feature('Ember Order: Order of the Ghostslayer', 'x', opt)}${feature('Rite of the Dawn (Ghostslayer)', 'x', opt)}${feature('Ember Order: Order of the Lycan', 'x', opt)}${feature('Hybrid Form (Lycan)', 'x', opt)}`)}
      `),
    );
    expect(subs.map((s) => [s.name, s.parts?.length])).toEqual([
      ['Order of the Ghostslayer', 2],
      ['Order of the Lycan', 2],
    ]);
  });

  it("gives a subclass its feature the file gives as the class's own, in any file order", () => {
    const pick = level(
      3,
      `${feature('Ember Path')}${feature('Ember Path: Mage of Lorehold (UA)', 'Lore.', opt)}${feature('Lessons (Mage of Lorehold (UA))', 'x', opt)}`,
    );
    const stray = level(
      3,
      `${feature('Ancient Companion (Mage of Lorehold (UA))', 'A companion.')}${feature('Brutal Critical (1 die)', 'Crit.')}`,
    );
    for (const body of [pick + stray, stray + pick]) {
      const { result, subs } = subclassesOf(knight(body));
      expect(result.parts?.map((p) => p.entity.name).sort()).toEqual([
        'Brutal Critical (1 die)',
        'Ember Path',
      ]);
      expect(subs.map((s) => [s.name, s.parts?.map((p) => p.entity.name).sort()])).toEqual([
        ['Mage of Lorehold', ['Ancient Companion', 'Lessons', 'Mage of Lorehold']],
      ]);
    }
  });

  it('gives it once where the file lists it both ways, and to the subclass whose book it cites', () => {
    const cite = (text: string, book: string) => `${text}\nSource: ${book} p. 2`;
    const { result, subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', cite('Guards.', 'Ash Almanac'), opt)}${feature('Ash Ward (Ash Guard)', cite('Ward.', 'Ash Almanac'), opt)}${feature('Ember Path: Ash Guard', cite('Guards again.', 'Cinder Codex'), opt)}${feature('Ash Lore (Ash Guard)', cite('Lore.', 'Cinder Codex'), opt)}`)}
        ${level(7, `${feature('Ash Wall (Ash Guard)', cite('A wall.', 'Cinder Codex'), opt)}${feature('Ash Wall (Ash Guard)', cite('A wall.', 'Cinder Codex'))}`)}
      `),
    );
    expect(result.parts?.map((p) => p.entity.name)).toEqual(['Ember Path']);
    expect(subs.map((s) => [s.entity.source, s.parts?.map((p) => p.entity.name)])).toEqual([
      ['FCAshAlmanac', ['Ash Guard', 'Ash Ward']],
      ['FCCinderCodex', ['Ash Guard', 'Ash Lore', 'Ash Wall']],
    ]);
  });

  it('keeps a feature of a label once where the file lists it both ways, as a feature', () => {
    for (const both of [
      `${feature('Bonus Cantrip: Light (Ash Guard)', 'Light.', opt)}${feature('Bonus Cantrip: Light (Ash Guard)', 'Light.')}`,
      `${feature('Bonus Cantrip: Light (Ash Guard)', 'Light.')}${feature('Bonus Cantrip: Light (Ash Guard)', 'Light.', opt)}`,
    ]) {
      const { subs } = subclassesOf(
        knight(
          level(
            3,
            `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'Guards.', opt)}${both}`,
          ),
        ),
      );
      expect(subs.map((s) => [s.parts?.map((p) => p.entity.name), s.reasons])).toEqual([
        [['Ash Guard', 'Bonus Cantrip: Light'], []],
      ]);
    }
  });

  it('keeps a label as options when only one of its choices shares a name with a subclass', () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(1, `${feature('Fighting Style')}${feature('Fighting Style: Archery', 'x', opt)}${feature('Fighting Style: Defense', 'x', opt)}${feature('Fighting Style: Marksman', 'x', opt)}`)}
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Marksman', 'x', opt)}${feature('Steady Aim (Marksman)', 'x', opt)}`)}
      `),
    );
    expect(subs.map((s) => s.name)).toEqual(['Marksman']);
    expect(result.entity.subclassTitle).toBe('Ember Path');
    expect(result.options?.map((o) => o.entity.name)).toEqual(['Archery', 'Defense', 'Marksman']);
    expect(result.reasons).toEqual([]);
  });

  it('keeps a label as options when fewer than half its choices share a name with a subclass', () => {
    const styles = ['Archery', 'Defense', 'Dueling', 'Marksman', 'Sentinel']
      .map((s) => feature(`Fighting Style: ${s}`, 'x', opt))
      .join('');
    const { subs } = subclassesOf(
      knight(`
        ${level(1, `${feature('Fighting Style')}${styles}`)}
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Marksman', 'x', opt)}${feature('Steady Aim (Marksman)', 'x', opt)}${feature('Ember Path: Sentinel', 'x', opt)}${feature('Stand Fast (Sentinel)', 'x', opt)}`)}
      `),
    );
    expect(subs.map((s) => [s.name, s.parts?.length])).toEqual([
      ['Marksman', 2],
      ['Sentinel', 2],
    ]);
  });

  it('reads no subclass from the last words of names when the class has no feature for the label', () => {
    const { result, subs } = subclassesOf(
      knight(
        level(
          3,
          `${feature('Totem Spirit: Great Bear', 'x', opt)}${feature('Totem Spirit: Swift Eagle', 'x', opt)}${feature('Bear Hug (Bear)', 'x', opt)}${feature('Eagle Eye (Eagle)', 'x', opt)}`,
        ),
      ),
    );
    expect(subs).toEqual([]);
    expect(result.entity.subclassTitle).toBeUndefined();
    expect(result.options?.map((o) => o.entity.name)).toEqual(['Great Bear', 'Swift Eagle']);
    expect(result.reasons).toEqual([
      "its optional features that are no list's options (Bear Hug (Bear), Eagle Eye (Eagle)) are not converted",
    ]);
  });

  it('counts two choices of one label at one level in a subclass as its options', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: College of Swords', 'x', opt)}${feature('Fighting Style: Dueling (College of Swords)', 'x', opt)}${feature('Fighting Style: Defense (College of Swords)', 'x', opt)}${feature('Blade Flourish (College of Swords)', 'x', opt)}`)}
      `),
    );
    expect(subs[0]?.parts?.map((p) => p.entity.name)).toEqual([
      'College of Swords',
      'Blade Flourish',
    ]);
    expect(subs[0]?.options?.map((o) => [o.entity.name, o.entity.featureType, o.official])).toEqual(
      [
        ['Dueling', ['Ember Knight (College of Swords): Fighting Style'], 'FS:F'],
        ['Defense', ['Ember Knight (College of Swords): Fighting Style'], 'FS:F'],
      ],
    );
    expect(subs[0]?.entity.optionalfeatureProgression).toEqual([
      {
        name: 'Fighting Style',
        featureType: ['Ember Knight (College of Swords): Fighting Style', 'FS:F'],
        progression: { '3': 1 },
      },
    ]);
    expect(subs[0]?.reasons).toEqual([]);
  });

  it('takes no label for a subclass when only half its choices name one', () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(1, ['Archery', 'Defense', 'Marksman', 'Sentinel'].map((s) => feature(`Fighting Style: ${s}`, 'x', opt)).join(''))}
        ${level(3, `${feature('Legendary Marksman (Marksman)', 'x', opt)}${feature('Sentinel Stand (Sentinel)', 'x', opt)}`)}
      `),
    );
    expect(subs).toEqual([]);
    expect(result.entity.subclassTitle).toBeUndefined();
  });

  it('keeps every Channel Divinity a subclass lists, though they share a level', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Oath of Ash', 'x', opt)}${feature('Channel Divinity: Ash Weapon (Oath of Ash)', 'x', opt)}${feature('Channel Divinity: Turn the Sooty (Oath of Ash)', 'x', opt)}`)}
      `),
    );
    expect(subs[0]?.parts?.map((p) => p.entity.name)).toEqual([
      'Oath of Ash',
      'Channel Divinity: Ash Weapon',
      'Channel Divinity: Turn the Sooty',
    ]);
    expect(subs[0]?.reasons).toEqual([]);
  });

  it('keeps a Channel choice that names a group to choose by as an option', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Theurgy', 'x', opt)}${feature('Channel Arcana: Divine Arcana (Ash Theurgy)', 'x', opt)}${feature('Channel Arcana: Guided Strike (War Domain) (Ash Theurgy)', 'x', opt)}${feature('Channel Arcana: Preserve Life (Life Domain) (Ash Theurgy)', 'x', opt)}`)}
      `),
    );
    expect(subs[0]?.parts?.map((p) => p.entity.name)).toEqual([
      'Ash Theurgy',
      'Channel Arcana: Divine Arcana',
    ]);
    expect(subs[0]?.options?.map((o) => o.entity.name)).toEqual([
      'Guided Strike (War Domain)',
      'Preserve Life (Life Domain)',
    ]);
    expect(subs[0]?.reasons).toEqual([]);
  });

  it('takes a second pick whose features all cite the first one’s book as a repeat', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'x\nSource: Ember Codex p. 1', opt)}${feature('Ember Path: Ash Guard', 'Only flavour.\nSource: Ash Codex p. 1', opt)}${feature('Ash Ward (Ash Guard)', 'Ember.\nSource: Ember Codex p. 2', opt)}`)}
      `),
    );
    expect(subs.map((s) => [s.entity.source, s.parts?.length])).toEqual([['FCEmberCodex', 2]]);
  });

  it('keeps two subclasses of one name from two books apart', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'x\nSource: Ember Codex p. 1', opt)}${feature('Ash Ward (Ash Guard)', 'Ember.\nSource: Ember Codex p. 2', opt)}${feature('Ember Path: Ash Guard', 'x\nSource: Ash Codex p. 1', opt)}${feature('Ash Ward (Ash Guard)', 'Ash.\nSource: Ash Codex p. 2', opt)}${feature('Ember Path: Ash Guard', 'A repeat with no book.', opt)}`)}
      `),
    );
    expect(
      subs.map((s) => [
        s.entity.source,
        s.parts?.map((p) => (Array.isArray(p.entity.entries) ? p.entity.entries[0] : undefined)),
      ]),
    ).toEqual([
      ['FCEmberCodex', ['x', 'Ember.']],
      ['FCAshCodex', ['x', 'Ash.']],
    ]);
  });

  it('names no subclass for a pick of brackets alone', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}${feature('Ember Path: (Legacy)', 'x', opt)}`)}
      `),
    );
    expect(subs.map((s) => s.name)).toEqual(['Ash Guard']);
  });

  it('opens the choice with a feature of its own when the class has none', () => {
    const { result } = subclassesOf(
      knight(
        level(
          3,
          `${feature('Ember Path: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}`,
        ),
      ),
    );
    expect(result.entity.classFeatures).toEqual([
      { classFeature: `Ember Path|Ember Knight|${SOURCE}|3`, gainSubclassFeature: true },
    ]);
    expect(result.parts?.[0]?.entity.entries).toEqual(['You choose your Ember Path.']);
  });

  it('places a subclass by the Source line of its pick', () => {
    const { subs } = subclassesOf(
      knight(
        level(
          3,
          `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'Guards.\nSource: Ember Codex p. 9', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}`,
        ),
      ),
    );
    expect(subs[0]?.entity).toMatchObject({ source: 'FCEmberCodex', page: 9 });
    expect(subs[0]?.entity.subclassFeatures).toContain(
      `Ash Ward|Ember Knight|${SOURCE}|Ash Guard|FCEmberCodex|3`,
    );
  });

  it("casts by the class's optional slot rows, for a subclass with a spellcasting feature", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      level(i + 1, `<slots optional="YES">2,${i < 2 ? '0,0' : i < 6 ? '2,0' : '4,2'}</slots>`),
    ).join('');
    const { result, subs } = subclassesOf(
      knight(
        `${rows}${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Mage', 'x', opt)}${feature('Spellcasting (Ash Mage)', 'You cast spells.', opt)}`)}`,
      ),
    );
    expect(result.entity.casterProgression).toBeUndefined();
    expect(subs[0]?.entity).toMatchObject({ spellcastingAbility: 'int' });
    expect(subs[0]?.entity.casterProgression).toBeDefined();
    expect(subs[0]?.entity.subclassTableGroups).toBeDefined();
    expect(subs[0]?.entity.classTableGroups).toBeUndefined();
  });

  it('casts for a feature ending in Magic only when it names a spellcasting ability', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      level(i + 1, `<slots optional="YES">2,${i < 2 ? '0,0' : i < 6 ? '2,0' : '4,2'}</slots>`),
    ).join('');
    const { subs } = subclassesOf(
      knight(
        `${rows}${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Mage', 'x', opt)}${feature('Ash Magic (Ash Mage)', 'Intelligence is your spellcasting ability for these spells.', opt)}${feature('Ember Path: Soot Thief', 'x', opt)}${feature('Drain Magic (Soot Thief)', 'A creature regains one expended spell slot.', opt)}`)}`,
      ),
    );
    expect(subs.map((s) => [s.name, s.entity.casterProgression])).toEqual([
      ['Ash Mage', '1/3'],
      ['Soot Thief', undefined],
    ]);
  });

  it("says a subclass caster's slots come back on a short rest when the class's do", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      level(i + 1, `<slots optional="YES">2,${i < 2 ? '0,0' : i < 6 ? '2,0' : '4,2'}</slots>`),
    ).join('');
    const { subs } = subclassesOf(
      knight(
        `<slotsReset>S</slotsReset>${rows}${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Mage', 'x', opt)}${feature('Spellcasting (Ash Mage)', 'You cast spells.', opt)}`)}`,
      ),
    );
    expect(subs[0]?.reasons).toContain(
      'its spell slots come back on a short rest, which is kept as text',
    );
  });

  const counter = (name: string, value: string, reset = 'L', of = '') =>
    `<counter><name>${name}</name><value>${value}</value>${reset === '' ? '' : `<reset>${reset}</reset>`}${of === '' ? '' : `<subclass>${of}</subclass>`}</counter>`;
  const poolNames = (entity: Record<string, unknown> | undefined) => {
    const g = entity?.castGuidance as { effects?: { label: string }[] } | undefined;
    return g?.effects?.map((e) => e.label) ?? [];
  };

  it("makes a subclass's counters its pools, and the class's own the class's", () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}${counter('Ash', '2', 'L', 'Ash Guard')}${counter('Ember', '2', 'S')}${counter('Soot', '1', 'L', 'Soot Order')}`)}
      `),
    );
    expect(poolNames(result.entity)).toEqual(['Ember']);
    expect(result.reasons).toEqual([
      'its counters for a subclass it does not have (Soot) are not converted',
    ]);
    expect(poolNames(subs[0]?.entity)).toEqual(['Ash']);
    expect(subs[0]?.reasons).toEqual([]);
  });

  it('finds the subclass a counter names by the last words of its name', () => {
    const { subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Order of the Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}${counter('Ash', '2', 'L', 'Ash Guard')}`)}
      `),
    );
    expect(subs.map((s) => [s.name, poolNames(s.entity)])).toEqual([
      ['Order of the Ash Guard', ['Ash']],
    ]);
  });

  it("gives a subclass a counter the file left on the class, named for that subclass's feature", () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}${feature('Ember Path: Soot Blade', 'x', opt)}${feature('Soot Edge (Soot Blade)', 'x', opt)}${counter('Ash Ward', '1')}`)}
      `),
    );
    expect(poolNames(result.entity)).toEqual([]);
    expect(subs.map((s) => [s.name, poolNames(s.entity)])).toEqual([
      ['Ash Guard', ['Ash Ward']],
      ['Soot Blade', []],
    ]);
  });

  it('leaves out the uses a feature of a pool name would count itself', () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(1, `${feature('Ember Burst', 'You can use this feature twice.')}${counter('Ember Burst', '2')}`)}
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'Once per long rest.', opt)}${counter('Ash Ward', '1', 'L', 'Ash Guard')}`)}
      `),
    );
    const drop = { v: 1, drop: [{ kind: 'resource' }] };
    expect(result.parts?.find((p) => p.entity.name === 'Ember Burst')?.entity.castGuidance).toEqual(
      drop,
    );
    expect(result.parts?.find((p) => p.entity.name === 'Ember Path')?.entity.castGuidance).toBe(
      undefined,
    );
    expect(subs[0]?.parts?.find((p) => p.entity.name === 'Ash Ward')?.entity.castGuidance).toEqual(
      drop,
    );
  });

  it('reads spells known from a Spells Known counter when nothing else gives them', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      level(
        i + 1,
        `<slots>2,${i < 2 ? '2,0' : '4,2'}</slots>${i === 0 || i === 4 ? counter('Spells Known', i === 0 ? '2' : '5', '') : ''}`,
      ),
    ).join('');
    const { result } = subclassesOf(
      knight(`${rows}${level(1, feature('Spellcasting', 'You cast spells.'))}`),
    );
    expect(result.entity.spellsKnownProgression).toEqual([
      2, 2, 2, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
    ]);
    expect(poolNames(result.entity)).toEqual([]);
  });

  it("gives a subclass caster the class's Spells Known when the class casts nothing itself", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      level(
        i + 1,
        `<slots optional="YES">2,${i < 2 ? '0' : '2'}</slots>${i === 2 ? counter('Spells Known', '3', '') : ''}`,
      ),
    ).join('');
    const { result, subs } = subclassesOf(
      knight(
        `${rows}${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Mage', 'x', opt)}${feature('Spellcasting (Ash Mage)', 'You cast spells. Intelligence is your spellcasting ability.', opt)}${feature('Ember Path: Soot Blade', 'x', opt)}${feature('Soot Edge (Soot Blade)', 'x', opt)}`)}`,
      ),
    );
    expect(result.entity.spellsKnownProgression).toBeUndefined();
    expect(subs.map((s) => [s.name, s.entity.spellsKnownProgression])).toEqual([
      ['Ash Mage', [0, 0, ...Array<number>(18).fill(3)]],
      ['Soot Blade', undefined],
    ]);
  });

  it('reads spells known for a printing of an official class, with no pools', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      level(
        i + 1,
        `<slots>2,${i < 2 ? '2,0' : '4,2'}</slots>${i === 0 ? counter('Spells Known', '4', '') : ''}`,
      ),
    ).join('');
    const { result } = subclassesOf(
      knight(
        `<trait><name>Ember Knight</name><text>Knights.\nSource: Player's Handbook (2014) p. 1</text></trait>${rows}${level(1, `${feature('Spellcasting', 'You cast spells.')}${counter('Ember', '2')}`)}`,
      ),
    );
    expect(result.entity.spellsKnownProgression).toEqual(Array<number>(20).fill(4));
    expect(result.entity.castGuidance).toBeUndefined();
  });

  it('keeps no pools for a printing of an official class, whose own uses count', () => {
    const { result } = subclassesOf(
      knight(
        `<trait><name>Ember Knight</name><text>Knights.\nSource: Player's Handbook (2014) p. 1</text></trait>${level(1, `${feature('Ember Strike')}${counter('Ember', '2')}`)}`,
      ),
    );
    expect(result.entity.castGuidance).toBeUndefined();
    expect(result.reasons).toEqual([]);
  });

  it('takes an Ability Score Improvement offered at a level marked for one as the class feature', () => {
    const { result } = subclassesOf(
      knight(
        level(
          4,
          feature('Ability Score Improvement', 'Raise or take a feat.', opt),
          ' scoreImprovement="YES"',
        ),
      ),
    );
    expect(result.reasons).toEqual([]);
    expect(result.parts?.map((p) => [p.entity.name, p.entity.entries])).toEqual([
      ['Ability Score Improvement', ['Raise or take a feat.']],
    ]);
  });

  describe('spells', () => {
    const dash = String.fromCharCode(0x2014);
    const oath = (spells: string, more = '') =>
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Oath of Ash', 'Ash.', opt)}${feature('Oath Spells (Oath of Ash)', `You gain oath spells at the paladin levels listed.\n${spells}`, opt)}`)}
        ${level(7, feature('Cinder Soul (Oath of Ash)', 'You always have the fireball spell prepared.', opt))}
        ${more}
      `);

    it("reads a subclass's spells from its features, each at its level", () => {
      const { subs } = subclassesOf(oath(`3rd ${dash} burning hands, command`));
      expect(subs[0]?.entity.additionalSpells).toEqual([
        { prepared: { 3: ['burning hands', 'command'], 7: ['fireball'] } },
      ]);
      expect(subs[0]?.reasons).toEqual([]);
    });

    it('says a table of spells it cannot read is kept as text', () => {
      const { subs } = subclassesOf(oath(`3rd ${dash} sanctuary or deathwatch`));
      expect(subs[0]?.entity.additionalSpells).toEqual([{ prepared: { 7: ['fireball'] } }]);
      expect(subs[0]?.reasons).toEqual(['some of its spells are kept as text']);
    });

    it("names the subclass's options whose tables of spells are kept as text", () => {
      const lands = level(
        3,
        `${feature('Circle Spells: Arctic (Oath of Ash)', `You gain these spells.\n3rd ${dash} hold person`, opt)}${feature('Circle Spells: Coast (Oath of Ash)', `You gain these spells.\n3rd ${dash} mirror image or misty step`, opt)}`,
      );
      const { subs } = subclassesOf(oath(`3rd ${dash} command`, lands));
      expect(subs[0]?.options?.map((o) => [o.entity.name, o.entity.additionalSpells])).toEqual([
        ['Arctic', [{ known: { 3: ['hold person'] } }]],
        ['Coast', undefined],
      ]);
      expect(subs[0]?.reasons).toEqual(["its options' tables of spells (Coast) are kept as text"]);
    });

    it("reads a spell the class's own features always prepare, but no table of its own", () => {
      const { result } = subclassesOf(
        knight(
          `${level(1, feature('Favored Foe', "You always have the Hunter's Mark spell prepared."))}${level(2, feature('Ember Spells', `You gain domain spells at the levels listed.\n2nd ${dash} bless`))}`,
        ),
      );
      expect(result.entity.additionalSpells).toEqual([{ prepared: { 1: ["hunter's mark"] } }]);
      expect(result.reasons).toEqual([]);
    });
  });
});

describe('convertClassAdditions', () => {
  const opt = ' optional="YES"';
  const add = (inner: string) =>
    convertClassAdditions(
      parseXml(`<class><name>Fighter</name>${inner}</class>`),
      fc5Context(FILE),
    );
  const added = (inner: string) => {
    const a = add(inner);
    if (a === undefined || 'skip' in a) throw new Error(`no subclasses: ${JSON.stringify(a)}`);
    return a;
  };

  it('builds the subclasses a class entry with no hit die adds, on the class it is bound to', () => {
    const a = added(
      level(
        3,
        `${feature('Martial Archetype: Ash Guard', 'Guards.\nSource: Ember Codex p. 2', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}`,
      ),
    );
    expect([a.name, a.edition, a.reasons]).toEqual(['Fighter', '2014', []]);
    const subs = a.subclasses({ className: 'Fighter', classSource: 'PHB' });
    expect(subs.map((s) => [s.name, s.entity.source, s.entity.classSource])).toEqual([
      ['Ash Guard', 'FCEmberCodex', 'PHB'],
    ]);
  });

  it('says what it holds besides its subclasses, which is not converted', () => {
    const a = added(
      level(
        3,
        `${feature('Martial Archetype: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}${feature('Fighting Style: Ember Style', 'x', opt)}${feature('Extra Ember')}<counter><name>Ember</name><value>2</value><reset>L</reset></counter><counter><name>Ash</name><value>1</value><subclass>Ash Guard</subclass></counter>`,
      ),
    );
    expect(a.reasons).toEqual([
      'its features in no subclass (Fighting Style: Ember Style, Extra Ember) are not converted: it adds to a class of that name, and only its subclasses convert',
      'its own counters (Ember) are not converted: it adds to a class of that name, and only its subclasses convert',
    ]);
  });

  it('gives a subclass the options its own feature names, as a whole class does', () => {
    const a = added(
      level(
        3,
        `${feature('Martial Archetype: Totem Guard', 'x', opt)}${feature('Totem (Totem Guard)', 'Choose a totem.', opt)}${feature('Totem: Bear', 'Bear.', opt)}${feature('Totem: Eagle', 'Eagle.', opt)}`,
      ),
    );
    expect(a.reasons).toEqual([]);
    const [sub] = a.subclasses({ className: 'Fighter', classSource: 'PHB' });
    expect(sub?.options?.map((o) => [o.entity.name, o.entity.featureType])).toEqual([
      ['Bear', ['Fighter (Totem Guard): Totem']],
      ['Eagle', ['Fighter (Totem Guard): Totem']],
    ]);
    expect(sub?.entity.optionalfeatureProgression).toEqual([
      { name: 'Totem', featureType: ['Fighter (Totem Guard): Totem'], progression: { '3': 1 } },
    ]);
  });

  it('gives its subclass casters its Spells Known, and says nothing of it', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      level(
        i + 1,
        `<slots>2,${i < 2 ? '0' : '2'}</slots>${i === 2 ? '<counter><name>Spells Known</name><value>3</value></counter>' : ''}`,
      ),
    ).join('');
    const a = added(
      `${rows}${level(3, `${feature('Martial Archetype: Ash Mage', 'x', opt)}${feature('Spellcasting (Ash Mage)', 'You cast spells. Intelligence is your spellcasting ability.', opt)}`)}`,
    );
    expect(a.reasons).toEqual([]);
    const [sub] = a.subclasses({ className: 'Fighter', classSource: 'PHB' });
    expect(sub?.entity.spellsKnownProgression).toEqual([0, 0, ...Array<number>(18).fill(3)]);
  });

  it('reads the edition a pick marks, which its name drops', () => {
    const a = added(
      level(
        3,
        `${feature('Martial Archetype: Ash Guard [5.5e]', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}`,
      ),
    );
    const [sub] = a.subclasses({ className: 'Fighter', classSource: 'XPHB' });
    expect([sub?.name, sub?.edition, sub?.entity.edition]).toEqual(['Ash Guard', '2024', 'one']);
  });

  it('is undefined for one with no subclass', () => {
    expect(add(level(3, feature('Ash Ward', 'x', opt)))).toBeUndefined();
  });

  it('says a nameless one has no name', () => {
    const el = parseXml(
      `<class>${level(3, `${feature('Martial Archetype: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}`)}</class>`,
    );
    expect(convertClassAdditions(el, fc5Context(FILE))).toEqual({ skip: 'it has no name' });
  });
});
