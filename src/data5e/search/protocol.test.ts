import { describe, expect, it } from 'vitest';
import {
  clampDocs,
  clampLimit,
  clampQuery,
  MAX_DOC_NAME_LENGTH,
  MAX_INDEX_DOCS,
  MAX_QUERY_LENGTH,
  MAX_QUERY_LIMIT,
  MAX_QUERY_TERMS,
  pageAllowedHits,
  type SearchDoc,
} from './protocol';

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

describe('clampQuery', () => {
  it('leaves an ordinary query alone', () => {
    expect(clampQuery('fire bolt')).toBe('fire bolt');
  });

  it('cuts the length and keeps the leading terms', () => {
    const q = clampQuery('x'.repeat(10_000));
    expect(q).toHaveLength(MAX_QUERY_LENGTH);
    expect(clampQuery('a b c d e f g h i j k')).toBe('a b c d e f g h');
    expect(clampQuery(' a   b ').split(' ')).toEqual(['a', 'b']);
    expect(MAX_QUERY_TERMS).toBe(8);
  });
});

describe('clampLimit', () => {
  it('defaults, floors and bounds the result count', () => {
    expect(clampLimit(undefined)).toBe(30);
    expect(clampLimit(Number.NaN)).toBe(30);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(12.7)).toBe(12);
    expect(clampLimit(1e9)).toBe(MAX_QUERY_LIMIT);
  });
});

describe('clampDocs', () => {
  it('caps the doc count and cuts long names, leaving ids whole', () => {
    const docs = Array.from({ length: MAX_INDEX_DOCS + 5 }, (_, i) => doc(i, 'PHB'));
    const long = { ...doc(0, 'PHB'), name: 'n'.repeat(MAX_DOC_NAME_LENGTH + 50) };
    const out = clampDocs([long, ...docs]);
    expect(out).toHaveLength(MAX_INDEX_DOCS);
    expect(out[0]?.name).toHaveLength(MAX_DOC_NAME_LENGTH);
    expect(out[0]?.uid).toBe(long.uid);
    // An unchanged doc is passed through as is.
    expect(out[1]).toBe(docs[0]);
  });
});
