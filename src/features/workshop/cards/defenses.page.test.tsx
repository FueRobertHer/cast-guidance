// @vitest-environment jsdom
// U4a's page check (ADR-002): an item whose Armor Class is worked out another
// way, made on the Workshop's own page as a player makes it, saved to My
// homebrew, and counted on the sheet of the character carrying it.
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
} from '../../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

/** How long a lazily loaded page or an IndexedDB write may take on a loaded runner. */
const WAIT = 30_000;
const CARD = 'Another way to work out AC';

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Dexterity 16 and Constitution 14, unarmored (13), wearing the charm about to be made. */
function wearer() {
  const doc = testCharacter('Orla', [classEntry('Warrior', 5)], { dex: 16, con: 14 });
  doc.equipment = [
    {
      id: 'g1',
      ref: { name: 'Bark Charm', source: 'MyHomebrew' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
  ];
  return doc;
}

describe('an AC worked out another way, from the Workshop to a sheet', () => {
  it('saves what the card wrote, and the sheet counts it', async () => {
    const sheet = await renderSheet(wearer());
    await sheet.visit('/workshop');
    await sheet.visit('/workshop/new/item');
    fireEvent.change(await screen.findByLabelText('Name', {}, { timeout: WAIT }), {
      target: { value: 'Bark Charm' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const dialog = await screen.findByRole('dialog', {}, { timeout: WAIT });
    fireEvent.click(within(dialog).getByRole('button', { name: CARD }));
    await screen.findByLabelText(`${CARD}: Base`, {}, { timeout: WAIT });
    type(`${CARD}: Base`, '12');
    fireEvent.click(screen.getByRole('checkbox', { name: `${CARD}: Constitution` }));
    type(`${CARD}: Dexterity counts`, '2');
    expect(
      screen.getByText('Armor Class is 12 plus Dexterity and Constitution (Dexterity up to +2)'),
    ).toBeTruthy();
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(notice()).toBe('Saved Bark Charm'), { timeout: WAIT });

    const [file] = (await homebrewRepo.ownedSafe()).files;
    const [charm] = (file?.json as { item: Array<Record<string, unknown>> }).item;
    expect(charm?.castGuidance).toEqual({
      v: 1,
      effects: [{ kind: 'acFormula', base: 12, addAbilities: ['dex', 'con'], dexMax: 2 }],
    });
    expect(readMechanics(charm?.castGuidance).problems).toEqual([]);

    // 12, Dexterity +3 held to +2, Constitution +2.
    await sheet.visit(`/c/${sheet.doc.id}`);
    const ac = await screen.findByRole('button', { name: /Armor Class/ }, { timeout: WAIT });
    await waitFor(() => expect(ac.textContent).toMatch(/^16Armor Class/), { timeout: WAIT });
  });
});
