// @vitest-environment jsdom
// Make your own (board 2) over the app's routes: what is being made, then the
// three starts, each ending in the kind's editor with nothing saved.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { ensureSourcesVisible } from '@/data5e/sourceFilter';
import { homebrewRepo, WORKSHOP_SOURCE } from '@/db/homebrewRepo';
import { namelessControls } from '../../../tests-fixtures/a11y';
import {
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  sorcerer,
} from '../../../tests-fixtures/sheetHarness';
import { EDITORS } from './editorTypes';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

/** How long a lazily loaded page or an IndexedDB write may take on a loaded runner. */
const WAIT = 30_000;

const step = (name: string) => screen.findByRole('heading', { level: 2, name }, { timeout: WAIT });
const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');

describe('Make your own', () => {
  it('names every control, and asks what is being made first', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Make your own' }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(await step('What are you making?')).toBeTruthy();
    expect(namelessControls()).toEqual([]);
    expect(document.title).toBe('Make your own · Workshop · Cast Guidance');
    // Each kind by its name alone, with what it holds as its description.
    const feats = screen.getByRole('link', { name: 'Feats' });
    expect(feats.getAttribute('href')).toBe('/workshop/new?kind=feat');
    expect(feats.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Optional features' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Species / Races' }).getAttribute('href')).toBe(
      '/workshop/new?kind=race',
    );
    // On the board as Later: shown, not a way in.
    expect(screen.getByText('Creatures and companions')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Creatures and companions' })).toBeNull();
  });

  it('offers three starts, the first opening the empty editor, and keeps the collection', async () => {
    const mine = await homebrewRepo.createEditable('Mine', 'MINE');
    const sheet = await renderSheet(sorcerer());
    await sheet.visit(`/workshop/new?file=${mine.id}`);
    fireEvent.click(await screen.findByRole('link', { name: 'Feats' }, { timeout: WAIT }));
    const heading = await step('A new feat: start from');
    // The next step has the keyboard.
    expect(document.activeElement).toBe(heading);
    expect(href('From nothing')).toBe(`/workshop/new/feat?file=${mine.id}`);
    expect(href('Like something that exists')).toBe(
      `/workshop/new?kind=feat&from=like&file=${mine.id}`,
    );
    expect(href('From text you paste')).toBe(`/workshop/new?kind=feat&from=text&file=${mine.id}`);

    fireEvent.click(screen.getByRole('link', { name: 'From nothing' }));
    expect(await screen.findByLabelText('Name', {}, { timeout: WAIT })).toBeTruthy();
    expect(sheet.router.state.location.pathname).toBe('/workshop/new/feat');
    expect(sheet.router.state.location.search).toBe(`?file=${mine.id}`);
  });

  it('does not offer a class or subclass from pasted text: its text is in its features', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=class');
    await step('A new class: start from');
    expect(screen.queryByRole('link', { name: 'From text you paste' })).toBeNull();
    // An address asking for it anyway lands on the starts.
    await sheet.visit('/workshop/new?kind=subclass&from=text');
    expect(await step('A new subclass: start from')).toBeTruthy();
  });

  it('steps back through the steps, then leaves for the Workshop', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop');
    fireEvent.click(await screen.findByRole('link', { name: 'Make your own' }, { timeout: WAIT }));
    fireEvent.click(await screen.findByRole('link', { name: 'Feats' }, { timeout: WAIT }));
    fireEvent.click(
      await screen.findByRole('link', { name: 'Like something that exists' }, { timeout: WAIT }),
    );
    await step('Like something: a new feat');
    fireEvent.click(screen.getByRole('button', { name: 'Back a step' }));
    await step('A new feat: start from');
    fireEvent.click(screen.getByRole('button', { name: 'Back a step' }));
    await step('What are you making?');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(sheet.router.state.location.pathname).toBe('/workshop'), {
      timeout: WAIT,
    });
  });

  it('steps back from an address opened straight, without leaving the Make sheet', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=feat&from=like');
    await step('Like something: a new feat');
    fireEvent.click(screen.getByRole('button', { name: 'Back a step' }));
    await step('A new feat: start from');
    expect(sheet.router.state.location.search).toBe('?kind=feat');
  });

  it("goes up to the Workshop from the first step when it was the tab's first page", async () => {
    // The harness seeds the world; then a tab whose first page is the Make sheet.
    await renderSheet(sorcerer());
    cleanup();
    const router = createMemoryRouter(routes, { initialEntries: ['/workshop/new?kind=feat'] });
    render(<RouterProvider router={router} />);
    await step('A new feat: start from');
    // Stepping back replaces the address; Back after it still knows where it began,
    // even once the sheet is mounted afresh there (back from the editor).
    fireEvent.click(screen.getByRole('button', { name: 'Back a step' }));
    await step('What are you making?');
    fireEvent.click(screen.getByRole('link', { name: 'Feats' }));
    fireEvent.click(await screen.findByRole('link', { name: 'From nothing' }, { timeout: WAIT }));
    await screen.findByLabelText('Name', {}, { timeout: WAIT });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await step('A new feat: start from');
    fireEvent.click(screen.getByRole('button', { name: 'Back a step' }));
    await step('What are you making?');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/workshop'), {
      timeout: WAIT,
    });
  });
});

describe('Make your own, like something that exists', () => {
  it('finds one in the books and copies it under a new name, the original kept', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=feat&from=like');
    const search = await screen.findByRole(
      'searchbox',
      { name: 'Search feats: yours, your collections and the books' },
      { timeout: WAIT },
    );
    expect(screen.getByText('Type a name to find a feat to copy.')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'tou' } });
    const books = await screen.findByRole('region', { name: 'In the books' }, { timeout: WAIT });
    const tough = within(books).getByRole('link', { name: /^Tough/ });
    expect(tough.getAttribute('href')).toBe('/workshop/new?kind=feat&from=like&pick=Tough%7CPHB');

    tough.focus();
    fireEvent.click(tough);
    // The keyboard lands on the step, though its data loads after the address changes.
    const based = await step('A new feat, based on Tough');
    await waitFor(() => expect(document.activeElement).toBe(based));
    const name = screen.getByLabelText('Name');
    expect((name as HTMLInputElement).value).toBe('Tough');
    expect(screen.getByText(/Same name as the one you copied/)).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Tougher' } });
    expect(screen.getByText('A new feat, beside Tough.')).toBeTruthy();
    const open = screen.getByRole('link', { name: 'Open in the editor' });
    expect(open.getAttribute('href')).toBe('/workshop/copy/feat/Tough%7CPHB?name=Tougher');

    fireEvent.click(open);
    expect(await screen.findByDisplayValue('Tougher', {}, { timeout: WAIT })).toBeTruthy();
    expect(screen.getByText('Based on Tough')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Tougher' })).toBeTruthy();
    expect(await homebrewRepo.ownedSafe()).toMatchObject({ files: [] });
  });

  it("lists the player's own first, apart from a friend's and the books", async () => {
    await homebrewRepo.saveEntry('feat', { name: 'Tough as Nails', source: WORKSHOP_SOURCE });
    // A friend's Workshop file, imported: the same book, not the player's own.
    await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: WORKSHOP_SOURCE, full: 'My homebrew' }] },
        feat: [{ name: 'Tough Friend', source: WORKSHOP_SOURCE, entries: ['Theirs.'] }],
      },
      'friend.json',
    );
    await ensureSourcesVisible([WORKSHOP_SOURCE]);
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=feat&from=like');
    fireEvent.change(
      await screen.findByRole('searchbox', { name: /^Search feats/ }, { timeout: WAIT }),
      { target: { value: 'tough' } },
    );
    const yours = await screen.findByRole('region', { name: 'Yours' }, { timeout: WAIT });
    expect(
      within(yours)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([expect.stringMatching(/^Tough as Nails/)]);
    const theirs = screen.getByRole('region', { name: 'In your collections' });
    expect(
      within(theirs)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([expect.stringMatching(/^Tough Friend/)]);
    const books = screen.getByRole('region', { name: 'In the books' });
    expect(
      within(books)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual([expect.stringMatching(/^Tough/)]);
  });

  it('says so when nothing has the name', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=feat&from=like');
    fireEvent.change(
      await screen.findByRole('searchbox', { name: /^Search feats/ }, { timeout: WAIT }),
      { target: { value: 'zzz' } },
    );
    expect(
      await screen.findByText(/Nothing called .zzz.\. Try a shorter word\./, {}, { timeout: WAIT }),
    ).toBeTruthy();
  });
});

describe('Make your own, from text you paste', () => {
  const BOLT =
    'A flash of light streaks toward a creature of your choice within range. Make a ranged spell attack against the target. On a hit, the target takes 4d6 radiant damage.';

  it('ticks what the spell reader finds, and the editor opens with the kept ones in', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=spell&from=text');
    fireEvent.change(await screen.findByLabelText('Paste the text', {}, { timeout: WAIT }), {
      target: { value: BOLT },
    });
    const damage = await screen.findByRole(
      'checkbox',
      { name: /^4d6 radiant damage/ },
      { timeout: WAIT },
    );
    const attack = screen.getByRole('checkbox', { name: /^Ranged spell attack/ });
    expect((damage as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('2 of 2 kept')).toBeTruthy();
    // The attack is wrong, say: it stays in the text, and is not filled in.
    fireEvent.click(attack);
    expect(screen.getByText('1 of 2 kept')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open in the editor' }));
    await waitFor(() => expect(sheet.router.state.location.pathname).toBe('/workshop/new/spell'), {
      timeout: WAIT,
    });
    const seed = (sheet.router.state.location.state as { seed: Record<string, unknown> }).seed;
    expect(seed.entries).toEqual([expect.stringContaining('takes {@damage 4d6} radiant damage')]);
    expect(seed.spellAttack).toBeUndefined();
    expect(seed.damageInflict).toEqual(['radiant']);
    // Nothing saved: the editor has it, under no name yet.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'New spell' }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(await homebrewRepo.ownedSafe()).toMatchObject({ files: [] });
  });

  it('says when the spell reader could not load, and tries again when asked', async () => {
    const get = EDITORS.get.bind(EDITORS);
    const offline = vi
      .spyOn(EDITORS, 'get')
      .mockImplementation((type) =>
        type === 'spell' ? () => Promise.reject(new Error('You are offline')) : get(type),
      );
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=spell&from=text');
    expect(
      await screen.findByText(
        /^The spell reader could not load: You are offline/,
        {},
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    // The text can still go to the editor, into Text.
    fireEvent.change(screen.getByLabelText('Paste the text'), { target: { value: BOLT } });
    expect(
      screen.getByRole('button', { name: 'Open in the editor' }).hasAttribute('disabled'),
    ).toBe(false);

    offline.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('checkbox', { name: /^4d6 radiant damage/ }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(screen.queryByText(/could not load/)).toBeNull();
  });

  it('puts the text of any other kind into Text, and fills nothing else', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new?kind=feat&from=text');
    const box = await screen.findByLabelText('Paste the text', {}, { timeout: WAIT });
    const open = screen.getByRole('button', { name: 'Open in the editor' });
    expect(open.hasAttribute('disabled')).toBe(true);
    fireEvent.change(box, { target: { value: 'You are hard to move.\n\nYou stand your ground.' } });
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(open);
    await waitFor(() => expect(sheet.router.state.location.pathname).toBe('/workshop/new/feat'), {
      timeout: WAIT,
    });
    expect(sheet.router.state.location.state).toEqual({
      seed: { entries: ['You are hard to move.', 'You stand your ground.'] },
    });
    expect(
      await screen.findByDisplayValue(/You are hard to move\./, {}, { timeout: WAIT }),
    ).toBeTruthy();
  });
});
