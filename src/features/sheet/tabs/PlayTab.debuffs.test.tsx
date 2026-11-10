// @vitest-environment jsdom
// Debuffs on the sheet: a number an effect in play or a homebrew condition
// lowered wears the buff's edge in red, chevrons down, and its name says what
// lowered it. A homebrew condition is a debuff by default, in the strip too.
import 'fake-indexeddb/auto';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffect, DataEntity } from '@/engine/types';
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

beforeEach(() => localStorage.clear());
afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

const slowed: ActiveEffect = {
  id: 'slowed',
  name: 'Slowed',
  parts: [
    { kind: 'acBonus', amount: -2 },
    { kind: 'initiativeBonus', amount: -1 },
    { kind: 'speedBonus', amount: -10 },
  ],
};
const shieldOfFaith: ActiveEffect = {
  id: 'sof',
  name: 'Shield of Faith',
  parts: [{ kind: 'acBonus', amount: 2 }],
};

/** A homebrew condition: -2 to AC and -1 to every save. */
const dazed: DataEntity = {
  name: 'Dazed',
  source: 'TST',
  entries: ['You reel from the blow.'],
  castGuidance: {
    v: 1,
    effects: [
      { kind: 'acBonus', amount: -2 },
      { kind: 'saveBonus', amount: -1 },
    ],
  },
};
/** One that only helps, which is a buff. */
const inspired: DataEntity = {
  name: 'Inspired',
  source: 'TST',
  entries: ['You feel bold.'],
  castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
};
const world = { extra: { condition: [dazed, inspired] } };

function warrior(effects: ActiveEffect[] = [], conditions: Array<{ id: string }> = []) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.play.activeEffects = effects;
  doc.play.conditions = conditions;
  return doc;
}

/** Its edge, on a face that moves or a still frame: up, down or none. */
const edge = (el: HTMLElement) =>
  el.querySelector('.fx-down') !== null
    ? 'down'
    : el.querySelector('.fx-lift-ring, .fx-lift-on') !== null || el.closest('.fx-lift-on') !== null
      ? 'up'
      : 'none';

const acTile = () => screen.getByRole('button', { name: /Armor Class/ });
const stripChip = (name: RegExp) =>
  within(screen.getByRole('list', { name: 'Active effects' }))
    .getByRole('button', { name })
    .closest('li') as HTMLElement;

describe('a number an effect lowered', () => {
  it('wears the red edge and names what lowered it', async () => {
    await renderSheet(warrior([slowed]));
    expect(acTile().textContent).toContain(', lowered by Slowed');
    expect(edge(acTile())).toBe('down');
    const speed = screen.getByRole('button', { name: /^\d+\s*ft\s*Speed/ });
    expect(speed.textContent).toContain(', lowered by Slowed');
    expect(edge(speed)).toBe('down');
    const initiative = screen.getByRole('button', { name: /Initiative/ });
    expect(initiative.textContent).toContain(', lowered by Slowed');
    expect(edge(initiative)).toBe('down');
  });

  it('wears no edge when a raise and a penalty cancel out', async () => {
    const minus2: ActiveEffect = { ...slowed, parts: [{ kind: 'acBonus', amount: -2 }] };
    await renderSheet(warrior([shieldOfFaith, minus2]));
    expect(acTile().textContent).not.toMatch(/raised by|lowered by/);
    expect(edge(acTile())).toBe('none');
  });

  it('draws an effect that only hinders as a debuff in the strip', async () => {
    await renderSheet(warrior([slowed, shieldOfFaith]));
    const down = stripChip(/^Slowed/);
    expect(down.className).toContain('ring-danger');
    expect(down.querySelector('.lucide-chevrons-down')).not.toBeNull();
    const up = stripChip(/^Shield of Faith/);
    expect(up.className).not.toContain('ring-danger');
    expect(up.querySelector('.lucide-chevrons-up')).not.toBeNull();
  });
});

describe('a homebrew condition', () => {
  it('lowers AC with the red edge, with no effect in play beside it', async () => {
    await renderSheet(warrior([], [{ id: 'Dazed' }]), world);
    expect(acTile().textContent).toContain(', lowered by Dazed');
    expect(edge(acTile())).toBe('down');
  });

  it('is a debuff in the strip by default, and a buff when it only helps', async () => {
    await renderSheet(warrior([], [{ id: 'Dazed' }, { id: 'Inspired' }]), world);
    const dazedChip = stripChip(/^Dazed/);
    expect(dazedChip.className).toContain('ring-danger');
    expect(dazedChip.querySelector('.lucide-chevrons-down')).not.toBeNull();
    const inspiredChip = stripChip(/^Inspired/);
    expect(inspiredChip.className).not.toContain('ring-danger');
    expect(inspiredChip.querySelector('.lucide-chevrons-up')).not.toBeNull();
  });

  it('keeps a built-in condition as it was', async () => {
    await renderSheet(warrior([], [{ id: 'Poisoned' }]), world);
    const chip = stripChip(/^Poisoned/);
    expect(chip.className).not.toContain('ring-danger');
    expect(chip.querySelector('.lucide-circle-alert')).not.toBeNull();
  });

  it('wears nothing switched off', async () => {
    const doc = warrior([], []);
    doc.play.conditions = [{ id: 'Dazed', ignored: true }];
    await renderSheet(doc, world);
    expect(edge(acTile())).toBe('none');
    expect(stripChip(/^Dazed/).className).not.toContain('ring-danger');
  });

  it('lowers the saves on Stats, each saying so', async () => {
    await renderSheet(warrior([], [{ id: 'Dazed' }]), { ...world, path: 'stats' });
    const save = await screen.findByRole('button', { name: /^STR\b.*lowered by Dazed/ });
    expect(edge(save)).toBe('down');
  });
});
