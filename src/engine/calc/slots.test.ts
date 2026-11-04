import { describe, expect, it } from 'vitest';
import { Collector } from '../effects/base';
import {
  type Ability,
  type ClassLevelEntry,
  type DataEntity,
  type DerivedAbility,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { calcSpellcasting, learnableSpellLevels, mysticArcanumLevels, ownSlotTable } from './slots';

// Field shapes mirror the pinned 5etools data: a class's slot table sits in
// `classTableGroups`, a subclass caster's in `subclassTableGroups`, and the
// Fighter and Rogue carry no caster progression of their own.
const paladin: DataEntity = {
  name: 'Paladin',
  source: 'PHB',
  casterProgression: '1/2',
  spellcastingAbility: 'cha',
  preparedSpells: '<$level$> / 2 + <$cha_mod$>',
};
const ranger: DataEntity = { ...paladin, name: 'Ranger', spellcastingAbility: 'wis' };
/**
 * A homebrew full caster with a slot table of its own that the full-caster
 * rows do not match, and that stops at its third level.
 */
const spellblade: DataEntity = {
  name: 'Spellblade',
  source: 'PHB',
  casterProgression: 'full',
  spellcastingAbility: 'int',
  classTableGroups: [
    {
      title: 'Spell Slots per Spell Level',
      rowsSpellProgression: [
        [1, 0],
        [2, 0],
        [2, 1],
      ],
    },
  ],
};
const wizard: DataEntity = {
  name: 'Wizard',
  source: 'PHB',
  casterProgression: 'full',
  spellcastingAbility: 'int',
  preparedSpells: '<$level$> + <$int_mod$>',
  cantripProgression: [3, 3, 3, 4],
};
const warlock: DataEntity = {
  name: 'Warlock',
  source: 'PHB',
  casterProgression: 'pact',
  spellcastingAbility: 'cha',
  spellsKnownProgression: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11],
};
const fighter: DataEntity = { name: 'Fighter', source: 'PHB' };
const eldritchKnight: DataEntity = {
  name: 'Eldritch Knight',
  shortName: 'Eldritch Knight',
  source: 'PHB',
  className: 'Fighter',
  classSource: 'PHB',
  casterProgression: '1/3',
  spellcastingAbility: 'int',
  cantripProgression: [0, 0, 2, 2, 2, 2, 2],
  spellsKnownProgression: [0, 0, 3, 4, 4, 4, 5],
  subclassTableGroups: [
    { colLabels: ['Cantrips Known', 'Spells Known'], rows: [[0, 0]] },
    {
      title: 'Spell Slots per Spell Level',
      colLabels: ['1st', '2nd', '3rd', '4th'],
      rowsSpellProgression: [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [2, 0, 0, 0],
        [3, 0, 0, 0],
        [3, 0, 0, 0],
        [3, 0, 0, 0],
        [4, 2, 0, 0],
      ],
    },
  ],
};

const WORLD: Record<string, DataEntity[]> = {
  class: [paladin, ranger, spellblade, wizard, warlock, fighter],
  subclass: [eldritchKnight],
};
const ctx: EngineContext = {
  get: (type, name, source) =>
    (WORLD[type] ?? []).find(
      (e) => e.name === name && (source === undefined || e.source === source),
    ),
  byType: (type) => WORLD[type] ?? [],
};
const abilities = Object.fromEntries(
  (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => [k, { mod: 3 }]),
) as unknown as Record<Ability, DerivedAbility>;

const entry = (name: string, levels: number, subclass?: string): ClassLevelEntry => ({
  ref: { name, source: 'PHB' },
  ...(subclass !== undefined ? { subclass: { name: subclass, source: 'PHB' } } : {}),
  levels,
  hp: [],
});

function blocks(...classes: ClassLevelEntry[]) {
  const doc = newCharacterDoc('c', 'Test', 't');
  doc.classes = classes;
  return calcSpellcasting(doc, new Collector(doc, ctx), abilities, 3);
}

describe('spell slots', () => {
  it("gives a lone half caster its own table's slots, not the multiclass row", () => {
    // The shared multiclass count rounds a paladin's levels down, which left a
    // Paladin 5 with three 1st-level slots and no 2nd.
    expect(blocks(entry('Paladin', 3))[0]?.slots.slice(0, 2)).toEqual([3, 0]);
    expect(blocks(entry('Paladin', 5))[0]?.slots.slice(0, 2)).toEqual([4, 2]);
    expect(blocks(entry('Paladin', 1))[0]?.slots.every((n) => n === 0)).toBe(true);
  });

  it('reads the slot table from the data when there is one', () => {
    expect(ownSlotTable(eldritchKnight)?.[6]).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(ownSlotTable(paladin)).toBeUndefined();
    // Its own table, not a full caster's 4 and 2 at level 3.
    expect(blocks(entry('Spellblade', 3))[0]?.slots.slice(0, 3)).toEqual([2, 1, 0]);
  });

  it("follows a class's progression past the end of its table", () => {
    expect(blocks(entry('Spellblade', 5))[0]?.slots.slice(0, 4)).toEqual([4, 3, 2, 0]);
  });

  it('leaves out a class that has no slots yet, as a 2014 ranger at level 1', () => {
    // It has no Spellcasting feature yet, so the paladin is the one caster.
    expect(blocks(entry('Paladin', 5), entry('Ranger', 1))[0]?.slots.slice(0, 2)).toEqual([4, 2]);
    expect(blocks(entry('Ranger', 5), entry('Paladin', 1))[0]?.slots.slice(0, 2)).toEqual([4, 2]);
  });

  it('still rounds a half caster down across several casting classes', () => {
    // Paladin 5 counts as 2, plus Wizard 1: a level 3 caster's slots.
    expect(blocks(entry('Paladin', 5), entry('Wizard', 1))[0]?.slots.slice(0, 3)).toEqual([
      4, 2, 0,
    ]);
  });

  it('keeps pact magic out of the count, so a paladin with warlock levels uses its own table', () => {
    const [pal, lock] = blocks(entry('Paladin', 5), entry('Warlock', 2));
    expect(pal?.slots.slice(0, 2)).toEqual([4, 2]);
    expect(lock?.pactSlots).toEqual({ count: 2, level: 1 });
  });
});

describe('a subclass caster', () => {
  it('casts from its subclass when the class has no spellcasting', () => {
    expect(blocks(entry('Fighter', 7))).toEqual([]);
    const [ek] = blocks(entry('Fighter', 7, 'Eldritch Knight'));
    expect(ek?.className).toBe('Eldritch Knight');
    expect(ek?.fromSubclass).toEqual({ className: 'Fighter', shortName: 'Eldritch Knight' });
    expect(ek?.classUid).toBe('fighter|phb');
    expect(ek?.ability).toBe('int');
    expect(ek?.mode).toBe('known');
    expect(ek?.slots.slice(0, 2)).toEqual([4, 2]);
    expect(ek?.cantripsKnown).toBe(2);
    expect(ek?.spellsKnownMax).toBe(5);
  });

  it('adds its third-caster levels to a multiclass count', () => {
    // Fighter 7 counts as 2, plus Wizard 3: a level 5 caster's slots.
    expect(
      blocks(entry('Fighter', 7, 'Eldritch Knight'), entry('Wizard', 3))[0]?.slots.slice(0, 3),
    ).toEqual([4, 3, 2]);
  });
});

describe('learnable spell levels', () => {
  it('follows the full-caster table for a full caster', () => {
    expect(learnableSpellLevels(wizard, 'full', 3)).toEqual({
      upTo: 2,
      unlocksAt: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    });
  });

  it('counts each class on its own, whatever the shared slots allow', () => {
    // Wizard 1 / Paladin 9 shares 3rd-level slots, but a wizard learns as a Wizard 1.
    const [wiz, pal] = blocks(entry('Wizard', 1), entry('Paladin', 9));
    expect(wiz?.slots[2]).toBeGreaterThan(0);
    expect(wiz?.learnable?.upTo).toBe(1);
    expect(pal?.learnable?.upTo).toBe(3);
  });

  it('opens nothing before a half caster has slots, and drops its counts', () => {
    const [pal] = blocks(entry('Paladin', 1));
    expect(pal?.learnable).toEqual({
      upTo: 0,
      unlocksAt: [2, 5, 9, 13, 17, null, null, null, null],
    });
    expect(pal?.preparedMax).toBeUndefined();
    expect(blocks(entry('Paladin', 2))[0]?.preparedMax).toBe(4);
  });

  it("reads a class's own table, then its progression past the table's end", () => {
    expect(learnableSpellLevels(spellblade, 'full', 3)).toEqual({
      upTo: 2,
      unlocksAt: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    });
    expect(learnableSpellLevels(spellblade, 'full', 2)?.upTo).toBe(1);
  });

  it("reads a subclass caster's own table", () => {
    // The fixture's table stops at Fighter 7; the third-caster rows carry on
    // past it, as the real table's 3rd and 4th levels at 13 and 19 do.
    expect(blocks(entry('Fighter', 7, 'Eldritch Knight'))[0]?.learnable).toEqual({
      upTo: 2,
      unlocksAt: [3, 7, 13, 19, null, null, null, null, null],
    });
  });

  it('opens 6th to 9th level for a warlock with Mystic Arcanum', () => {
    expect(learnableSpellLevels(warlock, 'pact', 11)).toEqual({
      upTo: 6,
      unlocksAt: [1, 3, 5, 7, 9, 11, 13, 15, 17],
    });
    expect(learnableSpellLevels(warlock, 'pact', 10)?.upTo).toBe(5);
  });

  it('gives a warlock one Mystic Arcanum level at each of 11, 13, 15 and 17', () => {
    expect(mysticArcanumLevels(10)).toEqual([]);
    expect(mysticArcanumLevels(11)).toEqual([6]);
    expect(mysticArcanumLevels(16)).toEqual([6, 7, 8]);
    expect(mysticArcanumLevels(20)).toEqual([6, 7, 8, 9]);
    // Set, even empty, on every pact caster, and on no other.
    expect(blocks(entry('Warlock', 13))[0]?.mysticArcanum).toEqual([6, 7]);
    expect(blocks(entry('Warlock', 2))[0]?.mysticArcanum).toEqual([]);
    expect(blocks(entry('Wizard', 13))[0]?.mysticArcanum).toBeUndefined();
  });

  it('holds nothing back when the data cannot say', () => {
    expect(learnableSpellLevels({ casterProgression: 'odd' }, 'odd', 5)).toBeUndefined();
  });
});
