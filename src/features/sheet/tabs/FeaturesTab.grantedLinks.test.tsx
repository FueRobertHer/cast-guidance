// @vitest-environment jsdom
// Every row under "Innate & granted spells", on Features and on Build, opens
// that spell's Library page. 5etools writes a grant as `name|source#hint`
// ("thaumaturgy|xphb#c"), and the hint used to stay on the source, so each
// link named a printing that does not exist and landed on "Nothing in spells
// is called thaumaturgy|xphb#c".
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
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

const GRANTED = ['Guidance', 'Aid', 'Flame Strike'];

function hintfolkSorcerer() {
  const doc = testCharacter('Ember', [classEntry('Sorcerer', 2)], { cha: 16 });
  doc.race = { name: 'Hintfolk', source: 'TST' };
  return doc;
}

/** A row of the "Innate & granted spells" list (the one after its heading), by spell name. */
function grantedLink(name: string): HTMLElement {
  const list = screen.getByText('Innate & granted spells').nextElementSibling;
  if (!(list instanceof HTMLElement)) throw new Error('no granted spells list');
  // The name and origin are two spans, so the link reads "guidanceHintfolk · CHA".
  return within(list).getByRole('link', { name: new RegExp(`^${name}Hintfolk`, 'i') });
}

/** Tap the row, then wait for the Library page to name the spell. */
async function opens(name: string): Promise<void> {
  fireEvent.click(grantedLink(name));
  const title = await screen.findByRole('heading', { level: 1, name }, { timeout: 15_000 });
  expect(title).toBeTruthy();
  expect(screen.queryByText(/Nothing in spells is called/)).toBeNull();
}

describe('innate & granted spell links', () => {
  it('open the Library page of every granted spell from Features', async () => {
    const sheet = await renderSheet(hintfolkSorcerer(), {
      path: 'features',
      extra: { race: [hintfolk] },
    });
    for (const name of GRANTED) {
      expect(grantedLink(name).getAttribute('href')).not.toContain('%23');
      await opens(name);
      await sheet.visit(`/c/${sheet.doc.id}/features`);
    }
  });

  it('open the Library page of every granted spell from Build', async () => {
    const sheet = await renderSheet(hintfolkSorcerer(), {
      path: 'build',
      extra: { race: [hintfolk] },
    });
    for (const name of GRANTED) {
      expect(grantedLink(name).getAttribute('href')).not.toContain('%23');
      await opens(name);
      await sheet.visit(`/c/${sheet.doc.id}/build`);
    }
  });
});
