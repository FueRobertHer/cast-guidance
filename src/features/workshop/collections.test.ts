// The Collections shelf's grouping (ADR-002, D1): a file is one collection,
// the books one compendium was stored as are one together, and any book's id
// finds the collection.
import { describe, expect, it } from 'vitest';
import type { HomebrewFileMeta } from '@/db/homebrewRepo';
import { collectionsOf, collectionWith, holdsOf, madeName } from './collections';

const row = (id: string, over: Partial<HomebrewFileMeta> = {}): HomebrewFileMeta => ({
  id,
  fileName: `${id}.json`,
  enabled: true,
  editable: false,
  sourceIds: [id.toUpperCase()],
  counts: { spell: 1 },
  addedAt: 0,
  ...over,
});

describe('collectionsOf', () => {
  const rows = [
    row('a', { fileName: 'all.xml', book: 'Ember Codex', counts: { spell: 2 } }),
    row('mine', { editable: true, counts: {} }),
    row('b', { fileName: 'all (1).xml', book: 'Frost Codex', enabled: false }),
    row('link', { url: 'https://example.com/brew.json' }),
    row('part', { fileName: 'old.xml', book: 'Old Codex', subset: true }),
  ];

  it('keeps a compendium together where its newest book falls, by the file it came from', () => {
    const out = collectionsOf(rows, new Map([['mine', 'My homebrew']]));
    expect(out.map((c) => [c.id, c.name, c.from, c.rows.length, holdsOf(c)])).toEqual([
      ['a', 'all.xml', 'A compendium of 2 books', 2, '3 entries. 1 of 2 books on'],
      ['mine', 'My homebrew', 'Yours. Made in this app', 1, 'Empty. On'],
      ['link', 'link.json', 'A homebrew file, from a link', 1, '1 entry. On'],
      ['part', 'Old Codex', 'Part of a book, what a character brought', 1, '1 entry. On'],
    ]);
  });

  it('finds the collection from any of its books', () => {
    expect(collectionWith('b', rows)?.id).toBe('a');
    expect(collectionWith('gone', rows)).toBeUndefined();
  });

  it('says a collection turned off is off', () => {
    const [c] = collectionsOf([row('x', { enabled: false, counts: { feat: 3, spell: 2 } })]);
    expect(c === undefined ? '' : holdsOf(c)).toBe('5 entries. Off');
  });
});

describe('madeName', () => {
  it("reads the name the player gave the file's book, and nothing else", () => {
    expect(madeName({ _meta: { sources: [{ json: 'HB', full: 'Lantern Coast' }] } })).toBe(
      'Lantern Coast',
    );
    expect(madeName({ _meta: { sources: [{ json: 'HB', full: ' ' }] } })).toBeUndefined();
    expect(madeName({})).toBeUndefined();
  });
});
