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
      'its options are not converted yet',
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

  it('keeps a label as options when only one of its choices shares a name with a subclass', () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(1, `${feature('Fighting Style')}${feature('Fighting Style: Archery', 'x', opt)}${feature('Fighting Style: Defense', 'x', opt)}${feature('Fighting Style: Marksman', 'x', opt)}`)}
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Marksman', 'x', opt)}${feature('Steady Aim (Marksman)', 'x', opt)}`)}
      `),
    );
    expect(subs.map((s) => s.name)).toEqual(['Marksman']);
    expect(result.entity.subclassTitle).toBe('Ember Path');
    expect(result.reasons).toEqual(['its options are not converted yet']);
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
    expect(result.reasons).toEqual(['its options are not converted yet']);
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
    expect(subs[0]?.reasons).toEqual(['its options are not converted yet']);
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

  it("reports a subclass's counters on it, and the class's own on the class", () => {
    const { result, subs } = subclassesOf(
      knight(`
        ${level(3, `${feature('Ember Path')}${feature('Ember Path: Ash Guard', 'x', opt)}${feature('Ash Ward (Ash Guard)', 'x', opt)}<counter><name>Ash</name><value>2</value><subclass>Ash Guard</subclass></counter><counter><name>Ember</name><value>2</value></counter><counter><name>Soot</name><value>1</value><subclass>Soot Order</subclass></counter>`)}
      `),
    );
    expect(result.reasons).toEqual(['its counters (Ember, Soot) are not converted yet']);
    expect(subs[0]?.reasons).toEqual(['its counters (Ash) are not converted yet']);
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
      'its counters (Ember) are not converted yet',
    ]);
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
