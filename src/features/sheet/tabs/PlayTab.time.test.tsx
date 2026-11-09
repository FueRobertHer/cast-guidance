// @vitest-environment jsdom
// Effects in play and time on the Play tab (the buffs canvas): the rest sheet's
// Ends checklist, New turn's list with Heroism and Haste's box, concentration
// ending what it held, and Bless rolled into a death save.
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffect } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import {
  classEntry,
  concentratingOn,
  dialog,
  HARNESS_TIMEOUT,
  hp,
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

beforeEach(() => {
  localStorage.clear();
  rollLogStore.getState().clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

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

const aid: ActiveEffect = {
  id: 'aid',
  name: 'Aid',
  parts: [{ kind: 'maxHpBonus', amount: 5 }],
  lasts: { minutes: 480 },
};
const bless: ActiveEffect = {
  id: 'bless',
  name: 'Bless',
  parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
  lasts: { minutes: 1, concentration: true },
  mine: true,
};
const heroism: ActiveEffect = {
  id: 'hero',
  name: 'Heroism',
  parts: [{ kind: 'tempHpEachTurn', amount: 3 }],
  lasts: { minutes: 1, concentration: true },
};
const haste: ActiveEffect = {
  id: 'haste',
  name: 'Haste',
  parts: [{ kind: 'extraAction', label: 'Haste action', note: 'Attack once, Dash, Disengage' }],
  lasts: { minutes: 1, concentration: true },
};

/** A level-3 warrior with the effects given in play. */
function warrior(effects: ActiveEffect[], over: { currentHp?: number } = {}) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
  doc.play.currentHp = over.currentHp ?? 20;
  doc.play.hpInitialized = true;
  doc.play.activeEffects = effects;
  return doc;
}

/** The rest sheet's rows: each effect's name, its line, and whether it is ticked. */
function restRows(): Array<{ name: string; ticked: boolean }> {
  return screen.getAllByRole('checkbox').map((box) => ({
    name: box.closest('label')?.textContent ?? '',
    ticked: (box as HTMLInputElement).checked,
  }));
}

describe('a rest with effects in play', () => {
  it('ticks what the rest ends by its duration, and ends Aid before the HP refill', async () => {
    const sheet = await renderSheet(warrior([aid, { ...bless, lasts: { minutes: 1440 } }]));
    const before = hp();

    press('Long rest');
    const ask = await dialog('Long rest');
    expect(ask.text).toContain('regain half your hit dice');
    expect(restRows()).toEqual([
      { name: 'Aid8 hours', ticked: true },
      { name: 'Bless24 hours, so it stays', ticked: false },
    ]);
    await ask.press('Take the long rest');

    // Aid's +5 does not outlive the rest: the refill is to the maximum without it.
    expect(hp()).toEqual({ current: before.max - 5, max: before.max - 5, temp: 0 });
    expect(notice()).toMatch(/^Long rest complete: Restored .* · Ended Aid$/);
    const saved = await sheet.saved();
    expect(saved.play.activeEffects?.map((e) => e.id)).toEqual(['bless']);
    expect((await sheet.history())[0]).toBe('Long rest');
  });

  it('keeps what the player unticks, and rests at once with nothing in play', async () => {
    const sheet = await renderSheet(warrior([bless]));
    press('Short rest');
    const ask = await dialog('Short rest');
    expect(restRows()).toEqual([{ name: 'BlessConcentration, 1 minute', ticked: true }]);
    fireEvent.click(screen.getByRole('checkbox'));
    // The line follows the tick.
    expect(restRows()).toEqual([
      { name: 'BlessConcentration, 1 minute, so it stays', ticked: false },
    ]);
    await ask.press('Take the short rest');
    expect((await sheet.saved()).play.activeEffects?.map((e) => e.id)).toEqual(['bless']);

    await resetSheetHarness();
    await renderSheet(warrior([]));
    press('Short rest');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(notice()).toBe('Short rest: Nothing to restore');
  });
});

describe('New turn with effects in play', () => {
  it("gives Heroism's temp HP, frees Haste's box and says both", async () => {
    const sheet = await renderSheet(warrior([heroism, haste]));
    const box = screen.getByRole('button', { name: /^Haste action/ });
    expect(box.getAttribute('aria-pressed')).toBe('false');
    expect(box.textContent).toContain('Attack once, Dash, Disengage');
    fireEvent.click(box);
    expect(box.getAttribute('aria-pressed')).toBe('true');
    expect((await sheet.history())[0]).toBe('Used Haste action');

    press('New turn');

    expect(hp().temp).toBe(3);
    expect(screen.getByRole('button', { name: /^Haste action/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(notice()).toBe('New turn: +3 temp HP: Heroism · Haste action ready again');
    const saved = await sheet.saved();
    expect(saved.play.tempHp).toBe(3);
    expect(saved.play.turn?.extra).toBeUndefined();
  });
});

describe('concentration on the Play tab', () => {
  it('ends your own Bless when you stop concentrating, and leaves an ally’s', async () => {
    const doc = warrior([bless, { ...bless, id: 'ally', mine: undefined }]);
    doc.play.concentratingOn = { label: 'Bless', level: 1 };
    const sheet = await renderSheet(doc);
    expect(concentratingOn()).toBe('Bless');

    fireEvent.click(screen.getByRole('button', { name: /^Concentrating on/ }));

    expect(concentratingOn()).toBeUndefined();
    const saved = await sheet.saved();
    expect(saved.play.concentratingOn).toBeUndefined();
    expect(saved.play.activeEffects?.map((e) => e.id)).toEqual(['ally']);
  });

  it('ends your own Bless at 0 HP', async () => {
    const doc = warrior([bless], { currentHp: 4 });
    doc.play.concentratingOn = { label: 'Bless', level: 1 };
    const sheet = await renderSheet(doc);
    press('Damage 5 hit points');
    expect(hp().current).toBe(0);
    const saved = await sheet.saved();
    expect(saved.play.concentratingOn).toBeUndefined();
    expect(saved.play.activeEffects).toBeUndefined();
  });
});

describe('Bless in a roll', () => {
  it('rolls its die into a death save, turning an 8 into a success', async () => {
    const sheet = await renderSheet(warrior([{ ...bless, mine: undefined }], { currentHp: 0 }));
    nextFaces(8, 3);
    press('Roll save');
    const roll = rollLogStore.getState().rolls[0];
    expect(roll?.total).toBe(11);
    expect(roll?.meta?.from).toEqual([{ term: 1, source: 'Bless' }]);
    expect(roll?.meta?.offers).toBeUndefined();
    expect((await sheet.saved()).play.deathSaves).toEqual({ success: 1, fail: 0 });
  });
});
