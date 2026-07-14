import { describe, expect, it } from 'vitest';
import { classSpellUids, classSpellUidsFromEntities, type SpellClassLookup } from './spellLookup';

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
});
