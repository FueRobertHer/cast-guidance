// @vitest-environment jsdom
// Settings' books row over the real registry (U9's follow-ups): how many of
// the books show, with a collection's own source left out, a collection
// deleted in another tab not counted as a book, and a registry that cannot be
// read said so rather than Loading for good.
import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidateRegistry } from '@/data5e/registry';
import { updateSourcePolicy, withSource } from '@/data5e/sourceFilter';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import {
  HARNESS_TIMEOUT,
  resetSheetHarness,
  seedWorld,
} from '../../../tests-fixtures/sheetHarness';
import { BooksRow } from './SettingsPage';
import { booksShownWords } from './SourcesSection';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });
const WAIT = 30_000;

afterEach(async () => {
  vi.restoreAllMocks();
  await updateSourcePolicy(() => ({ mode: 'all', except: [] }));
  await resetSheetHarness();
});

/** Settings' books row, as Settings shows it. */
function visit() {
  const router = createMemoryRouter([{ path: '*', element: <BooksRow /> }]);
  render(<RouterProvider router={router} />);
}
const row = () => screen.getByRole('link', { name: /^The books/ });
/** The row's caption once the books are read: "All 3 books show". */
async function caption(): Promise<string> {
  let words = '';
  await waitFor(
    () => {
      words = row().textContent ?? '';
      expect(words).toMatch(/books? show/);
    },
    { timeout: WAIT },
  );
  return words.replace(/^The books,?\s*/, '');
}

/** A collection with a spell in its own source, as an import stores one. */
const lantern = {
  _meta: { sources: [{ json: 'LanternCoast', full: 'Lantern Coast' }] },
  spell: [
    {
      name: 'Glowfly',
      source: 'LanternCoast',
      level: 0,
      school: 'V',
      time: [{ number: 1, unit: 'action' }],
      range: { type: 'point', distance: { type: 'self' } },
      components: { v: true },
      duration: [{ type: 'instant' }],
      entries: ['A light.'],
    },
  ],
};

describe('the books row', () => {
  it('counts the books on the device, against the books chosen to show', async () => {
    await seedWorld();
    visit();
    const all = await caption();
    const total = Number(/All (\d+) books show/.exec(all)?.[1]);
    expect(total).toBeGreaterThan(1);
    expect(all).toBe(booksShownWords({ shown: total, total }));
    const [first] = (await import('@/data5e/registry').then((m) => m.getRegistry()))
      .sourceCounts()
      .keys();
    await updateSourcePolicy((p) => withSource(p, first ?? '', false));
    await waitFor(
      () => expect(row().textContent).toContain(`${total - 1} of ${total} books show`),
      {
        timeout: WAIT,
      },
    );
  });

  it('leaves a collection out, and counts no book for one deleted in another tab', async () => {
    await seedWorld();
    const file = await homebrewRepo.importJson(lantern, 'lantern.json');
    invalidateRegistry();
    visit();
    const before = await caption();
    // Every caption from here on: the rows and the registry are read apart, and
    // one counted against the other for a moment says 6 books.
    const said: string[] = [];
    const watch = new MutationObserver(() => said.push(row().textContent ?? ''));
    watch.observe(row(), { childList: true, subtree: true, characterData: true });
    // Deleted as another tab deletes it: the rows go, and nothing here is told.
    // The row reads the stored rows again (its live query), and is still right.
    const reads = vi.spyOn(homebrewRepo, 'listMetaSafe');
    await db.homebrewFiles.delete(file.id);
    await waitFor(() => expect(reads).toHaveBeenCalled(), { timeout: WAIT });
    await new Promise((r) => setTimeout(r, 100));
    expect(await caption()).toBe(before);
    watch.disconnect();
    expect(said.filter((t) => t.includes('books show') && !t.endsWith(before))).toEqual([]);
  });

  it('says it could not read the books when the registry cannot be read', async () => {
    await seedWorld();
    vi.spyOn(dataCacheRepo, 'cachedPaths').mockRejectedValue(new Error('the read failed'));
    visit();
    await waitFor(() => expect(row().textContent).toContain('Could not read the books'), {
      timeout: WAIT,
    });
  });
});

describe('booksShownWords', () => {
  it('says each state of the books in words', () => {
    expect(booksShownWords(undefined)).toBe('Loading…');
    expect(booksShownWords('failed')).toBe('Could not read the books');
    expect(booksShownWords({ shown: 0, total: 0 })).toBe('No game data yet');
    expect(booksShownWords({ shown: 3, total: 3 })).toBe('All 3 books show');
    expect(booksShownWords({ shown: 1, total: 3 })).toBe('1 of 3 books show');
  });
});
