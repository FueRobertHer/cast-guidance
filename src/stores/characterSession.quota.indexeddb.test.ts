// Autosave when the device runs out of space (TEST-002), against the real
// repositories over fake-indexeddb. The fault fixture refuses writes at the
// DBCore level, the same place a real QuotaExceededError surfaces.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { historyRepo } from '@/db/historyRepo';
import { newCharacterDoc } from '@/engine/types';
import { QUOTA_GUIDANCE } from '@/lib/storageErrors';
import { injectIdbFault, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { createCharacterSessionStore } from './characterSession';

let clock = 1_000_000;

function openSession() {
  return createCharacterSessionStore({
    characters: characterRepo,
    history: historyRepo,
    // Saves run only when a test flushes, so nothing races the assertions.
    debounceMs: 60_000,
    now: () => clock,
  });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  await db.characters.put(newCharacterDoc('c1', 'Wren', 'tag'));
});

afterEach(async () => {
  await removeIdbFaults();
  vi.restoreAllMocks();
});

describe('autosave under a full device', () => {
  it('keeps a refused save queued and visible, then Retry stores it with one history row', async () => {
    const session = openSession();
    await session.getState().load('c1');
    const fault = await injectIdbFault(db, { tables: ['characters'] });

    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    });
    await expect(session.getState().flush()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });

    expect(fault.hits).toBe(1);
    expect(session.getState().saveStatus).toBe('error');
    // Stored as guidance, not as the browser's "The quota has been exceeded."
    expect(session.getState().saveErrors.c1).toBe(QUOTA_GUIDANCE);
    // The screen still shows the edit; the database never got it.
    expect(session.getState().doc?.play.currentHp).toBe(4);
    expect((await db.characters.get('c1'))?.play.currentHp).toBe(0);
    expect(await db.characterHistory.count()).toBe(0);

    await fault();
    clock += 1_000;
    await session.getState().retryFailedSaves();

    expect(session.getState().saveStatus).toBe('saved');
    expect(session.getState().saveErrors).toEqual({});
    expect((await db.characters.get('c1'))?.play.currentHp).toBe(4);
    const rows = await historyRepo.list('c1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.doc.play.currentHp).toBe(4);
  });

  it('keeps the stored doc when only history was refused, and Retry adds the missing row', async () => {
    const session = openSession();
    await session.getState().load('c1');
    const fault = await injectIdbFault(db, { tables: ['characterHistory'], times: 1 });

    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    });
    await expect(session.getState().flush()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });

    expect(fault.hits).toBe(1);
    // The document itself landed; only its history entry is missing.
    expect((await db.characters.get('c1'))?.play.currentHp).toBe(4);
    expect(await db.characterHistory.count()).toBe(0);
    expect(session.getState().saveStatus).toBe('error');
    expect(session.getState().saveErrors.c1).toBe(QUOTA_GUIDANCE);

    // The fault has spent its one failure, so Retry goes through.
    clock += 1_000;
    await session.getState().retryFailedSaves();

    expect(session.getState().saveErrors).toEqual({});
    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => r.doc.play.currentHp)).toEqual([4]);
    // Labelled against the last stored baseline, not against nothing.
    expect(rows[0]?.label).toBe('HP 0→4');
  });

  it('lets an edit made while a refused save is in flight win on Retry', async () => {
    const session = openSession();
    await session.getState().load('c1');
    const fault = await injectIdbFault(db, { tables: ['characters'] });

    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    }, 'Took a hit');
    const first = session.getState().flush();
    // Lands while the refused write is still settling.
    session.getState().update((doc) => {
      doc.play.currentHp = 7;
    });
    await expect(first).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(fault.hits).toBe(1);

    await fault();
    clock += 1_000;
    await session.getState().retryFailedSaves();

    expect((await db.characters.get('c1'))?.play.currentHp).toBe(7);
    const rows = await historyRepo.list('c1');
    expect(rows.map((r) => r.doc.play.currentHp)).toEqual([7]);
  });

  it('does not pass a refused named action to the unrelated edit that follows it', async () => {
    const session = openSession();
    await session.getState().load('c1');
    const fault = await injectIdbFault(db, { tables: ['characters'] });

    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    }, 'Long rest');
    await expect(session.getState().flush()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    session.getState().update((doc) => {
      doc.name = 'Wren the Bold';
    });
    await expect(session.getState().flush()).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    expect(fault.hits).toBe(2);

    await fault();
    clock += 1_000;
    await session.getState().retryFailedSaves();

    const stored = await db.characters.get('c1');
    expect(stored?.name).toBe('Wren the Bold');
    expect(stored?.play.currentHp).toBe(4);
    const [row] = await historyRepo.list('c1');
    expect(row?.label).not.toBe('Long rest');
  });
});
