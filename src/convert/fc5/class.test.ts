import { describe, expect, it } from 'vitest';
import { PACT_SLOTS, STANDARD_SLOTS } from '../../engine/calc/slots';
import { parseXml } from '../xml';
import { convertClass, featureName, isStartNote, matchProgression } from './class';
import { fc5Context } from './compendium';
import type { Fc5Result } from './context';

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
      'its subclasses and options are not converted yet',
      'its notes on starting equipment and multiclassing are not converted yet',
      'its counters (Ember) are not converted yet',
    ]);
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
      skip: 'it only adds features to a class of that name, which is not converted yet',
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
