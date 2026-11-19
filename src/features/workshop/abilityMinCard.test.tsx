// @vitest-environment jsdom
// The One Workshop plan's acceptance test for F2 (board 3): Ogre's Grip, an
// item whose wearer's Strength is at least 19, made on the Workshop's own page
// as a player makes it, saved to My homebrew, and counted on Hild's sheet
// while she is attuned to it.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { homebrewRepo } from '@/db/homebrewRepo';
import { readMechanics } from '@/engine/effects/mechanics';
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

/** Hild, a level 5 warrior with Strength 8, wearing and attuned to the item about to be made. */
function hild() {
  const doc = testCharacter('Hild', [classEntry('Warrior', 5)], { str: 8 });
  doc.equipment = [
    {
      id: 'g1',
      ref: { name: "Ogre's Grip", source: 'MyHomebrew' },
      qty: 1,
      equipped: true,
      attuned: true,
    },
  ];
  return doc;
}

describe("Ogre's Grip from the Workshop to Hild's sheet", () => {
  it('saves an item whose Strength is at least 19, and her sheet shows Strength 19', async () => {
    // Her own Strength is 8, so a 19 on her sheet is the item's.
    const sheet = await renderSheet(hild());
    await sheet.visit('/workshop');
    await sheet.visit('/workshop/new/item');
    fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
      target: { value: "Ogre's Grip" },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Requires attunement' }));
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = await screen.findByRole('dialog', {}, { timeout: WAIT });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ability score is at least' }));
    await screen.findByLabelText('Ability score is at least: Ability', {}, { timeout: WAIT });
    // Each box is changed and set back, so the item holds what was picked, not the card's start.
    type('Ability score is at least: Ability', 'dex');
    type('Ability score is at least: At least', '18');
    expect(screen.getByText('Dexterity is at least 18')).toBeTruthy();
    type('Ability score is at least: Ability', 'str');
    type('Ability score is at least: At least', '19');
    expect(screen.getByText('Strength is at least 19')).toBeTruthy();
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(notice()).toBe("Saved Ogre's Grip"), { timeout: WAIT });

    const [file] = (await homebrewRepo.ownedSafe()).files;
    const [grip] = (file?.json as { item: Array<Record<string, unknown>> }).item;
    expect(grip).toMatchObject({ name: "Ogre's Grip", source: 'MyHomebrew', reqAttune: true });
    expect(grip?.castGuidance).toEqual({
      v: 1,
      effects: [{ kind: 'abilityMin', ability: 'str', min: 19 }],
    });
    expect(readMechanics(grip?.castGuidance).problems).toEqual([]);

    await sheet.visit(`/c/${sheet.doc.id}`);
    await sheet.tab('Stats');
    expect(
      await screen.findByRole('button', { name: 'STR score 19: breakdown' }, { timeout: WAIT }),
    ).toBeTruthy();
  });
});
