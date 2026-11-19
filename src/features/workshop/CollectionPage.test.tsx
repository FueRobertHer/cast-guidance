// @vitest-environment jsdom
// A collection's page over the app's routes (ADR-002, D1): for now its name,
// its switch and the way on to the Homebrew page, and a page for an address
// that names nothing.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { HARNESS_TIMEOUT, resetSheetHarness } from '../../../tests-fixtures/sheetHarness';
import { collectionsOf } from './collections';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

const WAIT = 30_000;

function visit(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  return router;
}

const enabled = async (id: string) => (await db.homebrewFiles.get(id))?.enabled;

describe('a collection page', () => {
  it('names the collection, turns it off and on, and leads to the Homebrew page', async () => {
    const row = await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: 'IMP', full: 'Imported Brews' }] },
        feat: [{ name: 'Glimmer', source: 'IMP', entries: ['Glow.'] }],
      },
      'imported.json',
    );
    visit(`/workshop/collection/${row.id}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'imported.json' }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(document.title).toBe('imported.json · Workshop · Cast Guidance');
    const use = screen.getByRole('button', { name: 'Use imported.json' });
    expect(use.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(use);
    await waitFor(async () => expect(await enabled(row.id)).toBe(false), { timeout: WAIT });
    await waitFor(() => expect(use.getAttribute('aria-pressed')).toBe('false'), { timeout: WAIT });
    fireEvent.click(use);
    await waitFor(async () => expect(await enabled(row.id)).toBe(true), { timeout: WAIT });
    expect(screen.getByRole('link', { name: 'Open the Homebrew page' }).getAttribute('href')).toBe(
      '/homebrew',
    );
    expect(namelessControls()).toEqual([]);
  });

  it("gives a compendium's books a switch each, from any book's address", async () => {
    const { books } = await homebrewRepo.prepareBooks(
      {
        _meta: {
          sources: [
            { json: 'FCA', full: 'Ember Codex' },
            { json: 'FCB', full: 'Frost Codex' },
          ],
          convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' },
        },
        spell: [
          { name: 'Ember Ward', source: 'FCA', level: 1 },
          { name: 'Frost Ward', source: 'FCB', level: 1 },
        ],
      },
      'all.xml',
    );
    await homebrewRepo.commitBooks(books);
    const rows = await db.homebrewFiles.toArray();
    // The book whose id is not the collection's own, so the page finds it
    // through the group and not by chance.
    const [collection] = collectionsOf(rows);
    const other = rows.find((r) => r.id !== collection?.id);
    if (collection === undefined || other?.book === undefined) throw new Error('no second book');
    visit(`/workshop/collection/${other.id}`);
    await screen.findByRole('heading', { level: 1, name: 'all.xml' }, { timeout: WAIT });
    const list = screen.getByRole('list', { name: 'Its books' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(expect.arrayContaining(['Use Ember Codex', 'Use Frost Codex']));
    fireEvent.click(within(list).getByRole('button', { name: `Use ${other.book}` }));
    await waitFor(async () => expect(await enabled(other.id)).toBe(false), { timeout: WAIT });
    expect(await screen.findByText(/1 of 2 books on/, {}, { timeout: WAIT })).toBeTruthy();
  });

  it('says a collection is gone, with the way back to the Workshop', async () => {
    visit('/workshop/collection/no-such-file');
    expect(
      await screen.findByText(
        'This collection is no longer on this device.',
        {},
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    expect(document.title).toBe('Collection not found · Workshop · Cast Guidance');
    expect(screen.getByRole('link', { name: 'Back to the Workshop' }).getAttribute('href')).toBe(
      '/workshop?shelf=collections',
    );
  });
});
