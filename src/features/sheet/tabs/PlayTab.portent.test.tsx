// @vitest-environment jsdom
// A foretelling pool on the Play tab (Portent): its numbers in place of pips,
// Roll before any are kept, a tap to use one on another creature's roll, and a
// long rest foretelling anew. And the Inspiration toggle saying what it does.
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classEntry,
  dialog,
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

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

/** The faces the next dice show, in order (the roller draws from crypto). */
function nextFaces(...faces: number[]) {
  const queue = [...faces];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
    const face = queue.shift();
    if (face === undefined) throw new Error('rolled more dice than the test set up');
    if (buf instanceof Uint32Array) buf[0] = face - 1;
    return buf;
  });
}

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const numbers = () =>
  screen
    .queryAllByRole('button', { name: /^Use Portent's \d+ on another creature's roll$/ })
    .map((b) => b.textContent);

const seer = () => {
  const doc = testCharacter('Seer', [classEntry('Warrior', 1)]);
  doc.customEffects = [
    {
      kind: 'resource',
      key: 'portent',
      label: 'Portent',
      max: 2,
      resetOn: 'long',
      foretell: true,
      origin: { label: 'Portent', uid: 'portent', type: 'custom' },
    },
  ];
  return doc;
};

describe('a foretelling pool on the Play tab', () => {
  it('rolls its numbers before any are kept, and a tap uses one on another roll', async () => {
    const sheet = await renderSheet(seer());
    expect(screen.getByText('Foretold anew on a long rest')).toBeTruthy();
    // Its uses are numbers, not pips.
    expect(screen.queryByRole('button', { name: 'Portent use 1' })).toBeNull();
    nextFaces(15, 6);
    press('Roll Portent: 2 d20s to foretell');
    expect(numbers()).toEqual(['15', '6']);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect((await sheet.saved()).play.foretold).toEqual({ portent: [15, 6] });

    press("Use Portent's 15 on another creature's roll");
    expect(numbers()).toEqual(['6']);
    expect(screen.getByText('1 of 2')).toBeTruthy();
    const saved = await sheet.saved();
    expect(saved.play.foretold).toEqual({ portent: [6] });
    expect(saved.play.resources).toEqual([{ key: 'portent', used: 1 }]);
    expect((await sheet.history())[0]).toBe("Used Portent's 15");
  });

  it('foretells anew on a long rest, and says the numbers', async () => {
    const doc = seer();
    doc.play.foretold = { portent: [3] };
    doc.play.resources = [{ key: 'portent', used: 1 }];
    const sheet = await renderSheet(doc);
    expect(numbers()).toEqual(['3']);

    press('Long rest');
    nextFaces(20, 1);
    await (await dialog('Long rest')).press('Rest');

    expect(numbers()).toEqual(['20', '1']);
    expect(notice()).toContain('Restored resources, Portent (20 and 1)');
    expect((await sheet.saved()).play.foretold).toEqual({ portent: [20, 1] });
  });

  it('rolls one for each use left, not for a use marked spent', async () => {
    const doc = seer();
    doc.play.resources = [{ key: 'portent', used: 1 }];
    const sheet = await renderSheet(doc);
    nextFaces(12);
    press('Roll Portent: 1 d20 to foretell');
    expect(numbers()).toEqual(['12']);
    expect((await sheet.saved()).play.foretold).toEqual({ portent: [12] });
  });

  it('shows none past the uses left, though more are kept', async () => {
    const doc = seer();
    doc.play.foretold = { portent: [9, 14] };
    doc.play.resources = [{ key: 'portent', used: 2 }];
    await renderSheet(doc);
    expect(numbers()).toEqual([]);
    expect(screen.getByText('0 of 2')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Roll Portent/ })).toBeNull();
  });
});

describe('the Inspiration toggle', () => {
  it('says what spending it does under the character’s rules', async () => {
    const doc = testCharacter('Hero', [classEntry('Monk', 2)]);
    doc.rulesVersion = '2024';
    await renderSheet(doc);
    expect(screen.getByRole('button', { name: 'Inspiration' }).getAttribute('title')).toBe(
      'Heroic Inspiration: spend it to reroll a die you just rolled',
    );
    await resetSheetHarness();
    const old = testCharacter('Hero', [classEntry('Monk', 2)]);
    old.rulesVersion = '2014';
    await renderSheet(old);
    expect(screen.getByRole('button', { name: 'Inspiration' }).getAttribute('title')).toBe(
      'Inspiration: spend it for advantage on an attack, save or check',
    );
  });
});
