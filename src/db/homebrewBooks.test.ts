import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/lib/guards';
import { bookHolders, bookKey, bookOf, bookParts, MAX_BOOKS, splitBooks } from './homebrewBooks';

const META = {
  sources: [
    { json: 'FCEmber', abbreviation: 'EC', full: 'Ember Codex' },
    { json: 'FCAsh', abbreviation: 'AT', full: 'Ashen Tome' },
    { json: 'FCEmpty', full: 'Empty Book' },
  ],
  convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' },
};

describe('splitBooks', () => {
  it('gives each book its own file, in the order the file declares them', () => {
    const parts = splitBooks({
      _meta: META,
      spell: [
        { name: 'Ash Bolt', source: 'FCAsh' },
        { name: 'Ember Lance', source: 'FCEmber' },
      ],
      feat: [{ name: 'Ember Heart', source: 'fcember' }],
    });
    expect(parts.map((p) => [p.sourceId, p.full])).toEqual([
      ['FCEmber', 'Ember Codex'],
      ['FCAsh', 'Ashen Tome'],
    ]);
    expect(parts[0]?.json).toEqual({
      _meta: { ...META, sources: [META.sources[0]] },
      spell: [{ name: 'Ember Lance', source: 'FCEmber' }],
      feat: [{ name: 'Ember Heart', source: 'fcember' }],
    });
    expect(parts[1]?.json).toEqual({
      _meta: { ...META, sources: [META.sources[1]] },
      spell: [{ name: 'Ash Bolt', source: 'FCAsh' }],
    });
  });

  it('keeps an entry of a book the file does not declare, in a book of its own', () => {
    const parts = splitBooks({ _meta: META, item: [{ name: 'Rope', source: 'Stray' }] });
    expect(parts).toEqual([
      {
        sourceId: 'Stray',
        full: 'Stray',
        json: {
          _meta: { ...META, sources: [{ json: 'Stray' }] },
          item: [{ name: 'Rope', source: 'Stray' }],
        },
      },
    ]);
  });

  it('gives values beside the entries to every book', () => {
    const parts = splitBooks({
      _meta: META,
      spell: [
        { name: 'Ash Bolt', source: 'FCAsh' },
        { name: 'Ember Lance', source: 'FCEmber' },
      ],
      note: 'shared',
    });
    expect(parts.map((p) => p.json.note)).toEqual(['shared', 'shared']);
  });

  it('refuses an entry whose book cannot be told', () => {
    expect(() => splitBooks({ _meta: META, spell: [{ name: 'Nowhere' }] })).toThrow(
      ValidationError,
    );
    expect(() => splitBooks({ _meta: META, spell: ['text'] })).toThrow(/names no source/);
  });
});

describe('bookKey', () => {
  it('is the one source a book holds, and nothing for a file of several', () => {
    expect(bookKey({ sourceIds: ['FCEmber'] })).toBe('fcember');
    expect(bookKey({ sourceIds: ['A', 'B'] })).toBeUndefined();
    expect(bookKey({ sourceIds: [] })).toBeUndefined();
  });
});

describe('bookParts', () => {
  const bookSubset = (json: Record<string, unknown>, refs: { name: string; source: string }[]) =>
    bookParts([json], refs)[0];
  const BOOK = {
    _meta: {
      sources: [{ json: 'FCEmber', full: 'Ember Codex' }],
      convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' },
    },
    race: [
      { name: 'Emberkin', source: 'FCEmber' },
      {
        name: 'Emberkin, Ashborn',
        source: 'FCEmber',
        _copy: { name: 'Emberkin', source: 'FCEmber' },
      },
    ],
    background: [
      { name: 'Ember Herald', source: 'FCEmber', feats: [{ 'ember fear|fcember': true }] },
    ],
    feat: [
      {
        name: 'Ember Fear',
        source: 'FCEmber',
        entries: ['You learn {@spell Ember Lance|FCEmber} and {@spell Fire Bolt}.'],
      },
      { name: 'Unused Feat', source: 'FCEmber' },
    ],
    spell: [
      { name: 'Ember Lance', source: 'FCEmber' },
      { name: 'Ember Ward', source: 'FCEmber' },
    ],
  };

  it('keeps what the character picked and what that needs from the book, in the book`s order', () => {
    const part = bookSubset(BOOK, [
      { name: 'Emberkin, Ashborn', source: 'FCEmber' },
      { name: 'ember herald', source: 'fcember' },
    ]);
    expect(part).toEqual({
      _meta: { ...BOOK._meta, convertedFrom: { ...BOOK._meta.convertedFrom, subset: true } },
      race: BOOK.race,
      background: BOOK.background,
      feat: [BOOK.feat[0]],
      spell: [BOOK.spell[0]],
    });
  });

  it('is nothing for a character that uses none of the book', () => {
    expect(bookSubset(BOOK, [{ name: 'Fire Bolt', source: 'PHB' }])).toBeUndefined();
  });

  it('follows a long chain of entries without going back over them', () => {
    const chain = Array.from({ length: 2000 }, (_, i) => ({
      name: `Step ${i}`,
      source: 'FCEmber',
      entries: [`{@feat Step ${i + 1}|FCEmber} {@feat Step 0|FCEmber}`],
    }));
    const part = bookSubset({ _meta: BOOK._meta, feat: chain }, [
      { name: 'Step 0', source: 'FCEmber' },
    ]);
    expect((part?.feat as unknown[]).length).toBe(2000);
  });

  it('follows what a part needs into another book, and leaves books it does not need', () => {
    const ash = {
      _meta: { sources: [{ json: 'FCAsh', full: 'Ashen Tome' }], convertedFrom: {} },
      background: [
        { name: 'Ash Walker', source: 'FCAsh', feats: [{ 'ember fear|fcember': true }] },
      ],
    };
    const stone = {
      _meta: { sources: [{ json: 'FCStone', full: 'Stone Book' }], convertedFrom: {} },
      feat: [{ name: 'Stone Skin', source: 'FCStone' }],
    };
    const [ashPart, emberPart, stonePart] = bookParts(
      [ash, BOOK, stone],
      [{ name: 'Ash Walker', source: 'FCAsh' }],
    );
    expect(ashPart?.background).toEqual(ash.background);
    // The feat, and the spell its text names, come from the other book.
    expect(emberPart?.feat).toEqual([BOOK.feat[0]]);
    expect(emberPart?.spell).toEqual([BOOK.spell[0]]);
    expect(emberPart?.background).toBeUndefined();
    expect(stonePart).toBeUndefined();
  });

  it('finds many entries of one name, each naming that name, without going back over them', () => {
    const same = Array.from({ length: 50_000 }, () => ({
      name: 'Echo',
      source: 'FCEmber',
      entries: ['{@feat Echo|FCEmber}'],
    }));
    const part = bookSubset({ _meta: BOOK._meta, feat: same }, [
      { name: 'Echo', source: 'FCEmber' },
    ]);
    expect((part?.feat as unknown[]).length).toBe(50_000);
  });
});

describe('splitBooks, past the most books a file is kept as', () => {
  it('refuses a file of more books than one import can keep', () => {
    const spell = Array.from({ length: MAX_BOOKS + 1 }, (_, i) => ({
      name: 'Bolt',
      source: `Book${i}`,
    }));
    expect(() => splitBooks({ _meta: META, spell })).toThrow(/1,001 books, more than the 1,000/);
    expect(splitBooks({ _meta: META, spell: spell.slice(1) })).toHaveLength(MAX_BOOKS);
  });
});

describe('bookOf', () => {
  it('names the book a converted file of one source holds, and says when it is a part', () => {
    const meta = (
      convertedFrom: unknown,
      sources = [{ json: 'FCEmber', full: 'Ember Codex' }],
    ) => ({
      _meta: { sources, ...(convertedFrom === undefined ? {} : { convertedFrom }) },
    });
    expect(bookOf(meta({ format: 'fc5-compendium' }))).toEqual({ book: 'Ember Codex' });
    expect(bookOf(meta({ subset: true }))).toEqual({ book: 'Ember Codex', subset: true });
    expect(bookOf(meta({}, [{ json: 'FCEmber' }] as never))).toEqual({ book: 'FCEmber' });
    // Homebrew written as homebrew, and a converted file of several books, are no book.
    expect(bookOf(meta(undefined))).toEqual({});
    expect(
      bookOf(
        meta({}, [
          { json: 'A', full: 'A' },
          { json: 'B', full: 'B' },
        ]),
      ),
    ).toEqual({});
  });
});

describe('a part of a book, against what is here', () => {
  const lance = { name: 'Ember Lance', source: 'FCEmber' };
  const ward = { name: 'Ember Ward', source: 'FCEmber' };
  const part = (spell: unknown[], sourceIds = ['FCEmber']) => ({
    sourceIds,
    subset: true as const,
    json: { _meta: {}, spell },
  });
  const whole = { id: 'whole', sourceIds: ['FCEmber'], json: { spell: [lance, ward] } };
  const stoneLance = { name: 'Ember Lance', source: 'FCStone' };
  const other = { id: 'other', sourceIds: ['Other', 'FCStone'], json: { spell: [stoneLance] } };
  const otherPart = { id: 'part', sourceIds: ['FCAsh'], subset: true as const, json: {} };

  it('defers to a whole book or any file declaring its source, never to another part', () => {
    const here = [whole, other, otherPart];
    expect(bookHolders(part([lance]), here)).toEqual([whole]);
    expect(bookHolders(part([stoneLance], ['FCStone']), here)).toEqual([other]);
    expect(bookHolders(part([], ['FCAsh']), here)).toEqual([]);
    // A whole book is never skipped for what is here.
    expect(bookHolders({ ...part([lance]), subset: undefined }, here)).toEqual([]);
  });

  it('is not here when the stored book lacks an entry of the part', () => {
    const older = { ...whole, json: { spell: [ward] } };
    expect(bookHolders(part([lance]), [older])).toEqual([]);
    // The same name in another kind of entry is not the entry.
    expect(bookHolders(part([lance]), [{ ...whole, json: { feat: [lance] } }])).toEqual([]);
  });
});
