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

/**
 * A sorcerer carrying the rod the Workshop is about to make, in My homebrew,
 * four of its charges spent (its pool is the copy's, `r1`).
 */
function carrier() {
  const doc = sorcerer();
  doc.play.resources = [{ key: 'item-charges:r1', used: 4 }];
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
  it('casts its spell from the charges it counts, and its action spends them and buys one back', async () => {
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
    type('Action: Buys back a use with', 'spell-slot');
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
    press('Save');
    await waitFor(() => expect(notice()).toBe('Saved Rod of Mending'), { timeout: WAIT });

    await sheet.visit(`/c/${sheet.doc.id}`);
    expect(grantedSpell('Cure Wounds')).toEqual({
      alwaysPrepared: false,
      uses: '3/7 charges',
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
    expect(left('Rod of Mending charges use')).toBe(1);

    press('Use Flare');
    expect(left('Rod of Mending charges use')).toBe(0);
    expect(grantedSpell('Cure Wounds').uses).toBe('0/7 charges');
    // With none left, a spell slot buys one back, into this copy's pool.
    expect(left('Level 1 slot')).toBe(4);
    press('Restore Rod of Mending charges, spending a spell slot');
    castHeld('Level 1 slot');
    expect(left('Rod of Mending charges use')).toBe(1);
    expect(left('Level 1 slot')).toBe(3);
    expect((await sheet.saved()).play.resources).toEqual([{ key: 'item-charges:r1', used: 6 }]);

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
          buyBack: { own: ITEM_CHARGES, resource: 'spell-slot', amount: 1 },
        },
      ],
    });
    expect(readMechanics(rod?.castGuidance).problems).toEqual([]);
  });
});

describe('an item the Workshop wrote before its Charges section counted them', () => {
  it('is read as its charges on the sheet, opens so in the Workshop, and a save writes it so', async () => {
    // A pool card keyed `charges` and a Cast a spell card spending one of it.
    const old = {
      name: 'Wand of Old',
      source: 'OLDW',
      type: 'WD',
      rarity: 'rare',
      entries: ['It holds 5 charges.'],
      charges: 5,
      recharge: 'dawn',
      rechargeAmount: '{@dice 1d4}',
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: ITEM_CHARGES, label: 'Charges', max: 5, reset: 'long' },
          {
            kind: 'grantSpell',
            spell: 'Cure Wounds|TST',
            usage: '1/day',
            resourceKey: ITEM_CHARGES,
          },
        ],
      },
    };
    const meta = {
      json: 'OLDW',
      abbreviation: 'OLDW',
      full: 'Old Wands',
      authors: [],
      version: '1.0.0',
    };
    const file = await homebrewRepo.createEditable('Old Wands', 'OLDW');
    await homebrewRepo.saveEditable(file.id, { _meta: { sources: [meta] }, item: [old] });
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    // Spent from the older card's pool, which no longer counts.
    doc.play.resources = [{ key: ITEM_CHARGES, used: 2 }];
    doc.equipment = [
      {
        id: 'w1',
        ref: { name: 'Wand of Old', source: 'OLDW' },
        qty: 1,
        equipped: true,
        attuned: false,
      },
    ];
    const sheet = await renderSheet(doc, { extra: { spell: [cureWounds] } });
    expect(grantedSpell('Cure Wounds')).toEqual({
      alwaysPrepared: false,
      uses: '5/5 charges',
      usesTitle: 'charges from Wand of Old',
    });
    expect(left('Wand of Old charges use')).toBe(5);

    await sheet.visit('/workshop/edit/item/Wand%20of%20Old%7COLDW');
    await screen.findByLabelText('Charge spell 1', {}, { timeout: WAIT });
    expect(screen.queryByText(/counts these the older way/)).toBeNull();
    expect(screen.queryByLabelText('Uses per rest: Name')).toBeNull();
    press('Save');
    await waitFor(() => expect(notice()).toBe('Saved Wand of Old'), { timeout: WAIT });
    const saved = (await homebrewRepo.ownedSafe()).files.find((f) => f.id === file.id);
    const [wand] = (saved?.json as { item: Array<Record<string, unknown>> }).item;
    expect(wand?.castGuidance).toEqual({
      v: 1,
      effects: [
        {
          kind: 'charges',
          charges: 5,
          regain: '1d4',
          spells: [{ spell: 'Cure Wounds|TST', cost: 1 }],
        },
      ],
    });
  });
});
