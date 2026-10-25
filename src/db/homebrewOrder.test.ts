import { describe, expect, it } from 'vitest';
import { compareMergeOrder } from './homebrewOrder';

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
