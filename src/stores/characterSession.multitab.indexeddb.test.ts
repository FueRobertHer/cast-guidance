// Two tabs editing one character (TEST-002, data for REL-007 #98). Each tab is
// its own session store, as each browser tab has its own module instance, and
// both write through the real repositories to the same IndexedDB.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { historyRepo } from '@/db/historyRepo';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { createCharacterSessionStore } from './characterSession';

/** The database's clock: both tabs share one machine. */
let clock = 1_000_000;

function openTab() {
  // Each tab keeps its own clock for grouping edits, as two tabs would.
  let tabClock = clock;
  const session = createCharacterSessionStore({
    characters: characterRepo,
    history: historyRepo,
    debounceMs: 60_000,
    now: () => tabClock,
  });
  const edit = async (recipe: (doc: CharacterDoc) => void) => {
    clock += 1_000;
    tabClock = clock;
    session.getState().update(recipe);
    await session.getState().flush();
  };
  return { session, edit };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const doc = newCharacterDoc('c1', 'Wren', 'tag');
  doc.play.currentHp = 10;
  await db.characters.put(doc);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('one character open in two tabs', () => {
  it('documents last-writer-wins: a rename in tab B silently drops the HP change from tab A (REL-007)', async () => {
    // This pins today's behavior on purpose. A future conflict guard (#98)
    // should flip this test deliberately, not pass it by accident.
    const a = openTab();
    const b = openTab();
    await a.session.getState().load('c1');
    await b.session.getState().load('c1');

    await a.edit((doc) => {
      doc.play.currentHp = 3;
    });
    await b.edit((doc) => {
      doc.name = 'Wren the Bold';
    });

    const stored = await db.characters.get('c1');
    expect(stored?.name).toBe('Wren the Bold');
    expect(stored?.play.currentHp).toBe(10);
    // Tab A still shows its own edit, unaware it was overwritten.
    expect(a.session.getState().doc?.play.currentHp).toBe(3);

    // What makes the loss recoverable: history kept tab A's snapshot.
    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => [r.doc.name, r.doc.play.currentHp])).toEqual([
      ['Wren the Bold', 10],
      ['Wren', 3],
    ]);
  });

  it("never folds one tab's burst of HP taps into the other tab's history row", async () => {
    const a = openTab();
    const b = openTab();
    await a.session.getState().load('c1');
    await b.session.getState().load('c1');

    await a.edit((doc) => {
      doc.play.currentHp = 9;
    });
    await b.edit((doc) => {
      doc.play.currentHp = 8;
    });
    // A's run continues, but its row is no longer the newest: a fresh row.
    await a.edit((doc) => {
      doc.play.currentHp = 7;
    });
    // Now A's row is the newest, so this tap folds into it.
    await a.edit((doc) => {
      doc.play.currentHp = 6;
    });
    await b.edit((doc) => {
      doc.play.currentHp = 5;
    });

    const rows = (await historyRepo.list('c1')).reverse();
    expect(rows.map((r) => r.doc.play.currentHp)).toEqual([9, 8, 6, 5]);
    // Each tab labels its run from its own starting point.
    expect(rows.map((r) => r.label)).toEqual(['HP 10→9', 'HP 10→8', 'HP 10→6', 'HP 10→5']);
    const ats = rows.map((r) => r.at);
    expect([...ats].sort((x, y) => x - y)).toEqual(ats);
  });

  it('settles saves racing from both tabs without a rejection, each in its own history row', async () => {
    const a = openTab();
    const b = openTab();
    await a.session.getState().load('c1');
    await b.session.getState().load('c1');

    a.session.getState().update((doc) => {
      doc.play.currentHp = 4;
    });
    b.session.getState().update((doc) => {
      doc.name = 'Wren the Bold';
    });
    // Same millisecond, so the history rows must still order strictly.
    await expect(
      Promise.all([a.session.getState().flush(), b.session.getState().flush()]),
    ).resolves.toEqual([undefined, undefined]);

    expect(a.session.getState().saveStatus).toBe('saved');
    expect(b.session.getState().saveStatus).toBe('saved');
    const rows = await historyRepo.list('c1');
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.at)).size).toBe(2);
    // Whichever write landed last is what the character now holds.
    const stored = await db.characters.get('c1');
    expect(stored).toMatchObject({ name: rows[0]?.doc.name });
    expect(stored?.play.currentHp).toBe(rows[0]?.doc.play.currentHp);
  });
});
