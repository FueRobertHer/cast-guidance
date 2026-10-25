import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { historyRepo } from '@/db/historyRepo';
import { newCharacterDoc } from '@/engine/types';
import { unchecked } from '../../tests-fixtures/sessionCharacters';
import {
  createCharacterSessionStore,
  NOT_SAVED_LABEL,
  type SessionCharacters,
} from './characterSession';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

function memoryStorage(): () => Storage {
  const map = new Map<string, string>();
  const area = {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  };
  return () => area as unknown as Storage;
}

describe('an edit cut off by a reload (#123)', () => {
  it('is saved on the next boot with one history entry, and only once', async () => {
    const journal = memoryStorage();
    await characterRepo.put(newCharacterDoc('c1', 'Wren', 't'));

    // The first page: its write never commits, as when a reload tears it down.
    const torn = createCharacterSessionStore({
      characters: unchecked({ get: characterRepo.get, put: () => new Promise(() => undefined) }),
      history: historyRepo,
      debounceMs: 10_000,
      journal,
    });
    await torn.getState().load('c1');
    torn.getState().update((doc) => {
      doc.play.inspiration = true;
    });
    torn.getState().journalUnsaved();
    void torn.getState().flushAll();
    expect((await characterRepo.get('c1'))?.play.inspiration).toBe(false);

    const booted = () =>
      createCharacterSessionStore({ characters: characterRepo, history: historyRepo, journal });

    const next = booted();
    await next.getState().load('c1');
    expect(next.getState().doc?.play.inspiration).toBe(true);
    expect((await characterRepo.get('c1'))?.play.inspiration).toBe(true);

    // A further boot finds nothing left to replay.
    await booted().getState().load('c1');
    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => r.label)).toEqual(['Inspiration gained']);
  });
});

describe('a journaled edit another tab got past (REL-007, #98)', () => {
  it('goes to history with a word on the next boot, and the other save stands', async () => {
    const journal = memoryStorage();
    await characterRepo.put(newCharacterDoc('c1', 'Wren', 't'));
    await characterRepo.put(newCharacterDoc('c2', 'Bram', 't'));

    // Tab A's save fails and is kept for Retry.
    const failing: SessionCharacters = {
      getWithRevision: (id) => characterRepo.getWithRevision(id),
      save: async () => {
        throw new Error('quota exceeded');
      },
    };
    const tabA = createCharacterSessionStore({
      characters: failing,
      history: historyRepo,
      debounceMs: 10_000,
      journal,
    });
    await tabA.getState().load('c1');
    tabA.getState().update((doc) => {
      doc.name = 'A, never saved';
    });
    await expect(tabA.getState().flush()).rejects.toThrow('quota exceeded');

    // Tab B saves a newer edit.
    const tabB = createCharacterSessionStore({ characters: characterRepo, history: historyRepo });
    await tabB.getState().load('c1');
    tabB.getState().update((doc) => {
      doc.play.currentHp = 3;
    });
    await tabB.getState().flush();

    // Tab A leaves and comes back, reading B's row on the way, then goes away.
    // Its snapshot was built on the row before B's, and must say so.
    await tabA.getState().load('c2');
    await tabA.getState().load('c1');
    expect(tabA.getState().doc?.name).toBe('A, never saved');
    tabA.getState().journalUnsaved();

    const booted = createCharacterSessionStore({
      characters: characterRepo,
      history: historyRepo,
      journal,
    });
    await booted.getState().load('c1');

    const stored = await characterRepo.get('c1');
    expect([stored?.name, stored?.play.currentHp]).toEqual(['Wren', 3]);
    const [newest] = await historyRepo.list('c1');
    expect([newest?.label, newest?.doc.name]).toEqual([NOT_SAVED_LABEL, 'A, never saved']);
    expect(await booted.getState().replayJournal()).toEqual(['A, never saved']);
  });
});
