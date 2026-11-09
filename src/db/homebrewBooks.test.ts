import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/lib/guards';
import {
  bookHolders,
  bookKey,
  bookOf,
  bookParts,
  fileKey,
  MAX_BOOKS,
  mergeBook,
  oldWholeImports,
  sameBookCopy,
  splitBooks,
} from './homebrewBooks';

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

  it('finds many entries all naming one entry without going back over it', () => {
    const many = Array.from({ length: 50_000 }, (_, i) => ({
      name: `Echo ${i}`,
      source: 'FCEmber',
      entries: ['{@feat Echo 0|FCEmber}', `{@feat Echo ${i + 1}|FCEmber}`],
    }));
    const part = bookSubset({ _meta: BOOK._meta, feat: many }, [
      { name: 'Echo 0', source: 'FCEmber' },
    ]);
    expect((part?.feat as unknown[]).length).toBe(50_000);
  });

  it('takes an entry two copies of a book hold from the first copy only, as the app uses it', () => {
    const copy = (fileName: string, text: string) => ({
      _meta: { ...BOOK._meta, convertedFrom: { fileName } },
      spell: [{ name: 'Ember Lance', source: 'FCEmber', entries: [text] }],
    });
    const [first, second] = bookParts(
      [copy('five.xml', 'first'), copy('six.xml', 'second')],
      [{ name: 'Ember Lance', source: 'FCEmber' }],
    );
    expect(first?.spell).toEqual([{ name: 'Ember Lance', source: 'FCEmber', entries: ['first'] }]);
    expect(second).toBeUndefined();
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

describe('a book coming in, against what is here', () => {
  const lance = { name: 'Ember Lance', source: 'FCEmber' };
  const ward = { name: 'Ember Ward', source: 'FCEmber' };
  const part = (spell: unknown[], sourceIds = ['FCEmber']) => ({
    sourceIds,
    fileName: 'all.xml',
    book: 'Ember Codex',
    subset: true as const,
    json: { _meta: {}, spell },
  });
  const whole = {
    id: 'whole',
    sourceIds: ['FCEmber'],
    fileName: 'other.xml',
    book: 'Ember Codex',
    json: { spell: [lance, ward] },
  };
  const stoneLance = { name: 'Ember Lance', source: 'FCStone' };
  const other = {
    id: 'other',
    sourceIds: ['Other', 'FCStone'],
    fileName: 'other.json',
    json: { spell: [stoneLance] },
  };

  it('defers to every copy of the book here, from any file, and any file declaring its source', () => {
    const here = [whole, other];
    expect(bookHolders(part([lance]), here)).toEqual([whole]);
    expect(bookHolders(part([stoneLance], ['FCStone']), here)).toEqual([other]);
    // A whole book whose every entry is here adds nothing either.
    expect(bookHolders({ ...part([lance]), subset: undefined }, here)).toEqual([whole]);
    // Two parts here hold between them what a third needs.
    const lancePart = { ...part([lance]), id: 'a' };
    const wardPart = { ...part([ward]), id: 'b' };
    expect(bookHolders(part([lance, ward]), [lancePart, wardPart])).toEqual([lancePart, wardPart]);
    // A file that is no book is never skipped for what is here.
    expect(bookHolders({ ...part([lance]), book: undefined }, here)).toEqual([]);
  });

  it('is not here when the stored book lacks an entry of it', () => {
    const older = { ...whole, json: { spell: [ward] } };
    expect(bookHolders(part([lance]), [older])).toEqual([]);
    // The same name in another kind of entry is not the entry.
    expect(bookHolders(part([lance]), [{ ...whole, json: { feat: [lance] } }])).toEqual([]);
  });
});

describe('fileKey and sameBookCopy', () => {
  it('names a file the same however it was saved', () => {
    expect(fileKey('Complete.xml')).toBe('complete');
    expect(fileKey('C:\\Downloads\\Complete (1).xml')).toBe('complete');
    expect(fileKey('complete.json')).toBe('complete');
    expect(fileKey('Complete (Fight Club 5e)')).toBe('complete (fight club 5e)');
    expect(fileKey('Complete_Compendium_5.5e.xml')).toBe('complete_compendium_5.5e');
  });

  it('is one copy for one book from one file', () => {
    const copy = { sourceIds: ['FCEmber'], fileName: 'all.xml', book: 'Ember Codex' };
    expect(sameBookCopy(copy, { ...copy, fileName: 'All (2).xml', subset: true })).toBe(true);
    expect(sameBookCopy(copy, { ...copy, fileName: 'other.xml' })).toBe(false);
    expect(sameBookCopy(copy, { ...copy, sourceIds: ['FCAsh'] })).toBe(false);
    expect(sameBookCopy(copy, { ...copy, book: undefined })).toBe(false);
  });
});

describe('mergeBook', () => {
  const meta = (subset?: true) => ({
    sources: [{ json: 'FCEmber', full: 'Ember Codex' }],
    convertedFrom: { fileName: 'all.xml', ...(subset ? { subset } : {}) },
  });
  const lance = (text: string) => ({ name: 'Ember Lance', source: 'FCEmber', entries: [text] });
  const heart = { name: 'Ember Heart', source: 'FCEmber' };

  it('keeps what is stored and takes in what it lacks, once', () => {
    const { json, added } = mergeBook(
      { _meta: meta(true), feat: [heart] },
      { _meta: meta(true), feat: [heart], spell: [lance('incoming')] },
    );
    expect(added).toBe(1);
    expect(json).toEqual({ _meta: meta(true), feat: [heart], spell: [lance('incoming')] });
  });

  it('lets the stored copy win an entry both hold', () => {
    const { json, added } = mergeBook(
      { _meta: meta(true), spell: [lance('stored')] },
      { _meta: meta(true), spell: [lance('incoming')] },
    );
    expect(added).toBe(0);
    expect(json.spell).toEqual([lance('stored')]);
  });

  it('makes a part whole when the whole book comes in, and leaves a whole book whole', () => {
    const whole = mergeBook({ _meta: meta(true), feat: [heart] }, { _meta: meta(), feat: [heart] });
    expect(bookOf(whole.json)).toEqual({ book: 'Ember Codex' });
    const still = mergeBook({ _meta: meta(), feat: [heart] }, { _meta: meta(true), feat: [heart] });
    expect(bookOf(still.json)).toEqual({ book: 'Ember Codex' });
  });

  it('does not change the stored copy it reads', () => {
    const stored = { _meta: meta(true), feat: [heart] };
    mergeBook(stored, {
      _meta: meta(true),
      spell: [lance('x')],
      feat: [{ ...heart, name: 'Other' }],
    });
    expect(stored.feat).toEqual([heart]);
  });
});

describe('mergeBook and another book`s entries', () => {
  it('takes in only entries of the book itself', () => {
    const meta = { sources: [{ json: 'FCEmber', full: 'Ember Codex' }] };
    const stored = { _meta: meta, spell: [{ name: 'Ember Ward', source: 'FCEmber' }] };
    const { json, added } = mergeBook(stored, {
      _meta: meta,
      spell: [
        { name: 'Ember Lance', source: 'fcember' },
        { name: 'Zap', source: 'OTHER' },
      ],
    });
    expect(added).toBe(1);
    expect((json.spell as { name: string }[]).map((e) => e.name)).toEqual([
      'Ember Ward',
      'Ember Lance',
    ]);
  });
});

describe('oldWholeImports', () => {
  const legacy = (fileName: string, extra: Record<string, unknown> = {}) => ({
    id: fileName,
    sourceIds: ['FCComplete'],
    fileName,
    json: {
      _meta: {
        sources: [{ json: 'FCComplete' }],
        convertedFrom: { format: 'fc5-compendium', fileName, ...extra },
      },
    },
  });

  it('finds the same file converted whole, however it was saved', () => {
    const here = [legacy('Complete.xml'), legacy('Other.xml')];
    expect(oldWholeImports('Complete (1).xml', here).map((f) => f.id)).toEqual(['Complete.xml']);
  });

  it('finds it stored whole with a source per book, as it was before books were rows', () => {
    const several = { ...legacy('Complete.xml'), sourceIds: ['FCEmber', 'FCAsh'] };
    expect(oldWholeImports('Complete.xml', [several]).map((f) => f.id)).toEqual(['Complete.xml']);
    expect(oldWholeImports('Other.xml', [several])).toEqual([]);
  });

  it('leaves a book, a part and homebrew written by hand', () => {
    expect(oldWholeImports('Complete.xml', [{ ...legacy('Complete.xml'), book: 'X' }])).toEqual([]);
    expect(oldWholeImports('Complete.xml', [legacy('Complete.xml', { subset: true })])).toEqual([]);
    expect(
      oldWholeImports('Complete.xml', [{ ...legacy('Complete.xml'), json: { _meta: {} } }]),
    ).toEqual([]);
  });
});
