import { createStore } from 'zustand/vanilla';
import { roll } from '@/dice/roll';
import type { RollOffer, RollResult } from '@/dice/types';
import { announce } from './announcer';
import { rollLogStore } from './rollLog';
import { rollOffersStore } from './rollOffers';

/**
 * Decide before the roll, a table's house rule (the buffs canvas, Dice B; the
 * choice is `lib/oneUseDice`): when a one-use die fits a roll (2014 Guidance on
 * a check, Bardic Inspiration on any d20 test), the roll waits on the toast
 * while the player names the dice they spend, then lands. A named die is spent
 * whatever the d20 shows, a natural 1 or 20 included, and the dice not named
 * are not offered after it: that was the choice.
 *
 * The d20 is rolled at the tap, under the dock's mode and the "Ignore once"
 * then armed, but it is never shown or said until it lands, so waiting tells
 * the player nothing. Bless still rolls in, since there is nothing to decide.
 */

/** What a control does with its roll once it lands: the chip's total, an action spent. */
export type Landed = (result: RollResult) => void;

/** One-use dice that do not wait for a failure: the ones a table names first. */
export function namedFirst(offer: RollOffer): boolean {
  return offer.once && !offer.ifFailed;
}

/** A roll made and not yet landed: what the control does then, and what making it put off. */
interface Pending {
  result: RollResult;
  onLanded: Landed | undefined;
  /** Side effects of making it that wait for it to land (`whenLanded`). */
  effects: Array<() => void>;
}

export interface HeldRoll extends Pending {
  /** Counts holds, so the toast knows a new one from the last. */
  seq: number;
  /** The dice it asks about, and which of them are named. */
  offers: RollOffer[];
  named: boolean[];
  attack: boolean;
  /** The control that rolled it: tapped again it rolls, and focus goes back there. */
  from: HTMLElement | null;
  /** Damage tapped while the attack waits, in order, which lands with it. */
  damage: Pending[];
}

export const heldRollStore = createStore<{ held: HeldRoll | null; seq: number }>(() => ({
  held: null,
  seq: 0,
}));

/** A roll as the log keeps it: without the hold's note. */
function logged(result: RollResult): RollResult {
  if (result.meta?.askFirst === undefined) return result;
  const meta = { ...result.meta };
  delete meta.askFirst;
  return { ...result, meta };
}

/** The log takes it, what making it put off happens, then what the control does. */
function land({ result, onLanded, effects }: Pending): void {
  rollLogStore.getState().append(result);
  for (const effect of effects) effect();
  onLanded?.(result);
}

/** What `make` is putting off while `rollFrom` makes a roll; null outside one. */
let making: Array<() => void> | null = null;

/**
 * Puts off a side effect of making a roll until it lands: "Ignore once" is
 * spent by a roll that lands, not one that waits and is cancelled. Outside
 * `rollFrom` (a roll that lands at once) it happens now.
 */
export function whenLanded(effect: () => void): void {
  if (making === null) effect();
  else making.push(effect);
}

/** "Guidance", "Guidance or Bardic Inspiration". */
const orList = (names: readonly string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;

/**
 * Every roll a player taps on the sheet lands here. `make` rolls it and `onLanded`
 * is what the control does once it lands, after the log has it. `from` is the
 * control: tapped again while its roll waits, it rolls.
 *
 * Under the house rule a roll with one-use dice to name waits, in place of any
 * roll already waiting. Damage tapped while an attack waits joins it (a
 * weapon's, its riders', a smite's). Anything else lands at once, and the roll
 * that waited is let go. What `make` puts off (`whenLanded`) waits with it.
 */
export function rollFrom(
  from: HTMLElement | null,
  make: () => RollResult,
  onLanded?: Landed,
): void {
  const { held } = heldRollStore.getState();
  if (held !== null && from !== null && held.from === from) {
    rollHeld();
    return;
  }
  making = [];
  let result: RollResult;
  let effects: Array<() => void>;
  try {
    result = make();
  } finally {
    effects = making;
    making = null;
  }
  const ask = result.meta?.askFirst;
  if (ask !== undefined && rollOffersStore.getState().before) {
    heldRollStore.setState((s) => ({
      seq: s.seq + 1,
      held: {
        seq: s.seq + 1,
        result,
        onLanded,
        effects,
        offers: ask.offers,
        named: ask.offers.map(() => false),
        attack: ask.attack,
        from,
        damage: [],
      },
    }));
    const label = result.label ?? result.expr;
    announce(`${label} waiting: add ${orList(ask.offers.map((o) => o.source))}, or Roll.`, {
      key: 'roll',
      repeat: true,
    });
    return;
  }
  if (held?.attack && result.kind === 'damage') {
    heldRollStore.setState({
      held: { ...held, damage: [...held.damage, { result: logged(result), onLanded, effects }] },
    });
    announce(`${result.label ?? 'Damage'} rolls with the attack.`, { key: 'roll', repeat: true });
    return;
  }
  // Landing lets the waiting roll go (the log's listener below).
  land({ result: logged(result), onLanded, effects });
}

/** Names a die for the waiting roll, or takes it back. */
export function nameHeldDie(index: number): void {
  const { held } = heldRollStore.getState();
  if (held === null || held.offers[index] === undefined) return;
  const named = [...held.named];
  named[index] = !named[index];
  heldRollStore.setState({ held: { ...held, named } });
}

/** Lets the waiting roll go unseen, and any damage with it. */
export function cancelHeld(): void {
  if (heldRollStore.getState().held !== null) heldRollStore.setState({ held: null });
}

/**
 * The waiting roll lands: the named dice roll in and are spent, the rest of
 * its asked dice are gone, and what it still offers after (2024 Bardic) stays.
 * Damage that joined it lands next, in the order tapped, marked as going with it.
 */
export function rollHeld(): void {
  const { held } = heldRollStore.getState();
  if (held === null) return;
  heldRollStore.setState({ held: null });
  const base = held.result;
  const terms = [...base.terms];
  const from = [...(base.meta?.from ?? [])];
  let total = base.total;
  const spent: string[] = [];
  held.offers.forEach((o, i) => {
    if (held.named[i] !== true) return;
    const die = roll(o.dice);
    const term = die.terms[0];
    if (term === undefined || term.kind !== 'dice') return;
    from.push({ term: terms.length, source: o.source });
    terms.push(term);
    total += die.total;
    if (o.effectId !== undefined) spent.push(o.effectId);
  });
  const after = (base.meta?.offers ?? []).filter((o) => !namedFirst(o));
  const kept = { ...base.meta };
  delete kept.askFirst;
  delete kept.from;
  delete kept.offers;
  const result: RollResult = {
    ...base,
    total,
    terms,
    meta: {
      ...kept,
      ...(from.length > 0 ? { from } : {}),
      ...(after.length > 0 ? { offers: after } : {}),
    },
    ...(held.damage.length === 0 ? {} : { id: crypto.randomUUID() }),
  };
  land({
    result,
    onLanded: held.onLanded,
    effects: [
      ...held.effects,
      ...spent.map((id) => () => rollOffersStore.getState().spend?.(id, true)),
    ],
  });
  for (const d of held.damage) {
    land({ ...d, result: { ...d.result, meta: { ...d.result.meta, withRoll: result.id } } });
  }
}

// A roll that lands from anywhere else (the dice tray, the Build page) lets
// the waiting one go: the toast is for the newest roll.
rollLogStore.subscribe((state, prev) => {
  if (state.seq !== prev.seq) cancelHeld();
});
