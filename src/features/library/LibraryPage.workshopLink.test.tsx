// @vitest-environment jsdom
// An entry's way into the Workshop: Edit for one the player's own file holds,
// Change for your table and Make one like it for everything else (board 6, C).
// It used to offer Edit whenever any file of theirs declared the entry's book,
// so a collection named after a book turned every entry of that book into an
// Edit that opened nothing.
import 'fake-indexeddb/auto';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homebrewRepo } from '@/db/homebrewRepo';
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

const WAIT = 30_000;

describe("an entry's Workshop link", () => {
  it('changes or copies a book entry, even with a collection of yours named after its book', async () => {
    await homebrewRepo.createEditable('Test book', 'TST');
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/library/spell/aid%7Ctst');
    await screen.findByRole('heading', { name: 'Aid' }, { timeout: WAIT });

    const like = await screen.findByRole('link', { name: /^Make one like it/ }, { timeout: WAIT });
    expect(like.getAttribute('href')).toBe('/workshop/copy/spell/Aid%7CTST');
    const change = screen.getByRole('link', { name: /^Change for your table/ });
    expect(change.getAttribute('href')).toBe('/workshop/change/spell/aid%7Ctst');
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('edits one your file holds, in that file', async () => {
    const mine = await homebrewRepo.createEditable('Mine', 'MINE');
    await homebrewRepo.saveEditable(mine.id, {
      ...(mine.json as Record<string, unknown>),
      spell: [{ name: 'Spark', source: 'MINE', level: 0, school: 'V', entries: ['A spark.'] }],
    });
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/library/spell/spark%7Cmine');
    await screen.findByRole('heading', { name: 'Spark' }, { timeout: WAIT });

    const link = await screen.findByRole('link', { name: 'Edit' }, { timeout: WAIT });
    expect(link.getAttribute('href')).toBe(`/workshop/edit/spell/Spark%7CMINE?file=${mine.id}`);
  });

  it('edits the one shown, when two of your files hold one by its name and book', async () => {
    const files = [];
    for (const [title, text] of [
      ['First', 'From the first.'],
      ['Second', 'From the second.'],
    ] as const) {
      const row = await homebrewRepo.createEditable(title, 'HB');
      await homebrewRepo.saveEditable(row.id, {
        ...(row.json as Record<string, unknown>),
        feat: [{ name: 'Gift', source: 'HB', entries: [text] }],
      });
      files.push({ id: row.id, text });
    }
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/library/feat/gift%7Chb');
    await screen.findByRole('heading', { name: 'Gift' }, { timeout: WAIT });

    // The page shows whichever the registry keeps; Edit opens that one.
    const shown = files.find((f) => screen.queryByText(f.text) !== null);
    if (shown === undefined) throw new Error('neither Gift is shown');
    const link = await screen.findByRole('link', { name: 'Edit' }, { timeout: WAIT });
    expect(link.getAttribute('href')).toBe(`/workshop/edit/feat/Gift%7CHB?file=${shown.id}`);
  });
});
