// @vitest-environment jsdom
// A collection over time (ADR-002, D4; board 8): its page's address holds
// through an update, which comes from its link through the Import sheet; and
// what an update moved under the player's change shows as Needs a look,
// with both versions (E3's data), until the player keeps theirs.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/app/routes';
import { markDataChanged } from '@/data5e/landing';
import { identityKey } from '@/data5e/normalize';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { registryViewFor } from '@/data5e/registryView';
import { writeSourcePolicy } from '@/data5e/sourceFilter';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { type EntryKey, homebrewRepo } from '@/db/homebrewRepo';
import { noticeStore } from '@/stores/notices';
import { namelessControls } from '../../../tests-fixtures/a11y';
import {
  classEntry,
  HARNESS_TIMEOUT,
  resetSheetHarness,
  seedWorld,
  testCharacter,
} from '../../../tests-fixtures/sheetHarness';
import { collectionPath } from './collections';
import { writeChange } from './copyWriter';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);
// Open unless a test holds it: the page's reads of the registry wait on it.
const registryGate = vi.hoisted(() => ({ wait: Promise.resolve() }));
vi.mock('@/data5e/registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data5e/registry')>();
  return {
    ...real,
    getRegistry: (...a: Parameters<typeof real.getRegistry>) =>
      registryGate.wait.then(() => real.getRegistry(...a)),
  };
});

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

const WAIT = 30_000;
type Json = Record<string, unknown>;

function visit(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  return router;
}

const NAME = 'Tidewater Grimoire.json';
const LINK = `https://raw.githubusercontent.com/me/brews/main/${encodeURIComponent(NAME)}`;

function grimoire(changed = false): Json {
  return {
    _meta: { sources: [{ json: 'TWG', full: 'Tidewater Grimoire' }] },
    spell: [
      { name: 'Riptide', source: 'TWG', level: 1, entries: ['Pull.'] },
      ...(changed ? [{ name: 'Kelp Cloak', source: 'TWG', level: 2, entries: ['Wrap.'] }] : []),
    ],
  };
}

const rowIds = async () => (await db.homebrewFiles.toArray()).map((r) => r.id);

describe('a collection from a link', () => {
  it('keeps its address through an update, and updates from its link through the sheet', async () => {
    await seedWorld();
    const first = await homebrewRepo.commit(await homebrewRepo.prepare(grimoire(), NAME, LINK));
    expect(first.row.key).toBe(`url:${LINK}`);
    // The address the home links it by: the key, with its slashes and colons.
    visit(collectionPath(`url:${LINK}`));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Tidewater Grimoire' },
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    await screen.findByText('Riptide', {}, { timeout: WAIT });
    expect(screen.getByRole('link', { name: LINK }).getAttribute('href')).toBe(LINK);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(grimoire(true))));
    fireEvent.click(screen.getByRole('button', { name: 'Update from its link' }));
    const sheet = await screen.findByRole('dialog', { name: 'Import' }, { timeout: WAIT });
    const link = within(sheet).getByRole<HTMLInputElement>('textbox', {
      name: 'Link to a JSON homebrew file',
    });
    expect(link.value).toBe(LINK);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Read it' }));
    const preview = await screen.findByRole(
      'dialog',
      { name: `Update "${NAME}"?` },
      { timeout: WAIT },
    );
    fireEvent.click(within(preview).getByRole('button', { name: 'Update' }));

    // The same page, on the new content, under a new row id.
    await screen.findByText('Kelp Cloak', {}, { timeout: WAIT });
    expect(screen.getByRole('heading', { level: 1, name: 'Tidewater Grimoire' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/^Updated/);
    const ids = await rowIds();
    expect(ids).toHaveLength(1);
    expect(ids).not.toContain(first.row.id);
    expect(namelessControls()).toEqual([]);
  });

  it('follows an update made elsewhere while it is open', async () => {
    await homebrewRepo.commit(await homebrewRepo.prepare(grimoire(), NAME, LINK));
    visit(collectionPath(`url:${LINK}`));
    await screen.findByText('Riptide', {}, { timeout: WAIT });
    await homebrewRepo.commit(await homebrewRepo.prepare(grimoire(true), NAME, LINK));
    await screen.findByText('Kelp Cloak', {}, { timeout: WAIT });
    expect(screen.queryByText('This collection is no longer on this device.')).toBeNull();
    // A file would land beside it: its key is the link (U7).
    expect(screen.queryByRole('button', { name: 'Update from a file' })).toBeNull();
  });

  it('moves to its own address when opened by a row id, so an update keeps it open', async () => {
    const first = await homebrewRepo.commit(await homebrewRepo.prepare(grimoire(), NAME, LINK));
    const router = visit(`/workshop/collection/${first.row.id}`);
    await screen.findByText('Riptide', {}, { timeout: WAIT });
    await waitFor(
      () =>
        expect(decodeURIComponent(router.state.location.pathname)).toBe(
          decodeURIComponent(collectionPath(`url:${LINK}`)),
        ),
      { timeout: WAIT },
    );
    await homebrewRepo.commit(await homebrewRepo.prepare(grimoire(true), NAME, LINK));
    await screen.findByText('Kelp Cloak', {}, { timeout: WAIT });
    expect(screen.queryByText('This collection is no longer on this device.')).toBeNull();
  });

  it('opens from a link whose own address holds an encoded slash', async () => {
    const link = 'https://raw.githubusercontent.com/me/brews/main/get?p=a%2Fb.json';
    const first = await homebrewRepo.commit(await homebrewRepo.prepare(grimoire(), 'b.json', link));
    expect(first.row.key).toBe(`url:${link}`);
    visit(collectionPath(`url:${link}`));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Tidewater Grimoire' },
        { timeout: WAIT },
      ),
    ).toBeTruthy();
  });
});

describe('Needs a look', () => {
  const BASE = ['Glow.', 'Shine.'];
  const tide = (entries: unknown[]): Json => ({
    _meta: { sources: [{ json: 'TID', full: 'Tide Tales' }] },
    feat: [{ name: 'Glimmer', source: 'TID', entries }],
  });

  /** An imported Glimmer the player changed to `mine`, then an update to `theirs`. */
  async function changedUnderneath(
    mine: unknown[],
    theirs: unknown[],
    base: unknown[] = BASE,
  ): Promise<{ changesId: string; fileKey: string }> {
    await seedWorld();
    await homebrewRepo.importJson(tide(base), 'Tide.json');
    const reg = await getRegistry();
    const placed = reg.get('feat', 'Glimmer', 'TID');
    if (placed === undefined) throw new Error('no Glimmer');
    const original = reg.belowOwnChange(placed) as Json;
    const change = writeChange('feat', original, { ...original, entries: mine });
    const { fileId } = await homebrewRepo.saveEntry('feat', change as Json & EntryKey, {
      role: 'changes',
    });
    const updated = await homebrewRepo.importJson(tide(theirs), 'Tide.json');
    invalidateRegistry();
    const after = await getRegistry();
    const [record] = after.changedEntries();
    expect(record?.layers.map((l) => l.needsLook)).toEqual([['entries']]);
    return { changesId: fileId, fileKey: updated.key ?? '' };
  }

  async function lookAt(fileKey: string) {
    visit(collectionPath(fileKey));
    const list = await screen.findByRole('list', { name: 'Needs a look' }, { timeout: WAIT });
    expect(list.textContent).toContain('Glimmer');
    // What it holds is read on its own, so it can land after Needs a look.
    const held = await screen.findByRole('list', { name: 'In Tide Tales' }, { timeout: WAIT });
    expect(within(held).getByText('Needs a look')).toBeTruthy();
    expect(namelessControls()).toEqual([]);
    return list;
  }

  const settled = () =>
    waitFor(() => expect(screen.queryByRole('list', { name: 'Needs a look' })).toBeNull(), {
      timeout: WAIT,
    });

  it('an update to another paragraph: yours shows over it, and Keep yours settles it', async () => {
    const { fileKey } = await changedUnderneath(
      ['Glow brightly.', 'Shine.'],
      ['Glow.', 'Shine on.'],
    );
    const list = await lookAt(fileKey);
    expect(list.textContent).toContain('The collection’s now: Glow. Shine on.');
    expect(list.textContent).toContain('Yours: Glow brightly. Shine on.');
    expect(list.textContent).toContain('Yours shows.');

    fireEvent.click(within(list).getByRole('button', { name: 'Keep yours: Glimmer' }));
    await settled();
    const [record] = (await getRegistry()).changedEntries();
    expect(record?.layers.map((l) => l.needsLook)).toEqual([[]]);
    expect(record?.placed.entries).toEqual(['Glow brightly.', 'Shine on.']);
  });

  it('a change that holds the text whole: yours shows, and Keep yours settles it', async () => {
    // A paragraph added: the change holds the whole text, not steps over it.
    const mine = ['Glow.', 'Shine.', 'Sparkle.'];
    const { fileKey } = await changedUnderneath(mine, ['Glow softly.', 'Shine.']);
    const list = await lookAt(fileKey);
    expect(list.textContent).toContain('The collection’s now: Glow softly. Shine.');
    expect(list.textContent).toContain('Yours: Glow. Shine. Sparkle.');

    fireEvent.click(within(list).getByRole('button', { name: 'Keep yours: Glimmer' }));
    await settled();
    const [record] = (await getRegistry()).changedEntries();
    expect(record?.layers.map((l) => l.needsLook)).toEqual([[]]);
    expect(record?.placed.entries).toEqual(mine);
  });

  it('an update that reworded the text yours changed: says the collection’s shows, and uses it', async () => {
    const { fileKey } = await changedUnderneath(
      ['Glow brightly.', 'Shine.'],
      ['Glow softly.', 'Shine.'],
    );
    const list = await lookAt(fileKey);
    expect(list.textContent).toContain('The collection’s now: Glow softly. Shine.');
    // The player's whole text is gone (a mark is a hash): their words, as their change says them.
    expect(list.textContent).toContain('Yours: Glow brightly. (in place of “Glow.”)');
    expect(list.textContent).toContain('so its words show now');
    expect(within(list).queryByRole('button', { name: /^Keep yours/ })).toBeNull();

    fireEvent.click(within(list).getByRole('button', { name: 'Use the collection’s: Glimmer' }));
    await settled();
    // Nothing of the change still applied, so it is taken out.
    const reg = await getRegistry();
    expect(reg.changedEntries()).toEqual([]);
    expect(reg.get('feat', 'Glimmer', 'TID')?.entries).toEqual(['Glow softly.', 'Shine.']);
  });

  it('a change partly gone: keeps what still applies, and says what does not', async () => {
    const part = (name: string) => ({ type: 'entries', name, entries: ['Swear.'] });
    // The player rewords the first line and takes out the oath; the update renames the oath.
    const { fileKey } = await changedUnderneath(
      ['Glow brightly.'],
      ['Glow.', part('Lantern Vow')],
      ['Glow.', part('Lantern Oath')],
    );
    const list = await lookAt(fileKey);
    expect(list.textContent).toContain('Yours: Glow brightly. Lantern Vow Swear.');
    // A removal that finds nothing says nothing: it is a miss all the same.
    expect(list.textContent).toContain('Part of yours no longer finds its words');
    expect(list.textContent).toContain('Takes out Lantern Oath');
    fireEvent.click(
      within(list).getByRole('button', { name: 'Keep yours where it applies: Glimmer' }),
    );
    await settled();
    const [record] = (await getRegistry()).changedEntries();
    expect(record?.layers.map((l) => l.needsLook)).toEqual([[]]);
    expect(record?.placed.entries).toEqual(['Glow brightly.', part('Lantern Vow')]);
  });

  it('an update that already has the words yours put in: says so, and uses the collection’s', async () => {
    const { fileKey } = await changedUnderneath(
      ['Glow brightly.', 'Shine.'],
      ['Glow brightly.', 'Shine on.'],
    );
    const list = await lookAt(fileKey);
    expect(list.textContent).toContain('Yours: Glow brightly. (in place of “Glow.”)');
    expect(list.textContent).toContain('it now has the words yours put in');
    expect(list.textContent).not.toContain('Yours shows.');
    expect(within(list).queryByRole('button', { name: /^Keep yours/ })).toBeNull();
    fireEvent.click(within(list).getByRole('button', { name: 'Use the collection’s: Glimmer' }));
    await settled();
    const reg = await getRegistry();
    expect(reg.changedEntries()).toEqual([]);
    expect(reg.get('feat', 'Glimmer', 'TID')?.entries).toEqual(['Glow brightly.', 'Shine on.']);
  });

  it('an update with words yours put in only elsewhere: does not say yours shows', async () => {
    // The player made a second "Shine."; the update reworded the first line, and one "Shine." stays.
    const { fileKey } = await changedUnderneath(['Shine.', 'Shine.'], ['Glow softly.', 'Shine.']);
    const list = await lookAt(fileKey);
    expect(list.textContent).toContain('The collection’s now: Glow softly. Shine.');
    expect(list.textContent).not.toContain('Yours shows.');
    expect(list.textContent).toContain('so its words show');
    expect(within(list).queryByRole('button', { name: /^Keep yours/ })).toBeNull();
  });

  it('a removal of two parts with one renamed: says the renamed one is not taken out', async () => {
    const part = (name: string) => ({ type: 'entries', name, entries: ['Swear.'] });
    const { fileKey } = await changedUnderneath(
      ['Glow.'],
      ['Glow.', part('Lantern Oath'), part('Ember Pledge')],
      ['Glow.', part('Lantern Oath'), part('Ember Vow')],
    );
    const list = await lookAt(fileKey);
    expect(list.textContent).toContain('Part of yours no longer finds its words');
    expect(list.textContent).toContain('Takes out Ember Vow');
    expect(list.textContent).not.toContain('Takes out Lantern Oath');
    expect(
      within(list).getByRole('button', { name: 'Keep yours where it applies: Glimmer' }),
    ).toBeTruthy();
  });

  it('shows an entry under a source its file does not declare on its own page', async () => {
    const mixed = (entries: unknown[]): Json => ({
      _meta: { sources: [{ json: 'TID', full: 'Tide Tales' }] },
      feat: [{ name: 'Undertow', source: 'TIX', entries }],
    });
    await seedWorld();
    await homebrewRepo.importJson(mixed(BASE), 'Tide.json');
    const reg = await getRegistry();
    const placed = reg.get('feat', 'Undertow', 'TIX');
    if (placed === undefined) throw new Error('no Undertow');
    const original = reg.belowOwnChange(placed) as Json;
    const change = writeChange('feat', original, {
      ...original,
      entries: ['Glow brightly.', 'Shine.'],
    });
    await homebrewRepo.saveEntry('feat', change as Json & EntryKey, { role: 'changes' });
    const updated = await homebrewRepo.importJson(mixed(['Glow.', 'Shine on.']), 'Tide.json');
    visit(collectionPath(updated.key ?? ''));
    const list = await screen.findByRole('list', { name: 'Needs a look' }, { timeout: WAIT });
    expect(list.textContent).toContain('Undertow');
  });

  it('appears while the page is open, when the collection updates under a change', async () => {
    await seedWorld();
    await homebrewRepo.importJson(tide(BASE), 'Tide.json');
    const reg = await getRegistry();
    const placed = reg.get('feat', 'Glimmer', 'TID');
    if (placed === undefined) throw new Error('no Glimmer');
    const original = reg.belowOwnChange(placed) as Json;
    const change = writeChange('feat', original, {
      ...original,
      entries: ['Glow brightly.', 'Shine.'],
    });
    await homebrewRepo.saveEntry('feat', change as Json & EntryKey, { role: 'changes' });
    const first = (await db.homebrewFiles.toArray()).find((r) => r.fileName === 'Tide.json');
    visit(collectionPath(first?.key ?? ''));
    await screen.findByRole('list', { name: 'In Tide Tales' }, { timeout: WAIT });
    expect(screen.queryByRole('list', { name: 'Needs a look' })).toBeNull();
    await homebrewRepo.importJson(tide(['Glow.', 'Shine on.']), 'Tide.json');
    const list = await screen.findByRole('list', { name: 'Needs a look' }, { timeout: WAIT });
    expect(list.textContent).toContain('Yours: Glow brightly. Shine on.');
  });

  it('leaves a look off a rule pack that replaces the same entry', async () => {
    const lumen = (entries: unknown[]) => ({
      feat: [{ name: 'Lumen', source: 'TST', entries }],
    });
    await seedWorld(lumen(BASE));
    const pack = await homebrewRepo.importJson(
      {
        _meta: {
          sources: [{ json: 'TBL', full: 'Our Table' }],
          castGuidance: { v: 1, replaces: [{ type: 'feat', name: 'Lumen', source: 'TST' }] },
        },
        feat: [
          {
            name: 'Lumen',
            source: 'TST',
            _copy: {
              name: 'Lumen',
              source: 'TST',
              _mod: { entries: { mode: 'appendArr', items: ['At our table, it lasts.'] } },
            },
          },
        ],
      },
      'Our Table.json',
    );
    const reg = await getRegistry();
    const placed = reg.get('feat', 'Lumen', 'TST');
    if (placed === undefined) throw new Error('no Lumen');
    const original = reg.belowOwnChange(placed) as Json;
    const change = writeChange('feat', original, {
      ...original,
      entries: ['Glow brightly.', 'Shine.'],
    });
    const { fileId } = await homebrewRepo.saveEntry('feat', change as Json & EntryKey, {
      role: 'changes',
    });
    await seedWorld(lumen(['Glow.', 'Shine on.']));
    const looks = (await getRegistry()).changedEntries().flatMap((r) => r.layers);
    expect(looks.some((l) => l.from.fileId === fileId && l.needsLook.length > 0)).toBe(true);
    // The look is the player's change over the book: it shows where the change is.
    visit(collectionPath(pack.key ?? ''));
    await screen.findByRole('heading', { level: 1, name: 'Our Table' }, { timeout: WAIT });
    await screen.findByRole('list', { name: 'In Our Table' }, { timeout: WAIT });
    await new Promise((go) => setTimeout(go, 200));
    expect(screen.queryByRole('list', { name: 'Needs a look' })).toBeNull();
  });

  it('appears while the page is open, when the books under a change land new words', async () => {
    const lumen = (entries: unknown[]) => ({
      feat: [{ name: 'Lumen', source: 'TST', entries }],
    });
    await seedWorld(lumen(BASE));
    const reg = await getRegistry();
    const placed = reg.get('feat', 'Lumen', 'TST');
    if (placed === undefined) throw new Error('no Lumen');
    const original = reg.belowOwnChange(placed) as Json;
    const change = writeChange('feat', original, {
      ...original,
      entries: ['Glow brightly.', 'Shine.'],
    });
    const { fileId } = await homebrewRepo.saveEntry('feat', change as Json & EntryKey, {
      role: 'changes',
    });
    visit(collectionPath(fileId));
    await screen.findByRole('list', { name: 'In Changes to the books' }, { timeout: WAIT });
    expect(screen.queryByRole('list', { name: 'Needs a look' })).toBeNull();
    // A release lands, rewording the books under the change; no stored file moves.
    await seedWorld(lumen(['Glow.', 'Shine on.']));
    markDataChanged();
    const list = await screen.findByRole('list', { name: 'Needs a look' }, { timeout: WAIT });
    expect(list.textContent).toContain('Lumen');
  });

  it('takes a settled look off the list at once, so a second tap cannot land', async () => {
    const { fileKey } = await changedUnderneath(
      ['Glow brightly.', 'Shine.'],
      ['Glow softly.', 'Shine.'],
    );
    const list = await lookAt(fileKey);
    // Done, but nothing stored moves: the list is not read again.
    vi.spyOn(homebrewRepo, 'removeEntry').mockResolvedValue(true);
    fireEvent.click(within(list).getByRole('button', { name: 'Use the collection’s: Glimmer' }));
    await waitFor(() => expect(noticeStore.getState().notice?.tone).toBe('good'), {
      timeout: WAIT,
    });
    await new Promise((go) => setTimeout(go, 50));
    const again = screen.queryByRole('button', { name: 'Use the collection’s: Glimmer' });
    expect(again === null || again.hasAttribute('disabled')).toBe(true);
  });

  it('keeps a settled look off the list while the registry is read again', async () => {
    const { fileKey } = await changedUnderneath(
      ['Glow brightly.', 'Shine.'],
      ['Glow softly.', 'Shine.'],
    );
    const list = await lookAt(fileKey);
    // A real settle: the change's row moves before the registry is read again.
    const name = 'Use the collection’s: Glimmer';
    let tapped = false;
    let back = false;
    const watch = new MutationObserver(() => {
      const b = screen.queryByRole('button', { name });
      if (tapped && b !== null && !b.hasAttribute('disabled')) back = true;
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true });
    // The registry is slow to read again (a whole release, in the app): the
    // stored rows land first.
    let open = () => {};
    registryGate.wait = new Promise<void>((go) => {
      open = go;
    });
    try {
      fireEvent.click(within(list).getByRole('button', { name }));
      tapped = true;
      await waitFor(() => expect(noticeStore.getState().notice?.tone).toBe('good'), {
        timeout: WAIT,
      });
      await new Promise((go) => setTimeout(go, 300));
    } finally {
      open();
      registryGate.wait = Promise.resolve();
    }
    await settled();
    watch.disconnect();
    expect(back).toBe(false);
  });

  it('says so when settling finds the change already gone', async () => {
    const { fileKey } = await changedUnderneath(
      ['Glow brightly.', 'Shine.'],
      ['Glow softly.', 'Shine.'],
    );
    const list = await lookAt(fileKey);
    vi.spyOn(homebrewRepo, 'removeEntry').mockResolvedValue(false);
    fireEvent.click(within(list).getByRole('button', { name: 'Use the collection’s: Glimmer' }));
    await waitFor(() => expect(noticeStore.getState().notice?.tone).toBe('warn'), {
      timeout: WAIT,
    });
    expect(noticeStore.getState().notice?.title).toBe('Use the collection’s failed');
  });

  it('shows it on Changes to the books too, where the change is', async () => {
    const { changesId } = await changedUnderneath(
      ['Glow brightly.', 'Shine.'],
      ['Glow softly.', 'Shine.'],
    );
    visit(collectionPath(changesId));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Changes to the books' },
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Needs a look' }, { timeout: WAIT });
    expect(list.textContent).toContain('Yours: Glow brightly.');
    // A change opens where it is made: the entry's page in the Library.
    const entry = await screen.findByRole('link', { name: /^Glimmer/ }, { timeout: WAIT });
    expect(entry.getAttribute('href')).toBe('/library/feat/glimmer%7Ctid');
  });
});

describe('Changes to the books', () => {
  /** The player's change to an imported Glimmer, in Changes to the books. */
  async function changesFile(): Promise<string> {
    await seedWorld();
    await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: 'TID', full: 'Tide Tales' }] },
        feat: [{ name: 'Glimmer', source: 'TID', entries: ['Glow.'] }],
      },
      'Tide.json',
    );
    const reg = await getRegistry();
    const placed = reg.get('feat', 'Glimmer', 'TID');
    if (placed === undefined) throw new Error('no Glimmer');
    const original = reg.belowOwnChange(placed) as Json;
    const change = writeChange('feat', original, { ...original, entries: ['Glow brightly.'] });
    const { fileId } = await homebrewRepo.saveEntry('feat', change as Json & EntryKey, {
      role: 'changes',
    });
    return fileId;
  }

  it('is on for every character whatever books show, and turns off for one', async () => {
    const fileId = await changesFile();
    // A choice of books that names neither the collection nor the changes.
    await writeSourcePolicy({ mode: 'only', sources: ['TST'] });
    const osk = await characterRepo.create(testCharacter('Osk', [classEntry('Fighter', 1)]));
    visit(collectionPath(fileId));
    await screen.findByRole(
      'heading',
      { level: 1, name: 'Changes to the books' },
      { timeout: WAIT },
    );
    expect(await screen.findByText('In use on this device', {}, { timeout: WAIT })).toBeTruthy();
    const chip = () =>
      screen.findByRole('button', { name: 'Osk picks from it' }, { timeout: WAIT });
    await waitFor(async () => expect((await chip()).getAttribute('aria-pressed')).toBe('true'), {
      timeout: WAIT,
    });
    // What the chip says is what Osk's pickers read: the change, over the book's.
    const glimmer = async () => {
      const doc = await characterRepo.get(osk.id);
      if (doc === undefined) throw new Error('no Osk');
      return registryViewFor(await getRegistry(), doc).get('feat', 'Glimmer', 'TID')?.entries;
    };
    expect(await glimmer()).toEqual(['Glow brightly.']);
    fireEvent.click(await chip());
    await waitFor(
      async () =>
        expect((await characterRepo.get(osk.id))?.sourceSwitches).toEqual({ off: ['MyChanges'] }),
      { timeout: WAIT },
    );
    await waitFor(async () => expect((await chip()).getAttribute('aria-pressed')).toBe('false'), {
      timeout: WAIT,
    });
    expect(await glimmer()).toEqual(['Glow.']);
  });

  it("lists a change to a class's feature, which stands alone", async () => {
    await seedWorld();
    const keys = {
      name: 'Second Wind',
      source: 'TST',
      className: 'Fighter',
      classSource: 'TST',
      level: 1,
    };
    const { fileId } = await homebrewRepo.saveEntry(
      'classFeature',
      { ...keys, entries: ['Breathe deep.'], _copy: { ...keys } } as Json & EntryKey,
      { role: 'changes' },
    );
    visit(collectionPath(fileId));
    const held = await screen.findByRole(
      'list',
      { name: 'In Changes to the books' },
      { timeout: WAIT },
    );
    expect(within(held).getByText('Second Wind')).toBeTruthy();
    expect(screen.queryByText('Nothing in it yet.')).toBeNull();
    // It opens in the Library by its whole identity, and deletes as the change it is.
    const open = within(held).getByRole('link', { name: /^Second Wind/ });
    expect(open.getAttribute('href')).toBe(
      `/library/classFeature/${encodeURIComponent(identityKey('classFeature', keys))}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More for Second Wind' }));
    const menu = await screen.findByRole('dialog', { name: 'Second Wind' }, { timeout: WAIT });
    fireEvent.click(within(menu).getByRole('button', { name: /^Delete/ }));
    const ask = await screen.findByRole(
      'dialog',
      { name: 'Delete Second Wind?' },
      { timeout: WAIT },
    );
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    await screen.findByText('Nothing in it yet.', {}, { timeout: WAIT });
    const { file } = await homebrewRepo.getSafe(fileId);
    expect(file?.json.classFeature).toEqual([]);
  });

  it("opens a change to a class's feature on its Library page", async () => {
    await seedWorld();
    // A feature the books hold, so its Library page is there.
    const keys = {
      name: 'Expertise',
      source: 'TST',
      className: 'Sneak',
      classSource: 'TST',
      level: 1,
    };
    const { fileId } = await homebrewRepo.saveEntry(
      'classFeature',
      { ...keys, entries: ['Sharper still.'], _copy: { ...keys } } as Json & EntryKey,
      { role: 'changes' },
    );
    visit(collectionPath(fileId));
    const held = await screen.findByRole(
      'list',
      { name: 'In Changes to the books' },
      { timeout: WAIT },
    );
    fireEvent.click(within(held).getByRole('link', { name: /^Expertise/ }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Expertise' }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(await screen.findByText('Sharper still.', {}, { timeout: WAIT })).toBeTruthy();
  });
});
