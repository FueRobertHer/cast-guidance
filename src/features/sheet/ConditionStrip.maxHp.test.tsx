// @vitest-environment jsdom
// A homebrew condition that moves the hit point maximum, put on, switched and
// taken off from the strip as the player does, read from the HP meter. The
// owner's rules (2026-11-19): lowered, current HP comes down to the new
// maximum when above it; raised as it comes on, current HP rises by as much.
// Coming off gives back the maximum alone; switched back on, nothing heals.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  classEntry,
  dialog,
  dismiss,
  HARNESS_TIMEOUT,
  hp,
  renderSheet,
  resetSheetHarness,
  type SheetHarness,
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
  vi.restoreAllMocks();
  await resetSheetHarness();
});

const condition = (name: string, amount: number): DataEntity => ({
  name,
  source: 'TST',
  entries: [`Your hit point maximum changes by ${amount}.`],
  castGuidance: { v: 1, effects: [{ kind: 'maxHpBonus', amount }] },
});
const world = { extra: { condition: [condition('Withered', -5), condition('Hale', 5)] } };

/** A level 3 warrior's maximum: d10 hit dice by average, CON 14. */
const MAX = 28;

/**
 * A level 3 warrior at `current` hit points (full when not said), already in
 * play: a character still being built has current HP follow the maximum.
 */
async function open(current = MAX): Promise<{ sheet: SheetHarness; max: number }> {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
  doc.play.currentHp = current;
  doc.play.hpInitialized = true;
  const sheet = await renderSheet(doc, world);
  expect(hp()).toEqual({ current, max: MAX, temp: 0 });
  return { sheet, max: MAX };
}

async function putOn(sheet: SheetHarness, name: string) {
  await sheet.conditions();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
  await dismiss();
}
const takeOff = (name: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
/** Its effects switched off or back on from its sheet, as the strip's chip opens it. */
async function switchIt(name: string) {
  const strip = within(screen.getByRole('list', { name: 'Active effects' }));
  fireEvent.click(strip.getByRole('button', { name: new RegExp(`^${name}`) }));
  const info = within(await screen.findByRole('dialog', { name }));
  fireEvent.click(info.getByRole('button', { name: /^Apply its effects/ }));
  await dismiss();
}
const at = (current: number, max: number) => ({ current, max, temp: 0 });

describe('a homebrew condition that lowers the hit point maximum', () => {
  it('brings current HP down to it at full HP, and gives back only the maximum coming off', async () => {
    const { sheet, max } = await open();
    expect(hp()).toEqual(at(max, max));
    await putOn(sheet, 'Withered');
    expect(hp()).toEqual(at(max - 5, max - 5));
    takeOff('Withered');
    expect(hp()).toEqual(at(max - 5, max));
  });

  it('leaves current HP under the new maximum as it is', async () => {
    const { sheet, max } = await open(10);
    await putOn(sheet, 'Withered');
    expect(hp()).toEqual(at(10, max - 5));
    takeOff('Withered');
    expect(hp()).toEqual(at(10, max));
  });

  it('switched off gives the maximum back, and switched on brings current HP down again', async () => {
    const { sheet, max } = await open();
    await putOn(sheet, 'Withered');
    await switchIt('Withered');
    expect(hp()).toEqual(at(max - 5, max));
    // Healed to the maximum it gave back, so switching it on has HP to take.
    fireEvent.click(screen.getByRole('button', { name: 'Heal 5 hit points' }));
    expect(hp()).toEqual(at(max, max));
    await switchIt('Withered');
    expect(hp()).toEqual(at(max - 5, max - 5));
  });

  it('is what a long rest refills to', async () => {
    const { sheet, max } = await open(10);
    await putOn(sheet, 'Withered');
    await sheet.saved();
    fireEvent.click(screen.getByRole('button', { name: 'Long rest' }));
    await (await dialog('Long rest')).press('Rest');
    expect(hp()).toEqual(at(max - 5, max - 5));
  });
});

describe('a homebrew condition that raises the hit point maximum', () => {
  it('raises current HP by as much as it comes on, and leaves it be under the maximum coming off', async () => {
    const { sheet, max } = await open(10);
    await putOn(sheet, 'Hale');
    expect(hp()).toEqual(at(15, max + 5));
    takeOff('Hale');
    expect(hp()).toEqual(at(15, max));
  });

  it('at full HP, keeps the character at full both ways', async () => {
    const { sheet, max } = await open();
    await putOn(sheet, 'Hale');
    expect(hp()).toEqual(at(max + 5, max + 5));
    takeOff('Hale');
    expect(hp()).toEqual(at(max, max));
  });

  it('switched off takes current HP down, and switched back on heals nothing', async () => {
    const { sheet, max } = await open();
    await putOn(sheet, 'Hale');
    await switchIt('Hale');
    expect(hp()).toEqual(at(max, max));
    await switchIt('Hale');
    expect(hp()).toEqual(at(max, max + 5));
    // Taken off while switched off, it moves nothing.
    await switchIt('Hale');
    takeOff('Hale');
    expect(hp()).toEqual(at(max, max));
  });
});
