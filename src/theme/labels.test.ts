import { describe, expect, it } from 'vitest';
import { followsLabel, TOKEN_LABELS } from './labels';
import { VOCABULARY } from './vocabulary';

describe('token names in the editor', () => {
  it('names every token, and only tokens', () => {
    expect(VOCABULARY.filter((t) => TOKEN_LABELS[t.name] === undefined).map((t) => t.name)).toEqual(
      [],
    );
    const names = new Set(VOCABULARY.map((t) => t.name));
    expect(Object.keys(TOKEN_LABELS).filter((n) => !names.has(n))).toEqual([]);
  });

  it('calls the page the page', () => {
    expect(followsLabel('bg')).toBe('the page');
    expect(followsLabel('brand')).toBe('Action');
  });
});
