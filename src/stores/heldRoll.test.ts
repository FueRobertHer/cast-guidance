// @vitest-environment jsdom
// Decide before the roll, the house rule (the buffs canvas, Dice B): a roll
// with one-use dice to name waits, unseen, then lands with the named dice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RollOffer, RollResult } from '@/dice/types';
import { getAnnouncerState, resetAnnouncer, THROTTLE_MS } from './announcer';
import {
  cancelHeld,
  heldRollStore,
  namedFirst,
  nameHeldDie,
  rollFrom,
  rollHeld,
  whenLanded,
} from './heldRoll';
import { rollLogStore } from './rollLog';
import { rollOffersStore } from './rollOffers';

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
const failedBardic: RollOffer = { ...bardic, effectId: 'b2', ifFailed: true };

/** A d20 test as `rollD20Test` leaves it: Bless rolled in, dice to ask about. */
function d20(natural: number, over: Partial<RollResult['meta']> = {}, label = 'Athletics check') {
  return (): RollResult => ({
    expr: '1d20+3+1d4',
    label,
    kind: 'd20',
    total: natural + 3 + 2,
    at: 0,
    terms: [
      { kind: 'dice', sign: 1, sides: 20, rolls: [{ v: natural, kept: true }] },
      { kind: 'mod', value: 3 },
      { kind: 'dice', sign: 1, sides: 4, rolls: [{ v: 2, kept: true }] },
    ],
    meta: {
      d20: { natural },
      from: [{ term: 2, source: 'Bless' }],
      offers: [guidance, bardic],
      askFirst: { offers: [guidance, bardic], attack: false },
      ...over,
    },
  });
}

const attack = (natural: number, over: Partial<RollResult['meta']> = {}) =>
  d20(
    natural,
    { askFirst: { offers: [bardic], attack: true }, offers: [bardic], ...over },
    'Greataxe attack',
  );

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

const logged = () => rollLogStore.getState().rolls;
const spoken = () => getAnnouncerState().messages.map((m) => m.text);
const button = () => document.body.appendChild(document.createElement('button'));

beforeEach(() => {
  resetAnnouncer();
});

afterEach(() => {
  vi.restoreAllMocks();
  cancelHeld();
  rollLogStore.setState({ rolls: [], seq: 0 });
  rollOffersStore.setState({ spend: null, expired: 0, before: false });
  document.body.replaceChildren();
  resetAnnouncer();
});

describe('namedFirst', () => {
  it('takes one-use dice that do not wait for a failure', () => {
    expect(namedFirst(bardic)).toBe(true);
    expect(namedFirst(failedBardic)).toBe(false);
    expect(namedFirst({ ...guidance, once: false })).toBe(false);
  });
});

describe('after the roll, as written', () => {
  it('lands at once, with the dice still on offer and no note of asking', () => {
    const then = vi.fn();
    rollFrom(button(), d20(12), then);
    expect(heldRollStore.getState().held).toBeNull();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]?.meta?.offers).toEqual([guidance, bardic]);
    expect(logged()[0]?.meta?.askFirst).toBeUndefined();
    expect(then).toHaveBeenCalledWith(expect.objectContaining({ total: 17 }));
  });
});

describe('before the roll, the house rule', () => {
  beforeEach(() => {
    rollOffersStore.setState({ before: true });
  });

  it('waits, unseen and unsaid, and asks for the dice by name', () => {
    const then = vi.fn();
    rollFrom(button(), d20(12), then);
    expect(logged()).toHaveLength(0);
    expect(then).not.toHaveBeenCalled();
    expect(heldRollStore.getState().held?.offers).toEqual([guidance, bardic]);
    expect(spoken()).toEqual([
      'Athletics check waiting: add Guidance or Bardic Inspiration, or Roll.',
    ]);
    expect(spoken().join(' ')).not.toMatch(/12|17/);
  });

  it('lands with the named dice rolled in and spent, and offers none of them after', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    const then = vi.fn();
    rollFrom(button(), d20(12, { offers: [guidance, bardic, failedBardic] }), then);
    nameHeldDie(1);
    nextFaces(6);
    rollHeld();
    const [r] = logged();
    expect(r?.total).toBe(23);
    expect(r?.meta?.from).toEqual([
      { term: 2, source: 'Bless' },
      { term: 3, source: 'Bardic Inspiration' },
    ]);
    // Guidance was not named, so it is gone; 2024 Bardic still waits for a failure.
    expect(r?.meta?.offers).toEqual([failedBardic]);
    expect(r?.meta?.askFirst).toBeUndefined();
    expect(spend).toHaveBeenCalledTimes(1);
    expect(spend).toHaveBeenCalledWith('b1', true);
    expect(then).toHaveBeenCalledWith(expect.objectContaining({ total: 23 }));
    expect(heldRollStore.getState().held).toBeNull();
  });

  it('spends a named die on a natural 20 too, which offers nothing after', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    rollFrom(button(), attack(20, { offers: undefined }));
    nameHeldDie(0);
    nextFaces(5);
    rollHeld();
    expect(logged()[0]?.total).toBe(30);
    expect(logged()[0]?.meta?.offers).toBeUndefined();
    expect(spend).toHaveBeenCalledWith('b1', true);
  });

  it('lands as rolled when nothing is named, spending nothing', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    rollFrom(button(), d20(9));
    nameHeldDie(0);
    nameHeldDie(0);
    rollHeld();
    expect(logged()[0]?.total).toBe(14);
    expect(logged()[0]?.meta?.from).toEqual([{ term: 2, source: 'Bless' }]);
    expect(logged()[0]?.meta?.offers).toBeUndefined();
    expect(spend).not.toHaveBeenCalled();
  });

  it('rolls when the same control is tapped again, without rolling anew', () => {
    const from = button();
    const make = vi.fn(d20(12));
    rollFrom(from, make);
    rollFrom(from, make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(logged()).toHaveLength(1);
    expect(heldRollStore.getState().held).toBeNull();
  });

  it('lets the waiting roll go for another that waits, or one that lands', () => {
    const first = vi.fn();
    rollFrom(button(), d20(12), first);
    rollFrom(button(), d20(4, {}, 'Stealth check'));
    expect(heldRollStore.getState().held?.result.label).toBe('Stealth check');
    const plain = (): RollResult => ({ ...damage(), kind: 'heal', label: 'Hit die (d8)' });
    rollFrom(button(), plain);
    expect(heldRollStore.getState().held).toBeNull();
    expect(logged().map((r) => r.label)).toEqual(['Hit die (d8)']);
    expect(first).not.toHaveBeenCalled();
  });

  it('lets it go when a roll lands from anywhere else', () => {
    rollFrom(button(), d20(12));
    rollLogStore.getState().append(damage());
    expect(heldRollStore.getState().held).toBeNull();
  });

  it('cancels unseen: nothing logged, nothing spent, nothing done', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    const then = vi.fn();
    rollFrom(button(), d20(12), then);
    nameHeldDie(0);
    cancelHeld();
    expect(logged()).toHaveLength(0);
    expect(spend).not.toHaveBeenCalled();
    expect(then).not.toHaveBeenCalled();
  });

  it('holds damage tapped while the attack waits, and lands it after, marked as going with it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const struck = vi.fn();
    const hurt = vi.fn();
    rollFrom(button(), attack(14), struck);
    rollFrom(button(), damage, hurt);
    expect(logged()).toHaveLength(0);
    expect(heldRollStore.getState().held?.damage.map((d) => d.result.total)).toEqual([11]);
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(spoken().at(-1)).toBe('Greataxe damage rolls with the attack.');
    vi.useRealTimers();
    rollHeld();
    const [dealt, swing] = logged();
    expect(swing?.label).toBe('Greataxe attack');
    expect(dealt?.label).toBe('Greataxe damage');
    expect(swing?.id).toBeDefined();
    expect(dealt?.meta?.withRoll).toBe(swing?.id);
    expect(struck).toHaveBeenCalledWith(expect.objectContaining({ id: swing?.id }));
    expect(hurt).toHaveBeenCalledWith(expect.objectContaining({ total: 11 }));
  });

  it('holds every damage roll tapped while the attack waits, and lands each in order', () => {
    const smite = (): RollResult => ({ ...damage(), label: 'Divine Smite', total: 9 });
    const hurt = vi.fn();
    const smote = vi.fn();
    rollFrom(button(), attack(14));
    rollFrom(button(), damage, hurt);
    rollFrom(button(), smite, smote);
    expect(heldRollStore.getState().held?.damage.map((d) => d.result.label)).toEqual([
      'Greataxe damage',
      'Divine Smite',
    ]);
    rollHeld();
    const [smiteRoll, dealt, swing] = logged();
    expect(logged().map((r) => r.label)).toEqual([
      'Divine Smite',
      'Greataxe damage',
      'Greataxe attack',
    ]);
    expect(dealt?.meta?.withRoll).toBe(swing?.id);
    expect(smiteRoll?.meta?.withRoll).toBe(swing?.id);
    expect(hurt).toHaveBeenCalledTimes(1);
    expect(smote).toHaveBeenCalledTimes(1);
  });

  it('lands damage at once while a check waits, which lets the check go', () => {
    rollFrom(button(), d20(12));
    rollFrom(button(), damage);
    expect(heldRollStore.getState().held).toBeNull();
    expect(logged().map((r) => r.label)).toEqual(['Greataxe damage']);
    expect(logged()[0]?.meta?.withRoll).toBeUndefined();
  });
});

describe('whenLanded', () => {
  it('happens at once outside a roll', () => {
    const effect = vi.fn();
    whenLanded(effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('waits with a roll that waits: once it lands, never if it is cancelled', () => {
    rollOffersStore.setState({ before: true });
    const spentOnce = vi.fn();
    const making = (r: () => RollResult) => () => {
      whenLanded(spentOnce);
      return r();
    };
    rollFrom(button(), making(d20(12)));
    expect(spentOnce).not.toHaveBeenCalled();
    cancelHeld();
    expect(spentOnce).not.toHaveBeenCalled();

    rollFrom(button(), making(d20(12)));
    rollHeld();
    expect(spentOnce).toHaveBeenCalledTimes(1);

    // A roll that lands at once spends it as it lands.
    rollOffersStore.setState({ before: false });
    rollFrom(button(), making(d20(9)));
    expect(spentOnce).toHaveBeenCalledTimes(2);
  });

  it('puts nothing off once a roll that threw is done', () => {
    expect(() =>
      rollFrom(button(), () => {
        throw new Error('bad dice');
      }),
    ).toThrow('bad dice');
    const effect = vi.fn();
    whenLanded(effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
