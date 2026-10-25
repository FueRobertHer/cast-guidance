// @vitest-environment jsdom
// TEST-003: what a rules-version switch does downstream. BuildPage.test covers
// the prompt itself (GAME-003); this follows a confirmed switch through the
// session store to the other tabs, which re-derive from the saved version:
// the Play tab's resources and exhaustion copy, the Build page's class picker
// and edition chips, and the printings the spell list offers.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  classEntry,
  dialog,
  HARNESS_TIMEOUT,
  pips,
  renderSheet,
  resetSheetHarness,
  type SheetHarness,
  sorcerer,
  testCharacter,
  type WorldLayer,
} from '../../../tests-fixtures/sheetHarness';
import { makeTestContext } from '../../../tests-fixtures/testWorld';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

const base = (type: string, name: string) => {
  const e = makeTestContext().get(type, name, 'TST');
  if (e === undefined) throw new Error(`no ${type} ${name} in the test world`);
  return e;
};

/**
 * Layered over the shared world: a Fighter, whose curated Second Wind has one
 * use under 2014 and two under 2024, and 2024 reprints of the Mage class and
 * of Guidance, so each list has a printing to swap to.
 */
const WORLD: WorldLayer = {
  class: [
    {
      name: 'Fighter',
      source: 'TST',
      hd: { number: 1, faces: 10 },
      proficiency: ['str', 'con'],
      classFeatures: ['Second Wind|Fighter|TST|1'],
    },
    { ...base('class', 'Mage'), reprintedAs: ['Mage|XPHB'] },
    { ...base('class', 'Mage'), source: 'XPHB' },
  ],
  classFeature: [
    {
      name: 'Second Wind',
      source: 'TST',
      className: 'Fighter',
      classSource: 'TST',
      level: 1,
      entries: ['You draw on a well of stamina.'],
    } satisfies DataEntity,
  ],
  spell: [
    { ...base('spell', 'Guidance'), reprintedAs: ['Guidance|XPHB'] },
    { ...base('spell', 'Guidance'), source: 'XPHB' },
  ],
};
const LISTS = { 'Guidance|TST': ['Sorcerer'], 'Guidance|XPHB': ['Sorcerer'] };

const fighter = () => testCharacter('Brick', [classEntry('Fighter', 1)], { str: 16 });

/** The source code on the badge in the row that holds `control`. */
function badgeBeside(control: HTMLElement): string | undefined {
  const row = control.closest('div');
  return row?.querySelector('span[title] > span[aria-hidden="true"]')?.textContent ?? undefined;
}

/** Switch on the Build page, answering the preview if one is raised. */
async function switchTo(
  sheet: SheetHarness,
  version: '2014' | '2024',
  { expectPrompt = true } = {},
) {
  await sheet.tab('Build');
  fireEvent.click(screen.getByRole('button', { name: version }));
  if (expectPrompt)
    await (await dialog(`Switch to ${version} rules?`)).press(`Switch to ${version}`);
  expect(screen.getByRole('button', { name: version }).getAttribute('aria-pressed')).toBe('true');
}

describe('a rules switch on an open sheet (TEST-003)', () => {
  it('re-derives Play: Second Wind gains its 2024 use, and loses it on the way back', async () => {
    const sheet = await renderSheet(fighter(), { extra: WORLD });
    expect(pips('Second Wind use')).toHaveLength(1);

    await switchTo(sheet, '2024');
    await sheet.tab('Play');
    expect(pips('Second Wind use')).toEqual(['available', 'available']);
    expect((await sheet.saved()).rulesVersion).toBe('2024');

    // Back to 2014 asks nothing: every pick is 2014 content already.
    await switchTo(sheet, '2014', { expectPrompt: false });
    await sheet.tab('Play');
    expect(pips('Second Wind use')).toEqual(['available']);
    expect((await sheet.saved()).rulesVersion).toBe('2014');
  });

  it('swaps the class picker to 2024 printings and marks the 2014 class held', async () => {
    const sheet = await renderSheet(fighter(), { extra: WORLD, path: 'build' });
    const picker = () => {
      const add = screen.getByText('Add a class (multiclass)').closest('details');
      if (add === null) throw new Error('no class picker');
      return within(add);
    };
    const offered = () => picker().getAllByRole('button', { name: 'Mage' }).map(badgeBeside);
    // The header row of the Fighter's card: its name, edition chip and steppers.
    const fighterCard = () =>
      screen.getByRole('button', { name: 'Remove Fighter' }).parentElement?.parentElement;
    expect(offered()).toEqual(['TST']);
    expect(fighterCard()?.textContent).not.toContain('2014 content');

    await switchTo(sheet, '2024');

    expect(offered()).toEqual(['XPHB']);
    expect(fighterCard()?.textContent).toContain('2014 content');

    await switchTo(sheet, '2014', { expectPrompt: false });
    expect(offered()).toEqual(['TST']);
    expect(fighterCard()?.textContent).not.toContain('2014 content');
  });

  it('offers the 2024 printing of a known spell, and keeps the known one listed', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push({ name: 'Guidance', source: 'TST' });
    const sheet = await renderSheet(doc, { extra: WORLD, lists: LISTS, path: 'spells' });
    const rows = () =>
      screen.getAllByRole('button', { name: 'Learn Guidance' }).map((b) => ({
        source: badgeBeside(b),
        known: b.getAttribute('aria-pressed') === 'true',
      }));
    expect(rows()).toEqual([{ source: 'TST', known: true }]);

    await switchTo(sheet, '2024');
    await sheet.tab('Spells');
    // The 2024 printing is what the list offers now. The 2014 one the
    // character knows stays listed, so it can still be seen and unlearned.
    expect(rows()).toEqual([
      { source: 'TST', known: true },
      { source: 'XPHB', known: false },
    ]);

    await switchTo(sheet, '2014', { expectPrompt: false });
    await sheet.tab('Spells');
    expect(rows()).toEqual([{ source: 'TST', known: true }]);
  });

  it("follows the version in the Play tab's exhaustion rules", async () => {
    const sheet = await renderSheet(testCharacter('Wren', [classEntry('Warrior', 3)]));
    fireEvent.click(screen.getByRole('button', { name: 'Increase exhaustion' }));
    expect(screen.getByText('Disadvantage on ability checks')).toBeTruthy();
    expect(screen.queryByText(/to all d20 tests/)).toBeNull();
    expect(screen.getByText('Speed (ft)')).toBeTruthy();

    await switchTo(sheet, '2024');
    await sheet.tab('Play');

    expect(screen.queryByText('Disadvantage on ability checks')).toBeNull();
    expect(screen.getByText('−2 to all d20 tests (checks, attacks, saves)')).toBeTruthy();
    expect(screen.getByText('−5 ft speed')).toBeTruthy();
    expect(screen.getByText('Speed (ft) · exhausted')).toBeTruthy();
  });
});
