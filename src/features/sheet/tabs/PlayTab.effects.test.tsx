// @vitest-environment jsdom
// Effects in play on the Play tab (the buffs canvas): the ring on a number an
// effect raised, AC and Speed tapped for the sum, the cue lines, the Defenses
// chip and its sheet, and the damage keypad's Half and the character's types.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffect } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import {
  classEntry,
  HARNESS_TIMEOUT,
  hp,
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

const shieldOfFaith: ActiveEffect = {
  id: 'sof',
  name: 'Shield of Faith',
  parts: [{ kind: 'acBonus', amount: 2 }],
  lasts: { minutes: 10, concentration: true },
};
const longstrider: ActiveEffect = {
  id: 'ls',
  name: 'Longstrider',
  parts: [{ kind: 'speedBonus', amount: 10 }],
  lasts: { minutes: 60 },
};
const rage: ActiveEffect = {
  id: 'rage',
  name: 'Rage',
  parts: [
    { kind: 'resist', damageType: 'bludgeoning' },
    { kind: 'resist', damageType: 'piercing' },
    { kind: 'resist', damageType: 'slashing' },
    { kind: 'cue', tone: 'warn', text: 'No spells or concentration' },
  ],
  lasts: { minutes: 1 },
};

/** A level-3 warrior at 20 HP, with the effects given in play. */
function warrior(effects: ActiveEffect[]) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.play.activeEffects = effects;
  return doc;
}

/** A cell wears an effect's ring: its face is raised. */
const raised = (el: HTMLElement) => el.querySelector('.cx-lifted') !== null;

describe('a number an effect in play raised', () => {
  it('is ringed and names what raised it, and one nothing raised is not', async () => {
    await renderSheet(warrior([shieldOfFaith, longstrider]));
    const ac = screen.getByRole('button', { name: /Armor Class/ });
    expect(ac.textContent).toContain(', raised by Shield of Faith');
    expect(raised(ac)).toBe(true);
    const speed = screen.getByRole('button', { name: /^\d+\s*ft\s*Speed/ });
    expect(speed.textContent).toContain(', raised by Longstrider');
    expect(raised(speed)).toBe(true);
    const initiative = screen.getByRole('button', { name: /Initiative/ });
    expect(raised(initiative)).toBe(false);
  });

  it('opens the sum from AC and from Speed, each naming the effect', async () => {
    await renderSheet(warrior([shieldOfFaith, longstrider]));
    fireEvent.click(screen.getByRole('button', { name: /Armor Class/ }));
    const ac = await screen.findByRole('dialog', { name: /^Armor Class/ });
    expect(within(ac).getByText('Shield of Faith')).toBeTruthy();
    fireEvent.keyDown(ac, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /^\d+\s*ft\s*Speed/ }));
    const speed = await screen.findByRole('dialog', { name: /^Speed/ });
    expect(within(speed).getByText('Longstrider')).toBeTruthy();
  });

  it('names an effect that holds off a condition, when that is all that raised the number', async () => {
    const freedom: ActiveEffect = {
      id: 'fom',
      name: 'Freedom of Movement',
      parts: [{ kind: 'conditionImmune', condition: 'grappled' }],
    };
    const doc = warrior([freedom]);
    doc.play.conditions = [{ id: 'Grappled' }];
    await renderSheet(doc);
    const speed = screen.getByRole('button', { name: /^\d+\s*ft\s*Speed/ });
    expect(speed.textContent).toContain(', raised by Freedom of Movement');
    expect(raised(speed)).toBe(true);
  });

  it('is not ringed when a condition sets it to 0, which no effect raises', async () => {
    const doc = warrior([longstrider]);
    doc.play.conditions = [{ id: 'Grappled' }];
    await renderSheet(doc);
    const speed = screen.getByRole('button', { name: /^0\s*ft/ });
    expect(speed.textContent).not.toContain('raised by');
    expect(raised(speed)).toBe(false);
  });

  it("names what raised the maximum after the hit points, in the HP button's name", async () => {
    const aid: ActiveEffect = {
      id: 'aid',
      name: 'Aid',
      parts: [{ kind: 'maxHpBonus', amount: 5 }],
    };
    await renderSheet(warrior([aid]));
    expect(
      screen.getByRole('button', { name: /^20 \/ \d+ hit points, maximum raised by Aid$/ }),
    ).toBeTruthy();
  });

  it('is not ringed with the effect switched off', async () => {
    await renderSheet(warrior([{ ...shieldOfFaith, off: true }]));
    const ac = screen.getByRole('button', { name: /Armor Class/ });
    expect(ac.textContent).not.toContain('raised by');
    expect(raised(ac)).toBe(false);
  });
});

describe('the Defenses chip', () => {
  it('is not on the card for a character with no defenses', async () => {
    await renderSheet(warrior([]));
    expect(screen.queryByRole('button', { name: /^Resists|^Defenses|^Immune/ })).toBeNull();
  });

  it('counts what Rage resists, and opens the sheet that says what gives it', async () => {
    await renderSheet(warrior([rage]));
    const chip = screen.getByRole('button', {
      name: 'Resists 3 damage types, raised by Rage',
    });
    expect(chip.textContent).toBe('Resists 3');
    fireEvent.click(chip);
    const sheet = within(await screen.findByRole('dialog', { name: 'Defenses' }));
    expect(sheet.getByRole('heading', { name: 'You take half from' })).toBeTruthy();
    expect(sheet.getByText('Bludgeoning, piercing, slashing')).toBeTruthy();
    expect(sheet.getByText('Rage')).toBeTruthy();
  });

  it("says Rage's cue line under the stats", async () => {
    await renderSheet(warrior([rage]));
    const cues = within(screen.getByRole('list', { name: 'From effects in play' }));
    expect(cues.getByText('No spells or concentration: Rage')).toBeTruthy();
  });
});

describe('the damage keypad', () => {
  it('halves for a save, then for a type resisted, and takes what is left', async () => {
    await renderSheet(warrior([rage]));
    fireEvent.click(screen.getByRole('button', { name: 'Damage' }));
    const sheet = await screen.findByRole('dialog', { name: 'Hit points' });
    const pad = within(within(sheet).getByRole('group', { name: 'Keypad' }));
    fireEvent.click(pad.getByRole('button', { name: '1' }));
    fireEvent.click(pad.getByRole('button', { name: '5' }));
    const changes = within(
      within(sheet).getByRole('group', { name: 'What changes how much you take' }),
    );
    expect(
      changes.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual(['Half, from a save or a feature', 'bludgeoning', 'piercing', 'slashing']);
    fireEvent.click(changes.getByRole('button', { name: 'Half, from a save or a feature' }));
    fireEvent.click(changes.getByRole('button', { name: 'slashing' }));
    expect(changes.getByRole('button', { name: 'slashing' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      within(sheet).getByText(/^15 slashing: half is 7, then Rage halves it to 3\./),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Take 3 damage' }));
    await waitFor(() => expect(hp().current).toBe(17));
  });

  it('offers Half alone to a character with no defenses', async () => {
    await renderSheet(warrior([]));
    fireEvent.click(screen.getByRole('button', { name: 'Damage' }));
    const sheet = await screen.findByRole('dialog', { name: 'Hit points' });
    const changes = within(
      within(sheet).getByRole('group', { name: 'What changes how much you take' }),
    );
    expect(changes.getAllByRole('button')).toHaveLength(1);
  });
});
