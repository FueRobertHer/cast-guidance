import { describe, expect, it } from 'vitest';
import { pageAllowedHits, type SearchDoc } from './protocol';

const doc = (n: number, source: string): SearchDoc => ({
  id: `spell:s${n}|${source}`.toLowerCase(),
  type: 'spell',
  uid: `s${n}|${source}`.toLowerCase(),
  name: `Spell ${n}`,
  source,
});

/** 30 hidden-source hits ranked above 5 allowed ones. */
const ranked: SearchDoc[] = [
  ...Array.from({ length: 30 }, (_, i) => doc(i, 'TCE')),
  ...Array.from({ length: 5 }, (_, i) => doc(100 + i, 'XPHB')),
];

describe('pageAllowedHits', () => {
  it('returns the first page untouched when nothing is filtered', () => {
    const { hits, hiddenCount } = pageAllowedHits(ranked, undefined, 30);
    expect(hits).toHaveLength(30);
    expect(hits[0]?.source).toBe('TCE');
    expect(hiddenCount).toBe(0);
  });

  it('filters the whole ranked list, not just the first page', () => {
    // The regression this exists for: with the filter applied after truncation
    // the top 30 are all hidden, so the user sees zero results even though five
    // perfectly good matches sit at ranks 31-35.
    const { hits, hiddenCount } = pageAllowedHits(ranked, { mode: 'only', sources: ['XPHB'] }, 30);
    expect(hits).toHaveLength(5);
    expect(hits.every((h) => h.source === 'XPHB')).toBe(true);
    expect(hiddenCount).toBe(30);
  });

  it('honors a block list the same way', () => {
    const { hits } = pageAllowedHits(ranked, { mode: 'all', except: ['TCE'] }, 30);
    expect(hits).toHaveLength(5);
    expect(hits.every((h) => h.source === 'XPHB')).toBe(true);
  });

  it('still caps the page at the limit', () => {
    const { hits } = pageAllowedHits(ranked, { mode: 'all', except: [] }, 10);
    expect(hits).toHaveLength(10);
  });

  it('caps the hidden count too, so the UI never promises thousands', () => {
    const many = Array.from({ length: 500 }, (_, i) => doc(i, 'TCE'));
    const { hits, hiddenCount } = pageAllowedHits(many, { mode: 'only', sources: ['XPHB'] }, 30);
    expect(hits).toEqual([]);
    expect(hiddenCount).toBe(30);
  });

  it('copies hits rather than passing the ranked entries through', () => {
    const { hits } = pageAllowedHits(ranked, undefined, 1);
    // MiniSearch results carry a score and other internals; only the doc shape
    // should cross the worker boundary.
    expect(Object.keys(hits[0] ?? {}).sort()).toEqual(['id', 'name', 'source', 'type', 'uid']);
  });
});
