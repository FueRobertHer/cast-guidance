import { describe, expect, it } from 'vitest';
import {
  COLLECTION_ID_KEY,
  collectionIdOf,
  collectionKey,
  compareMergeOrder,
  sameCollection,
  withCollectionId,
} from './homebrewOrder';

describe('compareMergeOrder', () => {
  it('puts the earliest import first and breaks a same-millisecond tie on the id', () => {
    const files = [
      { id: 'm', addedAt: 5 },
      { id: 'a', addedAt: 9 },
      { id: 'd', addedAt: 5 },
      { id: 'z', addedAt: 1 },
    ];
    expect(files.sort(compareMergeOrder).map((f) => f.id)).toEqual(['z', 'd', 'm', 'a']);
  });
});

describe('collectionKey and sameCollection (ADR-002, D4)', () => {
  it('keys a file by its link, else its first source and file name, and a book by its source', () => {
    const parts = { sourceIds: ['EMB', 'ASH'], fileName: 'Ember (1).json' };
    expect(collectionKey({ ...parts, url: ' https://x/e.json ' })).toBe('url:https://x/e.json');
    expect(collectionKey({ ...parts, url: ' ' })).toBe(collectionKey(parts));
    expect(collectionKey(parts)).toBe(collectionKey({ ...parts, fileName: 'ember.json' }));
    expect(collectionKey({ ...parts, url: 'https://x/e.json', book: 'Ember Book' })).toBe(
      collectionKey({ ...parts, book: 'Ember Book' }),
    );
  });

  it('keys a collection made in the app by its id, over its link and file, but not a book', () => {
    const parts = { sourceIds: ['MyHomebrew'], fileName: 'My_homebrew.json', made: 'id-1' };
    expect(collectionKey(parts)).toBe('made:id-1');
    expect(collectionKey({ ...parts, url: 'https://x/e.json' })).toBe('made:id-1');
    expect(collectionKey({ ...parts, sourceIds: ['EMB'] })).toBe('made:id-1');
    // Every book of a file has its `_meta`, so its id: a book is keyed as one.
    expect(collectionKey({ ...parts, book: 'My homebrew' })).toBe('book:myhomebrew|my_homebrew');
  });

  it('gives a file under the app’s own source with no id no key, so it lands beside', () => {
    for (const source of ['MyHomebrew', 'myhomebrew', 'MyChanges']) {
      expect(collectionKey({ sourceIds: [source], fileName: 'My_homebrew.json' })).toBeUndefined();
      expect(
        collectionKey({ sourceIds: [source], fileName: 'x.json', url: 'https://x/e.json' }),
      ).toBeUndefined();
    }
    // A source the player chose looks like anyone's: keyed by its file.
    expect(collectionKey({ sourceIds: ['HB', 'MyHomebrew'], fileName: 'Brew.json' })).toBe(
      'file:hb|brew',
    );
  });

  it('lets a stamped file take the place of a copy with no stamp under its link or file', () => {
    const parts = { sourceIds: ['HB'], fileName: 'Homebrew.json' };
    const stamped = (made: string, more: object = {}) => {
      const f = { ...parts, ...more, made };
      return { ...f, editable: false, key: collectionKey(f) };
    };
    const plain = (more: object = {}) => ({
      editable: false,
      key: collectionKey({ ...parts, ...more }),
    });
    expect(sameCollection(plain(), stamped('osk'))).toBe(true);
    expect(
      sameCollection(
        plain({ url: 'https://x/hb.json' }),
        stamped('osk', { url: 'https://x/hb.json' }),
      ),
    ).toBe(true);
    expect(sameCollection(plain({ fileName: 'Other.json' }), stamped('osk'))).toBe(false);
    // Two stamped copies are one collection by their stamp alone.
    expect(sameCollection(stamped('bram'), stamped('osk'))).toBe(false);
    expect(sameCollection(stamped('osk'), stamped('osk', { fileName: 'Renamed.json' }))).toBe(true);
    // Never the other way: a file with no stamp cannot be told from another player's.
    expect(sameCollection(stamped('osk'), { ...parts, ...plain() })).toBe(false);
    // Nor under the app's own sources, where a copy with no stamp has no key.
    const workshop = { sourceIds: ['MyHomebrew'], fileName: 'My_homebrew.json' };
    expect(
      sameCollection(
        { editable: false, key: collectionKey(workshop) },
        { ...workshop, editable: false, key: collectionKey({ ...workshop, made: 'osk' }) },
      ),
    ).toBe(false);
    // Nor a file the player owns.
    expect(sameCollection({ ...plain(), editable: true }, stamped('osk'))).toBe(false);
  });

  it('matches imported files of one key only, never a file the player owns', () => {
    const key = 'file:emb|ember';
    expect(sameCollection({ editable: false, key }, { editable: false, key })).toBe(true);
    expect(sameCollection({ editable: false, key }, { editable: false, key: `${key}2` })).toBe(
      false,
    );
    expect(sameCollection({ editable: false }, { editable: false })).toBe(false);
    // Even one carrying a key: no import writes over the player's own file.
    expect(sameCollection({ editable: true, key }, { editable: false, key })).toBe(false);
    expect(sameCollection({ editable: false, key }, { editable: true, key })).toBe(false);
  });
});

describe('collectionIdOf and withCollectionId', () => {
  const meta = { sources: [{ json: 'MyHomebrew' }] };

  it('reads the id a file is stamped with, and stamps one', () => {
    const json = withCollectionId({ _meta: meta, spell: [] }, 'id-1');
    expect(json).toEqual({ _meta: { ...meta, [COLLECTION_ID_KEY]: 'id-1' }, spell: [] });
    expect(collectionIdOf(json)).toBe('id-1');
    expect(collectionIdOf(withCollectionId(json, 'id-2'))).toBe('id-2');
  });

  it('reads anything else as no id: it comes in with imported files', () => {
    const stamp = (id: unknown) => ({ _meta: { ...meta, [COLLECTION_ID_KEY]: id } });
    for (const id of ['', '  ', 'x'.repeat(65), 7, null, ['id'], { id: 'id' }]) {
      expect(collectionIdOf(stamp(id))).toBeUndefined();
    }
    expect(collectionIdOf(stamp('x'.repeat(64)))).toBe('x'.repeat(64));
    expect(collectionIdOf({ _meta: Object.create({ [COLLECTION_ID_KEY]: 'id' }) })).toBeUndefined();
    expect(collectionIdOf({ _meta: 'id' })).toBeUndefined();
    expect(collectionIdOf(undefined)).toBeUndefined();
  });

  it('leaves a file with no `_meta` object as it is', () => {
    const json = { _meta: ['x'], spell: [] };
    expect(withCollectionId(json, 'id-1')).toBe(json);
  });
});
