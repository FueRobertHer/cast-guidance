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
});
