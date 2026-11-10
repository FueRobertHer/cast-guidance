// @vitest-environment jsdom
// Reckless Attack through the real sheet (the rolls canvas, phase 2): the roll
// prompt offers it on the first Strength melee attack of a barbarian's turn;
// declared, it presets advantage and goes in play as the roll lands, so the
// turn's next attack keeps advantage without asking, and New turn ends it.
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc } from '@/engine/types';
import { cancelHeld, followUpStore } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { RollToast } from '@/ui/RollToast';
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

beforeEach(() => {
  localStorage.clear();
  rollLogStore.getState().clear();
});
afterEach(async () => {
  act(() => cancelHeld());
  followUpStore.setState({ offer: null });
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

/** A barbarian class with Reckless Attack at 2nd level, as the data prints it. */
const world = {
  class: [
    {
      name: 'Barbarian',
      source: 'TST',
      hd: { number: 1, faces: 12 },
      proficiency: ['str', 'con'],
      classFeatures: ['Rage|Barbarian|TST|1', 'Reckless Attack|Barbarian|TST|2'],
    },
  ],
  classFeature: [
    {
      name: 'Rage',
      source: 'TST',
      className: 'Barbarian',
      classSource: 'TST',
      level: 1,
      entries: ['You can imbue yourself with a primal power called Rage.'],
    },
    {
      name: 'Reckless Attack',
      source: 'TST',
      className: 'Barbarian',
      classSource: 'TST',
      level: 2,
      entries: ['You can throw aside all concern for defense to attack with fierce desperation.'],
    },
  ],
};

/** A barbarian with STR 16, a longsword (Strength, melee) and a shortbow (Dexterity, ranged). */
function barbarian(level: number): CharacterDoc {
  const doc = testCharacter('Hild', [classEntry('Barbarian', level)], { str: 16, con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.equipment = [
    {
      id: 'e1',
      ref: { name: 'Longsword', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
    { id: 'e2', ref: { name: 'Shortbow', source: 'TST' }, qty: 1, equipped: true, attuned: false },
  ];
  return doc;
}

const attack = (weapon: string) => screen.getByTitle(`${weapon} attack`);
const prompt = (label: string) => screen.getByRole('group', { name: `${label}, choose and roll` });
const offered = () => screen.queryByRole('button', { name: 'Reckless Attack, this turn' });
const pressed = (name: string) =>
  within(screen.getByRole('group', { name: 'Roll mode' }))
    .getByRole('button', { name })
    .getAttribute('aria-pressed');

describe('Reckless Attack in the roll prompt', () => {
  it('is offered on the first Strength melee attack, kept for the turn once declared, and ends next turn', async () => {
    const sheet = await renderSheet(barbarian(2), { extra: world });
    render(<RollToast />);

    // The first attack of the turn offers it, undeclared.
    fireEvent.click(attack('Longsword'));
    const reckless = offered();
    expect(reckless?.getAttribute('aria-pressed')).toBe('false');
    expect(pressed('Normal')).toBe('true');

    // Declared: advantage, why, and the cost by Roll.
    fireEvent.click(reckless as HTMLElement);
    expect(pressed('Advantage')).toBe('true');
    const group = prompt('Longsword attack');
    expect(group.textContent).toContain('Advantage: Reckless Attack');
    expect(group.textContent).toContain(
      'Attack rolls against you have advantage until your next turn.',
    );
    nextFaces(4, 15);
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    expect(rollLogStore.getState().rolls[0]).toMatchObject({
      total: 18, // the higher d20 and STR; the test class grants no weapon proficiency
      meta: { advantage: 'adv', cue: 'Advantage: Reckless Attack' },
    });

    const saved = await sheet.saved();
    expect(saved.play.turn?.action).toBe(true);
    expect(saved.play.activeEffects).toEqual([
      expect.objectContaining({ name: 'Reckless Attack', turnsLeft: 1, mine: true }),
    ]);
    // One deed in history: undoing the attack takes the declaration back too.
    const history = await sheet.history();
    expect(history[0]).toBe('Attacked with Longsword');
    expect(history).not.toContain('Declared Reckless Attack');

    // The turn's next attack keeps advantage without asking again.
    fireEvent.click(attack('Longsword'));
    expect(offered()).toBeNull();
    expect(pressed('Advantage')).toBe('true');
    expect(prompt('Longsword attack').textContent).toContain('Advantage: Reckless Attack');
    act(() => cancelHeld());

    // A Dexterity ranged attack is not reached.
    fireEvent.click(attack('Shortbow'));
    expect(offered()).toBeNull();
    expect(pressed('Normal')).toBe('true');
    act(() => cancelHeld());

    // A new turn ends it, and the next turn's first attack offers it again.
    fireEvent.click(screen.getByRole('button', { name: 'New turn' }));
    expect(await screen.findByText(/Reckless Attack ended/)).toBeTruthy();
    expect((await sheet.saved()).play.activeEffects).toBeUndefined();
    fireEvent.click(attack('Longsword'));
    expect(offered()?.getAttribute('aria-pressed')).toBe('false');
    expect(pressed('Normal')).toBe('true');
  });

  it('puts nothing in play when the attack is rolled undeclared, and is not offered again that turn', async () => {
    const sheet = await renderSheet(barbarian(2), { extra: world });
    render(<RollToast />);
    fireEvent.click(attack('Longsword'));
    expect(offered()).not.toBeNull();
    nextFaces(12);
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    expect((await sheet.saved()).play.activeEffects).toBeUndefined();
    fireEvent.click(attack('Longsword'));
    expect(offered()).toBeNull();
    expect(pressed('Normal')).toBe('true');
  });

  it('is not offered to a barbarian without the feature yet', async () => {
    await renderSheet(barbarian(1), { extra: world });
    render(<RollToast />);
    fireEvent.click(attack('Longsword'));
    expect(prompt('Longsword attack')).toBeTruthy();
    expect(offered()).toBeNull();
  });
});
