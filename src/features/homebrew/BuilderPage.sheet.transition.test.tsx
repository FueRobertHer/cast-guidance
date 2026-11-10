// @vitest-environment jsdom
// TEST-003: a homebrew edit reaching a character that uses it. A collection's
// entries open in the Workshop, which writes the file and invalidates the
// registry; nothing tells the sheet directly, so what is under test is the
// whole path: the real homebrew row in IndexedDB, the registry rebuilding on
// the content revision, and the sheet re-deriving from it when the player
// goes back to the character.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homebrewRepo } from '@/db/homebrewRepo';
import {
  chooseSpells,
  HARNESS_TIMEOUT,
  notice,
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

/** An editable file holding a spell and a ring, as the Builder's forms made them. */
async function brewFile() {
  const row = await homebrewRepo.createEditable('My Brews', 'HBX');
  await homebrewRepo.saveEditable(row.id, {
    ...(row.json as Record<string, unknown>),
    spell: [
      {
        name: 'Ember Lance',
        source: 'HBX',
        level: 1,
        school: 'V',
        time: [{ number: 1, unit: 'action' }],
        classes: { fromClassList: [{ name: 'Sorcerer', source: 'PHB' }] },
        entries: ['A lance deals {@damage 2d6} fire damage.'],
      },
    ],
    item: [
      { name: 'Ring of Warding', source: 'HBX', type: 'RG', bonusAc: '+1', entries: ['A ring.'] },
    ],
  });
  return row.id;
}

/** A sorcerer who knows the brewed spell and wears the brewed ring. */
function brewUser() {
  const doc = sorcerer();
  const lance = { name: 'Ember Lance', source: 'HBX' };
  doc.spellcasting = { 'sorcerer|tst': { known: [lance], prepared: [lance] } };
  doc.equipment = [
    {
      id: 'r1',
      ref: { name: 'Ring of Warding', source: 'HBX' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
  ];
  return doc;
}

/** The Armor Class tile's number. */
const armorClass = () => Number(screen.getByText(/^Armor Class/).previousSibling?.textContent);

/** Open an entry from its collection in the Workshop, change one field, and save it. */
async function edit(
  sheet: { visit: (to: string) => Promise<void> },
  fileId: string,
  entity: string,
  field: string,
  value: string,
) {
  await sheet.visit(`/homebrew/edit/${fileId}`);
  // A lazily loaded route, so it can take a moment on a cold run.
  fireEvent.click(await screen.findByRole('link', { name: `Edit ${entity}` }, { timeout: WAIT }));
  fireEvent.change(await screen.findByLabelText(field, {}, { timeout: WAIT }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(notice()).toBe(`Saved ${entity}`), { timeout: WAIT });
}

describe('a homebrew edit on a character that uses it (TEST-003)', () => {
  it('reaches the sheet: new dice, a new AC bonus and a new spell to learn', async () => {
    const fileId = await brewFile();
    const sheet = await renderSheet(brewUser());
    // Dex 12 and the ring's +1.
    expect(armorClass()).toBe(12);
    expect(screen.getByRole('button', { name: '2d6' })).toBeTruthy();

    // The damage card's dice, and the ring's AC bonus.
    await edit(sheet, fileId, 'Ember Lance', 'Dice', '4d8');
    await edit(sheet, fileId, 'Ring of Warding', 'AC', '+2');
    // A new spell from the collection: made in the Workshop, kept in that file.
    await sheet.visit(`/homebrew/edit/${fileId}`);
    fireEvent.click(await screen.findByRole('link', { name: 'New spell' }, { timeout: WAIT }));
    fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
      target: { value: 'Glow Ward' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Sorcerer' }, { timeout: WAIT }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(notice()).toBe('Saved Glow Ward'), { timeout: WAIT });

    await sheet.visit(`/c/${sheet.doc.id}`);
    expect(armorClass()).toBe(13);
    expect(screen.getByRole('button', { name: '4d8' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '2d6' })).toBeNull();

    await sheet.tab('Spells');
    await chooseSpells();
    expect(screen.getByRole('button', { name: 'Learn Glow Ward' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Learn Ember Lance' }).getAttribute('aria-pressed'),
    ).toBe('true');

    // Three saves on the same file, each a new content revision.
    const { file } = await homebrewRepo.getSafe(fileId);
    expect(file?.rev).toBe(4);
    expect(file?.counts).toEqual({ spell: 2, item: 1 });
    expect(file?.json.spell).toContainEqual(
      expect.objectContaining({ name: 'Glow Ward', source: 'HBX' }),
    );
    // Nothing went to a file of the Workshop's own.
    expect((await homebrewRepo.ownedSafe()).files.map((f) => f.id)).toEqual([fileId]);
  });

  it('never writes a new entry into a file the address names but the player did not make', async () => {
    const imported = await homebrewRepo.importJson(
      {
        _meta: { sources: [{ json: 'IMP', full: 'Imported Brews' }] },
        spell: [{ name: 'Old Spark', source: 'IMP', level: 0, school: 'V', entries: ['A spark.'] }],
      },
      'imported.json',
    );
    const sheet = await renderSheet(brewUser());
    for (const [id, name] of [
      [imported.id, 'Stray Ward'],
      ['no-such-file', 'Lost Ward'],
    ] as const) {
      // From the Workshop's home, as a player gets to New: the editor keeps
      // what it saved through its own address change, by path alone.
      await sheet.visit('/workshop');
      await sheet.visit(`/workshop/new/spell?file=${encodeURIComponent(id)}`);
      fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
        target: { value: name },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(notice()).toBe(`Saved ${name}`), { timeout: WAIT });
    }
    const { file } = await homebrewRepo.getSafe(imported.id);
    expect(file?.rev).toBe(imported.rev);
    expect(file?.json.spell).toEqual([expect.objectContaining({ name: 'Old Spark' })]);
    // Both went to My homebrew, as a new entry without `?file=` does.
    const mine = (await homebrewRepo.ownedSafe()).files;
    expect(mine).toHaveLength(1);
    expect(mine[0]?.sourceIds).toEqual(['MyHomebrew']);
    expect((mine[0]?.json.spell as Array<{ name: string }>).map((s) => s.name)).toEqual([
      'Stray Ward',
      'Lost Ward',
    ]);
  });
});
