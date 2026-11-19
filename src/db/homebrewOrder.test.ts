import { describe, expect, it } from 'vitest';
import { collectionKey, compareMergeOrder, sameCollection } from './homebrewOrder';

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
