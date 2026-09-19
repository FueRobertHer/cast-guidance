import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('what one autosave reads', () => {
  it('does not load the stored documents to find the newest or to prune', async () => {
    // `record` runs on every debounced save, and every row it reads carries a
    // whole character document. Both of its reads used to arrive as full rows
    // via `sortBy`, which has to materialise the lot: fifty documents to use
    // one, then fifty again to use none of them, only their ids. On a phone
    // that was the cost of typing a hit point.
    const doc = newCharacterDoc('c1', 'Sparks', 't');
    for (let i = 0; i < 60; i++) {
      await historyRepo.record({ ...doc, name: `Sparks ${i}` }, `edit ${i}`);
    }

    // Off a live collection rather than a Dexie export, which does not carry
    // `Collection` in this build.
    const collectionProto = Object.getPrototypeOf(
      db.characterHistory.where('charId').equals('c1'),
    ) as { sortBy: (key: string) => Promise<unknown> };
    const sortBy = vi.spyOn(collectionProto, 'sortBy');
    await historyRepo.record({ ...doc, name: 'Sparks again' }, 'one more');
    expect(sortBy).not.toHaveBeenCalled();
    sortBy.mockRestore();

    // And it still prunes, so the cheaper reads did not cost the behaviour.
    expect(await db.characterHistory.where('charId').equals('c1').count()).toBe(50);
  });
});
