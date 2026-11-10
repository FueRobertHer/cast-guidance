import { createStore } from 'zustand/vanilla';
import type { RollOffer, RollResult } from '@/dice/types';
import type { D20Ask, RollMode } from '@/features/sheet/d20Tests';
import type { ChipWear } from '@/ui/ChipFace';
import { announce } from './announcer';
import { rollLogStore } from './rollLog';
import { rollOffersStore } from './rollOffers';

/**
 * The roll prompt (the rolls canvas, picked 2026-11-09): every d20 test the
 * sheet makes waits here before its d20 is rolled. The toast's place shows it
 * with what the sheet sets (the mode, and why), the dice that roll in (Bless),
 * and the one-use dice that may be added first (2014 Guidance and Bardic
 * Inspiration). Roll, or the same control tapped again, rolls it.
 *
 * A one-use die added here rolls in and is spent, a natural 1 or 20 included.
 * The ones not added come back after the roll, as written, unless the table's
 * house rule (`lib/oneUseDice`, "before") says a die is named first or not at
 * all.
 */

/** What a control does with its roll once it lands: the chip's total, an action spent. */
export type Landed = (result: RollResult) => void;

/** Which attack a roll was, and whether it crit (`d20Ask`'s `attack`). */
export type AttackMark = NonNullable<NonNullable<RollResult['meta']>['attack']>;

/** One-use dice that do not wait for a failure: the ones the prompt offers before the roll. */
export function namedFirst(offer: RollOffer): boolean {
  return offer.once && !offer.ifFailed;
}

/** Is what a control made a d20 test to ask about, not a roll already made? */
export function isD20Ask(made: RollResult | D20Ask): made is D20Ask {
  return (made as Partial<D20Ask>).kind === 'ask';
}

/**
 * How the control that rolled looks, for the prompt's header: its text, and
 * what it wears (a condition's face, a buff's ring and lift).
 */
export interface RollFace {
  text: string;
  wear?: ChipWear | undefined;
  lift?: boolean | undefined;
}

/** What a hit offers after it lands: its damage, rolled as the damage chip would. */
export interface FollowUp {
  /** The damage's dice as its chip shows them ("1d12+4"). */
  expr: string;
  go: () => void;
}

/** A roll made and not yet landed: what the control does then, and what making it put off. */
interface Pending {
  result: RollResult;
  onLanded: Landed | undefined;
  /** Side effects of making it that wait for it to land (`whenLanded`). */
  effects: Array<() => void>;
}

export interface HeldRoll {
  /** Counts holds, so the toast knows a new one from the last. */
  seq: number;
  ask: D20Ask;
  onLanded: Landed | undefined;
  /** Side effects of asking that wait for the roll to land (`whenLanded`). */
  effects: Array<() => void>;
  /** The control that rolled it: tapped again it rolls, and focus goes back there. */
  from: HTMLElement | null;
  face: RollFace | undefined;
  /** The prompt's choices: the mode, the dice that roll in left in, the one-use dice added. */
  mode: RollMode;
  rollsIn: boolean[];
  named: boolean[];
  /**
   * Damage tapped while an attack waits, in order: made once the attack has
   * landed, so a crit doubles it, and landed with it.
   */
  damage: Array<{ make: () => RollResult; onLanded: Landed | undefined }>;
  afterHit: FollowUp | undefined;
}

export const heldRollStore = createStore<{ held: HeldRoll | null; seq: number }>(() => ({
  held: null,
  seq: 0,
}));

/** The damage a hit just landed offers, until it is rolled or another roll offers its own. */
export const followUpStore = createStore<{
  /** `from`: the attack's control, where focus goes back once the damage is rolled. */
  offer: { id: string; expr: string; go: () => void; from: HTMLElement | null } | null;
}>(() => ({ offer: null }));

/** The log takes it, what making it put off happens, then what the control does. */
function land({ result, onLanded, effects }: Pending): void {
  rollLogStore.getState().append(result);
  for (const effect of effects) effect();
  onLanded?.(result);
}

/** What `make` is putting off while `rollFrom` makes a roll; null outside one. */
let making: Array<() => void> | null = null;

/** Runs `make` with what it puts off kept aside. */
function made<T>(make: () => T): { value: T; effects: Array<() => void> } {
  making = [];
  try {
    const value = make();
    return { value, effects: making };
  } finally {
    making = null;
  }
}

/**
 * Puts off a side effect of making a roll until it lands: "Ignore once" is
 * spent by a roll that lands, not one that waits and is cancelled. Outside
 * `rollFrom` (a roll that lands at once) it happens now.
 */
export function whenLanded(effect: () => void): void {
  if (making === null) effect();
  else making.push(effect);
}

/**
 * The attack damage rolled now goes with: the newest roll in the log past the
 * damage and plain dice rolled after it (a superiority die may add to that
 * damage). Any other roll (a check, a heal) lets it go, and so does an attack
 * still waiting in the prompt, whose d20 is not rolled yet. A crit there
 * doubles the dice of the damage that goes with it (`RollChip` `withAttack`).
 */
export function attackInPlay(): AttackMark | undefined {
  if (heldRollStore.getState().held !== null) return undefined;
  const last = rollLogStore
    .getState()
    .rolls.find((r) => r.kind !== 'damage' && (r.kind !== undefined || r.meta?.d20 !== undefined));
  return last?.meta?.attack;
}

/** "Doubled" dice as a crit rolls them: "1d12+4" reads "2d12+4". */
export function critDice(expr: string): string {
  return expr.replace(
    /(\d*)d(\d+)/g,
    (_, n: string, sides: string) => `${2 * Number(n || 1)}d${sides}`,
  );
}

/**
 * Every roll a player taps on the sheet lands here. `make` rolls it, or asks
 * about a d20 test (`d20Ask`), and `onLanded` is what the control does once it
 * lands, after the log has it. `from` is the control: tapped again while its
 * roll waits, it rolls.
 *
 * A d20 test waits in the prompt, in place of any roll already waiting, with
 * the control's look for its header (`face`) and what a hit offers after it
 * (`afterHit`). Damage that goes with an attack (`joins`: a weapon's, its
 * riders', Sneak Attack's), tapped while one waits, joins it unrolled.
 * Anything else lands at once, a save's damage or a spell cast included, and
 * the roll that waited is let go. What `make` puts off (`whenLanded`) waits
 * with it.
 */
export function rollFrom(
  from: HTMLElement | null,
  make: () => RollResult | D20Ask,
  onLanded?: Landed,
  {
    face,
    afterHit,
    joins,
  }: { face?: RollFace; afterHit?: FollowUp; joins?: { label: string } | undefined } = {},
): void {
  const { held } = heldRollStore.getState();
  if (held !== null && from !== null && held.from === from) {
    rollHeld();
    return;
  }
  if (held?.ask.attack && joins !== undefined) {
    // Made once the attack lands, so a crit there doubles it.
    join(held, make as () => RollResult, onLanded, joins.label);
    return;
  }
  const { value, effects } = made(make);
  if (isD20Ask(value)) {
    heldRollStore.setState((s) => ({
      seq: s.seq + 1,
      held: {
        seq: s.seq + 1,
        ask: value,
        onLanded,
        effects,
        from,
        face,
        mode: value.preset,
        rollsIn: value.rollsIn.map(() => true),
        named: value.once.map(() => false),
        damage: [],
        afterHit,
      },
    }));
    const why = value.cueFor(value.preset);
    announce(`${value.label}${why === '' ? '' : `. ${why}`}. Choose, then Roll.`, {
      key: 'roll',
      repeat: true,
    });
    return;
  }
  // Landing lets the waiting roll go (the log's listener below).
  land({ result: value, onLanded, effects });
}

/** Damage that waits with the attack, made once it lands. */
function join(held: HeldRoll, make: () => RollResult, onLanded: Landed | undefined, label: string) {
  heldRollStore.setState({ held: { ...held, damage: [...held.damage, { make, onLanded }] } });
  announce(`${label} rolls with the attack.`, { key: 'roll', repeat: true });
}

/** Picks the waiting roll's mode. */
export function setHeldMode(mode: RollMode): void {
  const { held } = heldRollStore.getState();
  if (held !== null && held.mode !== mode) heldRollStore.setState({ held: { ...held, mode } });
}

/** Leaves a die that rolls in (Bless) out of the waiting roll, or puts it back. */
export function toggleHeldRollIn(index: number): void {
  const { held } = heldRollStore.getState();
  if (held === null || held.ask.rollsIn[index] === undefined) return;
  const rollsIn = [...held.rollsIn];
  rollsIn[index] = !rollsIn[index];
  heldRollStore.setState({ held: { ...held, rollsIn } });
}

/** Adds a one-use die to the waiting roll, or takes it back. */
export function nameHeldDie(index: number): void {
  const { held } = heldRollStore.getState();
  if (held === null || held.ask.once[index] === undefined) return;
  const named = [...held.named];
  named[index] = !named[index];
  heldRollStore.setState({ held: { ...held, named } });
}

/** Lets the waiting roll go unrolled, and any damage with it. */
export function cancelHeld(): void {
  if (heldRollStore.getState().held !== null) heldRollStore.setState({ held: null });
}

/**
 * The waiting roll lands, under the prompt's choices: the one-use dice added
 * roll in and are spent. Damage that joined it is made next, in the order
 * tapped, and lands marked as going with it. A hit with nothing joined offers
 * its damage (`afterHit`), unless a natural 1 or an automatic failure settled it.
 */
export function rollHeld(): void {
  const { held } = heldRollStore.getState();
  if (held === null) return;
  heldRollStore.setState({ held: null });
  const id = crypto.randomUUID();
  const result: RollResult = {
    ...held.ask.roll({
      mode: held.mode,
      rollsIn: held.rollsIn,
      named: held.named,
      dropUnnamed: rollOffersStore.getState().before,
    }),
    id,
  };
  const spent = held.ask.once.flatMap((o, i) =>
    held.named[i] === true && o.effectId !== undefined ? [o.effectId] : [],
  );
  land({
    result,
    onLanded: held.onLanded,
    effects: [
      ...held.effects,
      ...spent.map((effectId) => () => rollOffersStore.getState().spend?.(effectId, true)),
    ],
  });
  for (const d of held.damage) {
    const { value, effects } = made(d.make);
    land({
      result: { ...value, meta: { ...value.meta, withRoll: id } },
      onLanded: d.onLanded,
      effects,
    });
  }
  const missed = result.meta?.autoFail === true || result.meta?.d20?.natural === 1;
  if (held.afterHit !== undefined && held.damage.length === 0 && !missed) {
    const crit = result.meta?.attack?.crit === true;
    followUpStore.setState({
      offer: {
        id,
        expr: crit ? critDice(held.afterHit.expr) : held.afterHit.expr,
        go: held.afterHit.go,
        from: held.from,
      },
    });
  }
}

// A roll that lands from anywhere else (the dice tray, the Build page) lets
// the waiting one go: the toast is for the newest roll.
rollLogStore.subscribe((state, prev) => {
  if (state.seq !== prev.seq) cancelHeld();
});
