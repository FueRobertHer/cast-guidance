// @vitest-environment jsdom
// The roll toast when a feature sets the d20 to a number after the roll (Trance
// of Order's 10, Stroke of Luck's 20), and a total a floor holds up (Indomitable Might).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RerollOffer, RollOffer, RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { followUpStore } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { RollToast, rerollPrices, rollAnnouncement } from './RollToast';

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

const trance: RerollOffer = {
  source: 'Trance of Order',
  die: 'all',
  to: 10,
  ifFailed: false,
  when: 'Only while Trance of Order lasts',
};
const stroke: RerollOffer = {
  source: 'Stroke of Luck',
  die: 'all',
  to: 20,
  ifFailed: true,
  pay: {
    spends: [{ key: 'stroke-of-luck', max: 1, amount: 1 }],
    reaction: false,
    words: 'spends a Stroke of Luck use',
  },
};

const save = (face: number, rerolls: RerollOffer[]): RollResult => ({
  expr: '1d20+2',
  label: 'WIS save',
  total: face + 2,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: face, kept: true }] },
    { kind: 'mod', value: 2 },
  ],
  meta: { d20: { natural: face }, rerolls },
});

/** A Strength check whose 9 Indomitable Might held up to 18. */
const held = (offers: RollOffer[] = []): RollResult => ({
  expr: '1d20+4',
  label: 'Athletics check',
  total: 18,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 5, kept: true }] },
    { kind: 'mod', value: 4 },
  ],
  meta: {
    d20: { natural: 5 },
    floor: { at: 18, source: 'Indomitable Might', raw: 9 },
    ...(offers.length > 0 ? { offers } : {}),
  },
});

const spoken = () => getAnnouncerState().messages.map((m) => m.text);
const group = () => screen.queryByRole('group', { name: 'Roll result' });
const total = () => group()?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetAnnouncer();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAnnouncer();
  rollLogStore.setState({ rolls: [], seq: 0 });
  rollOffersStore.setState({ spend: null, pay: null, expired: 0 });
  followUpStore.setState({ offer: null });
});

describe('a roll with a set on offer', () => {
  it('sets the d20 to its number with no die rolled, puts it in the log and says it', () => {
    const paying = vi.fn(() => true);
    rollOffersStore.setState({ pay: paying });
    nextFaces();
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save(7, [trance])));
    expect(screen.getByText('Trance of Order: Only while Trance of Order lasts.')).toBeTruthy();
    const chip = screen.getByRole('button', {
      name: 'Set the d20 to 10 with Trance of Order. Only while Trance of Order lasts',
    });
    expect(chip.textContent).toBe('Set 10, Trance of Order');
    fireEvent.click(chip);
    expect(paying).not.toHaveBeenCalled();
    expect(total()).toContain('12');
    expect(total()).toContain('d20 [7, 10] set by Trance of Order + 2');
    const logged = rollLogStore.getState().rolls[0];
    expect(logged?.total).toBe(12);
    expect(logged?.meta?.d20).toEqual({ natural: 10 });
    expect(logged?.meta?.setBy).toEqual(['Trance of Order']);
    // Made, it stays as a chip that says so, and sets nothing again.
    const made = screen.getByRole('button', { name: 'Set to 10 with Trance of Order' });
    expect(made.textContent).toBe('Set to 10, Trance of Order');
    expect(made.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByText(/Only while Trance of Order lasts/)).toBeNull();
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(spoken().at(-1)).toBe(
      'Trance of Order: set to 10. WIS save: 12. Rolled 10, dropped 7, set by Trance of Order, plus 2',
    );
  });

  it('offers no set while the d20 shows more than its most', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save(10, [trance])));
    expect(screen.queryByRole('button', { name: /Trance of Order/ })).toBeNull();
  });

  it('pays first for a paid set, and a 20 set on an attack crits its damage', () => {
    const paying = vi.fn(() => true);
    rollOffersStore.setState({ pay: paying });
    render(<RollToast />);
    act(() => {
      const base = save(6, [stroke]);
      rollLogStore.getState().append({
        ...base,
        id: 'atk-1',
        label: 'Dagger attack',
        meta: { ...base.meta, attack: { by: 'c1', of: 'Dagger', crit: false } },
      });
      followUpStore.setState({ offer: { id: 'atk-1', expr: '1d4', go: () => {}, from: null } });
    });
    const chip = screen.getByRole('button', {
      name: 'Set the d20 to 20 with Stroke of Luck, if the roll failed. It spends a Stroke of Luck use',
    });
    expect(chip.textContent).toBe('Set 20, Stroke of Luck, if it failed· paid');
    fireEvent.click(chip);
    expect(paying).toHaveBeenCalledWith(stroke, true);
    expect(rollLogStore.getState().rolls[0]?.meta?.attack?.crit).toBe(true);
    expect(screen.getByRole('button', { name: 'Roll 2d4' })).toBeTruthy();
  });

  it('leaves the roll as it is when the set cannot be paid', () => {
    rollOffersStore.setState({ pay: () => false });
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save(6, [stroke])));
    fireEvent.click(screen.getByRole('button', { name: /^Set the d20 to 20/ }));
    expect(rollLogStore.getState().rolls[0]?.total).toBe(8);
    expect(screen.getByRole('button', { name: /^Set the d20 to 20/ })).toBeTruthy();
  });

  it('says a set price as a reroll price is said', () => {
    expect(rerollPrices([trance, stroke])).toBe(
      'Trance of Order: Only while Trance of Order lasts. Stroke of Luck spends a Stroke of Luck use.',
    );
  });
});

describe('a total a floor holds up', () => {
  it('says what the terms came to and what holds it up', () => {
    expect(rollAnnouncement(held())).toBe(
      'Athletics check: 18. Rolled 5, plus 4, 9 set to 18 by Indomitable Might',
    );
    render(<RollToast />);
    act(() => rollLogStore.getState().append(held()));
    // With nothing to decide the toast is one button, not a group.
    expect(document.body.textContent).toContain('d20 [5] + 4 = 9, set to 18 by Indomitable Might');
  });

  it('counts a die added after from what the terms come to, so the floor still holds', () => {
    const guidance: RollOffer = { dice: '1d4', source: 'Guidance', once: false, ifFailed: false };
    render(<RollToast />);
    act(() => rollLogStore.getState().append(held([guidance])));
    nextFaces(3);
    fireEvent.click(screen.getByRole('button', { name: 'Add Guidance, +d4' }));
    const logged = rollLogStore.getState().rolls[0];
    expect(logged?.total).toBe(18);
    expect(logged?.meta?.floor).toEqual({ at: 18, source: 'Indomitable Might', raw: 12 });
    expect(total()).toContain('d20 [5] + 4 + d4 [3] Guidance = 12, set to 18 by Indomitable Might');
  });
});
