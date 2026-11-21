// @vitest-environment jsdom
// A collection's page over the app's routes (ADR-002, D1; board 8): every job
// done on one stored file or compendium. Turn it on or off, for
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
import { getRegistry } from '@/data5e/registry';
import { registryViewFor } from '@/data5e/registryView';
import { policyAllows, readSourcePolicy, writeSourcePolicy } from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { CHANGES_SOURCE, homebrewRepo } from '@/db/homebrewRepo';
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

/** Pick a compendium's book by its name in the Book list. */
function pickBook(name: string) {
  const box = screen.getByRole('combobox', { name: 'Book' });
  const option = within(box).getByRole<HTMLOptionElement>('option', { name });
  fireEvent.change(box, { target: { value: option.value } });
}

/** Answer the row's More menu with `choice`. */
async function more(entry: string, choice: string) {
  fireEvent.click(screen.getByRole('button', { name: `More for ${entry}` }));
  const menu = await screen.findByRole('dialog', { name: entry }, { timeout: WAIT });
  fireEvent.click(within(menu).getByRole('button', { name: new RegExp(`^${choice}`) }));
}

describe('a collection page', () => {
  it('names the collection, turns it off and on, and offers its update', async () => {
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
    // Its jobs are all here: nothing leads to another page to do them.
    expect(
      screen
        .getAllByRole('link')
        .filter((l) => (l.getAttribute('href') ?? '').startsWith('/homebrew')),
    ).toEqual([]);
    expect(screen.getByRole('button', { name: 'Update from a file' })).toBeTruthy();
    expect(namelessControls()).toEqual([]);
  });

  it('opens from the address of one of its rows, as links from before keys do', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    expect(row.key).toBeDefined();
    visit(`/workshop/collection/${row.id}`);
    expect(await heading('imported.json')).toBeTruthy();
  });

  it('goes up to Collections from an old Builder link opened in a new tab', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    // The redirect and the page's own address each replace the tab's first
    // entry: Back still goes up, not out of the app.
    const router = visit(`/homebrew/edit/${row.id}`);
    expect(await heading('imported.json')).toBeTruthy();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/workshop/collection/${encodeURIComponent(row.key ?? '')}`,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe(
        '/workshop?shelf=collections',
      ),
    );
  });

  it('steps back to the page an old Builder link was followed from', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    const router = createMemoryRouter(routes, {
      initialEntries: ['/settings', `/homebrew/edit/${row.id}`],
      initialIndex: 1,
    });
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    expect(await heading('imported.json')).toBeTruthy();
    await waitFor(() => expect(router.state.location.pathname).not.toContain(row.id));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
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
    pickBook('Frost Codex');
    await within(screen.getByRole('list', { name: 'In all.xml' })).findByText(
      'Frost Ward',
      {},
      { timeout: WAIT },
    );
    expect(screen.queryByText('Ember Ward')).toBeNull();
  });

  it('keeps the book picked when an update brings its books in again', async () => {
    const codex = (ward: string) => ({
      _meta: {
        sources: [
          { json: 'FCA', full: 'Ember Codex' },
          { json: 'FCB', full: 'Frost Codex' },
        ],
        convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' },
      },
      spell: [
        { name: 'Ember Ward', source: 'FCA', level: 1 },
        { name: ward, source: 'FCB', level: 1 },
      ],
    });
    await homebrewRepo.commitBooks(
      (await homebrewRepo.prepareBooks(codex('Frost Ward'), 'all.xml')).books,
    );
    visit(await addressOf((await db.homebrewFiles.toArray())[0]?.id ?? ''));
    await heading('all.xml');
    await screen.findByRole('list', { name: 'In all.xml' }, { timeout: WAIT });
    pickBook('Frost Codex');
    const held = () => screen.getByRole('list', { name: 'In all.xml' });
    await waitFor(() => expect(within(held()).getByText('Frost Ward')).toBeTruthy(), {
      timeout: WAIT,
    });
    // The update stores Frost Codex under a new row.
    await homebrewRepo.commitBooks(
      (await homebrewRepo.prepareBooks(codex('Frost Wall'), 'all.xml')).books,
    );
    await waitFor(() => expect(within(held()).getByText('Frost Wall')).toBeTruthy(), {
      timeout: WAIT,
    });
    expect(screen.queryByText('Ember Ward')).toBeNull();
  });

  it('opens the book picked when two books share a name', async () => {
    const { books } = await homebrewRepo.prepareBooks(
      {
        _meta: {
          sources: [
            { json: 'FCA', full: 'Codex' },
            { json: 'FCB', full: 'Codex' },
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
    expect(await db.homebrewFiles.count()).toBe(2);
    visit(await addressOf((await db.homebrewFiles.toArray())[0]?.id ?? ''));
    await screen.findByRole('list', { name: 'In all.xml' }, { timeout: WAIT });
    const box = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Book' });
    const options = within(box).getAllByRole<HTMLOptionElement>('option');
    expect(new Set(options.map((o) => o.value)).size).toBe(2);
    const shown = () => screen.getByRole('list', { name: 'In all.xml' }).textContent ?? '';
    const first = shown();
    fireEvent.change(box, { target: { value: options[1]?.value } });
    await waitFor(() => expect(shown()).not.toBe(first), { timeout: WAIT });
  });

  it('names two copies of one day by the time each came in', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    const meta = await db.homebrewFiles.get(row.id);
    if (meta === undefined) throw new Error('no row');
    // Noon and ten past, one day: apart by the time, with no number.
    const noon = new Date(2026, 0, 5, 12, 0, 0).getTime();
    await db.homebrewFiles.update(row.id, { addedAt: noon + 600_000 });
    await db.homebrewFiles.add({ ...meta, id: 'older-copy', addedAt: noon });
    await db.homebrewJson.add({ id: 'older-copy', json: IMPORTED });
    visit(await addressOf(row.id));
    const list = await screen.findByRole('list', { name: 'Its copies' }, { timeout: WAIT });
    const names = within(list)
      .getAllByRole('button', { name: /^Use / })
      .map((b) => b.getAttribute('aria-label') ?? '');
    expect(new Set(names).size).toBe(2);
    for (const n of names) {
      expect(n).toContain(new Date(noon).toLocaleDateString());
      expect(n).not.toMatch(/of 2\)$/);
    }
  });

  it('names each copy apart, even two added the same day', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    const meta = await db.homebrewFiles.get(row.id);
    if (meta === undefined) throw new Error('no row');
    await db.homebrewFiles.add({ ...meta, id: 'older-copy', addedAt: meta.addedAt - 1 });
    await db.homebrewJson.add({ id: 'older-copy', json: IMPORTED });
    visit(await addressOf(row.id));
    const list = await screen.findByRole('list', { name: 'Its copies' }, { timeout: WAIT });
    const labels = within(list)
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size).toBe(4);
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
    // What the chips say is what each character's pickers read (E4's view).
    const glimmerFor = async (id: string) => {
      const doc = await characterRepo.get(id);
      if (doc === undefined) throw new Error('no character');
      return registryViewFor(await getRegistry(), doc).get('feat', 'Glimmer', 'IMP');
    };
    expect(await glimmerFor(hild.id)).toBeDefined();
    expect(await glimmerFor(osk.id)).toBeUndefined();

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

  it('keeps each character’s switch busy until its own write ends', async () => {
    await character('Hild');
    await character('Osk');
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    await heading('imported.json');
    const chip = (who: string) =>
      screen.findByRole('button', { name: `${who} picks from it` }, { timeout: WAIT });
    // Each save waits for its own release.
    const save = characterRepo.save.bind(characterRepo);
    const gates = new Map<string, () => void>();
    const held = vi.spyOn(characterRepo, 'save').mockImplementation(async (doc, ...rest) => {
      await new Promise<void>((go) => gates.set(doc.name, go));
      return save(doc, ...rest);
    });
    try {
      fireEvent.click(await chip('Hild'));
      fireEvent.click(await chip('Osk'));
      await waitFor(() => expect([...gates.keys()].sort()).toEqual(['Hild', 'Osk']), {
        timeout: WAIT,
      });
      expect((await chip('Hild')).hasAttribute('disabled')).toBe(true);
      expect((await chip('Osk')).hasAttribute('disabled')).toBe(true);
      gates.get('Hild')?.();
      await waitFor(async () => expect((await chip('Hild')).hasAttribute('disabled')).toBe(false), {
        timeout: WAIT,
      });
      // Osk's write has not ended, so its switch is still busy.
      expect((await chip('Osk')).hasAttribute('disabled')).toBe(true);
      gates.get('Osk')?.();
      await waitFor(async () => expect((await chip('Osk')).hasAttribute('disabled')).toBe(false), {
        timeout: WAIT,
      });
    } finally {
      for (const go of gates.values()) go();
      held.mockRestore();
    }
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

  it('shows every entry again when the last of the kind picked is deleted', async () => {
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
    visit(await addressOf(fileId));
    fireEvent.click(await screen.findByRole('button', { name: 'Feats, 1' }, { timeout: WAIT }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /^Lanternfolk/ })).toBeNull(), {
      timeout: WAIT,
    });
    await more('Ogre Grip', 'Delete');
    const ask = await screen.findByRole('dialog', { name: 'Delete Ogre Grip?' }, { timeout: WAIT });
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await json(fileId)).feat).toEqual([]), { timeout: WAIT });
    // One kind is left, so no chips: the list shows it, not the empty Feats.
    expect(
      await screen.findByRole('link', { name: /^Lanternfolk/ }, { timeout: WAIT }),
    ).toBeTruthy();
  });

  it('asks to turn on only a collection that is off, not a kind the Library does not list', async () => {
    const row = await homebrewRepo.importJson(
      { ...IMPORTED, monster: [{ name: 'Gloomhound', source: 'IMP' }] },
      'imported.json',
    );
    visit(await addressOf(row.id));
    const hound = await screen.findByText('Gloomhound', {}, { timeout: WAIT });
    const item = hound.closest('li');
    expect(item?.querySelector('a')).toBeNull();
    expect(item?.textContent).not.toContain('Turn it on');
    // Off, the kinds the Library lists say how to open them; a kind it does not list, still not.
    fireEvent.click(screen.getByRole('button', { name: 'Use imported.json' }));
    await waitFor(
      () =>
        expect(screen.getByText('Glimmer').closest('li')?.textContent).toContain(
          'Turn it on to open it in the Library',
        ),
      { timeout: WAIT },
    );
    expect(screen.getByText('Gloomhound').closest('li')?.textContent).not.toContain('Turn it on');
  });

  it('exports the file as it leaves this device', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    await heading('imported.json');
    fireEvent.click(screen.getByRole('button', { name: 'Export a file' }));
    await waitFor(() => expect(downloadJson).toHaveBeenCalledTimes(1), { timeout: WAIT });
    expect(vi.mocked(downloadJson).mock.calls[0]).toEqual(['imported.json', IMPORTED]);
  });

  it('asks before turning it off on this device, naming who would lose what (finding 17)', async () => {
    await character('Hild', { race: { name: 'Lanternfolk', source: 'IMP' } });
    // Its own switch brings the collection back for it, so it loses nothing.
    await character('Osk', {
      race: { name: 'Lanternfolk', source: 'IMP' },
      sourceSwitches: { on: ['IMP'] },
    });
    await character('Brin');
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    await heading('imported.json');
    const use = screen.getByRole('button', { name: 'Use imported.json' });

    fireEvent.click(use);
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Turn off imported.json?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain('Its entries leave the sheets that have them');
    expect(ask.textContent).toContain('Hild has Lanternfolk.');
    expect(ask.textContent).not.toContain('Osk');
    expect(ask.textContent).not.toContain('Brin');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
    expect(await enabled(row.id)).toBe(true);

    fireEvent.click(use);
    const again = await screen.findByRole(
      'dialog',
      { name: 'Turn off imported.json?' },
      { timeout: WAIT },
    );
    fireEvent.click(within(again).getByRole('button', { name: 'Turn off' }));
    await waitFor(async () => expect(await enabled(row.id)).toBe(false), { timeout: WAIT });
    // On again asks nothing.
    await waitFor(() => expect(use.getAttribute('aria-pressed')).toBe('false'), { timeout: WAIT });
    fireEvent.click(use);
    await waitFor(async () => expect(await enabled(row.id)).toBe(true), { timeout: WAIT });
    expect(screen.queryByRole('dialog', { name: /^Turn off/ })).toBeNull();
  });

  it('names nobody when another copy still on serves what they have', async () => {
    await character('Hild', { race: { name: 'Lanternfolk', source: 'IMP' } });
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    const meta = await db.homebrewFiles.get(row.id);
    if (meta === undefined) throw new Error('no row');
    await db.homebrewFiles.add({ ...meta, id: 'older-copy', addedAt: 1 });
    await db.homebrewJson.add({ id: 'older-copy', json: IMPORTED });
    visit(await addressOf(row.id));
    const list = await screen.findByRole('list', { name: 'Its copies' }, { timeout: WAIT });
    const [first, second] = within(list).getAllByRole('button', { name: /^Use / });
    if (first === undefined || second === undefined) throw new Error('two switches');
    fireEvent.click(first);
    await waitFor(
      async () =>
        expect((await db.homebrewFiles.toArray()).filter((r) => !r.enabled)).toHaveLength(1),
      { timeout: WAIT },
    );
    expect(screen.queryByRole('dialog', { name: /^Turn off/ })).toBeNull();
    await waitFor(() => expect(first.getAttribute('aria-pressed')).toBe('false'), {
      timeout: WAIT,
    });
    // The last copy on does take it away.
    fireEvent.click(second);
    const ask = await screen.findByRole('dialog', { name: /^Turn off/ }, { timeout: WAIT });
    expect(ask.textContent).toContain('Hild has Lanternfolk.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
  });

  it('names only who the Changes file reaches, when it goes off', async () => {
    const { fileId } = await homebrewRepo.saveEntry(
      'feat',
      {
        name: 'Glimmer',
        source: 'IMP',
        _copy: { name: 'Glimmer', source: 'IMP' },
        entries: ['Glow.'],
      },
      { role: 'changes' },
    );
    const pick = { 'class:fighter|phb:feat:4': 'glimmer|imp' };
    await character('Osk', { choices: pick, sourceSwitches: { off: [CHANGES_SOURCE] } });
    visit(collectionPath(fileId));
    const use = await screen.findByRole('button', { name: /^Use / }, { timeout: WAIT });
    // Osk has it off already, so nothing changes for anyone: no question.
    fireEvent.click(use);
    await waitFor(async () => expect(await enabled(fileId)).toBe(false), { timeout: WAIT });
    expect(screen.queryByRole('dialog', { name: /^Turn off/ })).toBeNull();
    await waitFor(() => expect(use.getAttribute('aria-pressed')).toBe('false'), { timeout: WAIT });
    fireEvent.click(use);
    await waitFor(async () => expect(await enabled(fileId)).toBe(true), { timeout: WAIT });
    await waitFor(() => expect(use.getAttribute('aria-pressed')).toBe('true'), { timeout: WAIT });

    await character('Hild', { choices: pick });
    fireEvent.click(use);
    const ask = await screen.findByRole('dialog', { name: /^Turn off/ }, { timeout: WAIT });
    expect(ask.textContent).toContain('Every entry it changes is the book’s again');
    expect(ask.textContent).toContain('Hild has Glimmer.');
    expect(ask.textContent).not.toContain('Osk');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
  });

  it('names an entry as its file does, though a pick holds it lowercased (F26)', async () => {
    const { fileId } = await homebrewRepo.saveEntry('feat', {
      name: 'Solar Tactician',
      source: 'MyHomebrew',
      entries: ['Plan.'],
    });
    await character('Hild', {
      choices: { 'class:fighter|phb:feat:4': 'solar tactician|myhomebrew' },
    });
    visit(await addressOf(fileId));
    await screen.findByRole('link', { name: /^Solar Tactician/ }, { timeout: WAIT });
    await more('Solar Tactician', 'Delete');
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete Solar Tactician?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain('Hild has Solar Tactician.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
  });

  it('renames a class of your own from its menu, its features with it (F26)', async () => {
    const { fileId } = await homebrewRepo.saveEntry(
      'class',
      {
        name: 'Warden',
        source: 'MyHomebrew',
        hd: { number: 1, faces: 10 },
        classFeatures: ['Vigil|Warden|MyHomebrew|1|MyHomebrew'],
      },
      {
        owned: [
          {
            name: 'Vigil',
            source: 'MyHomebrew',
            className: 'Warden',
            classSource: 'MyHomebrew',
            level: 1,
            entries: ['Watch.'],
          },
        ],
      },
    );
    visit(await addressOf(fileId));
    await screen.findByRole('link', { name: /^Warden/ }, { timeout: WAIT });
    await more('Warden', 'Rename');
    const name = await screen.findByRole('textbox', { name: 'Rename Warden' }, { timeout: WAIT });
    fireEvent.change(name, { target: { value: 'Keeper' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(
      async () =>
        expect((await json(fileId)).class).toMatchObject([
          { name: 'Keeper', classFeatures: ['Vigil|Keeper|MyHomebrew|1|MyHomebrew'] },
        ]),
      { timeout: WAIT },
    );
    expect((await json(fileId)).classFeature).toMatchObject([
      { name: 'Vigil', className: 'Keeper' },
    ]);
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

  it('deletes a collection that could not be read, the one place that can', async () => {
    const real = homebrewRepo.listMetaSafe.bind(homebrewRepo);
    // No stored row reads back this way today (a row the list cannot read
    // has no id), so the read is given one: this pins the page's own branch.
    const read = vi.spyOn(homebrewRepo, 'listMetaSafe').mockImplementation(async () => ({
      ...(await real()),
      errors: [{ id: 'broken-1', fileName: 'broken.json', message: 'the file content is missing' }],
    }));
    const remove = vi.spyOn(homebrewRepo, 'delete');
    try {
      visit('/workshop/collection/broken-1');
      expect(
        await screen.findByText(
          'This collection is on this device but could not be read: the file content is missing.',
          {},
          { timeout: WAIT },
        ),
      ).toBeTruthy();
      await waitFor(
        () => expect(document.title).toBe('Collection unreadable · Workshop · Cast Guidance'),
        { timeout: WAIT },
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete it' }));
      const ask = await screen.findByRole(
        'dialog',
        { name: 'Delete this collection?' },
        { timeout: WAIT },
      );
      expect(ask.textContent).toContain('It could not be read, so what it held is not known.');
      fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(remove).toHaveBeenCalledWith('broken-1'), { timeout: WAIT });
    } finally {
      read.mockRestore();
      remove.mockRestore();
    }
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
    // Answered, so no open dialog hides the next test's page.
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
    expect(await db.homebrewFiles.count()).toBe(1);
  });

  it('says who has its entries is not known when its content cannot be read', async () => {
    await character('Hild', { race: { name: 'Lanternfolk', source: 'IMP' } });
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    await db.homebrewJson.delete(row.id);
    visit(await addressOf(row.id));
    await heading('imported.json');
    fireEvent.click(screen.getByRole('button', { name: 'Delete this collection' }));
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete imported.json?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain(
      'imported.json could not be read, so who has its entries is not known.',
    );
    expect(ask.textContent).not.toContain('No character has any of it.');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
  });

  it('names an unreadable file once when two copies of it cannot be read', async () => {
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    const meta = await db.homebrewFiles.get(row.id);
    if (meta === undefined) throw new Error('no row');
    await db.homebrewFiles.add({ ...meta, id: 'older-copy', addedAt: meta.addedAt - 1 });
    await db.homebrewJson.delete(row.id);
    visit(await addressOf(row.id));
    await heading('imported.json');
    fireEvent.click(screen.getByRole('button', { name: 'Delete this collection' }));
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete imported.json?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain(
      'imported.json could not be read, so who has its entries is not known.',
    );
    expect(ask.textContent).not.toContain('imported.json and imported.json');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
  });

  it('says a row of its file that cannot be read stays after a delete', async () => {
    const { books } = await homebrewRepo.prepareBooks(
      {
        _meta: {
          sources: [{ json: 'FCA', full: 'Ember Codex' }],
          convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' },
        },
        spell: [{ name: 'Ember Ward', source: 'FCA', level: 1 }],
      },
      'all.xml',
    );
    await homebrewRepo.commitBooks(books);
    const [book] = await db.homebrewFiles.toArray();
    if (book === undefined) throw new Error('no book');
    const address = await addressOf(book.id);
    // A row with no id: nothing can address it, so a delete cannot take it.
    await db.homebrewFiles.add({ id: '', fileName: 'all.xml' } as never);
    visit(address);
    await heading('Ember Codex');
    fireEvent.click(screen.getByRole('button', { name: 'Delete this collection' }));
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete Ember Codex?' },
      { timeout: WAIT },
    );
    expect(ask.textContent).toContain(
      'One more row named all.xml could not be read, so it stays: the Collections shelf lists it.',
    );
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: WAIT });
  });
});

describe('where it is on, source by source', () => {
  /** A file declaring two sources, one entry in each. */
  const TWO = {
    _meta: {
      sources: [
        { json: 'FCA', full: 'Ember Codex' },
        { json: 'FCB', full: 'Frost Codex' },
      ],
    },
    spell: [
      { name: 'Ember Ward', source: 'FCA', level: 1 },
      { name: 'Frost Ward', source: 'FCB', level: 1 },
    ],
  };
  const chip = (name: string) =>
    screen.findByRole('button', { name: `${name} picks from it` }, { timeout: WAIT });

  it('turns off a file of two sources for a character while the choice of books hides one', async () => {
    const hild = await character('Hild');
    await writeSourcePolicy({ mode: 'all', except: ['FCB'] });
    const row = await homebrewRepo.importJson(TWO, 'two.json');
    visit(await addressOf(row.id));
    // Ember Ward still reaches Hild's pickers, so she picks from it.
    await waitFor(
      async () => expect((await chip('Hild')).getAttribute('aria-pressed')).toBe('true'),
      {
        timeout: WAIT,
      },
    );
    fireEvent.click(await chip('Hild'));
    await waitFor(async () => expect(await switchesOf(hild.id)).toEqual({ off: ['FCA'] }), {
      timeout: WAIT,
    });
  });

  it('turned on for a character, leaves out a book the choice of books hides here, and says so up top', async () => {
    const hild = await character('Hild');
    await writeSourcePolicy({ mode: 'all', except: ['FCB'] });
    const { books } = await homebrewRepo.prepareBooks(
      {
        _meta: { ...TWO._meta, convertedFrom: { format: 'fc5-compendium', fileName: 'all.xml' } },
        spell: TWO.spell,
      },
      'all.xml',
    );
    await homebrewRepo.commitBooks(books);
    const [first] = await db.homebrewFiles.toArray();
    if (first === undefined) throw new Error('no book');
    visit(await addressOf(first.id));
    await heading('all.xml');
    fireEvent.click(await chip('Hild'));
    await waitFor(async () => expect(await switchesOf(hild.id)).toEqual({ off: ['FCA'] }), {
      timeout: WAIT,
    });
    await waitFor(
      async () => expect((await chip('Hild')).getAttribute('aria-pressed')).toBe('false'),
      {
        timeout: WAIT,
      },
    );
    fireEvent.click(await chip('Hild'));
    // On as the device has it: Frost Codex stays hidden for her too.
    await waitFor(async () => expect(await switchesOf(hild.id)).toBeUndefined(), { timeout: WAIT });
    // Frost Codex is on, and hidden by The books: one of two shows here.
    expect(
      await screen.findByText(/2 entries\. 1 of 2 books on\./, {}, { timeout: WAIT }),
    ).toBeTruthy();
  });

  it('says a file the choice of books hides is off, up top as below', async () => {
    await writeSourcePolicy({ mode: 'all', except: ['IMP'] });
    const row = await homebrewRepo.importJson(IMPORTED, 'imported.json');
    visit(await addressOf(row.id));
    await heading('imported.json');
    expect(
      await screen.findByText('Hidden by The books’ choice of what shows', {}, { timeout: WAIT }),
    ).toBeTruthy();
    expect(screen.getByText(/2 entries\. Off\./)).toBeTruthy();
  });
});
