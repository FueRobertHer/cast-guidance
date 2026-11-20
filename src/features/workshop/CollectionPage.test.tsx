// @vitest-environment jsdom
// A collection's page over the app's routes (ADR-002, D1; board 8): each job
// the Homebrew page's file card and the Builder did. Turn it on or off, for
// the device and for each character; open, rename and delete an entry;
// export; delete the collection; The books. Bugs 1, 2 and 4 of the plan's
// list each have a case here. Updates and Needs a look are in
// `CollectionPage.update.test.tsx`.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { policyAllows, readSourcePolicy, writeSourcePolicy } from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import type { CharacterDoc } from '@/engine/types';
import { downloadJson } from '@/lib/download';
import { namelessControls } from '../../../tests-fixtures/a11y';
import {
  classEntry,
  HARNESS_TIMEOUT,
  resetSheetHarness,
  seedWorld,
  testCharacter,
} from '../../../tests-fixtures/sheetHarness';
import { BOOKS_PATH, collectionPath, collectionsOf } from './collections';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);
vi.mock('@/lib/download', async (actual) => ({
  ...(await actual<typeof import('@/lib/download')>()),
  downloadJson: vi.fn(),
}));

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(async () => {
  vi.mocked(downloadJson).mockClear();
  await resetSheetHarness();
});

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
const heading = (name: string) =>
  screen.findByRole('heading', { level: 1, name }, { timeout: WAIT });
const switchesOf = async (id: string) => (await characterRepo.get(id))?.sourceSwitches;
const json = async (id: string) => (await homebrewRepo.getSafe(id)).file?.json ?? {};

const IMPORTED = {
  _meta: { sources: [{ json: 'IMP', full: 'Imported Brews' }] },
  feat: [{ name: 'Glimmer', source: 'IMP', entries: ['Glow.'] }],
  race: [{ name: 'Lanternfolk', source: 'IMP', entries: ['Bright.'] }],
};

async function character(name: string, over: Partial<CharacterDoc> = {}) {
  return characterRepo.create({ ...testCharacter(name, [classEntry('Fighter', 1)]), ...over });
}

/** The address the home links a file's collection by. */
async function addressOf(fileId: string): Promise<string> {
  const c = collectionsOf(await db.homebrewFiles.toArray()).find((x) =>
    x.rows.some((r) => r.id === fileId),
  );
  if (c === undefined) throw new Error('no collection');
  return collectionPath(c.id);
}

/** Answer the row's More menu with `choice`. */
async function more(entry: string, choice: string) {
  fireEvent.click(screen.getByRole('button', { name: `More for ${entry}` }));
  const menu = await screen.findByRole('dialog', { name: entry }, { timeout: WAIT });
  fireEvent.click(within(menu).getByRole('button', { name: new RegExp(`^${choice}`) }));
}

describe('a collection page', () => {
  it('names the collection, turns it off and on, and leads to the Homebrew page', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    expect(await heading('imported.json')).toBeTruthy();
    // The title is set in an effect, which can run after the heading shows.
    await waitFor(() => expect(document.title).toBe('imported.json · Workshop · Cast Guidance'), {
      timeout: WAIT,
    });
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
    expect(screen.getByRole('button', { name: 'Update from a file' })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });

  it('opens from the address of one of its rows, as links from before keys do', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    expect(row.key).toBeDefined();
    visit(`/workshop/collection/${row.id}`);
    expect(await heading('imported.json')).toBeTruthy();
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
    const [collection] = collectionsOf(rows);
    expect(collection?.id).toBe('books:all');
    const other = rows.find((r) => r.book === 'Frost Codex');
    if (other?.book === undefined) throw new Error('no second book');
    visit(`/workshop/collection/${other.id}`);
    await heading('all.xml');
    const list = screen.getByRole('list', { name: 'Its books' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(expect.arrayContaining(['Use Ember Codex', 'Use Frost Codex']));
    fireEvent.click(within(list).getByRole('button', { name: `Use ${other.book}` }));
    await waitFor(async () => expect(await enabled(other.id)).toBe(false), { timeout: WAIT });
    expect(await screen.findByText(/1 of 2 books on/, {}, { timeout: WAIT })).toBeTruthy();
    // Only the book picked is read: each lists its own entries.
    const held = await screen.findByRole('list', { name: 'In all.xml' }, { timeout: WAIT });
    await within(held).findByText('Ember Ward', {}, { timeout: WAIT });
    fireEvent.change(screen.getByRole('combobox', { name: 'Book' }), {
      target: { value: other.id },
    });
    await within(screen.getByRole('list', { name: 'In all.xml' })).findByText(
      'Frost Ward',
      {},
      { timeout: WAIT },
    );
    expect(screen.queryByText('Ember Ward')).toBeNull();
  });

  it('turns it off and on for one character, over the device', async () => {
    const hild = await character('Hild');
    const osk = await character('Osk');
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    await heading('imported.json');
    const chip = (who: string) =>
      screen.findByRole('button', { name: `${who} picks from it` }, { timeout: WAIT });
    expect((await chip('Osk')).getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByText(/Every character picks from it\. New characters do too\./),
    ).toBeTruthy();
    // D3's line, not the boards': the sheet keeps what it has.
    expect(screen.getByText(/what is already on its sheet keeps counting/)).toBeTruthy();

    fireEvent.click(await chip('Osk'));
    await waitFor(async () => expect(await switchesOf(osk.id)).toEqual({ off: ['IMP'] }), {
      timeout: WAIT,
    });
    expect(await switchesOf(hild.id)).toBeUndefined();
    await waitFor(
      async () => expect((await chip('Osk')).getAttribute('aria-pressed')).toBe('false'),
      {
        timeout: WAIT,
      },
    );
    expect(screen.getByText(/^Hild picks from it\. New characters do too\./)).toBeTruthy();

    // Off on the device: only a character's own On brings it back for that character.
    fireEvent.click(screen.getByRole('button', { name: 'Use imported.json' }));
    await waitFor(
      async () => expect((await chip('Hild')).getAttribute('aria-pressed')).toBe('false'),
      {
        timeout: WAIT,
      },
    );
    fireEvent.click(await chip('Hild'));
    await waitFor(async () => expect(await switchesOf(hild.id)).toEqual({ on: ['IMP'] }), {
      timeout: WAIT,
    });
    await screen.findByText(/^Hild picks from it\. New characters do not\./, {}, { timeout: WAIT });

    fireEvent.click(screen.getByRole('button', { name: 'Every character as this device' }));
    await waitFor(
      async () => {
        expect(await switchesOf(hild.id)).toBeUndefined();
        expect(await switchesOf(osk.id)).toBeUndefined();
      },
      { timeout: WAIT },
    );
    expect(namelessControls()).toEqual([]);
  });

  it("keeps a character's other switches and old list, and writes no switch it does not need", async () => {
    // Osk lists only the books' own source, so this file is outside his list.
    const osk = await character('Osk', {
      allowedSources: ['TST'],
      sourceSwitches: { off: ['OTHER'] },
    });
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    const chip = await screen.findByRole(
      'button',
      { name: 'Osk picks from it' },
      { timeout: WAIT },
    );
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    await waitFor(
      async () => expect(await switchesOf(osk.id)).toEqual({ on: ['IMP'], off: ['OTHER'] }),
      { timeout: WAIT },
    );
    expect((await characterRepo.get(osk.id))?.allowedSources).toEqual(['TST']);
  });

  it('opens an entry of your own in its editor, in its file (bug 2)', async () => {
    const { fileId } = await homebrewRepo.saveEntry('feat', {
      name: 'Ogre Grip',
      source: 'MyHomebrew',
      entries: ['Grip.'],
    });
    const router = visit(await addressOf(fileId));
    await heading('My homebrew');
    const open = await screen.findByRole('link', { name: /^Ogre Grip/ }, { timeout: WAIT });
    const to = `/workshop/edit/feat/${encodeURIComponent('Ogre Grip|MyHomebrew')}?file=${encodeURIComponent(fileId)}`;
    expect(open.getAttribute('href')).toBe(to);
    fireEvent.click(open);
    await waitFor(
      () => expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(to),
      { timeout: WAIT },
    );
  });

  it('opens an entry in the Library by its own source, not the file’s first (bug 4)', async () => {
    const row = await homebrewRepo.importJson(
      {
        _meta: {
          sources: [
            { json: 'FCA', full: 'Ember Codex' },
            { json: 'FCB', full: 'Frost Codex' },
          ],
        },
        spell: [{ name: 'Frost Ward', source: 'FCB', level: 1 }],
      },
      'two.json',
    );
    visit(await addressOf(row.id));
    const open = await screen.findByRole('link', { name: /^Frost Ward/ }, { timeout: WAIT });
    expect(open.getAttribute('href')).toBe('/library/spell/frost%20ward%7Cfcb');

    // The same for an entry of your own under a second source, from its menu.
    const own = await homebrewRepo.createEditable('Lantern Coast', 'LC');
    await homebrewRepo.saveEntry(
      'spell',
      { name: 'Sun Lantern', source: 'LCX', level: 1, entries: ['Shine.'] },
      { fileId: own.id },
    );
    const router = visit(collectionPath(own.id));
    await heading('Lantern Coast');
    await screen.findByRole('link', { name: /^Sun Lantern/ }, { timeout: WAIT });
    await more('Sun Lantern', 'View in the Library');
    await waitFor(
      () => expect(router.state.location.pathname).toBe('/library/spell/sun%20lantern%7Clcx'),
      { timeout: WAIT },
    );
  });

  it('offers to add any kind to a collection of your own, classes too (bug 1)', async () => {
    const own = await homebrewRepo.createEditable('Lantern Coast', 'LC');
    const router = visit(collectionPath(own.id));
    await heading('Lantern Coast');
    const add = screen.getByRole('link', { name: 'Add to Lantern Coast' });
    expect(add.getAttribute('href')).toBe(`/workshop/new?file=${encodeURIComponent(own.id)}`);
    expect(screen.getByRole('main').textContent).not.toMatch(/JSON/);
    fireEvent.click(add);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Make your own' }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Classes/ })).toBeTruthy();
    expect(router.state.location.search).toBe(`?file=${encodeURIComponent(own.id)}`);
  });

  it('renames an entry of your own, and deletes one, saying who has it', async () => {
    const { fileId } = await homebrewRepo.saveEntry('feat', {
      name: 'Ogre Grip',
      source: 'MyHomebrew',
      entries: ['Grip.'],
    });
    await homebrewRepo.saveEntry('race', {
      name: 'Lanternfolk',
      source: 'MyHomebrew',
      entries: ['Bright.'],
    });
    await character('Hild', { race: { name: 'Lanternfolk', source: 'MyHomebrew' } });
    visit(await addressOf(fileId));
    await screen.findByRole('link', { name: /^Ogre Grip/ }, { timeout: WAIT });

    await more('Ogre Grip', 'Rename');
    const name = await screen.findByRole(
      'textbox',
      { name: 'Rename Ogre Grip' },
      { timeout: WAIT },
    );
    fireEvent.change(name, { target: { value: 'Ogre Hold' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(
      async () =>
        expect(((await json(fileId)).feat as { name: string }[]).map((f) => f.name)).toEqual([
          'Ogre Hold',
        ]),
      { timeout: WAIT },
    );
    await screen.findByRole('link', { name: /^Ogre Hold/ }, { timeout: WAIT });

    await more('Lanternfolk', 'Delete');
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete Lanternfolk?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain('Hild has Lanternfolk.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await json(fileId)).race).toEqual([]), { timeout: WAIT });
  });

  it('exports the file as it leaves this device', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    await heading('imported.json');
    fireEvent.click(screen.getByRole('button', { name: 'Export a file' }));
    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1), { timeout: WAIT });
    expect(vi.mocked(downloadJson).mock.calls[0]).toEqual(['imported.json', IMPORTED]);
  });

  it('deletes the collection, saying who loses what first', async () => {
    await character('Hild', { race: { name: 'Lanternfolk', source: 'IMP' } });
    await character('Osk');
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    const router = visit(await addressOf(row.id));
    await heading('imported.json');
    fireEvent.click(screen.getByRole('button', { name: 'Delete this collection' }));
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete imported.json?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain('Hild has Lanternfolk.');
    expect(ask.textContent).not.toContain('Osk');
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await db.homebrewFiles.count()).toBe(0), { timeout: WAIT });
    await waitFor(
      () =>
        expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
          '/workshop?shelf=collections',
        ),
      { timeout: WAIT },
    );
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
    await waitFor(
      () => expect(document.title).toBe('Collection not found · Workshop · Cast Guidance'),
      { timeout: WAIT },
    );
    expect(screen.getByRole('link', { name: 'Back to the Workshop' }).getAttribute('href')).toBe(
      '/workshop?shelf=collections',
    );
  });
});

describe('The books', () => {
  it('lists the books to show, and leaves the collections to their own pages', async () => {
    await seedWorld();
    await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(BOOKS_PATH);
    expect(await heading('The books')).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('The books · Workshop · Cast Guidance'), {
      timeout: WAIT,
    });
    expect(screen.getByText('Game data harness')).toBeTruthy();
    const books = screen.getByRole('region', { name: 'Which books show' });
    await within(books).findByText(/^Showing all \d+ downloaded sources\.$/, {}, { timeout: WAIT });
    expect(within(books).queryByText('Homebrew')).toBeNull();
    expect(within(books).queryByText('Imported Brews')).toBeNull();
    expect(namelessControls()).toEqual([]);
  });

  it('keeps every collection as it was when a choice of books is picked', async () => {
    await seedWorld();
    await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(BOOKS_PATH);
    await heading('The books');
    const books = screen.getByRole('region', { name: 'Which books show' });
    // The choices wait for the collections' sources, which tell a book from a collection.
    fireEvent.click(
      await within(books).findByRole('button', { name: '2024 core only' }, { timeout: WAIT }),
    );
    await waitFor(async () => expect(policyAllows(await readSourcePolicy(), 'XPHB')).toBe(true), {
      timeout: WAIT,
    });
    const policy = await readSourcePolicy();
    expect(policyAllows(policy, 'PHB')).toBe(false);
    // The collection is not on this page, and stays shown: its own page has its switch.
    expect(policyAllows(policy, 'IMP')).toBe(true);
    await waitFor(
      () =>
        expect(
          within(books)
            .getByRole('button', { name: '2024 core only' })
            .getAttribute('aria-pressed'),
        ).toBe('true'),
      { timeout: WAIT },
    );
  });

  it('shows every book again from an empty choice, and keeps each collection as it was', async () => {
    await seedWorld();
    await homebrewRepo.importJson(IMPORTED, 'imported.json');
    // No book shows, and neither does the collection, which the player hid.
    await writeSourcePolicy({ mode: 'only', sources: [] });
    visit(BOOKS_PATH);
    await heading('The books');
    const books = screen.getByRole('region', { name: 'Which books show' });
    fireEvent.click(
      await within(books).findByRole('button', { name: 'Show everything' }, { timeout: WAIT }),
    );
    await waitFor(async () => expect(policyAllows(await readSourcePolicy(), 'TST')).toBe(true), {
      timeout: WAIT,
    });
    expect(policyAllows(await readSourcePolicy(), 'IMP')).toBe(false);
  });

  it('names the choice of books after a collection it kept is deleted', async () => {
    await seedWorld();
    // "2024 core only" picked with a collection kept shown, then the collection deleted.
    await writeSourcePolicy({ mode: 'only', sources: ['XDMG', 'XMM', 'XPHB', 'GONE'] });
    visit(BOOKS_PATH);
    await heading('The books');
    const books = screen.getByRole('region', { name: 'Which books show' });
    await waitFor(
      () =>
        expect(
          within(books)
            .getByRole('button', { name: '2024 core only' })
            .getAttribute('aria-pressed'),
        ).toBe('true'),
      { timeout: WAIT },
    );
  });

  it('turned on for a character, reaches only the copies this device uses', async () => {
    const osk = await character('Osk');
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    // An older copy under the same key, switched off on this device.
    const meta = await db.homebrewFiles.get(row.id);
    if (meta === undefined) throw new Error('no row');
    await db.homebrewFiles.add({
      ...meta,
      id: 'older-copy',
      enabled: false,
      addedAt: meta.addedAt - 1,
    });
    await db.homebrewJson.add({ id: 'older-copy', json: IMPORTED });
    visit(await addressOf(row.id));
    const chip = () =>
      screen.findByRole('button', { name: 'Osk picks from it' }, { timeout: WAIT });
    fireEvent.click(await chip());
    await waitFor(async () => expect(await switchesOf(osk.id)).toEqual({ off: ['IMP'] }), {
      timeout: WAIT,
    });
    await waitFor(async () => expect((await chip()).getAttribute('aria-pressed')).toBe('false'), {
      timeout: WAIT,
    });
    fireEvent.click(await chip());
    // No `on`: a switch naming its source would bring the copy switched off here back for Osk (E4).
    await waitFor(async () => expect(await switchesOf(osk.id)).toBeUndefined(), { timeout: WAIT });
  });

  it('names who holds an entry under a source its file does not declare, before deleting', async () => {
    await character('Hild', { race: { name: 'Mothkin', source: 'IMX' } });
    const row = await homebrewRepo.importJson(
      { ...IMPORTED, race: [{ name: 'Mothkin', source: 'IMX', entries: ['Soft.'] }] },
      'imported.json',
    );
    visit(await addressOf(row.id));
    await heading('imported.json');
    fireEvent.click(screen.getByRole('button', { name: 'Delete this collection' }));
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete imported.json?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain('Hild has Mothkin.');
  });
});
