// @vitest-environment jsdom
// The roll toast when the character's features offer a reroll after the roll
// (Indomitable on a failed save): tap to reroll, paid first, and the new roll stands.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RerollOffer, RollOffer, RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { OFFER_WAIT_MS, ROLL_TOAST_MS, RollToast, rerollPrices } from './RollToast';

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

const pay = {
  spends: [{ key: 'indomitable', max: 1, amount: 1 }],
  reaction: false,
  words: 'spends an Indomitable use',
};
const indomitable: RerollOffer = { source: 'Indomitable', die: 'all', ifFailed: true, pay };
const focus: RerollOffer = {
  source: 'Fanatical Focus',
  die: 'all',
  ifFailed: true,
  when: 'Once a Rage',
};

const save = (rerolls: RerollOffer[], offers: RollOffer[] = []): RollResult => ({
  expr: '1d20+2',
  label: 'WIS save',
  total: 9,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 7, kept: true }] },
    { kind: 'mod', value: 2 },
  ],
  meta: { d20: { natural: 7 }, rerolls, ...(offers.length > 0 ? { offers } : {}) },
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
});

describe('rerollPrices', () => {
  it('says what each reroll pays and when it holds, and nothing for one with neither', () => {
    expect(
      rerollPrices([
        indomitable,
        focus,
        { source: 'Survivor', die: 'one', atMost: 9, ifFailed: false },
        {
          source: 'Living Legend',
          die: 'all',
          ifFailed: true,
          pay: { spends: [], reaction: true, words: 'marks your reaction' },
          when: 'Only while Living Legend lasts',
        },
      ]),
    ).toBe(
      'Indomitable spends an Indomitable use. Fanatical Focus: Once a Rage. ' +
        'Living Legend marks your reaction. Only while Living Legend lasts.',
    );
  });
});

describe('a roll with a reroll on offer', () => {
  it('pays, rerolls the d20, puts the new roll in the log and says it', () => {
    const paying = vi.fn(() => true);
    rollOffersStore.setState({ pay: paying });
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save([indomitable])));
    expect(screen.getByText(/Indomitable use/)).toBeTruthy();
    nextFaces(16);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Reroll with Indomitable, if the roll failed. It spends an Indomitable use',
      }),
    );
    expect(paying).toHaveBeenCalledWith(indomitable, true);
    expect(total()).toContain('18');
    expect(total()).toContain('d20 [7, 16] Indomitable reroll + 2');
    const logged = rollLogStore.getState().rolls[0];
    expect(logged?.total).toBe(18);
    expect(logged?.meta?.d20).toEqual({ natural: 16 });
    // The new roll stands: there is no reroll left to make, nor any taking it back.
    expect(screen.queryByRole('button', { name: /^Reroll with/ })).toBeNull();
    // Nor a price left to read for it.
    expect(screen.queryByText(/Indomitable use/)).toBeNull();
    const made = screen.getByRole('button', { name: 'Rerolled with Indomitable' });
    expect(made.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(made);
    expect(paying).toHaveBeenCalledTimes(1);
    expect(rollLogStore.getState().rolls[0]?.total).toBe(18);
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    expect(spoken().at(-1)).toBe(
      'Indomitable: rerolled. WIS save: 18. Rolled 16, dropped 7, rerolled by Indomitable, plus 2',
    );
    // Nothing waits now, so it goes on time.
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(group()).toBeNull();
  });

  it('leaves the roll as it is when the reroll cannot be paid', () => {
    rollOffersStore.setState({ pay: () => false });
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save([indomitable])));
    fireEvent.click(screen.getByRole('button', { name: /^Reroll with Indomitable/ }));
    expect(rollLogStore.getState().rolls[0]?.total).toBe(9);
    expect(screen.getByRole('button', { name: /^Reroll with Indomitable/ })).toBeTruthy();
  });

  it('rerolls a free one with nothing to pay, and keeps the dice added on the new roll', () => {
    const paying = vi.fn(() => true);
    rollOffersStore.setState({ pay: paying });
    const guidance: RollOffer = { dice: '1d4', source: 'Guidance', once: false, ifFailed: false };
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save([focus], [guidance])));
    nextFaces(3);
    fireEvent.click(screen.getByRole('button', { name: 'Add Guidance, +d4' }));
    expect(rollLogStore.getState().rolls[0]?.total).toBe(12);
    nextFaces(15);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Reroll with Fanatical Focus, if the roll failed. Once a Rage',
      }),
    );
    expect(paying).not.toHaveBeenCalled();
    expect(rollLogStore.getState().rolls[0]?.total).toBe(20);
    expect(total()).toContain('d20 [7, 15] Fanatical Focus reroll + 2 + d4 [3] Guidance');
  });

  it('offers each reroll once, and another still after one is made', () => {
    rollOffersStore.setState({ pay: () => true });
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save([indomitable, focus])));
    nextFaces(4);
    fireEvent.click(screen.getByRole('button', { name: /^Reroll with Indomitable/ }));
    expect(screen.queryByRole('button', { name: /^Reroll with Indomitable/ })).toBeNull();
    nextFaces(12);
    fireEvent.click(screen.getByRole('button', { name: /^Reroll with Fanatical Focus/ }));
    expect(rollLogStore.getState().rolls[0]?.total).toBe(14);
    expect(rollLogStore.getState().rolls[0]?.meta?.rerolled).toEqual([
      'Indomitable',
      'Fanatical Focus',
    ]);
  });

  it('shows a reroll of a low die only while the d20 shows one', () => {
    const twins: RerollOffer = { source: 'Khenra Twins', die: 'one', atMost: 1, ifFailed: false };
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save([twins])));
    expect(screen.queryByRole('button', { name: /^Reroll with Khenra Twins/ })).toBeNull();
    // With nothing to decide, it goes as any roll does.
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(screen.queryByText('WIS save')).toBeNull();
  });

  it('waits a minute for a reroll, and the x keeps the roll as it is', () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save([focus])));
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(group()).not.toBeNull();
    act(() => vi.advanceTimersByTime(OFFER_WAIT_MS));
    expect(group()).toBeNull();

    act(() => rollLogStore.getState().append(save([focus])));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this roll as it is' }));
    expect(screen.queryByRole('button', { name: /^Reroll with/ })).toBeNull();
    act(() => vi.advanceTimersByTime(ROLL_TOAST_MS + 100));
    expect(screen.queryByText('WIS save')).toBeNull();
  });

  it('takes the focus to the reroll when the roll came from the keyboard', () => {
    // jsdom has no keyboard modality: the focused element stands for one reached by Tab.
    const matches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, s) {
      return s === ':focus-visible' ? this === document.activeElement : matches.call(this, s);
    });
    render(
      <>
        <button type="button">WIS save</button>
        <RollToast />
      </>,
    );
    screen.getByRole('button', { name: 'WIS save' }).focus();
    act(() => rollLogStore.getState().append(save([indomitable])));
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Reroll with Indomitable, if the roll failed. It spends an Indomitable use',
    );
  });

  it("says the chip's words: what it is, whether only on a failure, and that it is paid", () => {
    render(<RollToast />);
    act(() => rollLogStore.getState().append(save([indomitable])));
    expect(screen.getByRole('button', { name: /^Reroll with Indomitable/ }).textContent).toBe(
      'Reroll, Indomitable, if it failed· paid',
    );
  });
});
