// @vitest-environment jsdom
// The roll prompt (the rolls canvas, picked 2026-11-09): a d20 test waits,
// unrolled, then lands under the prompt's choices.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roll } from '@/dice/roll';
import type { RollOffer, RollResult } from '@/dice/types';
import { d20Ask } from '@/features/sheet/d20Tests';
import { getAnnouncerState, resetAnnouncer } from './announcer';
import {
  attackInPlay,
  cancelHeld,
  critDice,
  followUpStore,
  heldRollStore,
  namedFirst,
  nameHeldDie,
  rollFrom,
  rollHeld,
  setHeldMode,
  toggleHeldRollIn,
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

/** A check with Bless rolling in and one-use dice to offer. */
const check =
  (offers: RollOffer[] = [guidance, bardic], label = 'Athletics check') =>
  () =>
    d20Ask('1d20+3', {
      label,
      riders: {
        dice: [{ dice: '1d4', source: 'Bless' }],
        offers,
        advantage: [],
        disadvantage: [],
      },
    });

/** A Greataxe attack, with Bardic to offer. */
const swing = () =>
  d20Ask('1d20+7', {
    label: 'Greataxe attack',
    riders: { dice: [], offers: [bardic], advantage: [], disadvantage: [] },
    settlesOnNatural: true,
    attack: { by: 'c1', of: 'Greataxe' },
  });

/** Greataxe damage, doubled when the attack in play crit, as `RollChip` rolls it. */
const damage = (): RollResult =>
  roll('1d12+4', {
    label: 'Greataxe damage',
    kind: 'damage',
    ...(attackInPlay()?.crit === true ? { critical: true } : {}),
  });

const logged = () => rollLogStore.getState().rolls;
const held = () => heldRollStore.getState().held;
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
  followUpStore.setState({ offer: null });
  document.body.replaceChildren();
  resetAnnouncer();
});

describe('namedFirst', () => {
  it('takes one-use dice that do not wait for a failure', () => {
    expect(namedFirst(guidance)).toBe(true);
    expect(namedFirst(failedBardic)).toBe(false);
    expect(namedFirst({ ...guidance, once: false })).toBe(false);
  });
});

describe('the prompt', () => {
  it('waits with nothing rolled, presets the mode and says what to do', () => {
    nextFaces();
    rollFrom(button(), check());
    expect(logged()).toHaveLength(0);
    expect(held()?.mode).toBe('normal');
    expect(held()?.rollsIn).toEqual([true]);
    expect(held()?.named).toEqual([false, false]);
    expect(spoken().at(-1)).toBe('Athletics check. Choose, then Roll.');
  });

  it('rolls the d20 at Roll, Bless in, the one-use dice offered after as written', () => {
    rollFrom(button(), check());
    nextFaces(14, 3);
    rollHeld();
    const r = logged()[0];
    expect(r?.total).toBe(14 + 3 + 3);
    expect(r?.meta?.from).toEqual([{ term: 2, source: 'Bless' }]);
    expect(r?.meta?.offers).toEqual([guidance, bardic]);
    expect(held()).toBeNull();
  });

  it('rolls an added one-use die in and spends it, offering only the rest after', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    rollFrom(button(), check());
    nameHeldDie(1);
    nextFaces(10, 2, 6);
    rollHeld();
    const r = logged()[0];
    expect(r?.total).toBe(10 + 3 + 2 + 6);
    expect(r?.meta?.from).toEqual([
      { term: 2, source: 'Bless' },
      { term: 3, source: 'Bardic Inspiration' },
    ]);
    expect(r?.meta?.offers).toEqual([guidance]);
    expect(spend).toHaveBeenCalledWith('b1', true);
  });

  it('offers none of them after under the house rule', () => {
    rollOffersStore.setState({ before: true });
    rollFrom(button(), check([guidance, failedBardic]));
    nextFaces(10, 2);
    rollHeld();
    // 2024 Bardic waits for a failure, so it is still offered after.
    expect(logged()[0]?.meta?.offers).toEqual([failedBardic]);
  });

  it('spends an added die on a natural 20 too, and offers nothing after an attack it settles', () => {
    const spend = vi.fn();
    rollOffersStore.setState({ spend });
    rollFrom(button(), swing);
    nameHeldDie(0);
    nextFaces(20, 5);
    rollHeld();
    expect(logged()[0]?.meta?.offers).toBeUndefined();
    expect(spend).toHaveBeenCalledWith('b1', true);
  });

  it('leaves Bless out when the prompt takes it out', () => {
    rollFrom(button(), check([]));
    toggleHeldRollIn(0);
    nextFaces(11);
    rollHeld();
    expect(logged()[0]?.total).toBe(14);
    expect(logged()[0]?.meta?.from).toBeUndefined();
  });

  it('rolls in the mode picked, and the cue says it was chosen', () => {
    rollFrom(button(), check([]));
    setHeldMode('adv');
    nextFaces(4, 17, 1);
    rollHeld();
    const r = logged()[0];
    expect(r?.meta?.d20?.natural).toBe(17);
    expect(r?.meta?.cue).toBe('Advantage chosen for this roll');
  });

  it('rolls when the same control is tapped again', () => {
    const from = button();
    rollFrom(from, check([]));
    nextFaces(9, 1);
    rollFrom(from, check([]));
    expect(logged()).toHaveLength(1);
    expect(held()).toBeNull();
  });

  it('lets the waiting roll go for another that waits, or one that lands', () => {
    rollFrom(button(), check([], 'Athletics check'));
    rollFrom(button(), check([], 'Stealth check'));
    expect(held()?.ask.label).toBe('Stealth check');
    rollFrom(button(), () => roll('2d4+2', { label: 'Potion of Healing', kind: 'heal' }));
    expect(held()).toBeNull();
    expect(logged().map((r) => r.label)).toEqual(['Potion of Healing']);
  });

  it('lets it go when a roll lands from anywhere else', () => {
    rollFrom(button(), check());
    rollLogStore.getState().append(roll('1d6'));
    expect(held()).toBeNull();
  });

  it('cancels unrolled: nothing logged, nothing spent, nothing done', () => {
    const spend = vi.fn();
    const landed = vi.fn();
    rollOffersStore.setState({ spend });
    rollFrom(button(), check(), landed);
    nameHeldDie(0);
    cancelHeld();
    expect(logged()).toHaveLength(0);
    expect(spend).not.toHaveBeenCalled();
    expect(landed).not.toHaveBeenCalled();
  });
});

describe('an attack in the prompt', () => {
  it('makes damage tapped while it waits after it lands, so a crit doubles it', () => {
    rollFrom(button(), swing);
    rollFrom(button(), damage, undefined, { joins: { label: 'Greataxe damage' } });
    expect(logged()).toHaveLength(0);
    expect(held()?.damage).toHaveLength(1);
    nextFaces(20, 5, 7);
    rollHeld();
    const [dmg, atk] = logged();
    expect(atk?.meta?.attack).toEqual({ by: 'c1', of: 'Greataxe', crit: true });
    expect(dmg?.meta?.critical).toBe(true);
    expect(dmg?.total).toBe(5 + 7 + 4);
    expect(dmg?.meta?.withRoll).toBe(atk?.id);
    // Damage that joined it needs no offer.
    expect(followUpStore.getState().offer).toBeNull();
  });

  it('offers its damage after a hit, doubled on a crit', () => {
    const go = vi.fn();
    rollFrom(button(), swing, undefined, { afterHit: { expr: '1d12+4', go } });
    nextFaces(20);
    rollHeld();
    expect(followUpStore.getState().offer).toMatchObject({
      id: logged()[0]?.id,
      expr: '2d12+4',
    });
  });

  it('offers no damage after a natural 1', () => {
    rollFrom(button(), swing, undefined, { afterHit: { expr: '1d12+4', go: vi.fn() } });
    nextFaces(1);
    rollHeld();
    expect(followUpStore.getState().offer).toBeNull();
  });

  it('lands damage at once while a check waits, which lets the check go', () => {
    rollFrom(button(), check());
    rollFrom(button(), damage, undefined, { joins: { label: 'Greataxe damage' } });
    expect(held()).toBeNull();
    expect(logged().map((r) => r.label)).toEqual(['Greataxe damage']);
  });

  it("lands damage that goes with no attack at once, letting the attack go (a save's, a spell cast)", () => {
    const cast = vi.fn();
    rollFrom(button(), swing);
    rollFrom(button(), () => roll('8d6', { label: 'Fireball damage', kind: 'damage' }), cast);
    expect(held()).toBeNull();
    expect(logged().map((r) => r.label)).toEqual(['Fireball damage']);
    expect(cast).toHaveBeenCalledTimes(1);
  });
});

describe('whenLanded', () => {
  it('happens at once outside a roll', () => {
    const effect = vi.fn();
    whenLanded(effect);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('waits with a roll in the prompt: once it lands, never if it is cancelled', () => {
    const spentOnce = vi.fn();
    const making = () => {
      whenLanded(spentOnce);
      return check([])();
    };
    rollFrom(button(), making);
    expect(spentOnce).not.toHaveBeenCalled();
    cancelHeld();
    expect(spentOnce).not.toHaveBeenCalled();

    rollFrom(button(), making);
    rollHeld();
    expect(spentOnce).toHaveBeenCalledTimes(1);

    // A roll that lands at once spends it as it lands.
    rollFrom(button(), () => {
      whenLanded(spentOnce);
      return roll('1d6');
    });
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

describe('attackInPlay', () => {
  const landed = (crit: boolean) => () => {
    nextFaces(crit ? 20 : 12);
    const r = swing().roll();
    vi.restoreAllMocks();
    return r;
  };

  it('is the newest roll, past the damage rolled after it', () => {
    expect(attackInPlay()).toBeUndefined();
    rollFrom(button(), landed(true));
    expect(attackInPlay()).toEqual({ by: 'c1', of: 'Greataxe', crit: true });
    rollFrom(button(), damage);
    rollFrom(button(), damage);
    expect(attackInPlay()).toEqual({ by: 'c1', of: 'Greataxe', crit: true });
    rollFrom(button(), landed(false));
    expect(attackInPlay()).toEqual({ by: 'c1', of: 'Greataxe', crit: false });
  });

  it('lets go once a heal lands', () => {
    rollFrom(button(), landed(true));
    rollFrom(button(), () => roll('2d4+2', { label: 'Cure Wounds', kind: 'heal' }));
    expect(attackInPlay()).toBeUndefined();
  });

  it('passes plain dice rolled after it, which may add to its damage', () => {
    rollFrom(button(), landed(true));
    rollFrom(button(), () => roll('1d8', { label: 'Superiority die' }));
    expect(attackInPlay()).toEqual({ by: 'c1', of: 'Greataxe', crit: true });
  });

  it('is nothing while an attack waits, whose d20 is not rolled yet', () => {
    rollFrom(button(), landed(true));
    rollFrom(button(), swing);
    expect(attackInPlay()).toBeUndefined();
  });
});

describe('critDice', () => {
  it('doubles every die count, the modifiers once', () => {
    expect(critDice('1d12+4')).toBe('2d12+4');
    expect(critDice('2d6+1d8+3')).toBe('4d6+2d8+3');
    expect(critDice('d10')).toBe('2d10');
  });
});
