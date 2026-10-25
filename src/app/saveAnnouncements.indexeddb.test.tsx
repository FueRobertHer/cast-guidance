// @vitest-environment jsdom
// A11Y-002: saving is quiet until it fails (#113). The sheet header's Unsaved,
// Saving and Saved used to be a live region, so every HP tap was read out
// three times. This runs the real sheet, the real session store and the shell's
// banners over fake-indexeddb, and listens the way a screen reader would. The
// only other thing an HP tap says is the HP itself, once the taps settle.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { deriveSheet } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { Component as SheetLayout } from '@/features/sheet/SheetLayout';
import { Component as PlayTab } from '@/features/sheet/tabs/PlayTab';
import { resetAnnouncer } from '@/stores/announcer';
import { characterSessionStore } from '@/stores/characterSession';
import { LiveAnnouncer } from '@/ui/LiveAnnouncer';
import { listenForAnnouncements } from '../../tests-fixtures/announcements';
import { injectIdbFault, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { SAVE_RECOVERED_TEXT, StorageBanners } from './AppShell';

// The synthetic world stands in for the compendium, as in the PlayTab tests.
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => makeTestContext() }));
vi.mock('@/data5e/engineAdapter', () => ({ engineContextFor: (r: unknown) => r }));
vi.mock('@/features/dice/DiceTray', () => ({ DiceTray: () => null }));
vi.mock('@/features/sheet/HistoryDrawer', () => ({ HistoryDrawer: () => null }));

const SAVED_WAIT = { timeout: 5000 };

/** The Play tab's settled HP line (see `hpSpeech`), the one thing an HP tap may say. */
const HP_LINE = /^\d+ of \d+ hit points$/;
const aboutSaving = (heard: string[]) => heard.filter((t) => !HP_LINE.test(t));

async function seedWarrior(): Promise<number> {
  const doc = newCharacterDoc('c1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  const max = deriveSheet(doc, makeTestContext()).maxHp.value;
  doc.play.currentHp = max;
  doc.play.hpInitialized = true;
  await db.characters.put(doc);
  return max;
}

function renderSheet() {
  const router = createMemoryRouter(
    [
      {
        path: '/c/:id',
        element: (
          <>
            <LiveAnnouncer />
            <StorageBanners />
            <SheetLayout />
          </>
        ),
        children: [{ index: true, element: <PlayTab /> }],
      },
    ],
    { initialEntries: ['/c/c1'] },
  );
  render(<RouterProvider router={router} />);
}

const storedHp = async () => (await db.characters.get('c1'))?.play.currentHp;
const saveStatus = () => characterSessionStore.getState().saveStatus;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
  resetAnnouncer();
});

afterEach(async () => {
  cleanup();
  await characterSessionStore.getState().close();
  await removeIdbFaults();
  resetAnnouncer();
});

describe('save announcements', () => {
  it('says nothing about saving for a run of HP edits, however many saves they take', async () => {
    const max = await seedWarrior();
    renderSheet();
    const damage = await screen.findByRole('button', { name: 'Damage 1 hit point' });
    const listener = listenForAnnouncements();

    // Five taps inside the debounce, a pause long enough to save, then five
    // more: at least two full Unsaved, Saving, Saved cycles.
    for (let i = 0; i < 5; i++) fireEvent.click(damage);
    await waitFor(async () => expect(await storedHp()).toBe(max - 5), SAVED_WAIT);
    await waitFor(() => expect(saveStatus()).toBe('saved'), SAVED_WAIT);
    for (let i = 0; i < 5; i++) fireEvent.click(damage);
    await waitFor(async () => expect(await storedHp()).toBe(max - 10), SAVED_WAIT);
    await waitFor(() => expect(saveStatus()).toBe('saved'), SAVED_WAIT);
    // The HP, once, where the second run ended. The first run's line is said
    // too only if its save outlasted the settle; either way, only HP lines.
    await waitFor(
      () => expect(listener.heard.at(-1)).toBe(`${max - 10} of ${max} hit points`),
      SAVED_WAIT,
    );
    await act(async () => undefined);
    listener.stop();

    expect(aboutSaving(listener.heard)).toEqual([]);
    expect(listener.heard.length).toBeLessThanOrEqual(2);
    // The indicator still shows the state, as text nobody is made to hear.
    const indicator = document.querySelector('[data-save-indicator]');
    expect(indicator?.textContent).toContain('Saved');
    expect(indicator?.closest('[aria-live],[role="status"],[role="alert"],output')).toBeNull();
  });

  it('says a failure once, however many edits keep failing, and the recovery once', async () => {
    const max = await seedWarrior();
    renderSheet();
    const damage = await screen.findByRole('button', { name: 'Damage 1 hit point' });
    fireEvent.click(damage);
    await waitFor(async () => expect(await storedHp()).toBe(max - 1), SAVED_WAIT);
    await waitFor(() => expect(saveStatus()).toBe('saved'), SAVED_WAIT);

    const fault = await injectIdbFault(db, { tables: ['characters'] });
    const listener = listenForAnnouncements();
    fireEvent.click(damage);
    await waitFor(() => expect(saveStatus()).toBe('error'), SAVED_WAIT);
    // More edits while the device is still full: each save fails again.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(damage);
      await waitFor(() => expect(saveStatus()).toBe('pending'), SAVED_WAIT);
      await waitFor(() => expect(saveStatus()).toBe('error'), SAVED_WAIT);
    }
    await act(async () => undefined);
    expect(fault.hits).toBe(4);
    expect(aboutSaving(listener.heard)).toHaveLength(1);
    expect(aboutSaving(listener.heard)[0]).toContain('Character changes could not be saved');

    await fault();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(async () => expect(await storedHp()).toBe(max - 5), SAVED_WAIT);
    await waitFor(() => expect(saveStatus()).toBe('saved'), SAVED_WAIT);
    await act(async () => undefined);
    listener.stop();

    const saving = aboutSaving(listener.heard);
    expect(saving).toEqual([saving[0], SAVE_RECOVERED_TEXT]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
