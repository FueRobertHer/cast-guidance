import { describe, expect, it } from 'vitest';
import { summarizeEntries } from './summarize';

describe('summarizeEntries', () => {
  it('returns a plain string as-is and collapses whitespace', () => {
    expect(summarizeEntries('Hello   world')).toBe('Hello world');
  });

  it('strips {@tag body|args} down to the body', () => {
    expect(summarizeEntries('Deal {@damage 2d6|fire} to a target')).toBe('Deal 2d6 to a target');
    expect(summarizeEntries('See {@spell fireball|phb}.')).toBe('See fireball.');
  });

  it('drops bodyless tags', () => {
    expect(summarizeEntries('a {@hit} b')).toBe('a  b'.replace(/\s+/g, ' '));
  });

  it('digs the first string out of nested entries', () => {
    expect(summarizeEntries([{ entries: ['deep text'] }])).toBe('deep text');
    expect(summarizeEntries({ entry: 'inner' })).toBe('inner');
  });

  it('returns empty for no string content', () => {
    expect(summarizeEntries(undefined)).toBe('');
    expect(summarizeEntries([{ type: 'table' }])).toBe('');
  });

  it('truncates past the max length with an ellipsis', () => {
    const out = summarizeEntries('x'.repeat(300), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('reads a reference by its display text', () => {
    expect(summarizeEntries('Add your {@variantrule Proficiency|XPHB|Proficiency Bonus}.')).toBe(
      'Add your Proficiency Bonus.',
    );
    expect(summarizeEntries('Deal {@damage 2d6|fire} and {@condition prone||Prone}.')).toBe(
      'Deal 2d6 and Prone.',
    );
  });

  it('reads a tag inside a tag', () => {
    expect(summarizeEntries('nested {@b {@i x}|y} end')).toBe('nested x end');
    expect(summarizeEntries('nested bodyless {@b {@i}} end')).toBe('nested bodyless end');
    expect(summarizeEntries('{@a b|c}{@d e}{@f}')).toBe('be');
  });

  it('leaves a tag that never closes as text', () => {
    for (const text of [
      'unclosed {@spell fire and more',
      'unclosed then closed {@a b {@c d} tail',
      'pipe {@a |b {@c d|e} tail',
    ]) {
      expect(summarizeEntries(text, 1000), text).toBe(text);
    }
  });

  it('stays linear on a long run of unclosed tags', () => {
    // About eleven seconds for the old regex on a fast machine, and cubic in
    // the length: a homebrew string can be 200,000 characters. The budget
    // here is the test timeout.
    const text = '{@a b'.repeat(1200);
    expect(summarizeEntries(text, 1_000_000)).toBe(text);
  }, 2000);
});
