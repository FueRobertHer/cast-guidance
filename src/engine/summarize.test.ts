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

  it('reads tags exactly as the regex it replaced did', () => {
    const legacy = (text: string) =>
      text
        .replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1')
        .replace(/\{@\w+\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    for (const text of [
      'Deal {@damage 2d6|fire} and {@condition prone||Prone}.',
      'nested {@b {@i x}|y} end',
      'nested bodyless {@b {@i}} end',
      'empty {@tag } and {@tag |x} bodies',
      'no name {@ x} and {@:x} here',
      'unclosed {@spell fire and more',
      'unclosed then closed {@a b {@c d} tail',
      'pipe {@a |b {@c d|e} tail',
      'brace after {@a b}} and {@hit}',
      '{@a b|c}{@d e}{@f}',
    ]) {
      expect(summarizeEntries(text, 1000), text).toBe(legacy(text));
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
