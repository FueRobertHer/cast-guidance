// @vitest-environment jsdom
// The Workshop page over the app's routes: what Make your own names, and which
// file an entry opens from and saves to when two files hold one by the same
// name and book.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HomebrewFileRow } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { isRecord } from '@/engine/castGuidance';
import { namelessControls } from '../../../tests-fixtures/a11y';
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

describe('Make your own, until the Make sheet', () => {
  it('names every control, each way to make one by its kind', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/new');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Make your own' }, { timeout: WAIT }),
    ).toBeTruthy();
    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('link', { name: 'Feats' }).getAttribute('href')).toBe(
      '/workshop/new/feat',
    );
    expect(document.title).toBe('Make your own · Workshop · Cast Guidance');
  });

  it("is where the home's Make your own goes", async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop');
    fireEvent.click(await screen.findByRole('link', { name: 'Make your own' }, { timeout: WAIT }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Make your own' }, { timeout: WAIT }),
    ).toBeTruthy();
  });
});

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
