import { describe, expect, it } from 'vitest';
import { spellClasses, spellSubclasses } from './spellLists';

const lookup = {
  xphb: {
    fireball: {
      class: {
        XPHB: { Sorcerer: true, Wizard: true },
        WoW: { Mage: { definedInSources: ['WoW'] } },
      },
      subclass: {
        XPHB: {
          Fighter: { XPHB: { 'Eldritch Knight': { name: 'Eldritch Knight' } } },
          Bard: { XPHB: { Lore: { name: 'College of Lore' } } },
        },
      },
    },
  },
};

const knight = {
  name: 'Eldritch Knight',
  shortName: 'Eldritch Knight',
  source: 'XPHB',
  className: 'Fighter',
  classSource: 'XPHB',
};

describe('the lists a spell is on (Gemini 43)', () => {
  it("reads the lookup's classes, whatever the case of the spell's name and book", () => {
    expect(spellClasses(lookup, { name: 'FIREBALL', source: 'XPHB' })).toEqual([
      { name: 'Sorcerer', source: 'XPHB' },
      { name: 'Wizard', source: 'XPHB' },
      { name: 'Mage', source: 'WoW' },
    ]);
  });

  it("reads the lookup's subclasses with their full names", () => {
    expect(spellSubclasses(lookup, { name: 'Fireball', source: 'XPHB' })).toEqual([
      knight,
      {
        name: 'College of Lore',
        shortName: 'Lore',
        source: 'XPHB',
        className: 'Bard',
        classSource: 'XPHB',
      },
    ]);
  });

  it("reads a homebrew spell's own lists, and lists each once", () => {
    const spell = {
      name: 'Spark',
      source: 'MINE',
      classes: {
        fromClassList: [
          { name: 'Wizard', source: 'XPHB' },
          { name: 'Wizard', source: 'XPHB' },
          { name: 'Warden' },
        ],
        fromSubclass: [
          {
            class: { name: 'Fighter', source: 'XPHB' },
            subclass: { name: 'Eldritch Knight', shortName: 'Eldritch Knight', source: 'XPHB' },
          },
          { class: { name: 'Rogue' }, subclass: 'not an object' },
        ],
      },
    };
    expect(spellClasses({}, spell)).toEqual([
      { name: 'Wizard', source: 'XPHB' },
      { name: 'Warden', source: '' },
    ]);
    expect(spellSubclasses({}, spell)).toEqual([knight]);
  });

  it('is empty for a spell on no list', () => {
    expect(spellClasses(lookup, { name: 'Wish', source: 'XPHB' })).toEqual([]);
    expect(spellSubclasses(lookup, { name: 'Wish', source: 'XPHB' })).toEqual([]);
  });
});
