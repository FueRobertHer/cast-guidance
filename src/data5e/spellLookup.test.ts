import { describe, expect, it } from 'vitest';
import {
  classSpellUids,
  classSpellUidsFromEntities,
  type SpellClassLookup,
  subclassSpellUids,
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
