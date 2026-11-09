import { describe, expect, it } from 'vitest';
import type { Entity } from '../data5e/copyMod';
import type { EntityType } from '../data5e/normalize';
import {
  compareValues,
  compareWithOfficial,
  type OfficialData,
  spellClassesFromLookup,
} from './compareOfficial';
import { convertXmlText } from './index';

const officialOf = (
  byType: Partial<Record<EntityType, Entity[]>>,
  spellClasses?: OfficialData['spellClasses'],
): OfficialData => ({
  byType: (type) => byType[type] ?? [],
  ...(spellClasses === undefined ? {} : { spellClasses }),
});

const field = (result: ReturnType<typeof compareWithOfficial>, kind: string, name: string) =>
  result.find((k) => k.kind === kind)?.fields.find((f) => f.field === name);

describe('compareWithOfficial', () => {
  it('matches by name and rules edition, as the import does', () => {
    const official = officialOf({
      spell: [
        { name: 'Fireball', source: 'PHB', level: 3 },
        { name: 'Fireball', source: 'XPHB', edition: 'one', level: 3, ritual: true },
      ],
    });
    const result = compareWithOfficial(
      {
        spell: [
          { name: 'Fireball', source: 'FCSpells', level: 3 },
          { name: 'fireball', source: 'FCSpells', edition: 'one', level: 3 },
          { name: 'Embers', source: 'FCSpells', level: 1 },
        ],
      },
      official,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'spell', converted: 3, matched: 2 });
    expect(result[0]?.unmatched).toEqual(['Embers']);
    // Only the 2024 printing has `ritual`, and only the 2024 entry met it.
    expect(field(result, 'spell', 'ritual')).toMatchObject({ missing: 1, same: 0 });
    expect(field(result, 'spell', 'level')).toMatchObject({ same: 2 });
  });

  it('tallies same, differs, missing and extra, with examples', () => {
    const official = officialOf({
      spell: [
        { name: 'A', source: 'PHB', level: 1, savingThrow: ['wisdom'], damageInflict: ['fire'] },
        { name: 'B', source: 'PHB', level: 2, savingThrow: ['dexterity'] },
      ],
    });
    const result = compareWithOfficial(
      {
        spell: [
          { name: 'A', source: 'FC', level: 1, savingThrow: ['wisdom'], spellAttack: ['R'] },
          { name: 'B', source: 'FC', level: 3, savingThrow: ['dexterity'] },
        ],
      },
      official,
    );
    expect(field(result, 'spell', 'level')).toEqual({
      field: 'level',
      same: 1,
      source: 0,
      differs: 1,
      missing: 0,
      extra: 0,
      examples: { source: [], differs: ['B: converted 3, official 2'], missing: [], extra: [] },
      lacks: [],
      adds: [],
      searchTag: false,
    });
    // On a spell, a damage type it deals is one of 5etools' filter tags.
    expect(field(result, 'spell', 'damageInflict')?.searchTag).toBe(true);
    expect(field(result, 'spell', 'level')?.searchTag).toBe(false);
    expect(field(result, 'spell', 'damageInflict')?.examples.missing).toEqual(['A: ["fire"]']);
    expect(field(result, 'spell', 'spellAttack')?.examples.extra).toEqual(['A: ["R"]']);
    expect(field(result, 'spell', 'savingThrow')).toMatchObject({ same: 2, differs: 0 });
    // Most disagreements first, then by name.
    expect(result[0]?.fields.map((f) => f.field)).toEqual([
      'damageInflict',
      'level',
      'spellAttack',
      'savingThrow',
    ]);
  });

  it('leaves out what is about the printing, and bookkeeping keys', () => {
    const official = officialOf({
      feat: [
        {
          name: 'Alert',
          source: 'PHB',
          page: 165,
          srd: true,
          hasFluff: true,
          referenceSources: ['LMoP'],
          lootTables: ['Magic Item Table F'],
          entries: ['Always on the lookout.'],
          _versions: [],
        },
      ],
    });
    const result = compareWithOfficial(
      { feat: [{ name: 'Alert', source: 'FC', entries: ['Other words.'] }] },
      official,
    );
    expect(result[0]).toMatchObject({ matched: 1, fields: [] });
  });

  it('compares higher-level text by presence only', () => {
    const higher = [{ entries: ['More.'] }];
    const official = officialOf({
      spell: ['A', 'B', 'C'].map((name) => ({
        name,
        source: 'PHB',
        ...(name === 'C' ? {} : { entriesHigherLevel: higher }),
      })),
    });
    const result = compareWithOfficial(
      {
        spell: [
          { name: 'A', entriesHigherLevel: [{ entries: ['Other words.'] }] },
          { name: 'B' },
          { name: 'C', entriesHigherLevel: higher },
        ],
      },
      official,
    );
    expect(field(result, 'spell', 'entriesHigherLevel')).toMatchObject({
      same: 1,
      differs: 0,
      missing: 1,
      extra: 1,
    });
  });

  it('keeps out the age of a race, and compares the era of an item, which the engine reads', () => {
    const official = officialOf({
      race: [{ name: 'Elf', source: 'PHB', age: { mature: 100 } }],
      baseitem: [{ name: 'Musket', source: 'DMG', age: 'renaissance' }],
    });
    const result = compareWithOfficial(
      { race: [{ name: 'Elf' }], item: [{ name: 'Musket' }] },
      official,
    );
    expect(field(result, 'race', 'age')).toBeUndefined();
    expect(field(result, 'item', 'age')).toMatchObject({ missing: 1 });
  });

  it('counts a defense as a rule on an item or a race, and as a tag only on a spell', () => {
    const official = officialOf({
      spell: [{ name: 'Heroism', source: 'PHB', conditionImmune: ['frightened'] }],
      baseitem: [{ name: 'Periapt', source: 'DMG', conditionImmune: ['poisoned'] }],
    });
    const result = compareWithOfficial(
      { spell: [{ name: 'Heroism' }], item: [{ name: 'Periapt' }] },
      official,
    );
    expect(field(result, 'spell', 'conditionImmune')?.searchTag).toBe(true);
    expect(field(result, 'item', 'conditionImmune')?.searchTag).toBe(false);
  });

  it('finds an entry under the name the SRD prints it with', () => {
    const official = officialOf({
      spell: [{ name: "Tasha's Hideous Laughter", source: 'PHB', srd: 'Hideous Laughter' }],
    });
    const result = compareWithOfficial(
      { spell: [{ name: 'Hideous Laughter', source: 'FC' }] },
      official,
    );
    expect(result[0]?.matched).toBe(1);
  });

  it('finds a 2024 entry under its SRD 5.2 name, in its own edition only', () => {
    const official = officialOf({
      item: [{ name: 'Bag of Tricks', source: 'XDMG', edition: 'one', srd52: 'Bag of Beasts' }],
    });
    const result = compareWithOfficial(
      { item: [{ name: 'Bag of Beasts', edition: 'one' }, { name: 'Bag of Beasts' }] },
      official,
    );
    expect(result[0]).toMatchObject({ matched: 1, unmatched: ['Bag of Beasts'] });
  });

  it('prefers the free-rules printing among several of one name and edition', () => {
    const official = officialOf({
      item: [{ name: 'Lantern', source: 'AAA', weight: 9 }],
      baseitem: [{ name: 'Lantern', source: 'PHB', srd: true, weight: 2 }],
    });
    const result = compareWithOfficial({ item: [{ name: 'Lantern', weight: 2 }] }, official);
    expect(field(result, 'item', 'weight')).toMatchObject({ same: 1 });
  });

  it('sets a subrace beside its race, merged as 5etools shows it', () => {
    const official = officialOf({
      race: [
        // First, so a subrace found by its race's name alone would get it.
        { name: 'Dwarf', source: 'OTHER', speed: 99 },
        { name: 'Dwarf', source: 'PHB', speed: 25, ability: [{ con: 2 }], resist: ['poison'] },
        {
          name: 'Elf',
          source: 'PHB',
          ability: [{ dex: 2 }],
          languageProficiencies: [{ common: true, elvish: true }],
          skillProficiencies: [{ perception: true }],
        },
        { name: 'Gnome', source: 'PHB', languageProficiencies: [{ common: true, gnomish: true }] },
      ],
      subrace: [
        {
          name: 'Hill',
          source: 'PHB',
          raceName: 'Dwarf',
          raceSource: 'PHB',
          ability: [{ wis: 1 }],
        },
        {
          name: 'High',
          source: 'PHB',
          raceName: 'Elf',
          raceSource: 'PHB',
          ability: [{ int: 1 }],
          languageProficiencies: [{ common: true, elvish: true, anyStandard: 1 }],
          skillProficiencies: [{ arcana: true }],
          overwrite: { languageProficiencies: true },
        },
        {
          name: 'Deep',
          source: 'PHB',
          raceName: 'Gnome',
          raceSource: 'PHB',
          languageProficiencies: [{ undercommon: true }],
        },
      ],
    });
    const result = compareWithOfficial(
      {
        race: [
          { name: 'Dwarf, Hill', speed: 25, ability: [{ con: 2, wis: 1 }], resist: ['poison'] },
          {
            name: 'Elf (High)',
            ability: [{ dex: 2, int: 1 }],
            languageProficiencies: [{ common: true, elvish: true, anyStandard: 1 }],
            skillProficiencies: [{ perception: true, arcana: true }],
          },
          {
            name: 'Deep Gnome',
            languageProficiencies: [{ common: true, gnomish: true }, { undercommon: true }],
          },
          { name: 'Hill' },
        ],
      },
      official,
    );
    expect(result[0]).toMatchObject({ converted: 4, matched: 3, unmatched: ['Hill'] });
    for (const name of ['speed', 'ability', 'resist', 'languageProficiencies']) {
      expect(field(result, 'race', name), name).toMatchObject({ differs: 0, missing: 0, extra: 0 });
    }
    expect(field(result, 'race', 'skillProficiencies')).toMatchObject({ same: 1 });
    for (const name of ['raceName', 'raceSource', 'overwrite']) {
      expect(field(result, 'race', name), name).toBeUndefined();
    }
  });

  it('finds a 2024 lineage under the name other apps give it, in its own edition', () => {
    const official = officialOf({
      race: [
        { name: 'Elf', source: 'XPHB', edition: 'one', darkvision: 60 },
        {
          name: 'Elf; Drow Lineage',
          source: 'XPHB',
          edition: 'one',
          _versionOf: 'elf|xphb',
          darkvision: 120,
        },
      ],
    });
    const result = compareWithOfficial(
      { race: [{ name: 'Elf, Drow', edition: 'one', darkvision: 120 }, { name: 'Elf, Drow' }] },
      official,
    );
    expect(result[0]).toMatchObject({ matched: 1, unmatched: ['Elf, Drow'] });
    expect(field(result, 'race', 'darkvision')).toMatchObject({ same: 1 });
  });

  it('merges a race`s nameless subrace, its base entry, into the race', () => {
    const scores = [{ str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }];
    const official = officialOf({
      race: [
        { name: 'Human', source: 'PHB', speed: 30 },
        { name: 'Human', source: 'OTHER', speed: 30 },
      ],
      subrace: [
        { source: 'OTHER', raceName: 'Human', raceSource: 'OTHER', ability: [{ str: 2 }] },
        { source: 'PHB', raceName: 'Human', raceSource: 'PHB', srd: true, ability: scores },
      ],
    });
    const result = compareWithOfficial(
      { race: [{ name: 'Human', speed: 30, ability: scores }] },
      official,
    );
    expect(field(result, 'race', 'ability')).toMatchObject({ same: 1, extra: 0 });
  });

  it('counts each value a list lacks or adds, across entries, most first', () => {
    const official = officialOf({
      spell: ['A', 'B', 'C'].map((name) => ({
        name,
        source: 'PHB',
        damageInflict: ['fire', 'cold'],
      })),
    });
    const result = compareWithOfficial(
      {
        spell: [
          { name: 'A', damageInflict: ['fire'] },
          { name: 'B', damageInflict: ['acid'] },
          { name: 'C', damageInflict: ['cold', 'fire'] },
        ],
      },
      official,
    );
    expect(field(result, 'spell', 'damageInflict')).toMatchObject({
      same: 1,
      differs: 2,
      lacks: [
        { value: '"cold"', count: 2 },
        { value: '"fire"', count: 1 },
      ],
      adds: [{ value: '"acid"', count: 1 }],
    });
  });

  it('counts a value once per entry, however often a list repeats it', () => {
    const result = compareWithOfficial(
      { spell: [{ name: 'A', damageInflict: ['fire'] }] },
      officialOf({ spell: [{ name: 'A', source: 'PHB', damageInflict: ['cold', 'cold'] }] }),
    );
    expect(field(result, 'spell', 'damageInflict')).toMatchObject({
      lacks: [{ value: '"cold"', count: 1 }],
      examples: { differs: ['A: lacks ["cold"], adds ["fire"]'] },
    });
  });

  it('counts a reference to another book, or to none, apart from same and differs', () => {
    const official = officialOf({
      background: ['A', 'B', 'C', 'D'].map((name) => ({
        name,
        source: 'XPHB',
        edition: 'one',
        feats: [{ 'magic initiate; cleric|xphb': true }],
      })),
    });
    const result = compareWithOfficial(
      {
        background: [
          { name: 'A', edition: 'one', feats: [{ 'magic initiate; cleric|xphb': true }] },
          { name: 'B', edition: 'one', feats: [{ 'Magic Initiate; Cleric|XPHB': true }] },
          { name: 'C', edition: 'one', feats: [{ 'magic initiate; cleric': true }] },
          { name: 'D', edition: 'one', feats: [{ 'magic initiate; cleric|phb': true }] },
        ],
      },
      official,
    );
    expect(field(result, 'background', 'feats')).toMatchObject({
      same: 2,
      source: 2,
      differs: 0,
      examples: {
        source: [
          'C: lacks [{"magic initiate; cleric|xphb":true}], adds [{"magic initiate; cleric":true}]',
          'D: lacks [{"magic initiate; cleric|xphb":true}], adds [{"magic initiate; cleric|phb":true}]',
        ],
      },
    });
  });

  it('counts only records as entries, and names a nameless one', () => {
    const result = compareWithOfficial(
      { spell: [null, 'x', 5, { source: 'FC' }, { name: 'A' }] },
      officialOf({ spell: [{ name: 'A', source: 'PHB' }] }),
    );
    expect(result[0]).toMatchObject({ converted: 2, matched: 1, unmatched: ['(no name)'] });
  });

  it('does not count values of lists of records, only shows them', () => {
    const official = officialOf({
      spell: [
        { name: 'A', source: 'PHB', time: [{ number: 1, unit: 'reaction', condition: 'x' }] },
      ],
    });
    const result = compareWithOfficial(
      { spell: [{ name: 'A', time: [{ number: 1, unit: 'reaction' }] }] },
      official,
    );
    expect(field(result, 'spell', 'time')).toMatchObject({ differs: 1, lacks: [], adds: [] });
    expect(field(result, 'spell', 'time')?.examples.differs[0]).toMatch(
      /^A: lacks \[\{.*\}\], adds/,
    );
  });

  it('caps the examples and the unmatched names', () => {
    const names = ['A', 'B', 'C'];
    const result = compareWithOfficial(
      { race: [...names, 'X', 'Y', 'Z'].map((name) => ({ name, speed: 30 })) },
      officialOf({ race: names.map((name) => ({ name, source: 'PHB', speed: 25 })) }),
      2,
    );
    expect(result[0]).toMatchObject({ converted: 6, matched: 3, unmatched: ['X', 'Y'] });
    expect(field(result, 'race', 'speed')).toMatchObject({
      differs: 3,
      examples: { differs: ['A: converted 30, official 25', 'B: converted 30, official 25'] },
    });
  });

  it('compares spell class lists by name when the lookup is given', () => {
    const spell = { name: 'Bless', source: 'PHB' };
    const converted = {
      spell: [
        {
          name: 'Bless',
          source: 'FC',
          classes: { fromClassList: [{ name: 'Cleric', source: 'PHB' }] },
        },
      ],
    };
    const withLookup = compareWithOfficial(
      converted,
      officialOf({ spell: [spell] }, () => ['Cleric', 'Paladin', 'Cleric']),
    );
    expect(field(withLookup, 'spell', 'classes')?.examples.differs).toEqual([
      'Bless: lacks ["Paladin"]',
    ]);
    expect(field(withLookup, 'spell', 'classes')).toMatchObject({
      lacks: [{ value: '"Paladin"', count: 1 }],
      adds: [],
    });
    const without = compareWithOfficial(converted, officialOf({ spell: [spell] }));
    expect(field(without, 'spell', 'classes')).toBeUndefined();
  });

  it('runs on real converter output', () => {
    const { json } = convertXmlText(
      `<compendium><item><name>Longsword</name><type>M</type><weight>3</weight>
        <dmg1>1d8</dmg1><dmg2>1d10</dmg2><dmgType>S</dmgType><property>V</property>
        <text>Proficiency: martial</text></item></compendium>`,
      { fileName: 'items.xml' },
    );
    const result = compareWithOfficial(
      json,
      officialOf({
        baseitem: [
          {
            name: 'Longsword',
            source: 'PHB',
            srd: true,
            type: 'M',
            weaponCategory: 'martial',
            weight: 3,
            dmg1: '1d8',
            dmg2: '1d10',
            dmgType: 'S',
            property: ['V'],
            weapon: true,
            sword: true,
          },
        ],
      }),
    );
    expect(result[0]).toMatchObject({ kind: 'item', matched: 1 });
    const disagree = result[0]?.fields.filter((f) => f.same === 0).map((f) => f.field);
    expect(disagree).toContain('sword');
    expect(field(result, 'item', 'dmg1')).toMatchObject({ same: 1 });
    expect(field(result, 'item', 'weaponCategory')).toMatchObject({ same: 1 });
  });
});

describe('spellClassesFromLookup', () => {
  const classesOf = spellClassesFromLookup({
    phb: {
      bless: { class: { PHB: { Cleric: true, Paladin: true }, TCE: { Artificer: true } } },
    },
  });

  it('reads every class, across class sources', () => {
    expect(classesOf({ name: 'Bless', source: 'PHB' })).toEqual(['Cleric', 'Paladin', 'Artificer']);
  });

  it('answers none for a spell the lookup does not have', () => {
    expect(classesOf({ name: 'Bless', source: 'XPHB' })).toEqual([]);
    expect(classesOf({ name: 'constructor', source: 'PHB' })).toEqual([]);
    expect(spellClassesFromLookup(null)({ name: 'Bless', source: 'PHB' })).toEqual([]);
  });
});

describe('compareValues', () => {
  it('tells a reference naming another book, or none, from one that agrees', () => {
    expect(compareValues('M|XPHB', 'M|xphb')).toBe('same');
    expect(compareValues('M', 'M|XPHB')).toBe('source');
    expect(compareValues('alert|phb', 'alert|xphb')).toBe('source');
    expect(compareValues([{ uid: 'F|XPHB', note: 'x' }, 'L|XPHB'], ['L|XPHB', 'F|XPHB'])).toBe(
      'same',
    );
    expect(compareValues('M|XPHB', 'R|XPHB')).toBe('differs');
  });

  it('ignores case in text with a space in it, not in a code or one word', () => {
    expect(compareValues({ label: 'Acid damage' }, { label: 'acid damage' })).toBe('same');
    expect(compareValues('v', 'V')).toBe('differs');
    expect(compareValues({ V: true, S: true }, { v: true, s: true })).toBe('differs');
  });

  it('leaves text with a tag in it whole', () => {
    expect(compareValues('{@item longsword|phb}', '{@item longsword|xphb}')).toBe('differs');
  });

  it('ignores key order and the order of plain lists, not of lists of records', () => {
    expect(compareValues({ a: 1, b: [2, 1] }, { b: [1, 2], a: 1 })).toBe('same');
    expect(compareValues([{ a: 1 }, { b: 2 }], [{ b: 2 }, { a: 1 }])).toBe('differs');
  });
});
