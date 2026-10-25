// @vitest-environment jsdom
// Another tab deleting or upgrading the database (TEST-002), with two real
// Dexie connections over fake-indexeddb: the app's own `db`, standing for this
// tab, and a second `new Dexie('cast-guidance')`, standing for the other one.
//
// Before the lifecycle handler, Dexie's default `versionchange` handler closed
// this tab's connection with auto-open left on, so the next save reopened the
// database: a reset in another tab was undone by whichever tab saved next.
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageBanners } from '@/app/AppShell';
import { newCharacterDoc } from '@/engine/types';
import { characterSessionStore, createCharacterSessionStore } from '@/stores/characterSession';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import { DB_LIFECYCLE_COPY } from '@/ui/DbLifecycleBanner';
import { characterRepo } from './characterRepo';
import { db } from './db';
import { historyRepo } from './historyRepo';

const NAME = 'cast-guidance';

function openSession() {
  return createCharacterSessionStore({
    characters: characterRepo,
    history: historyRepo,
    // Saves run only when a test flushes, so nothing races the assertions.
    debounceMs: 60_000,
  });
}

/** The other tab's "Reset app data": its own connection, closed, then deleted. */
async function resetInOtherTab(): Promise<void> {
  const other = new Dexie(NAME);
  await other.open();
  other.close();
  await other.delete();
}

/** Characters on disk, read through a connection of its own; none without a database. */
async function storedCharacters(): Promise<number> {
  if (!(await Dexie.exists(NAME))) return 0;
  const probe = new Dexie(NAME);
  try {
    await probe.open();
    return probe.tables.some((t) => t.name === 'characters')
      ? await probe.table('characters').count()
      : 0;
  } finally {
    probe.close();
  }
}

/** Settles with `promise`, or rejects once `ms` pass: a blocked open never settles. */
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

beforeEach(async () => {
  // Dexie warns on every versionchange it handles; the tests cause them on purpose.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.characters.put(newCharacterDoc('c1', 'Wren', 'tag'));
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  // Back to one fresh database at the app's version, open, for the next test.
  db.close();
  await Dexie.delete(NAME);
  await db.open();
  dbLifecycleStore.setState({ state: 'open' });
});

describe('another tab deletes the database', () => {
  it('stops this tab writing, so a pending save cannot bring the database back', async () => {
    const session = openSession();
    await session.getState().load('c1');
    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    });

    await resetInOtherTab();

    expect(dbLifecycleStore.getState().state).toBe('deleted');
    await expect(session.getState().flush()).rejects.toMatchObject({
      name: 'DatabaseClosedError',
    });
    await expect(db.characters.put(newCharacterDoc('c2', 'Ash', 'tag'))).rejects.toMatchObject({
      name: 'DatabaseClosedError',
    });
    // Without the handler both writes reopen the database and land in it.
    expect(await Dexie.exists(NAME)).toBe(false);
    expect(await storedCharacters()).toBe(0);
  });

  it('shows the reset banner in place of a raw save error', async () => {
    render(<StorageBanners />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    await characterSessionStore.getState().load('c1');
    characterSessionStore.getState().update((doc) => {
      doc.play.currentHp = 4;
    });
    await resetInOtherTab();
    await expect(characterSessionStore.getState().flush('c1')).rejects.toThrow();
    expect(characterSessionStore.getState().saveErrors.c1).toBeDefined();

    // The live region was already there, so the message is announced, politely.
    expect(await screen.findByText(DB_LIFECYCLE_COPY.deleted)).toBe(status);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    // "Character changes could not be saved: Database has been closed" says
    // nothing useful, and its Retry cannot work.
    expect(screen.queryByText(/could not be saved/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('another tab upgrades the database', () => {
  it('closes this tab so the upgrade is not blocked, and refuses later writes', async () => {
    render(<StorageBanners />);
    // This tab is connected and has written.
    expect(await db.characters.count()).toBe(1);

    const other = new Dexie(NAME);
    other.version(5).stores({ characters: 'id, name, updatedAt', probe: 'id' });
    const blocked = vi.fn();
    other.on('blocked', blocked);
    await within(other.open(), 5_000);

    expect(blocked).not.toHaveBeenCalled();
    expect(other.verno).toBe(5);
    expect(dbLifecycleStore.getState().state).toBe('superseded');
    // Older code must not write under the newer schema.
    await expect(db.characters.put(newCharacterDoc('c2', 'Ash', 'tag'))).rejects.toMatchObject({
      name: 'DatabaseClosedError',
    });
    expect(await other.table('characters').count()).toBe(1);
    other.close();

    expect(await screen.findByText(DB_LIFECYCLE_COPY.superseded)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });
});

describe('a connection the browser drops on its own', () => {
  // A regression guard, not a fix: Safari can close a connection under a
  // backgrounded tab. That is no reason to stop saving, and Dexie reopens on
  // the next write as long as nothing here treats it as a versionchange.
  it('records nothing, and the next save reopens and lands', async () => {
    const session = openSession();
    await session.getState().load('c1');
    db.close({ disableAutoOpen: false });

    session.getState().update((doc) => {
      doc.play.currentHp = 4;
    });
    await session.getState().flush();

    expect(dbLifecycleStore.getState().state).toBe('open');
    expect((await db.characters.get('c1'))?.play.currentHp).toBe(4);
  });
});
