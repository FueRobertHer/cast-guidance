import { describe, expect, it } from 'vitest';
import {
  classListCheck,
  classListedSpellUids,
  classSpellUids,
  classSpellUidsFromEntities,
  type SpellClassLookup,
  subclassListedSpellUids,
  subclassSpellUids,
  subclassSpellUidsFromEntities,
} from './spellLookup';

describe('classSpellUidsFromEntities (homebrew inline lists)', () => {
  const spells = [
    { name: 'Brew Bolt', source: 'HB', classes: { fromClassList: [{ name: 'Wizard' }] } },
    { name: 'Heal Word', source: 'HB', classes: { fromClassList: [{ name: 'Cleric' }] } },
    { name: 'No List', source: 'HB' },
  ];

  it('returns lowercased uids for spells on the class list', () => {
    expect([...classSpellUidsFromEntities(spells, 'Wizard')]).toEqual(['brew bolt|hb']);
  });

  it('matches class name case-insensitively and skips spells without a list', () => {
    expect(classSpellUidsFromEntities(spells, 'cleric')).toEqual(new Set(['heal word|hb']));
    expect(classSpellUidsFromEntities(spells, 'Bard').size).toBe(0);
  });

  it('reads several names at once, for a Workshop copy and its original', () => {
    expect(classSpellUidsFromEntities(spells, ['Warden', 'Wizard'])).toEqual(
      new Set(['brew bolt|hb']),
    );
  });
});

describe('classSpellUids (generated lookup)', () => {
  const lookup: SpellClassLookup = {
    phb: {
      fireball: { class: { PHB: { Wizard: true, Sorcerer: true } } },
      'cure wounds': { class: { PHB: { Cleric: true } } },
      'no classes': {},
    },
  };

  it('collects "name|source" for spells on the class list across class sources', () => {
    expect([...classSpellUids(lookup, 'Wizard')]).toEqual(['fireball|phb']);
    expect(classSpellUids(lookup, 'sorcerer')).toEqual(new Set(['fireball|phb']));
  });

  it('is empty for a class that appears nowhere', () => {
    expect(classSpellUids(lookup, 'Druid').size).toBe(0);
  });

  it('reads several names at once, for a Workshop copy and its original', () => {
    expect(classSpellUids(lookup, ['Mender', 'Cleric'])).toEqual(new Set(['cure wounds|phb']));
    expect(classSpellUids(lookup, ['Mender']).size).toBe(0);
  });
});

describe('subclassSpellUids (generated lookup)', () => {
  // The release's shape: subclass[classSource][className][subclassSource][shortName].
  const lookup: SpellClassLookup = {
    phb: {
      shield: {
        class: { PHB: { Wizard: true } },
        subclass: {
          PHB: {
            Fighter: { PHB: { 'Eldritch Knight': { name: 'Eldritch Knight' } } },
            Rogue: { PHB: { 'Arcane Trickster': { name: 'Arcane Trickster' } } },
          },
        },
      },
      'cure wounds': { subclass: { PHB: { Cleric: { PHB: { Life: { name: 'Life Domain' } } } } } },
    },
    xphb: {
      shield: {
        subclass: {
          XPHB: { Fighter: { XPHB: { 'Eldritch Knight': { name: 'Eldritch Knight' } } } },
        },
      },
    },
  };

  it("collects a subclass caster's list across sources, by class and short name", () => {
    expect(subclassSpellUids(lookup, 'Fighter', 'Eldritch Knight')).toEqual(
      new Set(['shield|phb', 'shield|xphb']),
    );
    expect([...subclassSpellUids(lookup, 'rogue', 'arcane trickster')]).toEqual(['shield|phb']);
  });

  it('needs both names to match', () => {
    expect(subclassSpellUids(lookup, 'Rogue', 'Eldritch Knight').size).toBe(0);
    expect(subclassSpellUids(lookup, 'Wizard', 'Eldritch Knight').size).toBe(0);
  });

  it("reads a Workshop copy's subclass caster under its original's name too", () => {
    expect(subclassSpellUids(lookup, ['Warden', 'Fighter'], 'Eldritch Knight')).toEqual(
      new Set(['shield|phb', 'shield|xphb']),
    );
  });
});

describe('subclassSpellUidsFromEntities (homebrew inline subclass lists)', () => {
  const on = (name: string, className: string, subclass: Record<string, unknown>) => ({
    name,
    source: 'HB',
    classes: { fromSubclass: [{ class: { name: className }, subclass }] },
  });
  const spells = [
    on('Rune Spark', 'Fighter', { name: 'Eldritch Knight', shortName: 'Eldritch Knight' }),
    on('Hum', 'Bard', { name: 'College of Spellsong', shortName: 'Spellsong' }),
    on('Full Hum', 'Bard', { name: 'College of Spellsong' }),
    on('Short Hum', 'Bard', { name: 'Spellsong' }),
    on('Wrong Bard', 'Wizard', { name: 'College of Spellsong' }),
    { name: 'Class Only', source: 'HB', classes: { fromClassList: [{ name: 'Fighter' }] } },
    { name: 'Odd', source: 'HB', classes: { fromSubclass: [null, 'x', { class: 'Bard' }] } },
  ];

  it('matches the class and either name the subclass goes by', () => {
    expect(
      subclassSpellUidsFromEntities(spells, 'Bard', ['Spellsong', 'College of Spellsong']),
    ).toEqual(new Set(['hum|hb', 'full hum|hb', 'short hum|hb']));
    expect([...subclassSpellUidsFromEntities(spells, 'fighter', ['eldritch knight'])]).toEqual([
      'rune spark|hb',
    ]);
    // An entry's short name matches too, whatever its full name says.
    expect(subclassSpellUidsFromEntities(spells, 'Bard', ['Spellsong'])).toEqual(
      new Set(['hum|hb', 'short hum|hb']),
    );
  });

  it('needs the class too, and reads no class list', () => {
    expect(subclassSpellUidsFromEntities(spells, 'Fighter', ['Spellsong']).size).toBe(0);
    expect(subclassSpellUidsFromEntities(spells, 'Rogue', ['Eldritch Knight']).size).toBe(0);
  });

  it("reads a Workshop copy's subclass caster under its original's name too", () => {
    expect([
      ...subclassSpellUidsFromEntities(spells, ['Warden', 'Fighter'], ['Eldritch Knight']),
    ]).toEqual(['rune spark|hb']);
  });
});

describe('classListCheck (the lookup and homebrew together)', () => {
  const lookup: SpellClassLookup = {
    phb: { 'cure wounds': { class: { PHB: { Cleric: true } } } },
  };
  const spells = [
    { name: 'Heal Word', source: 'HB', classes: { fromClassList: [{ name: 'Cleric' }] } },
  ];

  it("asks both the lookup and a homebrew spell's own list, in any case", () => {
    const onList = classListCheck(lookup, spells);
    expect(onList('Cleric', 'cure wounds|phb')).toBe(true);
    expect(onList('cleric', 'heal word|hb')).toBe(true);
    expect(onList('Wizard', 'cure wounds|phb')).toBe(false);
  });

  it('reads homebrew alone before the lookup is in', () => {
    const onList = classListCheck(null, spells);
    expect(onList('Cleric', 'heal word|hb')).toBe(true);
    expect(onList('Cleric', 'cure wounds|phb')).toBe(false);
  });
});

describe('classListedSpellUids and subclassListedSpellUids (a homebrew class’s own list)', () => {
  const classes = [
    {
      name: 'Witch',
      source: 'HB',
      classSpells: ['Fire Bolt|PHB', 'shield', 7, { className: 'Wizard', classSource: 'PHB' }],
    },
    { name: 'Wizard', source: 'HB2', classSpells: ['alarm|phb'] },
  ];
  const subclasses = [
    {
      name: 'Coven of Ash',
      shortName: 'Ash',
      className: 'Witch',
      classSource: 'HB',
      subclassSpells: ['burning hands|phb'],
    },
  ];

  it('reads names with a book, and the Player’s Handbook without one, in any case', () => {
    expect(classListedSpellUids(classes, 'witch')).toEqual(
      new Set(['fire bolt|phb', 'shield|phb']),
    );
    expect(classListedSpellUids(classes, ['Witch', 'Wizard'])).toEqual(
      new Set(['fire bolt|phb', 'shield|phb', 'alarm|phb']),
    );
    expect(classListedSpellUids(classes, 'Druid')).toEqual(new Set());
  });

  it('reads a subclass by its full name or its short one, on its own class only', () => {
    expect(subclassListedSpellUids(subclasses, 'Witch', ['Ash'])).toEqual(
      new Set(['burning hands|phb']),
    );
    expect(subclassListedSpellUids(subclasses, 'Witch', ['coven of ash'])).toEqual(
      new Set(['burning hands|phb']),
    );
    expect(subclassListedSpellUids(subclasses, 'Wizard', ['Ash'])).toEqual(new Set());
  });

  it('puts them on the list classListCheck asks about', () => {
    const onList = classListCheck({}, [], classes);
    expect(onList('Witch', 'fire bolt|phb')).toBe(true);
    expect(onList('Witch', 'alarm|phb')).toBe(false);
    expect(classListCheck({}, [])('Witch', 'fire bolt|phb')).toBe(false);
  });
});
