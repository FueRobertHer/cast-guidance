import { describe, expect, it } from 'vitest';
import { bookCode, bookSource, codeEdition, readSourceLine } from './books';

describe('bookCode', () => {
  it('finds a title the app knows, in any case and with any quotes', () => {
    expect(bookCode("Xanathar's Guide to Everything")).toBe('XGE');
    expect(bookCode('XANATHAR’S GUIDE TO EVERYTHING')).toBe('XGE');
  });

  it('reads the titles Fight Club writes its own way', () => {
    expect(bookCode("Player's Handbook")).toBe('PHB');
    expect(bookCode("Player's Handbook (2014)")).toBe('PHB');
    expect(bookCode("Dungeon Master's Guide 2025")).toBe('XDMG');
  });

  it('reads a book named by its series', () => {
    expect(bookCode("Spelljammer: Adventures in Space - Astral Adventurer's Guide")).toBe('AAG');
    expect(bookCode('Curse of Strahd: Optional Backgrounds')).toBe('CoS');
  });

  it('reads a code or a title written without its apostrophe', () => {
    expect(bookCode('XGE')).toBe('XGE');
    expect(bookCode('Xanathars Guide to Everything')).toBe('XGE');
  });

  it('knows no third-party book', () => {
    expect(bookCode('The Ember Codex')).toBeUndefined();
    expect(bookCode('Ember Codex: Volume 2')).toBeUndefined();
  });
});

describe('readSourceLine', () => {
  it('reads each book with its page, the entry`s own first', () => {
    expect(readSourceLine("Xanathar's Guide to Everything p. 150, Ember Codex page 12")).toEqual([
      { title: "Xanathar's Guide to Everything", page: 150, code: 'XGE' },
      { title: 'Ember Codex', page: 12 },
    ]);
  });

  it('reads the ways a page is written', () => {
    expect(readSourceLine('Ember Codex p.7')).toEqual([{ title: 'Ember Codex', page: 7 }]);
    expect(readSourceLine('Ember Codex pg. 35-36')).toEqual([{ title: 'Ember Codex', page: 35 }]);
    expect(readSourceLine('Ember Codex')).toEqual([{ title: 'Ember Codex' }]);
  });

  it('gives a page alone to the book before it', () => {
    expect(readSourceLine("Player's Handbook, p. 213")).toEqual([
      { title: "Player's Handbook", page: 213, code: 'PHB' },
    ]);
  });

  it('keeps a comma inside a title whose part has no page', () => {
    expect(readSourceLine('Ember Codex, Revised p. 5')).toEqual([
      { title: 'Ember Codex, Revised', page: 5 },
    ]);
  });

  it('drops the tag Fight Club gives a book that is not official', () => {
    expect(readSourceLine('Ember Codex p. 30 (Indie)')).toEqual([
      { title: 'Ember Codex', page: 30 },
    ]);
    expect(readSourceLine('Ember Codex (Third Party)')).toEqual([{ title: 'Ember Codex' }]);
  });

  it('reads nothing from a line with no title', () => {
    expect(readSourceLine('  ,  . ')).toEqual([]);
  });

  it('reads a book before a trailing comma', () => {
    expect(readSourceLine('Ember Codex,')).toEqual([{ title: 'Ember Codex' }]);
  });

  it('ends a title at a kind tag or before a title the app knows', () => {
    expect(readSourceLine('Ember Codex (Homebrew), Ash Almanac')).toEqual([
      { title: 'Ember Codex' },
      { title: 'Ash Almanac' },
    ]);
    expect(readSourceLine("Ember Codex, Xanathar's Guide to Everything")).toEqual([
      { title: 'Ember Codex' },
      { title: "Xanathar's Guide to Everything", code: 'XGE' },
    ]);
  });

  it('marks a free rules text, and reads no title from a line that runs on', () => {
    expect(readSourceLine('System Reference Document 5.1 p. 2')).toEqual([
      { title: 'System Reference Document 5.1', page: 2, reference: true },
    ]);
    expect(readSourceLine(`Ember Codex${'x'.repeat(200)}`)).toEqual([]);
  });

  it('marks SRD with its version run on, but not a game`s own SRD', () => {
    expect(readSourceLine('SRD5.1 p. 3')).toEqual([{ title: 'SRD5.1', page: 3, reference: true }]);
    expect(readSourceLine('Ember Codex SRD')).toEqual([{ title: 'Ember Codex SRD' }]);
  });
});

describe('codeEdition', () => {
  it('reads the edition from the code, or from the books the data marks 2024', () => {
    expect(codeEdition('XPHB', undefined)).toBe('2024');
    expect(codeEdition('XGE', undefined)).toBe('2014');
    expect(codeEdition('XGE', new Set(['XGE']))).toBe('2024');
  });
});

describe('bookSource', () => {
  it('names the source after the book', () => {
    expect(bookSource('Ember Codex', false)).toEqual({
      json: 'FCEmberCodex',
      abbreviation: 'EC',
      full: 'Ember Codex',
    });
  });

  it('gives 2024 entries of a book of unknown edition a source of their own', () => {
    expect(bookSource('Ember Codex', true)).toEqual({
      json: 'FCEmberCodex2024',
      abbreviation: 'EC24',
      full: 'Ember Codex (2024)',
    });
  });

  it('cuts a long id short and keeps it unique', () => {
    const a = bookSource('The Very Long Ember Codex of Everything Ever Written, Volume One', false);
    const b = bookSource('The Very Long Ember Codex of Everything Ever Written, Volume Two', false);
    expect(a.json.length).toBeLessThanOrEqual(42);
    expect(a.json).not.toBe(b.json);
  });

  it('gives the same book the same source every time', () => {
    expect(bookSource('Ember Codex', false)).toEqual(bookSource('Ember Codex', false));
  });
});
