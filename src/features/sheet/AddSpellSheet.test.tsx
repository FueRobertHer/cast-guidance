// @vitest-environment jsdom
// ADR-002 E2: the Add a spell sheet reads the character's collection switches
// as well as its source list. A source switched off leaves this character's
// search; one switched on comes back in over the list.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSourcePolicy } from '@/data5e/sourceFilter';
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

  it('names both when the device hides a book and a switch this one (ADR-002 U11)', async () => {
    await writeSourcePolicy({ mode: 'all', except: ['XGE'] });
    const osk = warrior();
    osk.sourceSwitches = { off: ['TST'] };
    await renderSheet(osk, { path: 'spells' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add a spell' });
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'Search every spell' }), {
      target: { value: 'Aid' },
    });
    fireEvent.click(
      await within(sheet).findByText(
        /hidden by your source settings and this character's switches\. Show them anyway$/,
      ),
    );
    // Shown from a book her switch hides, it says so, as under her own list.
    expect(
      (await within(sheet).findAllByText("Not in this character's sources")).length,
    ).toBeGreaterThan(0);
  });

  it('lets a source switched on back in over its own list', async () => {
    const doc = warrior();
    doc.allowedSources = ['PHB'];
    doc.sourceSwitches = { on: ['TST'] };
    await renderSheet(doc, { path: 'spells' });
    expect(await searchableCount()).toBeGreaterThan(0);
  });
});
