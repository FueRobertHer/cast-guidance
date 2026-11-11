// @vitest-environment jsdom
// The roll prompt offering Portent's foretold numbers in place of the d20, the
// roll landing on one, and Heroic Inspiration's reroll offered on the result.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RerollOffer } from '@/dice/types';
import type { RollEffects } from '@/engine/playRules';
import { d20Ask } from '@/features/sheet/d20Tests';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { cancelHeld, followUpStore, rollFrom } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { RollToast, rerollPrices } from './RollToast';

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

const told = (v: number) => ({
  source: 'Portent',
  v,
  pay: {
    spends: [{ key: 'portent', max: 2, amount: 1 }],
    reaction: false,
    words: `uses the foretold ${v}`,
    foretold: { key: 'portent', v },
  },
});
const riders = (over: Partial<RollEffects>): RollEffects => ({
  dice: [],
  offers: [],
  advantage: [],
  disadvantage: [],
  ...over,
});
const save = () =>
  d20Ask('1d20+4', {
    label: 'WIS save',
    riders: riders({ advantage: ['Foresight'], foretold: [told(17), told(3)] }),
  });

const spoken = () => getAnnouncerState().messages.map((m) => m.text);
const control = (name: string) => {
  const b = document.createElement('button');
  b.textContent = name;
  document.body.appendChild(b);
  return b;
};
const prompt = () => screen.getByRole('group', { name: 'WIS save, choose and roll' });
const chip = (v: number) =>
  screen.getByRole('button', { name: `Portent ${v}, foretold: ${v} in place of the d20` });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetAnnouncer();
});

afterEach(() => {
  cleanup();
  act(() => cancelHeld());
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAnnouncer();
  rollLogStore.setState({ rolls: [], seq: 0 });
  rollOffersStore.setState({ spend: null, pay: null, expired: 0, before: false });
  followUpStore.setState({ offer: null });
  document.body.replaceChildren();
});

describe('foretold numbers in the roll prompt', () => {
  it('offers each one, and one picked takes the mode away and says what it uses', () => {
    render(<RollToast />);
    act(() => rollFrom(control('WIS'), save));
    expect(prompt().textContent).toContain('d20 +4, advantage');
    expect(chip(17).getAttribute('aria-pressed')).toBe('false');
    expect(chip(17).textContent).toBe('Portent 17· foretold');
    fireEvent.click(chip(17));
    expect(chip(17).getAttribute('aria-pressed')).toBe('true');
    expect(prompt().textContent).toContain('17 Portent +4');
    expect(prompt().textContent).toContain('Advantage does not count: Portent foretold the d20');
    expect(prompt().textContent).toContain("Uses Portent's 17.");
    // No d20 is rolled, so there is no mode to pick.
    expect(screen.queryByRole('group', { name: 'Roll mode' })).toBeNull();
    // One at a time: another takes its place, and tapped again it goes.
    fireEvent.click(chip(3));
    expect(chip(17).getAttribute('aria-pressed')).toBe('false');
    expect(chip(3).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip(3));
    expect(chip(3).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('group', { name: 'Roll mode' })).toBeTruthy();
  });

  it('pays for the number as it rolls, and the roll lands on it', () => {
    const paying = vi.fn(() => true);
    rollOffersStore.setState({ pay: paying });
    render(<RollToast />);
    act(() => rollFrom(control('WIS'), save));
    fireEvent.click(chip(17));
    nextFaces();
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    expect(paying).toHaveBeenCalledWith({ source: 'Portent', pay: told(17).pay }, true);
    const landed = rollLogStore.getState().rolls[0];
    expect(landed?.total).toBe(21);
    expect(landed?.meta?.foretold).toBe('Portent');
    expect(document.body.textContent).toContain('d20 [17] foretold by Portent + 4');
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(spoken().at(-1)).toBe(
      'WIS save: 21. Rolled 17, foretold by Portent, plus 4. Advantage does not count: Portent foretold the d20',
    );
  });

  it('rolls the d20 as the sheet sets it when the number cannot be paid', () => {
    rollOffersStore.setState({ pay: () => false });
    render(<RollToast />);
    act(() => rollFrom(control('WIS'), save));
    fireEvent.click(chip(17));
    nextFaces(6, 11);
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    const landed = rollLogStore.getState().rolls[0];
    expect(landed?.total).toBe(15);
    expect(landed?.meta?.advantage).toBe('adv');
    expect(landed?.meta?.foretold).toBeUndefined();
  });
});

describe('Heroic Inspiration on the result', () => {
  const inspiration: RerollOffer = {
    source: 'Heroic Inspiration',
    die: 'one',
    atMost: 20,
    ifFailed: false,
    pay: { spends: [], reaction: false, words: 'is spent', inspiration: true },
  };

  it('rerolls the lower die of advantage when spent, and says what it costs', () => {
    expect(rerollPrices([inspiration])).toBe('Heroic Inspiration is spent.');
    const paying = vi.fn(() => true);
    rollOffersStore.setState({ pay: paying });
    render(<RollToast />);
    act(() =>
      rollFrom(control('WIS'), () =>
        d20Ask('1d20+4', {
          label: 'WIS save',
          riders: riders({ advantage: ['Foresight'], rerollOffers: [inspiration] }),
        }),
      ),
    );
    nextFaces(3, 8);
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    expect(rollLogStore.getState().rolls[0]?.total).toBe(12);
    const reroll = screen.getByRole('button', {
      name: 'Reroll with Heroic Inspiration. It is spent',
    });
    nextFaces(19);
    fireEvent.click(reroll);
    expect(paying).toHaveBeenCalledWith(inspiration, true);
    expect(rollLogStore.getState().rolls[0]?.total).toBe(23);
    // The 3 is set aside, and the better of the 8 and the new 19 is kept.
    expect(rollLogStore.getState().rolls[0]?.terms[0]).toMatchObject({
      rolls: [
        { v: 3, kept: false, out: true },
        { v: 8, kept: false },
        { v: 19, kept: true },
      ],
    });
    expect(document.body.textContent).toContain(
      'd20 [3, 8, 19] advantage Heroic Inspiration reroll',
    );
  });
});
