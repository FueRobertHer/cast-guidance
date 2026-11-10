// @vitest-environment jsdom
// The roll prompt in the toast's place (the rolls canvas): a d20 test waiting
// with nothing rolled, its mode, the dice that roll in and the one-use dice to
// add, then the roll landing; damage tapped while an attack waits, and a hit's
// damage offered after it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollOffer, RollResult } from '@/dice/types';
import type { RollEffects } from '@/engine/playRules';
import { d20Ask } from '@/features/sheet/d20Tests';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from '@/stores/announcer';
import { cancelHeld, followUpStore, rollFrom } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { RollChip } from './RollChip';
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
const riders = (over: Partial<RollEffects>): RollEffects => ({
  dice: [],
  offers: [],
  advantage: [],
  disadvantage: [],
  ...over,
});

const check = () =>
  d20Ask('1d20+3', { label: 'Athletics check', riders: riders({ offers: [guidance, bardic] }) });

const attack = () =>
  d20Ask('1d20+7', {
    label: 'Greataxe attack',
    riders: riders({ dice: [{ dice: '1d4', source: 'Bless' }], offers: [bardic] }),
    settlesOnNatural: true,
    attack: { by: 'c1', of: 'Greataxe' },
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
const control = (name: string) => {
  const b = document.createElement('button');
  b.textContent = name;
  document.body.appendChild(b);
  return b;
};
const prompt = (label: string) => screen.getByRole('group', { name: `${label}, choose and roll` });
const roll = () => screen.getByRole('button', { name: 'Roll' });

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
  rollOffersStore.setState({ spend: null, expired: 0, before: false });
  followUpStore.setState({ offer: null });
  document.body.replaceChildren();
});

describe('the roll prompt', () => {
  it('takes the place of the last toast with nothing rolled, and holds focus on Roll', () => {
    const { container } = render(<RollToast />);
    act(() => rollLogStore.getState().append(damage()));
    expect(container.textContent).toContain('Greataxe damage');
    act(() => rollFrom(control('Athletics'), check));
    const group = prompt('Athletics check');
    expect(container.textContent).not.toContain('Greataxe damage');
    expect(group.textContent).toContain('d20 +3');
    expect(screen.getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      screen.getByRole('button', { name: '+d4 Guidance, once' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(group.textContent).toContain('Dice you leave come back after the roll.');
    expect(document.activeElement).toBe(roll());
    expect(rollLogStore.getState().rolls).toHaveLength(1); // the damage alone
    // It never times out: nothing has happened yet.
    act(() => vi.advanceTimersByTime(OFFER_WAIT_MS * 2));
    expect(prompt('Athletics check')).toBeTruthy();
  });

  it('presets the mode the sheet sets, and says why a mode picked over it was chosen', () => {
    render(<RollToast />);
    act(() =>
      rollFrom(control('Athletics'), () =>
        d20Ask('1d20+3', { label: 'Athletics check', advantageFrom: ['Rage'] }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Advantage' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disadvantage' }));
    const group = prompt('Athletics check');
    expect(group.textContent).toContain('Disadvantage chosen for this roll, over Rage');
    expect(group.textContent).toContain('d20 +3, disadvantage');
    nextFaces(15, 4);
    fireEvent.click(roll());
    expect(rollLogStore.getState().rolls[0]).toMatchObject({
      total: 7,
      meta: { advantage: 'dis', cue: 'Disadvantage chosen for this roll, over Rage' },
    });
  });

  it('rolls Bless in unless it is taken out for this roll', () => {
    render(<RollToast />);
    act(() => rollFrom(control('Greataxe'), attack));
    const bless = screen.getByRole('button', { name: '+d4 Bless, rolls in' });
    expect(bless.getAttribute('aria-pressed')).toBe('true');
    expect(prompt('Greataxe attack').textContent).toContain('d20 +7 + d4 Bless');
    fireEvent.click(bless);
    expect(bless.getAttribute('aria-pressed')).toBe('false');
    expect(prompt('Greataxe attack').textContent).not.toContain('d20 +7 + d4 Bless');
    nextFaces(14);
    fireEvent.click(roll());
    expect(rollLogStore.getState().rolls[0]?.total).toBe(21);
  });

  it('adds a one-use die, then rolls with it, spending it and sending focus back', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    const { container } = render(<RollToast />);
    const from = control('Athletics');
    act(() => rollFrom(from, check));
    fireEvent.click(screen.getByRole('button', { name: '+d4 Guidance, once' }));
    expect(
      screen.getByRole('button', { name: '+d4 Guidance, once' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(prompt('Athletics check').textContent).toContain('Spends Guidance.');
    roll().focus();
    nextFaces(12, 3);
    fireEvent.click(roll());
    expect(screen.queryByRole('group', { name: /choose and roll/ })).toBeNull();
    expect(container.textContent).toContain('d20 [12] + 3 + d4 [3] Guidance');
    expect(rollLogStore.getState().rolls[0]?.total).toBe(18);
    expect(document.activeElement).toBe(from);
    expect(spend).toHaveBeenCalledWith('g1', true);
    // Added before, so not offered after; the die left comes back, as written.
    expect(screen.queryByRole('button', { name: /Guidance/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Bardic Inspiration/ })).toBeTruthy();
  });

  it('lets the dice left go under the house rule', () => {
    rollOffersStore.setState({ before: true });
    const { container } = render(<RollToast />);
    act(() => rollFrom(control('Athletics'), check));
    expect(prompt('Athletics check').textContent).toContain(
      'Dice you leave are gone once the d20 shows.',
    );
    nextFaces(12);
    fireEvent.click(roll());
    expect(container.textContent).toContain('Athletics check');
    expect(screen.queryByRole('button', { name: /Bardic Inspiration|Guidance/ })).toBeNull();
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
    fireEvent.keyDown(roll(), { key: 'Escape' });
    expect(screen.queryByRole('group')).toBeNull();
    expect(rollLogStore.getState().rolls).toHaveLength(0);
    expect(document.activeElement).toBe(from);
  });

  it('rolls when its control is tapped again', () => {
    const { container } = render(<RollToast />);
    const from = control('Athletics');
    act(() => rollFrom(from, check));
    nextFaces(12);
    act(() => rollFrom(from, check));
    expect(screen.queryByRole('group', { name: /choose and roll/ })).toBeNull();
    expect(container.textContent).toContain('d20 [12] + 3');
  });
});

describe('a d20 chip in rules text', () => {
  it('asks plainly in the prompt, so its mode can be picked, then rolls under it', () => {
    render(
      <>
        <RollChip expr="1d20+5" display="+5" variant="d20" label="Attack roll +5" inline />
        <RollToast />
      </>,
    );
    fireEvent.click(screen.getByTitle('Attack roll +5'));
    const group = prompt('Attack roll +5');
    expect(rollLogStore.getState().rolls).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Advantage' }));
    expect(group.textContent).toContain('d20 +5, advantage');
    nextFaces(4, 16);
    fireEvent.click(roll());
    expect(rollLogStore.getState().rolls[0]).toMatchObject({
      total: 21,
      meta: { advantage: 'adv' },
    });
  });
});

describe('damage tapped while the attack waits', () => {
  it('says it rolls with the attack, then shows both together and says both', () => {
    render(<RollToast />);
    act(() => rollFrom(control('Greataxe'), attack));
    act(() =>
      rollFrom(control('1d12+4'), damage, undefined, { joins: { label: 'Greataxe damage' } }),
    );
    expect(prompt('Greataxe attack').textContent).toContain('Damage rolls with the attack');
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    resetAnnouncer();
    nextFaces(14, 2);
    fireEvent.click(roll());
    const shown = screen.getByRole('group', { name: 'Roll result' });
    expect(shown.textContent).toContain('Greataxe attack');
    expect(shown.textContent).toContain('23');
    expect(shown.textContent).toContain('Greataxe damage: d12 [7] + 4');
    expect(shown.textContent).toContain('11');
    expect(spoken()).toEqual([
      'Greataxe attack: 23. Rolled 14, plus 7, plus 2. Greataxe damage: 11. Rolled 7, plus 4',
    ]);
  });

  it('counts more than one, then shows and says each under the attack, in the order tapped', () => {
    render(<RollToast />);
    act(() => rollFrom(control('Greataxe'), attack));
    act(() =>
      rollFrom(control('1d12+4'), damage, undefined, { joins: { label: 'Greataxe damage' } }),
    );
    act(() =>
      rollFrom(
        control('Smite'),
        () => ({ ...damage(), label: 'Divine Smite', total: 9 }),
        undefined,
        {
          joins: { label: 'Divine Smite' },
        },
      ),
    );
    expect(prompt('Greataxe attack').textContent).toContain('2 damage rolls go with the attack');
    act(() => vi.advanceTimersByTime(THROTTLE_MS));
    resetAnnouncer();
    nextFaces(14, 2);
    fireEvent.click(roll());
    const shown = screen.getByRole('group', { name: 'Roll result' }).textContent ?? '';
    expect(shown.indexOf('Greataxe damage')).toBeLessThan(shown.indexOf('Divine Smite'));
    expect(spoken()[0]).toMatch(/^Greataxe attack: 23\..*Greataxe damage: 11\..*Divine Smite: 9/);
  });
});

describe("a hit's damage offered after it", () => {
  const swing = (go: () => void) =>
    act(() =>
      rollFrom(control('Greataxe'), attack, undefined, { afterHit: { expr: '1d12+4', go } }),
    );

  it('offers the damage on a hit, and rolls it as its chip would', () => {
    const go = vi.fn();
    render(<RollToast />);
    swing(go);
    nextFaces(14, 2);
    fireEvent.click(roll());
    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d12+4' }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(followUpStore.getState().offer).toBeNull();
  });

  it('sends focus back where the roll came from once the damage is rolled', () => {
    render(<RollToast />);
    const from = control('Greataxe');
    act(() =>
      rollFrom(from, attack, undefined, {
        afterHit: { expr: '1d12+4', go: () => rollFrom(null, damage) },
      }),
    );
    nextFaces(14, 2);
    fireEvent.click(roll());
    const offer = screen.getByRole('button', { name: 'Roll 1d12+4' });
    offer.focus();
    fireEvent.click(offer);
    expect(rollLogStore.getState().rolls[0]?.label).toBe('Greataxe damage');
    expect(document.activeElement).toBe(from);
  });

  it('offers it doubled on a crit, and keeps the toast up while it waits', () => {
    render(<RollToast />);
    swing(() => {});
    nextFaces(20, 2);
    fireEvent.click(roll());
    expect(screen.getByRole('button', { name: 'Roll 2d12+4' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(OFFER_WAIT_MS - 1));
    expect(screen.getByRole('button', { name: 'Roll 2d12+4' })).toBeTruthy();
  });

  it('offers nothing on a natural 1', () => {
    render(<RollToast />);
    swing(() => {});
    nextFaces(1, 2);
    fireEvent.click(roll());
    expect(screen.queryByRole('group', { name: /choose and roll/ })).toBeNull();
    expect(rollLogStore.getState().rolls[0]?.label).toBe('Greataxe attack');
    expect(screen.queryByRole('button', { name: /^Roll 1d12/ })).toBeNull();
  });
});

describe('withItsDamage', () => {
  const a: RollResult = {
    expr: '1d20+7',
    label: 'Greataxe attack',
    kind: 'd20',
    total: 21,
    at: 0,
    id: 'a',
    terms: [
      { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: 14, kept: true }] },
      { kind: 'mod', value: 7 },
    ],
    meta: { d20: { natural: 14 } },
  };
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
