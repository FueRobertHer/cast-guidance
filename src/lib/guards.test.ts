import { describe, expect, it } from 'vitest';
import {
  assertCharacterExport,
  assertHomebrewFile,
  CHARACTER_EXPORT_FORMAT,
  homebrewEntityCounts,
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
});
