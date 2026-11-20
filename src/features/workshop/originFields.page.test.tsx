// @vitest-environment jsdom
// U5b's page check (ADR-002, board 5): a field of each editor, made on the
// Workshop's own page as a player makes it, saved to My homebrew, stored as
// the data writes it, and a species' blindsight counted on a sheet.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homebrewRepo } from '@/db/homebrewRepo';
import {
  classEntry,
  HARNESS_TIMEOUT,
  notice,
  renderSheet,
  resetSheetHarness,
  testCharacter,
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

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** A level 5 Warrior of the species about to be made. */
function lanternfolk() {
  const doc = testCharacter('Osk', [classEntry('Warrior', 5)]);
  doc.race = { name: 'Lanternfolk', source: 'MyHomebrew' };
  return doc;
}

/** Opens a new entry of `kind` on the Workshop page and names it. */
async function make(kind: string, name: string) {
  const sheet = await renderSheet(lanternfolk());
  await sheet.visit('/workshop');
  await sheet.visit(`/workshop/new/${kind}`);
  fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
    target: { value: name },
  });
  return sheet;
}

/** Saves, and gives back the entry as My homebrew stores it. */
async function saved(kind: string, name: string): Promise<Record<string, unknown> | undefined> {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(notice()).toBe(`Saved ${name}`), { timeout: WAIT });
  const [file] = (await homebrewRepo.ownedSafe()).files;
  return (file?.json as Record<string, Array<Record<string, unknown>>>)[kind]?.[0];
}

describe('the origin fields, from the Workshop page to the file and the sheet', () => {
  it("saves a species' blindsight and size, and the sheet counts the blindsight", async () => {
    const sheet = await make('race', 'Lanternfolk');
    type('Blindsight in feet', '10');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Size' })).getByRole('button', { name: 'Huge' }),
    );
    const species = await saved('race', 'Lanternfolk');
    expect(species).toMatchObject({ blindsight: 10, size: ['M', 'H'], speed: 30 });

    await sheet.visit(`/c/${sheet.doc.id}/stats`);
    expect(await screen.findByText(/blindsight 10 ft\./, {}, { timeout: WAIT })).toBeTruthy();
  });

  it("saves a feat's prerequisite and languages", async () => {
    await make('feat', 'Harbour Hand');
    await screen.findByLabelText('Ability score needed', {}, { timeout: WAIT });
    fireEvent.change(screen.getByLabelText('Ability score needed'), { target: { value: 'con' } });
    type('Languages of their choice', '1');
    const feat = await saved('feat', 'Harbour Hand');
    expect(feat).toMatchObject({
      prerequisite: [{ ability: [{ con: 13 }] }],
      languageProficiencies: [{ anyStandard: 1 }],
    });
  });

  it("saves an optional feature's pact", async () => {
    await make('optionalfeature', 'Harbour Blade');
    fireEvent.change(await screen.findByLabelText('Pact boon', {}, { timeout: WAIT }), {
      target: { value: 'Tome' },
    });
    const option = await saved('optionalfeature', 'Harbour Blade');
    expect(option?.prerequisite).toEqual([{ pact: 'Tome' }]);
  });

  it('saves the spells an item casts by name and book', async () => {
    await make('item', 'Lamp of the Coast');
    fireEvent.click(await screen.findByRole('button', { name: 'Add a spell' }, { timeout: WAIT }));
    type('Spell 1', 'Guidance');
    const lamp = await saved('item', 'Lamp of the Coast');
    expect(lamp?.attachedSpells).toEqual({ will: ['Guidance|TST'] });
  });
});
