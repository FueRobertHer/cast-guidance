// @vitest-environment jsdom
// The roll toast as a group when an effect offers dice after the roll (the
// buffs canvas, Dice A): tap to add, tap again to take off, the x to keep it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollOffer, RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { OFFER_WAIT_MS, offerPrices, ROLL_TOAST_MS, RollToast, withAdded } from './RollToast';

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
  rollOffersStore.setState({ spend: null, pay: null, expired: 0 });
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

describe('offerPrices', () => {
  const pay = { spends: [], reaction: true, words: 'marks your reaction' };
  const offer = (over: Partial<RollOffer>): RollOffer => ({
    dice: '1d4',
    source: 'Lucky Footwork',
    once: true,
    ifFailed: true,
    ...over,
  });

  it('says what each paid extra pays, when it holds, and what taking it off gives back', () => {
    expect(
      offerPrices([
        offer({ pay, when: 'Only while you can move' }),
        bardic,
        offer({
          source: 'Tactical Mind',
          pay: { ...pay, reaction: false, words: 'spends 1 Second Wind' },
          spentOnSuccess: true,
        }),
      ]),
    ).toBe(
      'Lucky Footwork marks your reaction. Only while you can move. ' +
        'Tactical Mind spends 1 Second Wind. If the roll still fails, take it off for the use back.',
    );
  });

  it('says nothing with nothing paid', () => {
    expect(offerPrices([bardic])).toBe('');
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

  it('adds a flat bonus a feature pays for, naming it, and gives the use back taken off', () => {
    const pay = vi.fn(() => true);
    rollOffersStore.setState({ pay });
    const guided: RollOffer = {
      dice: '10',
      source: 'Guided Strike',
      once: true,
      ifFailed: true,
      after: true,
      pay: {
        spends: [{ key: 'cd', max: 2, amount: 1 }],
        reaction: false,
        words: 'spends 1 Channel Divinity',
      },
    };
    render(<RollToast />);
    act(() =>
      rollLogStore.getState().append({ ...save, meta: { ...save.meta, offers: [guided] } }),
    );
    expect(screen.getByRole('group', { name: 'Roll result' }).textContent).toContain(
      'Guided Strike spends 1 Channel Divinity.',
    );
    const chip = screen.getByRole('button', {
      name: 'Add Guided Strike, +10, if the roll failed. It spends 1 Channel Divinity',
    });
    expect(chip.textContent).toContain('· paid');
    fireEvent.click(chip);
    expect(total()).toContain('21');
    expect(total()).toContain('+ 10 Guided Strike');
    expect(pay).toHaveBeenLastCalledWith(guided, true);
    fireEvent.click(
      screen.getByRole('button', { name: 'Guided Strike, 10 added. Tap to take it off' }),
    );
    expect(pay).toHaveBeenLastCalledWith(guided, false);
    expect(rollLogStore.getState().rolls[0]?.total).toBe(11);
  });

  it('leaves a feature’s die off when it cannot be paid, keeping the number it rolled', () => {
    const pay = vi.fn(() => false);
    rollOffersStore.setState({ pay });
    const footwork: RollOffer = {
      dice: '1d4',
      source: 'Lucky Footwork',
      once: true,
      ifFailed: true,
      pay: { spends: [], reaction: true, words: 'marks your reaction' },
    };
    render(<RollToast />);
    act(() =>
      rollLogStore.getState().append({ ...save, meta: { ...save.meta, offers: [footwork] } }),
    );
    nextFaces(3);
    const chip = () => screen.getByRole('button', { name: /^Add Lucky Footwork/ });
    fireEvent.click(chip());
    expect(pay).toHaveBeenCalledWith(footwork, true);
    expect(chip().getAttribute('aria-pressed')).toBe('false');
    expect(rollLogStore.getState().rolls[0]?.total).toBe(11);
    // Paid the next time, it goes on with the number it already rolled.
    pay.mockReturnValue(true);
    fireEvent.click(chip());
    expect(rollLogStore.getState().rolls[0]?.total).toBe(14);
  });

  it('waits while a die whose use comes back on a failure is on, until kept as it is', () => {
    rollOffersStore.setState({ pay: () => true });
    const mind: RollOffer = {
      dice: '1d10',
      source: 'Tactical Mind',
      once: true,
      ifFailed: true,
      spentOnSuccess: true,
      pay: { spends: [], reaction: false, words: 'spends 1 Second Wind' },
    };
    render(<RollToast />);
    act(() => rollLogStore.getState().append({ ...save, meta: { ...save.meta, offers: [mind] } }));
    nextFaces(6);
    fireEvent.click(screen.getByRole('button', { name: /^Add Tactical Mind/ }));
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(
      screen.getByRole('button', { name: 'Tactical Mind, 6 added. Tap to take it off' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep this roll as it is' }));
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(screen.queryByRole('group', { name: 'Roll result' })).toBeNull();
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
