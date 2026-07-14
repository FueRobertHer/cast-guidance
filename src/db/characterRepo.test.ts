import { describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { partitionCharacterRows, planCharacterImport } from './characterRepo';
import type { HomebrewFileRow } from './db';

function brew(id: string): HomebrewFileRow {
  return {
    id,
    fileName: `${id}.json`,
    json: { _meta: { sources: [{ json: id }] } },
    enabled: true,
    editable: false,
    sourceIds: [id],
    counts: {},
    addedAt: 1,
  };
}

const fixedOpts = { newId: () => 'fresh-uuid', now: () => '2026-01-01T00:00:00.000Z' };

describe('planCharacterImport', () => {
  it('keeps the original id when no local character collides', () => {
    const doc = newCharacterDoc('orig-id', 'Hero', 'tag');
    const plan = planCharacterImport(doc, [], {
      ...fixedOpts,
      characterExists: false,
      existingHomebrewIds: new Set(),
    });
    expect(plan.finalDoc.id).toBe('orig-id');
    expect(plan.summary.renamed).toBe(false);
    expect(plan.finalDoc.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('assigns a fresh id when the character id already exists locally', () => {
    const doc = newCharacterDoc('orig-id', 'Hero', 'tag');
    const plan = planCharacterImport(doc, [], {
      ...fixedOpts,
      characterExists: true,
      existingHomebrewIds: new Set(),
    });
    expect(plan.finalDoc.id).toBe('fresh-uuid');
    expect(plan.summary.renamed).toBe(true);
  });

  it('skips homebrew already stored locally (by content hash)', () => {
    const doc = newCharacterDoc('orig-id', 'Hero', 'tag');
    const plan = planCharacterImport(doc, [brew('a'), brew('b')], {
      ...fixedOpts,
      characterExists: false,
      existingHomebrewIds: new Set(['a']),
    });
    expect(plan.homebrewToAdd.map((r) => r.id)).toEqual(['b']);
    expect(plan.summary).toMatchObject({ homebrewAdded: 1, homebrewSkipped: 1 });
  });

  it('de-dupes identical embedded files within the same import', () => {
    const doc = newCharacterDoc('orig-id', 'Hero', 'tag');
    const plan = planCharacterImport(doc, [brew('a'), brew('a'), brew('c')], {
      ...fixedOpts,
      characterExists: false,
      existingHomebrewIds: new Set(),
    });
    expect(plan.homebrewToAdd.map((r) => r.id)).toEqual(['a', 'c']);
    expect(plan.summary.homebrewAdded).toBe(2);
    expect(plan.summary.homebrewSkipped).toBe(1);
  });
});

describe('partitionCharacterRows', () => {
  it('returns readable characters and skips unreadable ones', () => {
    const good = newCharacterDoc('good', 'Hero', 'tag');
    const rows = [
      good,
      { id: 'from-the-future', schemaVersion: 9999 }, // migrateCharacter rejects
      'not even an object',
    ];
    const { characters, errors } = partitionCharacterRows(rows);
    expect(characters.map((c) => c.id)).toEqual(['good']);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.id).toBe('from-the-future');
    expect(errors[1]?.id).toBeUndefined();
  });

  it('is empty for an empty table', () => {
    expect(partitionCharacterRows([])).toEqual({ characters: [], errors: [] });
  });
});
