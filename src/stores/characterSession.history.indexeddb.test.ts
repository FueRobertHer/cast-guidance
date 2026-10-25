import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { historyRepo } from '@/db/historyRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { createCharacterSessionStore } from './characterSession';

let clock = 1_000_000;
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('history under a burst of small edits (UX-005)', () => {
  it('keeps the level up reachable after sixty quick HP taps', async () => {
    // Before rapid edits were folded, each tap was its own row, and the 50-row
    // cap pruned the level up a player would actually want to return to.
    const stored = new Map<string, CharacterDoc>([['c1', newCharacterDoc('c1', 'Wren', 't')]]);
    const session = createCharacterSessionStore({
      characters: {
        get: async (id) => structuredClone(stored.get(id)),
        put: async (doc) => {
          stored.set(doc.id, structuredClone(doc));
        },
      },
      history: historyRepo,
      debounceMs: 10_000,
      now: () => Date.now(),
    });
    const edit = async (recipe: (doc: CharacterDoc) => void) => {
      clock += 1_000;
      session.getState().update(recipe);
      await session.getState().flush();
    };

    await session.getState().load('c1');
    await edit((doc) => {
      doc.classes = [{ ref: { name: 'Wizard', source: 'PHB' }, levels: 2, hp: ['avg', 'avg'] }];
    });
    for (let hp = 1; hp <= 60; hp++) {
      await edit((doc) => {
        doc.play.currentHp = hp;
      });
    }

    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => r.label)).toEqual(['HP 0→60', 'Added Wizard']);
    expect(rows[0]?.doc.play.currentHp).toBe(60);
  });

  it('drops a run that ends where it began, such as a pip ticked by mistake', async () => {
    const stored = new Map<string, CharacterDoc>([['c1', newCharacterDoc('c1', 'Wren', 't')]]);
    const session = createCharacterSessionStore({
      characters: {
        get: async (id) => structuredClone(stored.get(id)),
        put: async (doc) => {
          stored.set(doc.id, structuredClone(doc));
        },
      },
      history: historyRepo,
      debounceMs: 10_000,
      now: () => Date.now(),
    });
    const edit = async (recipe: (doc: CharacterDoc) => void) => {
      clock += 1_000;
      session.getState().update(recipe);
      await session.getState().flush();
    };

    await session.getState().load('c1');
    await edit((doc) => {
      doc.classes = [{ ref: { name: 'Barbarian', source: 'PHB' }, levels: 1, hp: ['avg'] }];
    });
    await edit((doc) => {
      doc.play.resources = [{ key: 'rage', used: 1 }];
    });
    // Unticking leaves {used: 0} behind rather than removing the entry.
    await edit((doc) => {
      doc.play.resources = [{ key: 'rage', used: 0 }];
    });

    expect((await historyRepo.list('c1')).map((r) => r.label)).toEqual(['Added Barbarian']);
  });
});
