import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import type { EntityRegistry, EntityType } from '@/data5e/normalize';
import { bookContents, bookIndex } from './books';

describe('bookContents', () => {
  it('reads chapters, their ordinals, and their headers', () => {
    const book = {
      contents: [
        { name: 'Step-by-Step Characters', ordinal: { type: 'chapter', identifier: 1 } },
        {
          name: 'Conditions',
          ordinal: { type: 'appendix', identifier: 'A' },
          headers: ['Blinded', { header: 'Charmed' }],
        },
      ],
    } as unknown as Entity;

    expect(bookContents(book)).toEqual([
      {
        id: 'Chapter 1|Step-by-Step Characters',
        ordinal: 'Chapter 1',
        name: 'Step-by-Step Characters',
        headers: [],
      },
      {
        id: 'Appendix A|Conditions',
        ordinal: 'Appendix A',
        name: 'Conditions',
        headers: ['Blinded', 'Charmed'],
      },
    ]);
  });

  it('labels an ordinal that has a type but no number, which is what the ids are for', () => {
    // Two unnumbered appendices in one book is the case `BookChapter.id`
    // exists to survive.
    const book = {
      contents: [
        { name: 'Creatures', ordinal: { type: 'appendix' } },
        { name: 'Creatures', ordinal: { type: 'appendix' } },
      ],
    } as unknown as Entity;
    const chapters = bookContents(book);
    expect(chapters.map((c) => c.ordinal)).toEqual(['Appendix', 'Appendix']);
    expect(new Set(chapters.map((c) => c.id)).size).toBe(2);
  });

  it('titles an ordinal type it has never heard of rather than dropping it', () => {
    const book = {
      contents: [{ name: 'The Cards', ordinal: { type: 'insert', identifier: 2 } }],
    } as unknown as Entity;
    expect(bookContents(book)[0]?.ordinal).toBe('Insert 2');
  });

  it('keeps a chapter whose ordinal is missing or malformed', () => {
    const book = {
      contents: [{ name: 'Introduction' }, { name: 'Foreword', ordinal: 'chapter 1' }],
    } as unknown as Entity;
    expect(bookContents(book).map((c) => [c.name, c.ordinal])).toEqual([
      ['Introduction', undefined],
      ['Foreword', undefined],
    ]);
  });

  it('gives repeated chapters distinct ids, because they are list keys', () => {
    const book = {
      contents: [{ name: 'Creatures' }, { name: 'Creatures' }],
    } as unknown as Entity;
    const ids = bookContents(book).map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('is tolerant of anything that is not a chapter list', () => {
    expect(bookContents({} as Entity)).toEqual([]);
    expect(bookContents({ contents: 'nope' } as unknown as Entity)).toEqual([]);
    expect(bookContents({ contents: [null, 7, { headers: ['x'] }] } as unknown as Entity)).toEqual(
      [],
    );
  });
});

/** Just the two methods `bookIndex` reads. */
function registryOf(byType: Partial<Record<EntityType, Entity[]>>): EntityRegistry {
  return {
    byType: (type: EntityType) => byType[type] ?? [],
  } as unknown as EntityRegistry;
}

describe('bookIndex', () => {
  it("counts a book's entries per section, in the library's own order", () => {
    const reg = registryOf({
      spell: [
        { name: 'Fireball', source: 'PHB' },
        { name: 'Shield', source: 'PHB' },
        { name: 'Toll the Dead', source: 'XGE' },
      ] as Entity[],
      feat: [{ name: 'Alert', source: 'PHB' }] as Entity[],
    });

    expect(bookIndex(reg, 'PHB')).toEqual([
      { type: 'feat', label: 'Feats', count: 1 },
      { type: 'spell', label: 'Spells', count: 2 },
    ]);
  });

  it('drops empty sections rather than offering a link to nothing', () => {
    const reg = registryOf({ spell: [{ name: 'Fireball', source: 'PHB' }] as Entity[] });
    expect(bookIndex(reg, 'XGE')).toEqual([]);
  });

  it('matches source codes case-insensitively, as the rest of the app does', () => {
    const reg = registryOf({ item: [{ name: 'Rope', source: 'phb' }] as Entity[] });
    expect(bookIndex(reg, 'PHB')).toEqual([{ type: 'item', label: 'Items', count: 1 }]);
  });

  it('never lists books, which would only lead back to this page', () => {
    const reg = registryOf({
      book: [{ name: "Player's Handbook", source: 'PHB' }] as Entity[],
    });
    expect(bookIndex(reg, 'PHB')).toEqual([]);
  });
});
