// @vitest-environment jsdom
// Every row under "Innate & granted spells", on Features and on Build, opens
// that spell's rules text in place, the same sheet the Play tab uses. 5etools
// writes a grant as `name|source#hint` ("thaumaturgy|xphb#c"); the parse that
// cuts the hint from every part is pinned in additionalSpells.test.ts, and
// this file checks each shape still reaches its spell.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  classEntry,
  HARNESS_TIMEOUT,
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

afterEach(async () => {
  await resetSheetHarness();
});

/** Grants in each shape 5etools writes them: hint after the source, no source, plain. */
const hintfolk: DataEntity = {
  name: 'Hintfolk',
  source: 'TST',
  additionalSpells: [
    {
      ability: 'cha',
      known: { _: ['guidance|tst#c', 'aid#2'] },
      innate: { _: { daily: { '1': ['flame strike|TST#3'] } } },
    },
  ],
  entries: [],
};

/** Each granted spell, by name, with a line of its rules text in the test world. */
const GRANTED: ReadonlyArray<[name: string, text: string]> = [
  ['Guidance', '+1d4 to a check.'],
  ['Aid', 'Boost max HP.'],
  ['Flame Strike', 'Fire from the sky.'],
];

function hintfolkSorcerer() {
  const doc = testCharacter('Ember', [classEntry('Sorcerer', 2)], { cha: 16 });
  doc.race = { name: 'Hintfolk', source: 'TST' };
  return doc;
}

/** A row of the "Innate & granted spells" list (the one after its heading), by spell name. */
function grantedRow(name: string): HTMLElement {
  const list = screen.getByText('Innate & granted spells').nextElementSibling;
  if (!(list instanceof HTMLElement)) throw new Error('no granted spells list');
  // The name and origin are two spans, so the row reads "guidanceHintfolk · CHA".
  return within(list).getByRole('button', { name: new RegExp(`^${name}Hintfolk`, 'i') });
}

/** Tap the row, wait for the sheet to show the spell's text, then close it. */
async function opens(name: string, text: string): Promise<void> {
  fireEvent.click(grantedRow(name));
  const dialog = await screen.findByRole(
    'dialog',
    { name: new RegExp(`^${name}$`, 'i') },
    { timeout: 15_000 },
  );
  expect(await within(dialog).findByText(text, {}, { timeout: 15_000 })).toBeTruthy();
  expect(within(dialog).queryByText(/Couldn’t find rules text/)).toBeNull();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('innate & granted spell rows', () => {
  it('open the rules text of every granted spell from Features', async () => {
    await renderSheet(hintfolkSorcerer(), { path: 'features', extra: { race: [hintfolk] } });
    for (const [name, text] of GRANTED) await opens(name, text);
  });

  it('open the rules text of every granted spell from Build', async () => {
    await renderSheet(hintfolkSorcerer(), { path: 'build', extra: { race: [hintfolk] } });
    for (const [name, text] of GRANTED) await opens(name, text);
  });
});
