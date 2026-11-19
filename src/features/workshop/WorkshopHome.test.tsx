// @vitest-environment jsdom
// The Workshop's home over the app's routes (ADR-002, D1): its three shelves
// under one search, and that every way off it lands on a page.
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { markDataChanged } from '@/data5e/landing';
import { invalidateRegistry } from '@/data5e/registry';
import { homebrewRepo } from '@/db/homebrewRepo';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import { setAppTableRule } from '@/stores/tableRules';
import { namelessControls } from '../../../tests-fixtures/a11y';
import {
  HARNESS_TIMEOUT,
  resetSheetHarness,
  seedWorld,
} from '../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);
/** A hit as the index gives one. */
const hit = (type: string, name: string, source: string) => {
  const uid = `${name}|${source}`.toLowerCase();
  return { id: `${type}:${uid}`, type, uid, name, source };
};

// jsdom runs no worker, so the index answers as the Library's would: by
// default one official spell, one from an imported file, one from the
// player's own.
const HITS = [
  hit('spell', 'Glimmer', 'PHB'),
  hit('feat', 'Glimmer', 'IMP'),
  hit('feat', 'Gift', 'HB'),
];
const search = vi.hoisted(() => ({ ready: true, hits: [] as unknown[], asked: 0 }));
vi.mock('@/data5e/search/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data5e/search/client')>();
  return {
    ...real,
    ensureSearchIndex: () =>
      search.ready ? Promise.resolve() : Promise.reject(new Error('no worker')),
    searchAll: async () => {
      search.asked++;
      return { hits: search.hits, hiddenCount: 0 };
    },
  };
});

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

beforeEach(() => {
  search.ready = true;
  search.hits = HITS;
  search.asked = 0;
  resetAnnouncer();
});
afterEach(resetSheetHarness);
afterEach(resetAnnouncer);

/** How long a lazily loaded page or an IndexedDB write may take on a loaded runner. */
const WAIT = 30_000;

async function visit(path: string) {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  await seedWorld();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  await screen.findByRole('heading', { level: 1 }, { timeout: WAIT });
  return router;
}

/** A collection of the player's, with a feat and a spell. */
async function mine() {
  const row = await homebrewRepo.createEditable('Lantern Coast', 'HB');
  await homebrewRepo.saveEditable(row.id, {
    ...(row.json as Record<string, unknown>),
    feat: [{ name: 'Gift', source: 'HB', entries: ['A gift.'] }],
    spell: [{ name: 'Glimmer Bolt', source: 'HB', level: 0, school: 'V', entries: ['Zap.'] }],
  });
  return row;
}

const shelf = (name: string) =>
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Shelf' })).getByRole('button', { name }),
  );

describe('the Workshop home', () => {
  it('starts on Yours, names every control, and says how to begin', async () => {
    await visit('/workshop');
    expect(
      await screen.findByRole('heading', { name: 'Make it yours' }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Make your own' }).getAttribute('href')).toBe(
      '/workshop/new',
    );
    // The Import sheet opens over the home, by its address.
    expect(screen.getByRole('link', { name: 'Import a file or a link' }).getAttribute('href')).toBe(
      '/workshop?import=',
    );
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Workshop' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(namelessControls()).toEqual([]);
  });

  it('lists what the player made, each opening its editor, and chips narrow it by kind', async () => {
    const row = await mine();
    await visit('/workshop');
    const gift = await screen.findByRole('link', { name: /^Gift/ }, { timeout: WAIT });
    expect(gift.getAttribute('href')).toBe(`/workshop/edit/feat/Gift%7CHB?file=${row.id}`);
    expect(gift.textContent).toContain('Feat, Lantern Coast');
    expect(within(gift).getByText('New')).toBeTruthy();
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['All2', 'Feats1', 'Spells1']);
    fireEvent.click(within(chips).getByRole('button', { name: 'Spells, 1' }));
    expect(screen.queryByRole('link', { name: /^Gift/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^Glimmer Bolt/ })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });

  it('shows each collection as a card, a compendium as one, and the books last', async () => {
    await mine();
    await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: 'IMP', full: 'Imported Brews' }] },
        feat: [{ name: 'Glimmer', source: 'IMP', entries: ['Glow.'] }],
      },
      'imported.json',
    );
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
    await visit('/workshop?shelf=collections');
    const main = screen.getByRole('main');
    const cards = await waitFor(
      () => {
        const list = within(main)
          .getAllByRole('link')
          .filter((l) =>
            /^\/(workshop\/collection\/|settings$)/.test(l.getAttribute('href') ?? ''),
          );
        expect(list).toHaveLength(4);
        return list;
      },
      { timeout: WAIT },
    );
    expect(cards.map((c) => c.textContent)).toEqual([
      'all.xml, A compendium of 2 books, 2 entries. On',
      'imported.json, A homebrew file you imported, 1 entry. On',
      'Lantern Coast, Yours. Made in this app, 2 entries. On',
      'The books, Game data harness, Choose which books show, in Settings',
    ]);
    expect(screen.getByRole('link', { name: 'Import or manage files' }).getAttribute('href')).toBe(
      '/homebrew',
    );
    expect(screen.getByRole('link', { name: 'Import a file or a link' }).getAttribute('href')).toBe(
      '/workshop?shelf=collections&import=',
    );
    expect(namelessControls()).toEqual([]);
  });

  it('opens the Import sheet from a shelf and closes it back to the same shelf', async () => {
    const router = await visit('/workshop?shelf=collections');
    fireEvent.click(
      await screen.findByRole('link', { name: 'Import a file or a link' }, { timeout: WAIT }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Import' }, { timeout: WAIT });
    expect(
      within(within(sheet).getByRole('group', { name: 'Bring in' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['A file', 'A link', 'Text']);
    expect(namelessControls()).toEqual([]);
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull(), {
      timeout: WAIT,
    });
    expect(router.state.location.search).toBe('?shelf=collections');
    // The sheet has no trigger to hand focus back to: the home gives it to the way in.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('link', { name: 'Import a file or a link' }),
      ),
    );
  });

  it('lands a pasted file as a collection, says so, and shows it under Collections', async () => {
    const router = await visit('/workshop');
    fireEvent.click(
      await screen.findByRole('link', { name: 'Import a file or a link' }, { timeout: WAIT }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Import' }, { timeout: WAIT });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Text' }));
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^Paste a homebrew file/ }), {
      target: {
        value: JSON.stringify({
          _meta: { sources: [{ json: 'TWG', full: 'Tidewater Grimoire' }] },
          spell: [{ name: 'Riptide', source: 'TWG', level: 1, entries: ['Pull.'] }],
        }),
      },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Read it' }));
    const preview = await screen.findByRole(
      'dialog',
      { name: 'Import "Tidewater Grimoire.json"?' },
      { timeout: WAIT },
    );
    fireEvent.click(within(preview).getByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText(
        'Imported "Tidewater Grimoire.json" (1 spell)',
        {},
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    expect(router.state.location.search).toBe('?shelf=collections');
    expect(
      await screen.findByRole('link', { name: /^Tidewater Grimoire\.json/ }, { timeout: WAIT }),
    ).toBeTruthy();
    // From the empty Yours shelf to Collections: focus goes to the way in there.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('link', { name: 'Import a file or a link' }),
      ),
    );
    await waitFor(
      () =>
        expect(getAnnouncerState().messages.map((m) => m.text)).toContain(
          'Imported "Tidewater Grimoire.json" (1 spell)',
        ),
      { timeout: WAIT },
    );
  });

  it('lists the table rules by the value each plays by, opening the Rules page', async () => {
    setAppTableRule('critDamage', 'maxPlusRoll');
    try {
      await visit('/workshop');
      shelf('Rules');
      const crit = await screen.findByRole('link', { name: /^Critical hits/ }, { timeout: WAIT });
      expect(crit.textContent).toContain('Max the dice, then roll them');
      expect(screen.getByRole('link', { name: /^Rest length/ }).textContent).toContain(
        'Short 1 hour',
      );
      expect(await screen.findByText(/^None yet/, {}, { timeout: WAIT })).toBeTruthy();
      expect(namelessControls()).toEqual([]);
      fireEvent.click(crit);
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Rules' }, { timeout: WAIT }),
      ).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe(
        '/settings',
      );
      expect(
        screen.getByRole('link', { name: 'Open the Homebrew page' }).getAttribute('href'),
      ).toBe('/homebrew');
    } finally {
      setAppTableRule('critDamage', undefined);
    }
  });

  it('searches theirs first, then their collections, then the books', async () => {
    const row = await mine();
    await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: 'IMP', full: 'Imported Brews' }] },
        feat: [{ name: 'Glimmer', source: 'IMP', entries: ['Glow.'] }],
      },
      'imported.json',
    );
    await visit('/workshop');
    await screen.findByRole('link', { name: /^Gift/ }, { timeout: WAIT });
    fireEvent.change(screen.getByRole('searchbox', { name: /^Search/ }), {
      target: { value: 'gli' },
    });
    const books = await screen.findByRole('region', { name: 'In the books' }, { timeout: WAIT });
    const yours = screen.getByRole('region', { name: 'Yours' });
    expect(within(yours).getByRole('link').getAttribute('href')).toBe(
      `/workshop/edit/spell/Glimmer%20Bolt%7CHB?file=${row.id}`,
    );
    const theirs = screen.getByRole('region', { name: 'In your collections' });
    expect(within(theirs).getByRole('link').getAttribute('href')).toBe(
      '/library/feat/glimmer%7Cimp',
    );
    expect(within(books).getByRole('link').getAttribute('href')).toBe(
      '/library/spell/glimmer%7Cphb',
    );
    // Their own files are in the index too; the index's hit for Gift is left to Yours.
    expect(screen.queryByText('Gift')).toBeNull();
    // The shelves give way to the results.
    expect(screen.queryByRole('group', { name: 'Shelf' })).toBeNull();
  });

  it('still finds theirs when the books cannot be searched', async () => {
    search.ready = false;
    await mine();
    await visit('/workshop');
    await screen.findByRole('link', { name: /^Gift/ }, { timeout: WAIT });
    fireEvent.change(screen.getByRole('searchbox', { name: /^Search/ }), {
      target: { value: 'gift' },
    });
    expect(
      await screen.findByText(
        'Your collections and the books cannot be searched right now.',
        {},
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Yours' })).getByRole('link', { name: /^Gift/ }),
    ).toBeTruthy();
  });

  it("finds a friend's Workshop file under their collections, though it shares the player's source", async () => {
    // Every device's Workshop file is `MyHomebrew`; a character brought in
    // from a friend brings theirs with it.
    const theirs = await homebrewRepo.createEditable('Lantern Coast', 'MyHomebrew');
    await homebrewRepo.saveEditable(theirs.id, {
      ...(theirs.json as Record<string, unknown>),
      feat: [{ name: 'Ember Gift', source: 'MyHomebrew', entries: ['Mine.'] }],
    });
    await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: 'MyHomebrew', full: 'My homebrew' }] },
        feat: [{ name: 'Ember Ward', source: 'MyHomebrew', entries: ["A friend's."] }],
      },
      'My_homebrew.json',
    );
    search.hits = [
      hit('feat', 'Ember Gift', 'MyHomebrew'),
      hit('feat', 'Ember Ward', 'MyHomebrew'),
    ];
    await visit('/workshop');
    await screen.findByRole('link', { name: /^Ember Gift/ }, { timeout: WAIT });
    fireEvent.change(screen.getByRole('searchbox', { name: /^Search/ }), {
      target: { value: 'ember' },
    });
    const collected = await screen.findByRole(
      'region',
      { name: 'In your collections' },
      { timeout: WAIT },
    );
    expect(
      within(collected)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toEqual(['/library/feat/ember%20ward%7Cmyhomebrew']);
    // The player's own is listed once, under Yours.
    expect(
      within(screen.getByRole('region', { name: 'Yours' }))
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([expect.stringMatching(/^Ember Gift/)]);
  });

  it('asks again when the index is rebuilt behind the same query, and says nothing new', async () => {
    search.hits = [hit('spell', 'Glimmer', 'PHB')];
    await visit('/workshop');
    fireEvent.change(screen.getByRole('searchbox', { name: /^Search/ }), {
      target: { value: 'gli' },
    });
    const books = await screen.findByRole('region', { name: 'In the books' }, { timeout: WAIT });
    await waitFor(() => expect(getAnnouncerState().emitted).toBe(1), { timeout: WAIT });
    resetAnnouncer();
    const asked = search.asked;

    // More of the books land, and the index is built again.
    search.hits = [hit('spell', 'Glimmer', 'PHB'), hit('item', 'Glimmering Orb', 'PHB')];
    act(() => {
      invalidateRegistry();
      markDataChanged();
    });
    await within(books).findByRole('link', { name: /^Glimmering Orb/ }, { timeout: WAIT });
    expect(search.asked).toBeGreaterThan(asked);
    expect(within(books).getByRole('link', { name: /^Glimmering Orb/ }).textContent).toContain(
      'Item, ',
    );
    // Past the announcer's settle: the count is not said again.
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(getAnnouncerState().emitted).toBe(0);
  });

  it('lights the Workshop tab on the Homebrew page it still links to', async () => {
    const router = await visit('/workshop');
    await act(() => router.navigate('/homebrew'));
    await screen.findByRole('heading', { level: 1, name: 'Homebrew' }, { timeout: WAIT });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(nav)
        .getAllByRole('link')
        .filter((l) => l.getAttribute('aria-current') === 'page')
        .map((l) => l.textContent),
    ).toEqual(['Workshop']);
  });
});
