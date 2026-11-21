// @vitest-environment jsdom
// Back from the Workshop's editors after a move that replaces the address (a
// first save, its Undo, a change to the books sent to the Change sheet, one of
// yours sent from it to its editor), opened as the tab's first page or from a
// page before it. A replace gives the first entry a new key, so the move keeps
// it marked first, and Back goes up to the Workshop instead of out of the app.
import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { getRegistry } from '@/data5e/registry';
import { homebrewRepo } from '@/db/homebrewRepo';
import { isFirstEntry } from '@/lib/useBack';
import {
  HARNESS_TIMEOUT,
  renderApp,
  resetSheetHarness,
  seedWorld,
} from '../../../tests-fixtures/sheetHarness';
import { writeChange } from './copyWriter';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

const WAIT = 30_000;

/** Opened from outside (the tab's first page), and from the app's home before it. */
const OPENED = [
  { how: 'opened cold', before: [] as string[], back: '/workshop' },
  { how: 'opened from a page', before: ['/'], back: '/' },
] as const;

type Router = Awaited<ReturnType<typeof renderApp>>;

/**
 * The entry is still the tab's first exactly when it was opened cold. Asked of
 * the router itself: the router renders a move as a transition, so a Back
 * pressed at once could still read the address before it.
 */
const firstOnlyIfCold = (router: Router, before: readonly string[]) =>
  expect(isFirstEntry(router.state.location)).toBe(before.length === 0);

/** Back, once the page has rendered the address the router is at. */
async function back(): Promise<void> {
  await act(() => new Promise((r) => setTimeout(r, 0)));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
}

describe('Back from the Workshop editor', () => {
  for (const { how, before, back: to } of OPENED) {
    it(`after a first save moves the address, ${how}`, async () => {
      const router = await renderApp([...before, '/workshop/new/feat']);
      fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
        target: { value: 'Stand Fast' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(
        () => expect(router.state.location.pathname).toMatch(/^\/workshop\/edit\/feat\//),
        { timeout: WAIT },
      );
      firstOnlyIfCold(router, before);
      await back();
      await waitFor(() => expect(router.state.location.pathname).toBe(to));
    });

    it(`after a first save is taken back, ${how}`, async () => {
      const router = await renderApp([...before, '/workshop/new/feat']);
      fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
        target: { value: 'Stand Fast' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }, { timeout: WAIT }));
      await screen.findByText('Feat, your own. Not saved yet', {}, { timeout: WAIT });
      await waitFor(() => expect(router.state.location.pathname).toBe('/workshop/new/feat'));
      firstOnlyIfCold(router, before);
      // The typed name is kept, unsaved, so Back asks first.
      await back();
      fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(to));
    });

    it(`from a change to the books, sent on to the Change sheet, ${how}`, async () => {
      await seedWorld();
      const book = (await getRegistry()).get('spell', 'Aid', 'TST') as Entity;
      const saved = await homebrewRepo.saveEntry(
        'spell',
        writeChange('spell', book, { ...book, entries: ['Changed.'] }) as Entity & {
          name: string;
          source: string;
        },
        { role: 'changes' },
      );
      const router = await renderApp([
        ...before,
        `/workshop/edit/spell/Aid%7CTST?file=${saved.fileId}`,
      ]);
      await screen.findByText(/Changes the book's Aid/, {}, { timeout: WAIT });
      expect(router.state.location.pathname).toBe('/workshop/change/spell/aid%7Ctst');
      firstOnlyIfCold(router, before);
      await back();
      await waitFor(() => expect(router.state.location.pathname).toBe(to));
    });

    it(`from one of yours, sent from the Change sheet to its editor, ${how}`, async () => {
      const mine = await homebrewRepo.createEditable('Mine', 'HB');
      await homebrewRepo.saveEditable(mine.id, {
        ...(mine.json as Record<string, unknown>),
        feat: [{ name: 'Gift', source: 'HB', entries: ['Mine.'] }],
      });
      const router = await renderApp([...before, '/workshop/change/feat/gift%7Chb']);
      fireEvent.click(
        await screen.findByRole('button', { name: 'Open it in its editor' }, { timeout: WAIT }),
      );
      await screen.findByDisplayValue('Mine.', {}, { timeout: WAIT });
      expect(router.state.location.pathname).toBe('/workshop/edit/feat/Gift%7CHB');
      firstOnlyIfCold(router, before);
      await back();
      await waitFor(() => expect(router.state.location.pathname).toBe(to));
    });
  }
});
