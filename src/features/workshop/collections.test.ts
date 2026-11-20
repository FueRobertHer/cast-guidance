// The Collections shelf's grouping (ADR-002, D1): a file is one collection,
// the books one compendium was stored as are one together, and so are
// copies of one key. A collection's address outlives an update (D4), and any
// of its rows' ids or keys finds it.
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
      ['books:all', 'all.xml', 'A compendium of 2 books', 2, '3 entries. 1 of 2 books on'],
      ['mine', 'My homebrew', 'Yours. Made in this app', 1, 'Empty. On'],
      ['link', 'link.json', 'A homebrew file, from a link', 1, '1 entry. On'],
      ['books:old', 'Old Codex', 'Part of a book, what a character brought', 1, '1 entry. On'],
    ]);
  });

  it('finds the collection from any of its books', () => {
    expect(collectionWith('b', rows)?.id).toBe('books:all');
    expect(collectionWith('a', rows)?.id).toBe('books:all');
    expect(collectionWith('books:all', rows)?.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(collectionWith('gone', rows)).toBeUndefined();
  });

  it('addresses an imported file by its key, which an update keeps, and by its id before', () => {
    const key = 'url:https://example.com/brew.json';
    const before = [row('h1', { key }), row('mine', { editable: true })];
    // An update lands the new content under a new id and the same key (E1).
    const after = [row('h2', { key }), row('mine', { editable: true })];
    expect(collectionsOf(before).map((c) => c.id)).toEqual([key, 'mine']);
    expect(collectionWith(key, after)?.rows.map((r) => r.id)).toEqual(['h2']);
    expect(collectionWith('h1', before)?.id).toBe(key);
    expect(collectionWith('mine', after)?.id).toBe('mine');
  });

  it('keeps copies of one key together as one collection, with one address', () => {
    const key = 'file:imp|imported';
    const copies = [
      row('new', { key, counts: { feat: 2 } }),
      row('old', { key, enabled: false, counts: { feat: 1 } }),
      row('other'),
    ];
    const out = collectionsOf(copies);
    expect(out.map((c) => c.id)).toEqual([key, 'other']);
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
    const [c] = out;
    expect(c === undefined ? [] : [c.from, holdsOf(c)]).toEqual([
      'A homebrew file, 2 copies here',
      '2 entries. 1 of 2 copies on',
    ]);
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

describe('collectionWith', () => {
  it('finds a collection by the link it came from, whatever its key now', () => {
    const link = 'https://example.com/brew.json';
    const stamped = row('new', { key: 'made:abc', url: link, fileName: 'brew.json' });
    expect(collectionWith(`url:${link}`, [stamped])?.id).toBe('made:abc');
    expect(collectionWith('url:https://example.com/other.json', [stamped])).toBeUndefined();
  });
});
