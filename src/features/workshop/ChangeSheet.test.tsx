// @vitest-environment jsdom
// Change for your table and Make one like it (ADR-002 D2, board 6, pick C), from
// the Library, through the app's routes: a change saved from the Change sheet
// counts on every sheet that holds the book's entry, Undo brings the book's
// back, and a copy of a changed entry starts from, and stays, the table's version.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { identityKey } from '@/data5e/normalize';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { buildHomebrewRow, homebrewRepo, WORKSHOP_SOURCE } from '@/db/homebrewRepo';
import { deriveSheet } from '@/engine/derive';
import type { CharacterDoc } from '@/engine/types';
import {
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
  seedWorld,
  sorcerer,
  testCharacter,
  type WorldLayer,
} from '../../../tests-fixtures/sheetHarness';
import { writeChange } from './copyWriter';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

const WAIT = 30_000;

/** The 2024 Barbarian and its Rage, which the sheet knows by their class and level. */
const BARBARIAN: WorldLayer = {
  class: [
    {
      name: 'Barbarian',
      source: 'XPHB',
      edition: 'one',
      hd: { number: 1, faces: 12 },
      proficiency: ['str', 'con'],
      classFeatures: ['Rage|Barbarian|XPHB|1'],
    },
  ],
  classFeature: [
    {
      name: 'Rage',
      source: 'XPHB',
      className: 'Barbarian',
      classSource: 'XPHB',
      level: 1,
      entries: ['You can imbue yourself with a primal power called Rage.'],
    },
  ],
};

const barbarian = (name: string): CharacterDoc =>
  testCharacter(name, [{ ref: { name: 'Barbarian', source: 'XPHB' }, levels: 1, hp: ['avg'] }], {
    str: 16,
    con: 14,
  });

const sheetOf = async (doc: CharacterDoc) =>
  deriveSheet(doc, engineContextFor(await getRegistry()));

/** The player's Changes to the books, when stored. */
async function changes(): Promise<Record<string, unknown> | undefined> {
  const { files } = await homebrewRepo.ownedSafe();
  return files.find((f) => f.role === 'changes')?.json;
}

const changesOf = async (type: string): Promise<unknown[]> => {
  const json = await changes();
  return Array.isArray(json?.[type]) ? (json[type] as unknown[]) : [];
};

/** Open Rage from the Barbarian's page, then Change for your table. */
async function changeRageFromTheLibrary(sheet: Awaited<ReturnType<typeof renderSheet>>) {
  await sheet.visit('/library/class/barbarian%7Cxphb');
  fireEvent.click(await screen.findByRole('link', { name: 'Rage' }, { timeout: WAIT }));
  fireEvent.click(
    await screen.findByRole('link', { name: /^Change for your table/ }, { timeout: WAIT }),
  );
  await screen.findByText(/Changes the book's Rage/, {}, { timeout: WAIT });
}

describe('Change for your table', () => {
  it('a Rage changed from the Library counts on every barbarian, and Undo brings the book’s back', async () => {
    const osk = barbarian('Osk');
    const maren = barbarian('Maren');
    const sheet = await renderSheet(osk, { extra: BARBARIAN });
    await characterRepo.put(maren);
    const before = { osk: await sheetOf(osk), maren: await sheetOf(maren) };

    await changeRageFromTheLibrary(sheet);
    expect(sheet.router.state.location.pathname).toBe(
      '/workshop/change/classFeature/rage%7Cxphb%7Cbarbarian%7Cxphb%7C1',
    );
    // Nothing differs yet, so Save waits.
    const save = screen.getByRole('button', { name: 'Save for your table' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Speed' }));
    fireEvent.click(save);
    await screen.findByRole('button', { name: 'Undo' }, { timeout: WAIT });

    const [stored] = await changesOf('classFeature');
    expect(stored).toMatchObject({
      name: 'Rage',
      source: 'XPHB',
      className: 'Barbarian',
      level: 1,
      _copy: { name: 'Rage', source: 'XPHB' },
      castGuidance: { effects: [{ kind: 'speedBonus', amount: 5 }] },
    });
    for (const [doc, was] of [
      [osk, before.osk],
      [maren, before.maren],
    ] as const) {
      const now = await sheetOf(doc);
      expect(now.speedWalk.value).toBe(was.speedWalk.value + 5);
      // What it inherits stays the book's: its uses.
      expect(now.resources.find((r) => r.label === 'Rage')?.max).toBe(
        was.resources.find((r) => r.label === 'Rage')?.max,
      );
    }

    // The save made Changes to the books; Undo takes it away, and the sheets are the book's.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(changes()).resolves.toBeUndefined(), { timeout: WAIT });
    invalidateRegistry();
    expect(await sheetOf(osk)).toEqual(before.osk);
    expect(await sheetOf(maren)).toEqual(before.maren);
  });

  it("Use the book's again takes the change away, and Undo puts it back", async () => {
    const osk = barbarian('Osk');
    const sheet = await renderSheet(osk, { extra: BARBARIAN });
    const before = await sheetOf(osk);
    await changeRageFromTheLibrary(sheet);
    fireEvent.click(screen.getByRole('button', { name: 'Speed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save for your table' }));
    await screen.findByText(/Every character at your table uses your Rage/, {}, { timeout: WAIT });
    const changed = (await sheetOf(osk)).speedWalk.value;
    expect(changed).toBe(before.speedWalk.value + 5);

    // Opened again from the Library, it shows the change the table has, and a
    // second edit is saved with the first: it is written against the book's.
    await changeRageFromTheLibrary(sheet);
    expect(screen.getByText(/5 ft to your Speed/)).toBeTruthy();
    fireEvent.change(
      screen.getByDisplayValue('You can imbue yourself with a primal power called Rage.'),
      { target: { value: 'Rage, as our table plays it.' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save for your table' }));
    // The reworded paragraph is stored as a `_mod` of the book's text.
    await waitFor(
      async () =>
        expect((await changesOf('classFeature'))[0]).toMatchObject({
          _copy: { _mod: { entries: [{ mode: 'replaceArr' }] } },
          castGuidance: { effects: [{ kind: 'speedBonus', amount: 5 }] },
        }),
      { timeout: WAIT },
    );
    invalidateRegistry();
    const rage = (await getRegistry()).byType('classFeature').find((f) => f.name === 'Rage');
    expect(rage?.entries).toEqual(['Rage, as our table plays it.']);
    expect((await sheetOf(osk)).speedWalk.value).toBe(changed);
    // The header's More, before the effect list's own.
    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0] as HTMLElement);
    fireEvent.click(
      await screen.findByRole('button', { name: /Use the book's Rage again/ }, { timeout: WAIT }),
    );
    await screen.findByText(/The book's Rage is back for your table/, {}, { timeout: WAIT });
    expect(await changesOf('classFeature')).toEqual([]);
    expect(await sheetOf(osk)).toEqual(before);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(changesOf('classFeature')).resolves.toHaveLength(1), {
      timeout: WAIT,
    });
    invalidateRegistry();
    expect((await sheetOf(osk)).speedWalk.value).toBe(changed);
  });

  /**
   * Two features of one class with one name and book, as each class's Ability
   * Score Improvement, here from an imported collection; the one at `changed`
   * changed for the table.
   */
  async function gritChangedAt(changed: number) {
    const grit = (level: number): Entity => ({
      name: 'Grit',
      source: 'HB',
      className: 'Sorcerer',
      classSource: 'TST',
      level,
      entries: [`Grit at level ${level}.`],
    });
    await homebrewRepo.commit(
      await buildHomebrewRow(
        {
          _meta: { sources: [{ json: 'HB', full: 'Homebrew' }] },
          classFeature: [grit(4), grit(8)],
        },
        'grit.json',
      ),
    );
    await seedWorld();
    const reg = await getRegistry();
    const at = (level: number) =>
      reg.byType('classFeature').find((f) => f.name === 'Grit' && f.level === level) as Entity;
    await homebrewRepo.saveEntry(
      'classFeature',
      writeChange('classFeature', at(changed), {
        ...at(changed),
        entries: ['Changed.'],
      }) as Entity & { name: string; source: string },
      { role: 'changes' },
    );
    return { at };
  }

  it('opens the second of two same-named features with its own change', async () => {
    const { at } = await gritChangedAt(8);
    const sheet = await renderSheet(sorcerer());
    await sheet.visit(
      `/workshop/change/classFeature/${encodeURIComponent(identityKey('classFeature', at(8)))}`,
    );
    await screen.findByText(/Changes the book's Grit/, {}, { timeout: WAIT });
    expect(screen.getByDisplayValue('Changed.')).toBeTruthy();
  });

  it('keeps what is typed while a save is under way, unsaved', async () => {
    const sheet = await renderSheet(sorcerer());
    await sheet.visit('/workshop/change/spell/aid%7Ctst');
    const text = await screen.findByDisplayValue('Boost max HP.', {}, { timeout: WAIT });
    fireEvent.change(text, { target: { value: 'Saved text.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save for your table' }));
    // Typed before the save lands.
    fireEvent.change(screen.getByDisplayValue('Saved text.'), {
      target: { value: 'Typed after.' },
    });
    await screen.findByText(/Saved\. Every character at your table/, {}, { timeout: WAIT });
    expect(screen.getByDisplayValue('Typed after.')).toBeTruthy();
    // What was saved is what Save was pressed on.
    const saved = JSON.stringify(await changesOf('spell'));
    expect(saved).toContain('Saved text.');
    expect(saved).not.toContain('Typed after.');
    // Undo takes the save back and, as the Workshop editor's, keeps what was typed.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(changesOf('spell')).resolves.toEqual([]), { timeout: WAIT });
    expect(screen.getByDisplayValue('Typed after.')).toBeTruthy();
  });

  it('is not offered for a condition the app counts by its own rules', async () => {
    const condition = (name: string): Entity => ({
      name,
      source: 'TST',
      entries: [`${name}, as the book says.`],
    });
    const sheet = await renderSheet(sorcerer(), {
      extra: { condition: [condition('Poisoned'), condition('Dazed')] },
    });
    // A homebrew-named condition of a book can be changed.
    await sheet.visit('/library/condition/dazed%7Ctst');
    await screen.findByRole('link', { name: /^Change for your table/ }, { timeout: WAIT });
    // Poisoned is the app's: no change would reach a sheet, so only a copy is offered.
    await sheet.visit('/library/condition/poisoned%7Ctst');
    await screen.findByRole('link', { name: /^Make one like it/ }, { timeout: WAIT });
    expect(screen.queryByRole('link', { name: /^Change for your table/ })).toBeNull();
    await sheet.visit('/workshop/change/condition/poisoned%7Ctst');
    await screen.findByText(/counted by the app's own rules/, {}, { timeout: WAIT });
    expect(screen.queryByRole('button', { name: 'Save for your table' })).toBeNull();
  });

  it('keeps a change to each of two same-named features, and takes back only its own', async () => {
    const { at } = await gritChangedAt(4);
    const sheet = await renderSheet(sorcerer());
    await sheet.visit(
      `/workshop/change/classFeature/${encodeURIComponent(identityKey('classFeature', at(8)))}`,
    );
    // The level-8 Grit opens, not the changed one at level 4.
    const text = await screen.findByDisplayValue('Grit at level 8.', {}, { timeout: WAIT });
    fireEvent.change(text, { target: { value: 'Level 8, changed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save for your table' }));
    await screen.findByText(/Saved\. Every character at your table/, {}, { timeout: WAIT });
    const entriesAt = async (level: number) => {
      invalidateRegistry();
      return (await getRegistry())
        .byType('classFeature')
        .find((f) => f.name === 'Grit' && f.level === level)?.entries;
    };
    expect(await changesOf('classFeature')).toHaveLength(2);
    expect(await entriesAt(4)).toEqual(['Changed.']);
    expect(await entriesAt(8)).toEqual(['Level 8, changed.']);

    fireEvent.click(screen.getAllByRole('button', { name: 'More' })[0] as HTMLElement);
    fireEvent.click(
      await screen.findByRole('button', { name: /Use the book's Grit again/ }, { timeout: WAIT }),
    );
    await screen.findByText(/The book's Grit is back for your table/, {}, { timeout: WAIT });
    expect(await changesOf('classFeature')).toMatchObject([{ level: 4 }]);
    expect(await entriesAt(4)).toEqual(['Changed.']);
    expect(await entriesAt(8)).toEqual(['Grit at level 8.']);
  });
});

describe('Make one like it', () => {
  it('on a changed Aid starts from the changed Aid, and its copy stays it', async () => {
    await seedWorld();
    const book = (await getRegistry()).get('spell', 'Aid', 'TST') as Entity;
    await homebrewRepo.saveEntry(
      'spell',
      writeChange('spell', book, {
        ...book,
        entries: ['Boost max HP a lot.'],
        castGuidance: { v: 1, effects: [{ kind: 'speedBonus', amount: 5 }] },
      }) as Entity & { name: string; source: string },
      { role: 'changes' },
    );
    const sheet = await renderSheet(sorcerer());

    await sheet.visit('/library/spell/aid%7Ctst');
    await screen.findByText('Boost max HP a lot.', {}, { timeout: WAIT });
    // A change is not one of the player's own entries: no Edit into Changes to the books.
    await screen.findByRole(
      'link',
      { name: /^Change for your table.*Your table uses your version/ },
      { timeout: WAIT },
    );
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /^Make one like it/ }));

    await screen.findByText(/Starts from your table's Aid/, {}, { timeout: WAIT });
    expect(screen.getByDisplayValue('Boost max HP a lot.')).toBeTruthy();
    expect(screen.getByText(/No changes from your table's Aid yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Greater Aid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Undo' }, { timeout: WAIT });

    // The copy, as the registry reads it (against the book's Aid), is the table's version.
    invalidateRegistry();
    const reg = await getRegistry();
    const copy = reg.get('spell', 'Greater Aid', WORKSHOP_SOURCE);
    expect(copy?.entries).toEqual(['Boost max HP a lot.']);
    expect(copy?.castGuidance).toMatchObject({ effects: [{ kind: 'speedBonus', amount: 5 }] });
    const aid = reg.get('spell', 'Aid', 'TST') as Entity;
    expect(reg.changeOf(aid)?.base.entries).toEqual(['Boost max HP.']);

    // Opened again, it reads as it was saved, with no "changed since you copied it".
    await sheet.visit(`/workshop/edit/spell/Greater%20Aid%7C${WORKSHOP_SOURCE}`);
    await screen.findByDisplayValue('Boost max HP a lot.', {}, { timeout: WAIT });
    expect(screen.queryByText(/changed since you copied it/)).toBeNull();
  });

  it('opens a change to the books in the Change sheet, not as an entry of yours', async () => {
    await seedWorld();
    const book = (await getRegistry()).get('spell', 'Aid', 'TST') as Entity;
    const saved = await homebrewRepo.saveEntry(
      'spell',
      writeChange('spell', book, { ...book, entries: ['Changed.'] }) as Entity & {
        name: string;
        source: string;
      },
      { role: 'changes' },
    );
    const sheet = await renderSheet(sorcerer());
    await sheet.visit(`/workshop/edit/spell/Aid%7CTST?file=${saved.fileId}`);
    await screen.findByText(/Changes the book's Aid/, {}, { timeout: WAIT });
    expect(sheet.router.state.location.pathname).toBe('/workshop/change/spell/aid%7Ctst');
  });
});
