import { describe, expect, it } from 'vitest';
import { MigrationError, migrateCharacter } from './migrate';
import { CHARACTER_SCHEMA_VERSION, newCharacterDoc } from './types';

describe('migrateCharacter', () => {
  it('passes a current-version document through', () => {
    const doc = newCharacterDoc('c1', 'Hero', 'tag');
    const out = migrateCharacter(doc);
    expect(out.id).toBe('c1');
    expect(out.schemaVersion).toBe(CHARACTER_SCHEMA_VERSION);
  });

  it('treats a missing schemaVersion as the base version', () => {
    const out = migrateCharacter({ id: 'x', name: 'No Version' });
    // No migrations to run from v1; returned as-is.
    expect(out.id).toBe('x');
  });

  it('rejects a document from a newer app version', () => {
    expect(() =>
      migrateCharacter({ id: 'x', schemaVersion: CHARACTER_SCHEMA_VERSION + 5 }),
    ).toThrowError(MigrationError);
  });

  const notDocs: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'nope'],
  ];
  for (const [label, input] of notDocs) {
    it(`rejects a ${label}`, () => {
      expect(() => migrateCharacter(input)).toThrowError(MigrationError);
    });
  }

  it('does not mutate identity fields it does not own', () => {
    const doc = newCharacterDoc('keep-me', 'Hero', 'tag');
    doc.notes = 'important';
    const out = migrateCharacter(doc);
    expect(out.id).toBe('keep-me');
    expect(out.notes).toBe('important');
  });
});
