import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { historyRepo } from '@/db/historyRepo';
import { newCharacterDoc } from '@/engine/types';
import { createCharacterSessionStore } from './characterSession';

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
      characters: { get: characterRepo.get, put: () => new Promise(() => undefined) },
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
