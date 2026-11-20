// The fields the class and subclass editors share (U5c): spells by class
// level with the keys around them kept, the table's spell columns made again
// only when the spellcasting changed, and the entry Save compares them with.
import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { EntityRegistry } from '@/data5e/normalize';
import {
  asByLevel,
  byLevelValues,
  levelSpells,
  levelSpellsOf,
  savedBefore,
  setFrom,
  spellGroupsFor,
} from './classFields';
import type { Json, WriteContext } from './editorTypes';

describe('spells by class level', () => {
  it('reads one list by level and writes it back around the keys it does not show', () => {
    const raw = [
      {
        ability: 'cha',
        known: { '3': ['light|xphb#c'] },
        prepared: { '5': ['aid|xphb'], '3': ['bless|xphb'] },
      },
    ];
    const read = levelSpells(raw);
    expect(read?.how).toBe('prepared');
    expect(read?.rows).toEqual([
      { level: 3, spells: ['bless|xphb'] },
      { level: 5, spells: ['aid|xphb'] },
    ]);
    if (read === undefined) throw new Error('unread');
    // Written back as it was, its keys where they were.
    expect(levelSpellsOf(read.how, read.rows, read.block)).toEqual(raw);
    expect(
      Object.keys((levelSpellsOf(read.how, read.rows, read.block) as Json[])[0] ?? {}),
    ).toEqual(['ability', 'known', 'prepared']);
    // The list emptied, the cantrips stay.
    expect(levelSpellsOf(read.how, [], read.block)).toEqual([
      { ability: 'cha', known: { '3': ['light|xphb#c'] } },
    ]);
    // Added to the list it chooses from instead (a patron's).
    expect(levelSpellsOf('expanded', read.rows, read.block)).toEqual([
      {
        ability: 'cha',
        known: { '3': ['light|xphb#c'] },
        expanded: { '3': ['bless|xphb'], '5': ['aid|xphb'] },
      },
    ]);
    expect(levelSpellsOf('prepared', [{ level: 1, spells: [' '] }])).toBeUndefined();
  });

  it('keeps what it cannot show: alternatives, both lists, spells by spell level', () => {
    expect(
      levelSpells([{ prepared: { '1': ['a'] } }, { prepared: { '1': ['b'] } }]),
    ).toBeUndefined();
    expect(levelSpells([{ prepared: { '1': ['a'] }, expanded: { '1': ['b'] } }])).toBeUndefined();
    expect(levelSpells([{ expanded: { s1: ['a'] } }])).toBeUndefined();
    expect(levelSpells([{ prepared: { '1': [{ choose: 'level=1' }] } }])).toBeUndefined();
    expect(levelSpells(undefined)).toEqual({ how: 'prepared', rows: [] });
  });
});

describe('numbers by level', () => {
  it('a level table as twenty values, and back as the levels it changes at', () => {
    const values = byLevelValues({ '2': 1, '5': 2, '11': 3 });
    expect(values.slice(0, 6)).toEqual([0, 1, 1, 1, 2, 2]);
    expect(asByLevel(values)).toEqual({ '2': 1, '5': 2, '11': 3 });
    // Set at 3: the levels after it with the same number follow it.
    expect(setFrom(values, 3, 4).slice(0, 6)).toEqual([0, 1, 4, 4, 2, 2]);
  });
});

describe("the table's spell columns", () => {
  const BOOK: Json = {
    casterProgression: '1/3',
    spellsKnownProgression: Array(20).fill(3),
    classTableGroups: [
      {
        colLabels: ['Psi Dice', 'Spells Known'],
        rows: Array.from({ length: 20 }, () => ['d6', 3]),
      },
      { title: 'Spell Slots per Spell Level', colLabels: ['1st'], rowsSpellProgression: [[2]] },
    ],
  };

  it('with nothing to compare with, keeps a slot table there and makes one where there is none', () => {
    const slots = (groups: Json[]) =>
      groups.find((g) => Array.isArray(g.rowsSpellProgression))?.rowsSpellProgression as
        | unknown[][]
        | undefined;
    expect(slots(spellGroupsFor(structuredClone(BOOK), undefined))).toEqual([[2]]);
    expect(slots(spellGroupsFor({ casterProgression: 'full' }, undefined))?.[0]).toEqual([
      2, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    // A count changed: the counts follow, the slots stay.
    const more = { ...structuredClone(BOOK), spellsKnownProgression: Array(20).fill(4) };
    const groups = spellGroupsFor(more, BOOK);
    expect(slots(groups)).toEqual([[2]]);
    expect((groups[0]?.rows as unknown[][])[0]).toEqual(['d6', 4]);
  });

  it('stays as it is while the spellcasting does', () => {
    const draft = structuredClone(BOOK);
    expect(spellGroupsFor(draft, BOOK)).toEqual(BOOK.classTableGroups);
  });

  it('follows a change: a column it no longer has goes, the book columns stay, the slots follow', () => {
    const pact = {
      ...structuredClone(BOOK),
      casterProgression: 'pact',
      spellsKnownProgression: undefined,
      preparedSpellsProgression: Array(20).fill(4),
    };
    const groups = spellGroupsFor(pact, BOOK);
    expect(groups[0]).toMatchObject({
      colLabels: ['Prepared Spells', 'Spell Slots', 'Slot Level'],
    });
    expect((groups[0]?.rows as unknown[][])[10]).toEqual([4, 3, '5th']);
    expect(groups[1]?.colLabels).toEqual(['Psi Dice']);
    expect((groups[1]?.rows as unknown[][])[0]).toEqual(['d6']);
    // Pact magic has no slot table by spell level.
    expect(groups.some((g) => Array.isArray(g.rowsSpellProgression))).toBe(false);
    // No spells: only the book's own column is left.
    expect(
      spellGroupsFor({ ...structuredClone(BOOK), casterProgression: undefined }, BOOK),
    ).toEqual([{ colLabels: ['Psi Dice'], rows: Array.from({ length: 20 }, () => ['d6']) }]);
  });
});

describe('the entry Save compares with', () => {
  const registry = new EntityRegistry();
  const mine = { name: 'Lantern', source: 'HB', casterProgression: '1/3' };
  registry.addAll('subclass', [mine as unknown as Entity]);
  const at = (patch: Partial<WriteContext>): WriteContext =>
    ({ draft: {}, source: 'HB', mode: 'full', registry, ...patch }) as WriteContext;

  it('is the one copied, else the one stored, else none', () => {
    const book = { name: 'Knight', source: 'XPHB' };
    expect(
      savedBefore(at({ copied: book, stored: { name: 'Lantern', source: 'HB' } }), 'subclass'),
    ).toBe(book);
    expect(savedBefore(at({ stored: { name: 'Lantern', source: 'HB' } }), 'subclass')).toBe(
      registry.get('subclass', 'Lantern', 'HB'),
    );
    expect(savedBefore(at({}), 'subclass')).toBeUndefined();
  });
});
