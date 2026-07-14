import { describe, expect, it } from 'vitest';
import {
  assertCharacterDoc,
  assertCharacterExport,
  assertHomebrewFile,
  assertJsonWithinLimits,
  CHARACTER_EXPORT_FORMAT,
  homebrewEntityCounts,
  IMPORT_LIMITS,
  ValidationError,
} from './guards';

describe('assertHomebrewFile', () => {
  const valid = {
    _meta: { sources: [{ json: 'MyBrew', abbreviation: 'MB', full: 'My Brew' }] },
    race: [{ name: 'Brewfolk', source: 'MyBrew' }],
    spell: [{ name: 'Brew Bolt', source: 'MyBrew', level: 1 }],
  };

  it('accepts a minimal valid file and counts entities', () => {
    const { meta, json } = assertHomebrewFile(valid);
    expect(meta.sources[0]?.json).toBe('MyBrew');
    expect(homebrewEntityCounts(json)).toEqual({ race: 1, spell: 1 });
  });

  const bad: Array<[string, unknown]> = [
    ['array', []],
    ['string', 'nope'],
    ['missing _meta', { race: [] }],
    ['empty sources', { _meta: { sources: [] } }],
    ['source without json id', { _meta: { sources: [{ full: 'X' }] } }],
  ];
  for (const [label, input] of bad) {
    it(`rejects ${label}`, () => {
      expect(() => assertHomebrewFile(input)).toThrowError(ValidationError);
    });
  }
});

describe('assertCharacterExport', () => {
  it('accepts a valid export and round-trips', () => {
    const payload = {
      $format: CHARACTER_EXPORT_FORMAT,
      character: { id: 'x', schemaVersion: 1, name: 'Hero' },
      homebrew: [],
    };
    const parsed = assertCharacterExport(JSON.parse(JSON.stringify(payload)));
    expect((parsed.character as { name: string }).name).toBe('Hero');
  });

  it('rejects wrong format tag and missing character', () => {
    expect(() => assertCharacterExport({ $format: 'other@1', character: {} })).toThrowError(
      ValidationError,
    );
    expect(() => assertCharacterExport({ $format: CHARACTER_EXPORT_FORMAT })).toThrowError(
      ValidationError,
    );
  });

  it('rejects an oversized embedded-homebrew array', () => {
    const homebrew = Array.from({ length: IMPORT_LIMITS.maxHomebrewFiles + 1 }, () => ({}));
    expect(() =>
      assertCharacterExport({
        $format: CHARACTER_EXPORT_FORMAT,
        character: { id: 'x', schemaVersion: 1, name: 'Hero' },
        homebrew,
      }),
    ).toThrowError(ValidationError);
  });

  it('rejects a character document whose fields have the wrong shape', () => {
    expect(() =>
      assertCharacterExport({
        $format: CHARACTER_EXPORT_FORMAT,
        character: { id: 'x', name: 'Hero', classes: 'not-an-array' },
      }),
    ).toThrowError(ValidationError);
  });

  it('treats a missing homebrew field as an empty array', () => {
    const parsed = assertCharacterExport({
      $format: CHARACTER_EXPORT_FORMAT,
      character: { id: 'x', schemaVersion: 1, name: 'Hero' },
    });
    expect(parsed.homebrew).toEqual([]);
  });
});

describe('assertCharacterDoc', () => {
  it('accepts a well-typed document', () => {
    expect(() =>
      assertCharacterDoc({ id: 'abc', name: 'Hero', schemaVersion: 1, classes: [], play: {} }),
    ).not.toThrow();
  });

  const bad: Array<[string, unknown]> = [
    ['not an object', 'nope'],
    ['array', []],
    ['missing id', { name: 'Hero' }],
    ['empty id', { id: '   ' }],
    ['non-string name', { id: 'x', name: 42 }],
    ['non-number schemaVersion', { id: 'x', schemaVersion: 'v1' }],
    ['non-array classes', { id: 'x', classes: {} }],
    ['non-object play', { id: 'x', play: [] }],
  ];
  for (const [label, input] of bad) {
    it(`rejects ${label}`, () => {
      expect(() => assertCharacterDoc(input)).toThrowError(ValidationError);
    });
  }
});

describe('assertJsonWithinLimits', () => {
  it('accepts an ordinary object', () => {
    expect(() => assertJsonWithinLimits({ a: 1, b: [1, 2, 3], c: 'ok' })).not.toThrow();
  });

  it('rejects nesting deeper than the limit', () => {
    let deep: unknown = 0;
    for (let i = 0; i <= IMPORT_LIMITS.maxDepth + 1; i++) deep = [deep];
    expect(() => assertJsonWithinLimits(deep)).toThrowError(ValidationError);
  });

  it('rejects an over-long string', () => {
    const big = 'a'.repeat(IMPORT_LIMITS.maxStringLength + 1);
    expect(() => assertJsonWithinLimits({ note: big })).toThrowError(ValidationError);
  });

  it('rejects too many total values', () => {
    const arr = new Array(IMPORT_LIMITS.maxNodes + 2).fill(0);
    expect(() => assertJsonWithinLimits(arr)).toThrowError(ValidationError);
  });
});
