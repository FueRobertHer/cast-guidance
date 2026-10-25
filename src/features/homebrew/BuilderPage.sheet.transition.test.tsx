// @vitest-environment jsdom
// TEST-003: a homebrew edit reaching a character that uses it. The builder
// writes the file and invalidates the registry; nothing tells the sheet
// directly, so what is under test is the whole path: the real homebrew row in
// IndexedDB, the registry rebuilding on the content revision, and the sheet
// re-deriving from it when the player goes back to the character.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homebrewRepo } from '@/db/homebrewRepo';
import {
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

/** An editable file holding a spell and a ring, as the builder would have made it. */
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
const armorClass = () => Number(screen.getByText(/^AC/).previousSibling?.textContent);

/** Open an entity's form in the builder, change one field, and save it. */
async function edit(entity: string, field: string, value: string) {
  fireEvent.click(await screen.findByRole('button', { name: entity }, { timeout: WAIT }));
  fireEvent.change(screen.getByLabelText(field), { target: { value } });
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

    await sheet.visit(`/homebrew/edit/${fileId}`);
    // A lazily loaded route, so it can take a moment on a cold run.
    await screen.findByRole('heading', { level: 1, name: 'My Brews' }, { timeout: WAIT });
    await edit('Ember Lance', 'Description', 'A lance deals {@damage 4d8} fire damage.');
    await edit('Ring of Warding', 'AC bonus', '+2');
    fireEvent.click(screen.getByRole('button', { name: /New spell/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Glow Ward' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sorcerer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(notice()).toBe('Saved Glow Ward'), { timeout: WAIT });

    await sheet.visit(`/c/${sheet.doc.id}`);
    expect(armorClass()).toBe(13);
    expect(screen.getByRole('button', { name: '4d8' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '2d6' })).toBeNull();

    await sheet.tab('Spells');
    expect(screen.getByRole('button', { name: 'Learn Glow Ward' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Learn Ember Lance' }).getAttribute('aria-pressed'),
    ).toBe('true');

    // Three saves on the same file, each a new content revision.
    const { file } = await homebrewRepo.getSafe(fileId);
    expect(file?.rev).toBe(4);
    expect(file?.counts).toEqual({ spell: 2, item: 1 });
  });
});
