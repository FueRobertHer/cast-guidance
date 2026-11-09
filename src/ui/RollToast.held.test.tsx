// @vitest-environment jsdom
// The roll toast while a roll waits for its one-use dice to be named (the
// house rule; the buffs canvas, Dice B), and an attack shown with its damage.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollOffer, RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { cancelHeld, rollFrom } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { OFFER_WAIT_MS, RollToast, withItsDamage } from './RollToast';

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

const guidance: RollOffer = {
  dice: '1d4',
  source: 'Guidance',
  effectId: 'g1',
  once: true,
  ifFailed: false,
};
const bardic: RollOffer = {
  dice: '1d8',
  source: 'Bardic Inspiration',
  effectId: 'b1',
  once: true,
  ifFailed: false,
};

const check = (): RollResult => ({
  expr: '1d20+3',
  label: 'Athletics check',
  kind: 'd20',
  total: 15,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 12, kept: true }] },
    { kind: 'mod', value: 3 },
  ],
  meta: {
    d20: { natural: 12 },
    offers: [guidance, bardic],
    askFirst: { offers: [guidance, bardic], attack: false },
  },
});

const attack = (): RollResult => ({
  expr: '1d20+7+1d4',
  label: 'Greataxe attack',
  kind: 'd20',
  total: 23,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 14, kept: true }] },
    { kind: 'mod', value: 7 },
    { kind: 'dice', sign: 1, sides: 4, rolls: [{ v: 2, kept: true }] },
  ],
  meta: {
    d20: { natural: 14 },
    from: [{ term: 2, source: 'Bless' }],
    offers: [bardic],
    askFirst: { offers: [bardic], attack: true },
  },
});

const damage = (): RollResult => ({
  expr: '1d12+4',
  label: 'Greataxe damage',
  kind: 'damage',
  total: 11,
  at: 0,
  terms: [
    { kind: 'dice', sign: 1, sides: 12, rolls: [{ v: 7, kept: true }] },
    { kind: 'mod', value: 4 },
  ],
});

const spoken = () => getAnnouncerState().messages.map((m) => m.text);
/** Every name a screen reader is given in the group: its own and its controls'. */
const everythingSaid = (group: HTMLElement) =>
  [group, ...group.querySelectorAll('[aria-label]')]
    .map((el) => el.getAttribute('aria-label') ?? '')
    .join(' | ');
const control = (name: string) => {
  const b = document.createElement('button');
  b.textContent = name;
  document.body.appendChild(b);
  return b;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  resetAnnouncer();
  rollOffersStore.setState({ before: true });
});

afterEach(() => {
  cleanup();
  act(() => cancelHeld());
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAnnouncer();
  rollLogStore.setState({ rolls: [], seq: 0 });
  rollOffersStore.setState({ spend: null, expired: 0, before: false });
  document.body.replaceChildren();
});

describe('a roll waiting for its one-use dice', () => {
  it('takes the place of the last toast, asks with no total, and holds focus on Roll', () => {
    const { container } = render(<RollToast />);
    act(() => rollLogStore.getState().append(damage()));
    expect(container.textContent).toContain('Greataxe damage');
    const from = control('Athletics');
    act(() => rollFrom(from, check));
    const group = screen.getByRole('group', { name: 'Athletics check, waiting to roll' });
    expect(container.textContent).not.toContain('Greataxe damage');
    expect(group.textContent).toContain('Add a one-use die first?');
    expect(group.textContent).not.toMatch(/15|12/);
    expect(everythingSaid(group)).not.toMatch(/15|12/);
    const roll = screen.getByRole('button', { name: 'Roll' });
    expect(document.activeElement).toBe(roll);
    // It never times out: nothing has happened yet.
    act(() => vi.advanceTimersByTime(OFFER_WAIT_MS * 2));
    expect(screen.getByRole('group', { name: 'Athletics check, waiting to roll' })).toBeTruthy();
  });

  it('says what rolls in anyway, and nothing of the d20', () => {
    render(<RollToast />);
    act(() => rollFrom(control('Greataxe'), attack));
    const group = screen.getByRole('group', { name: 'Greataxe attack, waiting to roll' });
    expect(group.textContent).toContain('Bless rolls in. Add a one-use die first?');
    expect(group.textContent).not.toMatch(/23|14/);
    expect(everythingSaid(group)).not.toMatch(/23|14/);
    expect(spoken().join(' ')).not.toMatch(/23|14/);
  });

  it('names a die, then rolls with it, landing the total and sending focus back', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    const { container } = render(<RollToast />);
    const from = control('Athletics');
    act(() => rollFrom(from, check));
    const named = screen.getByRole('button', { name: 'Add Guidance to this roll, +d4' });
    expect(named.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(named);
    expect(
      screen
        .getByRole('button', { name: 'Guidance, added to this roll. Tap to take it off' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    const go = screen.getByRole('button', { name: 'Roll with it' });
    go.focus();
    nextFaces(3);
    fireEvent.click(go);
    expect(screen.queryByRole('group', { name: /waiting to roll/ })).toBeNull();
    expect(container.textContent).toContain('d20 [12] + 3 + d4 [3] Guidance');
    expect(container.textContent).toMatch(/18$/);
    expect(document.activeElement).toBe(from);
    expect(spend).toHaveBeenCalledWith('g1', true);
    // Asked before, so not offered after.
    expect(screen.queryByRole('button', { name: /Add Bardic/ })).toBeNull();
  });

  it('cancels with the x or Esc, landing nothing and sending focus back', () => {
    render(<RollToast />);
    const from = control('Athletics');
    act(() => rollFrom(from, check));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this roll' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(rollLogStore.getState().rolls).toHaveLength(0);
    expect(document.activeElement).toBe(from);

    act(() => rollFrom(from, check));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Roll' }), { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(rollLogStore.getState().rolls).toHaveLength(0);
    expect(document.activeElement).toBe(from);
  });

  it('rolls when its control is tapped again', () => {
    const { container } = render(<RollToast />);
    const from = control('Athletics');
    act(() => rollFrom(from, check));
    act(() => rollFrom(from, check));
    expect(screen.queryByRole('group', { name: /waiting to roll/ })).toBeNull();
    expect(container.textContent).toBe('Athletics checkd20 [12] + 315');
  });
});

describe('damage tapped while the attack waits', () => {
  it('says it rolls with the attack, then shows both together and says both', () => {
    render(<RollToast />);
    act(() => rollFrom(control('Greataxe'), attack));
    act(() => rollFrom(control('1d12+4'), damage));
    const waiting = screen.getByRole('group', { name: 'Greataxe attack, waiting to roll' });
    expect(waiting.textContent).toContain('Damage rolls with the attack');
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    resetAnnouncer();
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    const shown = screen.getByRole('group', { name: 'Roll result' });
    expect(shown.textContent).toContain('Greataxe attack');
    expect(shown.textContent).toContain('23');
    expect(shown.textContent).toContain('Greataxe damage: d12 [7] + 4');
    expect(shown.textContent).toContain('11');
    expect(spoken()).toEqual([
      'Greataxe attack: 23. Rolled 14, plus 7, plus 2. Greataxe damage: 11. Rolled 7, plus 4',
    ]);
  });
});

describe('more than one damage roll while the attack waits', () => {
  it('counts them, then shows and says each under the attack, in the order tapped', () => {
    render(<RollToast />);
    act(() => rollFrom(control('Greataxe'), attack));
    act(() => rollFrom(control('1d12+4'), damage));
    act(() => rollFrom(control('Smite'), () => ({ ...damage(), label: 'Divine Smite', total: 9 })));
    const waiting = screen.getByRole('group', { name: 'Greataxe attack, waiting to roll' });
    expect(waiting.textContent).toContain('2 damage rolls go with the attack');
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    resetAnnouncer();
    fireEvent.click(screen.getByRole('button', { name: 'Roll' }));
    const shown = screen.getByRole('group', { name: 'Roll result' }).textContent ?? '';
    expect(shown.indexOf('Greataxe damage')).toBeLessThan(shown.indexOf('Divine Smite'));
    expect(spoken()[0]).toMatch(/^Greataxe attack: 23\..*Greataxe damage: 11\..*Divine Smite: 9/);
  });
});

describe('withItsDamage', () => {
  const a = { ...attack(), id: 'a' };
  const d1 = { ...damage(), id: 'd1', meta: { withRoll: 'a' } };
  const d2 = { ...damage(), id: 'd2', label: 'Divine Smite', meta: { withRoll: 'a' } };

  it('shows an attack with the damage that went with it, oldest first', () => {
    expect(withItsDamage([d2, d1, a])).toEqual({ roll: a, damage: [d1, d2] });
  });

  it('shows the newest roll alone otherwise', () => {
    expect(withItsDamage([])).toBeUndefined();
    expect(withItsDamage([a])).toEqual({ roll: a, damage: [] });
    const plain = { ...damage(), id: 'p' };
    expect(withItsDamage([plain, d1, a])).toEqual({ roll: plain, damage: [] });
    // Its attack gone from the log, or another roll's: the damage stands alone.
    expect(withItsDamage([d1])).toEqual({ roll: d1, damage: [] });
    expect(withItsDamage([d1, { ...a, id: 'b' }])).toEqual({ roll: d1, damage: [] });
  });
});
