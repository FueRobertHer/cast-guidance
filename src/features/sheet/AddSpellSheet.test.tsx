// @vitest-environment jsdom
// ADR-002 E2: the Add a spell sheet reads the character's collection switches
// as well as its source list. A source switched off leaves this character's
// search; one switched on comes back in over the list.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classEntry,
  HARNESS_TIMEOUT,
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

afterEach(async () => {
  await resetSheetHarness();
});

const warrior = () => testCharacter('Osk', [classEntry('Warrior', 5)], { str: 16, wis: 14 });

async function searchableCount(): Promise<number> {
  fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
  const sheet = await screen.findByRole('dialog', { name: 'Add a spell' });
  const line = await within(sheet).findByText(/to search \d+ spells\./);
  return Number(/to search (\d+) spells/.exec(line.textContent ?? '')?.[1]);
}

describe("Add a spell under a character's collection switches", () => {
  it("drops a source switched off from this character's search only", async () => {
    await renderSheet(warrior(), { path: 'spells' });
    const all = await searchableCount();
    expect(all).toBeGreaterThan(0);
    await resetSheetHarness();

    const osk = warrior();
    osk.sourceSwitches = { off: ['TST'] };
    await renderSheet(osk, { path: 'spells' });
    const without = await searchableCount();
    expect(without).toBeLessThan(all);
    await resetSheetHarness();

    // Every spell in the test world is TST, so a switch naming another source
    // shows that the switch, not a blanket filter, hid them.
    const maren = warrior();
    maren.sourceSwitches = { off: ['XGE'] };
    await renderSheet(maren, { path: 'spells' });
    expect(await searchableCount()).toBe(all);
  });

  it('lets a source switched on back in over its own list', async () => {
    const doc = warrior();
    doc.allowedSources = ['PHB'];
    doc.sourceSwitches = { on: ['TST'] };
    await renderSheet(doc, { path: 'spells' });
    expect(await searchableCount()).toBeGreaterThan(0);
  });
});
