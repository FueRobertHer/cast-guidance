// The read boundary for stored homebrew (REL-006), as a pure function. What it
// refuses and what it repairs, and why, is documented on `readHomebrewRow`.
import { describe, expect, it } from 'vitest';
import { partitionHomebrewRows } from './homebrewRepo';

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'abc',
    fileName: 'brews.json',
    json: { _meta: { sources: [{ json: 'HB' }] } },
    enabled: true,
    editable: false,
    sourceIds: ['HB'],
    counts: { spell: 2 },
    addedAt: 10,
    ...over,
  };
}

describe('partitionHomebrewRows keeps a good row intact', () => {
  it('passes every field through', () => {
    const { files, errors } = partitionHomebrewRows([row({ url: 'https://x/y.json', rev: 3 })]);
    expect(errors).toEqual([]);
    expect(files[0]).toEqual({
      id: 'abc',
      fileName: 'brews.json',
      url: 'https://x/y.json',
      json: { _meta: { sources: [{ json: 'HB' }] } },
      enabled: true,
      editable: false,
      sourceIds: ['HB'],
      counts: { spell: 2 },
      addedAt: 10,
      rev: 3,
    });
  });
});

describe('partitionHomebrewRows refuses what cannot be used', () => {
  it('refuses a row whose content is not a JSON object', () => {
    // The refusal that matters: this row used to throw out of getRegistry().
    for (const json of [null, undefined, 7, 'text', [1, 2]]) {
      const { files, errors } = partitionHomebrewRows([row({ json })]);
      expect(files).toEqual([]);
      expect(errors[0]?.message).toContain('not a JSON object');
      expect(errors[0]?.id).toBe('abc');
      expect(errors[0]?.fileName).toBe('brews.json');
    }
  });

  it('refuses a row with no id, since no write could address it', () => {
    const { files, errors } = partitionHomebrewRows([row({ id: undefined }), row({ id: '' })]);
    expect(files).toEqual([]);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.message).toContain('no id');
    expect(errors[0]?.fileName).toBe('brews.json');
  });

  it('refuses a stored value that is not a row at all', () => {
    const { files, errors } = partitionHomebrewRows([null, 'nonsense', 42, []]);
    expect(files).toEqual([]);
    expect(errors).toHaveLength(4);
  });

  it('keeps the good rows on either side of a bad one', () => {
    const { files, errors } = partitionHomebrewRows([
      row({ id: 'a' }),
      row({ id: 'b', json: null }),
      row({ id: 'c' }),
    ]);
    expect(files.map((f) => f.id)).toEqual(['a', 'c']);
    expect(errors.map((e) => e.id)).toEqual(['b']);
  });
});

describe('partitionHomebrewRows repairs what it can supply', () => {
  it('fills in metadata a row is missing rather than hiding the file', () => {
    const { files, errors } = partitionHomebrewRows([{ id: 'abc', json: { spell: [] } }]);
    expect(errors).toEqual([]);
    expect(files[0]).toMatchObject({
      fileName: 'abc.json',
      sourceIds: [],
      counts: {},
      addedAt: 0,
      // Absent means on: a file whose flag was lost should still be usable,
      // and the user can turn it off from the homebrew screen.
      enabled: true,
      editable: false,
      rev: undefined,
    });
  });

  it('drops junk out of sourceIds and counts instead of trusting it', () => {
    const { files } = partitionHomebrewRows([
      row({ sourceIds: ['HB', 3, null, 'MB'], counts: { spell: 2, item: 'many', feat: null } }),
    ]);
    expect(files[0]?.sourceIds).toEqual(['HB', 'MB']);
    expect(files[0]?.counts).toEqual({ spell: 2, item: 0, feat: 0 });
  });

  it('treats a non-finite addedAt as unknown rather than sorting on NaN', () => {
    const { files } = partitionHomebrewRows([
      row({ addedAt: Number.NaN }),
      row({ addedAt: 'yesterday' }),
    ]);
    expect(files.map((f) => f.addedAt)).toEqual([0, 0]);
  });

  it('only counts editable when the row actually says so', () => {
    const { files } = partitionHomebrewRows([
      row({ editable: 'yes' }),
      row({ editable: undefined }),
      row({ editable: true }),
    ]);
    expect(files.map((f) => f.editable)).toEqual([false, false, true]);
  });

  it('only counts disabled when the row actually says so', () => {
    const { files } = partitionHomebrewRows([
      row({ enabled: false }),
      row({ enabled: undefined }),
      row({ enabled: 0 }),
    ]);
    expect(files.map((f) => f.enabled)).toEqual([false, true, true]);
  });
});
