// @vitest-environment jsdom
// The roll toast as a group when an effect offers dice after the roll (the
// buffs canvas, Dice A): tap to add, tap again to take off, the x to keep it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { OFFER_WAIT_MS, ROLL_TOAST_MS, RollToast, withAdded } from './RollToast';

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

const bardic = {
  dice: '1d8',
  source: 'Bardic Inspiration',
  effectId: 'b1',
  once: true,
  ifFailed: false,
};

const save: RollResult = {
  expr: '1d20+2',
  label: 'DEX save',
  total: 11,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 9, kept: true }] },
    { kind: 'mod', value: 2 },
  ],
  meta: { d20: { natural: 9 }, offers: [bardic] },
};

const spoken = () => getAnnouncerState().messages.map((m) => m.text);
const total = () => screen.getByRole('group', { name: 'Roll result' }).textContent ?? '';

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
  rollOffersStore.setState({ spend: null, expired: 0 });
});

describe('withAdded', () => {
  it('adds the dice that are on, named, to the total', () => {
    const term = {
      kind: 'dice' as const,
      sign: 1 as const,
      sides: 8,
      rolls: [{ v: 5, kept: true }],
    };
    const r = withAdded(save, [{ value: 5, term }], [true]);
    expect(r.total).toBe(16);
    expect(r.meta?.from).toEqual([{ term: 2, source: 'Bardic Inspiration' }]);
    expect(withAdded(save, [{ value: 5, term }], [false])).toBe(save);
  });
});

describe('a roll with dice on offer', () => {
  it('adds a die once tapped, spends its use, and gives it back when taken off', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save));
    expect(total()).toContain('11');

    nextFaces(5);
    fireEvent.click(screen.getByRole('button', { name: 'Add Bardic Inspiration, +d8' }));
    const added = screen.getByRole('button', {
      name: 'Bardic Inspiration, 5 added. Tap to take it off',
    });
    expect(added.getAttribute('aria-pressed')).toBe('true');
    expect(total()).toContain('16');
    expect(total()).toContain('d8 [5] Bardic Inspiration');
    expect(spend).toHaveBeenLastCalledWith('b1', true);
    expect(rollLogStore.getState().rolls[0]?.total).toBe(16);
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(spoken().at(-1)).toBe(
      'Bardic Inspiration added, 5. DEX save: 16. Rolled 9, plus 2, plus 5',
    );

    // Taken off and on again, it keeps the number it rolled.
    fireEvent.click(added);
    expect(spend).toHaveBeenLastCalledWith('b1', false);
    expect(rollLogStore.getState().rolls[0]?.total).toBe(11);
    fireEvent.click(screen.getByRole('button', { name: 'Add Bardic Inspiration, +d8' }));
    expect(rollLogStore.getState().rolls[0]?.total).toBe(16);
  });

  it('waits a minute for a die, then goes; kept as it is, it goes as any roll does', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save));
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(screen.queryByRole('group', { name: 'Roll result' })).not.toBeNull();
    act(() => vi.advanceTimersByTime(OFFER_WAIT_MS));
    expect(screen.queryByRole('group', { name: 'Roll result' })).toBeNull();

    act(() => rollLogStore.getState().append(save));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this roll as it is' }));
    expect(screen.queryByRole('button', { name: /Bardic/ })).toBeNull();
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(screen.queryByText('DEX save')).toBeNull();
  });

  it('goes on time after the x took the focus and the pointer with it', () => {
    // A pressed button takes focus (Chrome, Firefox); the x then leaves with
    // the dice, and no blur says so.
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save));
    const x = screen.getByRole('button', { name: 'Keep this roll as it is' });
    // The mouse that pressed it entered a group that is gone, so no leave comes.
    fireEvent.pointerEnter(screen.getByRole('group', { name: 'Roll result' }), {
      pointerType: 'mouse',
    });
    act(() => x.focus());
    fireEvent.click(x);
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(screen.queryByText('DEX save')).toBeNull();
  });

  it('lets the dice go when the hit points change, and closes on Esc', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save));
    act(() => rollOffersStore.getState().expire());
    expect(screen.queryByRole('button', { name: /Bardic/ })).toBeNull();

    act(() => rollLogStore.getState().append(save));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add Bardic Inspiration, +d8' }), {
      key: 'Escape',
    });
    expect(screen.queryByText('DEX save')).toBeNull();
  });

  it('says a 2024 Bardic die is for a failed roll', () => {
    render(<RollToast />);
    act(() =>
      rollLogStore
        .getState()
        .append({ ...save, meta: { ...save.meta, offers: [{ ...bardic, ifFailed: true }] } }),
    );
    expect(
      screen.getByRole('button', { name: 'Add Bardic Inspiration, +d8, if the roll failed' })
        .textContent,
    ).toBe('+d8 Bardic Inspiration, if it failed');
  });
});
