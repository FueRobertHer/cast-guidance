// @vitest-environment jsdom
// The Workshop page over the app's routes: what Make your own names, and which
// file an entry opens from and saves to when two files hold one by the same
// name and book.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomebrewFileRow } from '@/db/db';
import { homebrewRepo, WORKSHOP_SOURCE } from '@/db/homebrewRepo';
import { isRecord } from '@/engine/castGuidance';
import {
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  sorcerer,
} from '../../../tests-fixtures/sheetHarness';

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

/** Two collections of the player's, each with a feat called Gift under the book HB. */
async function twins(): Promise<{ first: HomebrewFileRow; second: HomebrewFileRow }> {
  const first = await homebrewRepo.createEditable('First', 'HB');
  const second = await homebrewRepo.createEditable('Second', 'HB');
  for (const [row, text] of [
    [first, 'From the first.'],
    [second, 'From the second.'],
  ] as const) {
    await homebrewRepo.saveEditable(row.id, {
      ...(row.json as Record<string, unknown>),
      feat: [{ name: 'Gift', source: 'HB', entries: [text] }],
    });
  }
  return { first, second };
}

/** The text of the Gift a file holds now. */
async function giftText(fileId: string): Promise<unknown> {
  const { file } = await homebrewRepo.getSafe(fileId);
  const feats = Array.isArray(file?.json.feat) ? file.json.feat : [];
  const gift = feats.find((f) => isRecord(f) && f.name === 'Gift');
  return isRecord(gift) ? gift.entries : undefined;
}

describe('two entries with one name and book, in two files', () => {
  it('open each from its own row in Yours', async () => {
    const { first, second } = await twins();
    const sheet = await renderSheet(sorcerer());
    for (const [row, text] of [
      [first, 'From the first.'],
      [second, 'From the second.'],
    ] as const) {
      await sheet.visit('/workshop');
      const links = await screen.findAllByRole('link', { name: /^Gift/ }, { timeout: WAIT });
      const link = links.find((l) => l.getAttribute('href')?.endsWith(`?file=${row.id}`));
      if (link === undefined) throw new Error(`no Gift row opens ${row.id}`);
      fireEvent.click(link);
      expect(await screen.findByDisplayValue(text, {}, { timeout: WAIT })).toBeTruthy();
    }
  });

  it('save to the file the editor opened from, and keep it in the address', async () => {
    const { first, second } = await twins();
    const sheet = await renderSheet(sorcerer());
    // Each in turn, so neither passes by being the one found first anyway.
    for (const [row, other, was, otherText] of [
      [first, second, 'From the first.', 'From the second.'],
      [second, first, 'From the second.', 'Changed: From the first.'],
    ] as const) {
      await sheet.visit(`/workshop/edit/feat/Gift%7CHB?file=${row.id}`);
      const text = await screen.findByDisplayValue(was, {}, { timeout: WAIT });
      fireEvent.change(text, { target: { value: `Changed: ${was}` } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(giftText(row.id)).resolves.toEqual([`Changed: ${was}`]), {
        timeout: WAIT,
      });
      expect(await giftText(other.id)).toEqual([otherText]);
    }
  });

  it('give an address that named no file the one saved to, keeping the editor open', async () => {
    await twins();
    const sheet = await renderSheet(sorcerer());
    // An older link: whichever Gift is found first opens.
    await sheet.visit('/workshop/edit/feat/Gift%7CHB');
    const text = await screen.findByDisplayValue(/^From the/, {}, { timeout: WAIT });
    fireEvent.change(text, { target: { value: 'Kept.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Only the search changes; the editor stays as it is, not reopened.
    await waitFor(() => expect(sheet.router.state.location.search).toMatch(/^\?file=./), {
      timeout: WAIT,
    });
    expect(sheet.router.state.location.pathname).toBe('/workshop/edit/feat/Gift%7CHB');
    expect(screen.getByDisplayValue('Kept.')).toBe(text);
    const id = new URLSearchParams(sheet.router.state.location.search).get('file') ?? '';
    expect(await giftText(id)).toEqual(['Kept.']);

    // Renamed, so the next save moves the editor to a new address, in the same file.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Present' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(
      () => expect(sheet.router.state.location.pathname).toBe('/workshop/edit/feat/Present%7CHB'),
      { timeout: WAIT },
    );
    expect(sheet.router.state.location.search).toBe(`?file=${id}`);
    const { file } = await homebrewRepo.getSafe(id);
    const feats = Array.isArray(file?.json.feat) ? file.json.feat : [];
    expect(feats.map((f) => isRecord(f) && f.name)).toEqual(['Present']);
  });
});

/** The feats a file holds now, by name. */
async function featNames(fileId: string): Promise<unknown[]> {
  const { file } = await homebrewRepo.getSafe(fileId);
  const feats = Array.isArray(file?.json.feat) ? file.json.feat : [];
  return feats.map((f) => isRecord(f) && f.name);
}

/** Name the open editor's entry, and save it. */
function nameAndSave(name: string): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('the Save bar', () => {
  it('lists what holds Save back, and takes the keyboard to the name', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new/feat');
    const name = await screen.findByLabelText('Name', {}, { timeout: WAIT });
    const list = screen.getByRole('list', { name: 'Before you save' });
    const problem = within(list).getByRole('button', { name: 'Give it a name to save it.' });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(problem);
    await waitFor(() => expect(document.activeElement).toBe(name));

    fireEvent.change(name, { target: { value: 'Half|Way' } });
    expect(within(list).getByRole('button', { name: 'A name cannot have | in it.' })).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Halfway' } });
    expect(screen.queryByRole('list', { name: 'Before you save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
  });

  it('makes My homebrew on the first save, and Undo takes it away again', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new/feat');
    await screen.findByLabelText('Name', {}, { timeout: WAIT });
    expect(screen.getByText(/made the first time you save/)).toBeTruthy();
    expect(screen.getByText('Feat, your own. Not saved yet')).toBeTruthy();
    nameAndSave('Stand Fast');

    expect(
      await screen.findByText('Saved. My homebrew is made, on this device.', {}, { timeout: WAIT }),
    ).toBeTruthy();
    expect(screen.getByText('Feat, your own. Saved')).toBeTruthy();
    const { files } = await homebrewRepo.ownedSafe();
    expect(files.map((f) => f.sourceIds)).toEqual([[WORKSHOP_SOURCE]]);

    const undo = screen.getByRole('button', { name: 'Undo' });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(async () => expect((await homebrewRepo.ownedSafe()).files).toEqual([]), {
      timeout: WAIT,
    });
    // Its row goes, and the keyboard goes on to Save rather than the page.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' })),
    );
    expect(
      await screen.findByText('Feat, your own. Not saved yet', {}, { timeout: WAIT }),
    ).toBeTruthy();
    await waitFor(() => expect(sheet.router.state.location.pathname).toBe('/workshop/new/feat'));
    expect(screen.getByDisplayValue('Stand Fast')).toBeTruthy();

    // Saved again, it is made again, with the one entry.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(
      async () => {
        const [file] = (await homebrewRepo.ownedSafe()).files;
        expect(file === undefined ? [] : await featNames(file.id)).toEqual(['Stand Fast']);
      },
      { timeout: WAIT },
    );
  });

  it('puts the file back as it was before a later save, under the name it had', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new/feat');
    await screen.findByLabelText('Name', {}, { timeout: WAIT });
    nameAndSave('Stand Fast');
    await screen.findByText(/My homebrew is made/, {}, { timeout: WAIT });
    const [file] = (await homebrewRepo.ownedSafe()).files;
    const id = file?.id ?? '';

    nameAndSave('Hold Fast');
    expect(await screen.findByText('Saved to My homebrew.', {}, { timeout: WAIT })).toBeTruthy();
    await waitFor(async () => expect(await featNames(id)).toEqual(['Hold Fast']));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(await featNames(id)).toEqual(['Stand Fast']), {
      timeout: WAIT,
    });
    await waitFor(() =>
      expect(sheet.router.state.location.pathname).toBe(
        `/workshop/edit/feat/Stand%20Fast%7C${WORKSHOP_SOURCE}`,
      ),
    );
    // The editor still has the new name, and saving it again replaces the old one.
    expect(screen.getByDisplayValue('Hold Fast')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await featNames(id)).toEqual(['Hold Fast']), {
      timeout: WAIT,
    });
  });

  it("saves into another collection of the player's when picked", async () => {
    const mine = await homebrewRepo.createEditable('Mine', 'MINE');
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new/feat');
    await screen.findByLabelText('Name', {}, { timeout: WAIT });
    fireEvent.click(
      screen.getByRole('button', { name: 'Saves to My homebrew. Pick another collection' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Saves to' }, { timeout: WAIT });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Mine/ }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Saves to Mine. Pick another collection' }),
      ).toBeTruthy(),
    );
    nameAndSave('Stand Fast');
    await waitFor(async () => expect(await featNames(mine.id)).toEqual(['Stand Fast']), {
      timeout: WAIT,
    });
    expect((await homebrewRepo.ownedSafe()).files.map((f) => f.id)).toEqual([mine.id]);
    expect(await screen.findByText('Saved to Mine.', {}, { timeout: WAIT })).toBeTruthy();
  });
});

describe('the file view', () => {
  it('shows the entry as Save writes it, and an edit there comes back to the form', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new/feat');
    fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
      target: { value: 'Stand Fast' },
    });
    const toggle = screen.getByRole('button', { name: 'Show as a file' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const box = screen.getByRole('textbox', { name: 'The file' }) as HTMLTextAreaElement;
    const shown: unknown = JSON.parse(box.value);
    expect(shown).toMatchObject({ name: 'Stand Fast', source: WORKSHOP_SOURCE });

    // Half typed, the form keeps the last that read.
    fireEvent.change(box, { target: { value: '{ "name": "Hold' } });
    expect(screen.getByText(/^Not read yet/)).toBeTruthy();
    // The source is the collection's, whatever the file says.
    fireEvent.change(box, {
      target: { value: JSON.stringify({ name: 'Hold Fast', source: 'ELSE', entries: ['Hold.'] }) },
    });
    expect(screen.queryByText(/^Not read yet/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Hold Fast' })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByDisplayValue('Hold Fast')).toBeTruthy();
    nameAndSave('Hold Fast');
    await waitFor(
      async () => {
        const [file] = (await homebrewRepo.ownedSafe()).files;
        const { file: saved } = await homebrewRepo.getSafe(file?.id ?? '');
        expect(saved?.json.feat).toEqual([
          expect.objectContaining({ name: 'Hold Fast', source: WORKSHOP_SOURCE }),
        ]);
      },
      { timeout: WAIT },
    );
  });
});

describe("a new class's Start from", () => {
  it('keeps the file the class was being made in', async () => {
    const mine = await homebrewRepo.createEditable('Mine', 'MINE');
    const sheet = await renderSheet(sorcerer());
    await sheet.visit(`/workshop/new/class?file=${mine.id}`);
    const start = await screen.findByLabelText('Start from', {}, { timeout: WAIT });
    fireEvent.change(start, { target: { value: 'Sorcerer|TST' } });

    await waitFor(
      () =>
        expect(sheet.router.state.location.pathname).toBe('/workshop/copy/class/Sorcerer%7CTST'),
      { timeout: WAIT },
    );
    expect(sheet.router.state.location.search).toBe(`?file=${mine.id}`);

    // And the copy is saved there, under that file's book, not to My homebrew.
    fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
      target: { value: 'Wild Sorcerer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(
      async () => {
        const { file } = await homebrewRepo.getSafe(mine.id);
        const classes = Array.isArray(file?.json.class) ? file.json.class : [];
        expect(classes.map((c) => isRecord(c) && [c.name, c.source])).toEqual([
          ['Wild Sorcerer', 'MINE'],
        ]);
      },
      { timeout: WAIT },
    );
  });

  it("refuses a copy under its original's own name and book", async () => {
    // A collection whose book is the original's: unrenamed, the copy would be
    // Sorcerer|TST copying Sorcerer|TST, which never reads as either.
    const mine = await homebrewRepo.createEditable('Test book', 'TST');
    const sheet = await renderSheet(sorcerer());
    await sheet.visit(`/workshop/new/class?file=${mine.id}`);
    const start = await screen.findByLabelText('Start from', {}, { timeout: WAIT });
    fireEvent.change(start, { target: { value: 'Sorcerer|TST' } });
    await screen.findByDisplayValue('Sorcerer', {}, { timeout: WAIT });

    expect(screen.getByText(/needs a name of its own/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(save);
    await new Promise((r) => setTimeout(r, 50));
    const { file } = await homebrewRepo.getSafe(mine.id);
    expect(file?.json.class).toBeUndefined();
    expect(sheet.router.state.location.pathname).toBe('/workshop/copy/class/Sorcerer%7CTST');
  });
});
