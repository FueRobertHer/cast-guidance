// @vitest-environment jsdom
// O1b: an item's charges made in the Workshop and spent on the sheet. The
// item is made on the Workshop's own page and saved to My homebrew, as a
// player makes one; what is under test is the whole path: the Charges
// section and an action's cost writing the item's `charges` effect, the save
// writing the entry, the registry rebuilding from the file, and the sheet
// casting from the carried copy's charges and spending them on the action.
// The file then goes through the import preview as an export of it would.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHomebrewRow, homebrewRepo } from '@/db/homebrewRepo';
import { ITEM_CHARGES } from '@/engine/curated/itemCharges';
import { readMechanics } from '@/engine/effects/mechanics';
import type { DataEntity } from '@/engine/types';
import { previewHomebrewImport } from '@/features/homebrew/importPreview';
import { rollLogStore } from '@/stores/rollLog';
import {
  castHeld,
  castTiles,
  grantedSpell,
  HARNESS_TIMEOUT,
  left,
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

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Heals 1d8, a die more a slot level. */
const cureWounds: DataEntity = {
  name: 'Cure Wounds',
  source: 'TST',
  level: 1,
  school: 'A',
  time: [{ number: 1, unit: 'action' }],
  entries: ['A creature you touch regains {@dice 1d8} hit points.'],
  entriesHigherLevel: [
    { entries: ['The healing increases by {@scaledice 1d8|1-9|1d8} per slot above 1st.'] },
  ],
};

/** A sorcerer carrying the rod the Workshop is about to make, in My homebrew. */
function carrier() {
  const doc = sorcerer();
  doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
  doc.equipment = [
    {
      id: 'r1',
      ref: { name: 'Rod of Mending', source: 'MyHomebrew' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
  ];
  return doc;
}

describe("an item's charges from the Workshop to the sheet", () => {
  it('casts its spell from the charges it counts, and its action spends them', async () => {
    const sheet = await renderSheet(carrier(), { extra: { spell: [cureWounds] } });
    // From the Workshop's home, as a player gets to New.
    await sheet.visit('/workshop');
    await sheet.visit('/workshop/new/item');
    fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
      target: { value: 'Rod of Mending' },
    });
    type('Charges', '7');
    type('Regains them', 'dawn');
    type('How many', '1d6 + 1');
    press('Add a spell its charges cast');
    type('Charge spell 1', 'cure wounds');
    type('Charge spell 1: up to level', '3');
    type("Its spells' attack and DC from", 'wis');
    // An action of its own that spends them, a bonus action so it shares no slot with the cast.
    press('More');
    const dialog = await screen.findByRole('dialog', {}, { timeout: WAIT });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Action\b/ }));
    fireEvent.change(await screen.findByLabelText('Action: Name', {}, { timeout: WAIT }), {
      target: { value: 'Flare' },
    });
    type('Action: Takes', 'bonus');
    type('Action: Spends', ITEM_CHARGES);
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
    press('Save');
    await waitFor(() => expect(notice()).toBe('Saved Rod of Mending'), { timeout: WAIT });

    await sheet.visit(`/c/${sheet.doc.id}`);
    expect(grantedSpell('Cure Wounds')).toEqual({
      alwaysPrepared: false,
      uses: '7/7 charges',
      usesTitle: 'charges from Rod of Mending',
    });
    press('1d8');
    expect(castTiles()).toEqual([
      'Level 1 from Rod of Mending, 1 charge',
      'Level 2 from Rod of Mending, 2 charges',
      'Level 3 from Rod of Mending, 3 charges',
    ]);
    castHeld('Level 2 from Rod of Mending');
    expect(rollLogStore.getState().rolls.map((r) => [r.expr, r.kind])).toEqual([['2d8', 'heal']]);
    expect(left('Rod of Mending charges use')).toBe(5);

    press('Use Flare');
    expect(left('Rod of Mending charges use')).toBe(4);
    expect(grantedSpell('Cure Wounds').uses).toBe('4/7 charges');
    expect((await sheet.saved()).play.resources).toEqual([{ key: 'item-charges:r1', used: 3 }]);

    // The file as an export of it holds it: one item, its effects read with
    // nothing wrong, and nothing the import preview takes for a rule pack.
    const mine = (await homebrewRepo.ownedSafe()).files;
    expect(mine).toHaveLength(1);
    const row = await buildHomebrewRow(structuredClone(mine[0]?.json), 'my-homebrew.json');
    const preview = previewHomebrewImport({
      row,
      bytes: 1,
      existing: [],
      official: null,
      characters: [],
    });
    expect(preview.counts).toEqual({ item: 1 });
    expect(preview.pack).toBeUndefined();
    expect(preview.copyIssues).toEqual([]);
    const [rod] = (row.json as { item: Array<Record<string, unknown>> }).item;
    expect(rod?.castGuidance).toEqual({
      v: 1,
      effects: [
        {
          kind: 'charges',
          charges: 7,
          regain: '1d6+1',
          ability: 'wis',
          spells: [{ spell: 'Cure Wounds|TST', cost: 1, upTo: 3 }],
        },
        {
          kind: 'action',
          economy: 'bonus',
          label: 'Flare',
          cost: { resource: ITEM_CHARGES, amount: 1 },
        },
      ],
    });
    expect(readMechanics(rod?.castGuidance).problems).toEqual([]);
  });
});
