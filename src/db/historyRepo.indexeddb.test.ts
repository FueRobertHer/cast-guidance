import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { db } from './db';
import { historyRepo } from './historyRepo';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('historyRepo', () => {
  it('records a snapshot and lists it', async () => {
    const doc = newCharacterDoc('c1', 'Hero', 't');
    await historyRepo.record(doc, 'Snapshot');
    const list = await historyRepo.list('c1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ charId: 'c1', label: 'Snapshot' });
  });

  it('skips an exact-duplicate consecutive snapshot', async () => {
    const doc = newCharacterDoc('c1', 'Hero', 't');
    await historyRepo.record(doc, 'A');
    await historyRepo.record(doc, 'B'); // identical doc → skipped
    expect(await historyRepo.list('c1')).toHaveLength(1);
  });

  it('records again when the doc changed', async () => {
    const doc = newCharacterDoc('c1', 'Hero', 't');
    await historyRepo.record(doc, 'A');
    await historyRepo.record({ ...doc, notes: 'changed' }, 'B');
    expect(await historyRepo.list('c1')).toHaveLength(2);
  });

  it('scopes list/clear to one character', async () => {
    await historyRepo.record(newCharacterDoc('c1', 'A', 't'), 's');
    await historyRepo.record(newCharacterDoc('c2', 'B', 't'), 's');
    await historyRepo.clear('c1');
    expect(await historyRepo.list('c1')).toHaveLength(0);
    expect(await historyRepo.list('c2')).toHaveLength(1);
  });

  it('prunes to the newest 50 snapshots', async () => {
    for (let i = 0; i < 55; i++) {
      // Vary the doc so each snapshot is distinct (not deduped).
      await historyRepo.record(
        { ...newCharacterDoc('c1', 'Hero', 't'), notes: `edit ${i}` },
        `s${i}`,
      );
    }
    expect(await historyRepo.list('c1')).toHaveLength(50);
  });
});
