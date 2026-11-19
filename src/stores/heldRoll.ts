import { createStore } from 'zustand/vanilla';
import { roll } from '@/dice/roll';
import type { RollOffer, RollResult } from '@/dice/types';
import type { D20Ask, RollMode, TurnExtra } from '@/features/sheet/d20Tests';
import type { ChipWear } from '@/ui/ChipFace';
import { announce } from './announcer';
import { rollLogStore } from './rollLog';
import { rollOffersStore } from './rollOffers';

/**
 * The roll prompt (the rolls canvas, picked 2026-11-09): every d20 test the
 * sheet makes waits here before its d20 is rolled. The toast's place shows it
 * with what the sheet sets (the mode, and why), the dice that roll in (Bless),
 * the one-use dice that may be added first (2014 Guidance and Bardic
 * Inspiration), and what may be declared for the turn (Reckless Attack, which
 * goes in play as the roll lands). Roll, or the same control tapped again,
 * rolls it.
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

/**
 * One-use dice that do not wait for a failure, or for the d20 to show (a flat
 * bonus): the ones the prompt offers before the roll.
 */
export function namedFirst(offer: RollOffer): boolean {
  return offer.once && !offer.ifFailed && offer.after !== true;
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
  /** With `lift`: an effect lowered it, so it wears the red edge. */
  down?: boolean | undefined;
  /** A chip's colour when it is not the roll blue: damage, healing, or Cast's outline. */
  tone?: 'danger' | 'heal' | 'cast' | undefined;
}

/**
 * One way to cast, as the prompt's tile draws it (`castWays`): its level, what
 * is left or what it costs under it, and whether it can pay now.
 */
export interface CastTileView {
  id: string;
  /** "1st", "3rd". */
  head: string;
  sub: string;
  ok: boolean;
  /** Its accessible name: what it spends and what is left. */
  aria: string;
}

/** The tiles of one source, under its heading ("Spell slots", "Staff of Healing"). */
export interface CastGroupView {
  title: string;
  sub?: string | undefined;
  tiles: readonly CastTileView[];
}

/** What a spell rolls at a level: its chip's dice, or its damage after a hit. */
export interface CastDice {
  expr: string;
  label: string;
  kind: 'damage' | 'heal' | undefined;
  /** Damage riding on an attack that crit, asked as it rolls: its dice roll twice (a smite). */
  crit?: boolean;
}

/**
 * A spell cast from the prompt (the rolls canvas, "Level at cast" A): every
 * way to cast it as tiles by source, and what the tile picked does. The cast
 * spends it as the roll lands, or as Cast is pressed for a spell with no dice.
 */
export interface HeldCast {
  /** The row it is cast from, so that row alone refreshes it (`refreshHeldCast`). */
  id: string;
  spell: string;
  /**
   * What the prompt calls doing it, when it is no spell: Use for a feature paid with
   * a slot (Divine Smite), Restore for a use bought back with one. Absent: Cast.
   */
  verb?: 'Use' | 'Restore';
  groups: readonly CastGroupView[];
  /** The tile it starts on: null when nothing can pay, and the cast spends nothing. */
  picked: string | null;
  /** The note by Roll: what the tile spends. */
  note: (id: string | null) => string;
  /**
   * The spell's dice at the tile's level: what Roll rolls with no d20, or the
   * damage a spell attack's hit offers. None for a spell with no dice. With
   * `label`, the spell's roll of that label (Ice Knife's cold damage, tapped
   * while its attack waits).
   */
  dice: (id: string | null, label?: string) => CastDice | undefined;
  /** The dice in words at the tile's level, under the label. */
  line: (id: string | null) => string | undefined;
  /** Spends what the tile says and marks the cast. */
  cast: (id: string | null) => void;
}

/** What a hit offers after it lands: its damage, rolled as the damage chip would. */
export interface FollowUp {
  /** The damage's dice as its chip shows them ("1d12+4"). */
  expr: string;
  go: () => void;
  /**
   * The damage prompt its `go` opens. Damage tapped while the attack waits
   * (`damageFrom`) asks with its own once the attack lands as a hit.
   */
  ask?: (() => DamageAsk) | undefined;
}

/**
 * The next attack of the Attack action (Extra Attack), offered once an attack
 * misses or its damage lands: what the button says, and the prompt it opens.
 */
export interface NextAttack {
  /** "Attack 2 of 2". */
  words: string;
  go: () => void;
}

/**
 * One more roll the damage prompt offers beside the weapon's own: a rider the
 * weapon carries (Flame Tongue's fire), a feature or effect the character may
 * add (Sneak Attack, Divine Smite, Bardic Inspiration), or what the player put
 * on the weapon (a coated blade, a special arrow).
 */
export interface DamageExtra {
  /** Its place in the prompt, unique while it waits. */
  key: string;
  dice: string;
  /** What adds it: "Flame Tongue", "Sneak Attack", "Basic Poison". */
  source: string;
  damageType?: string | undefined;
  /** How its roll is logged when it lands apart: "Longsword fire damage", "Sneak Attack". */
  label: string;
  /**
   * `rider`: the weapon's own, on to start, as Bless rolls in. `add`: the
   * character's to add, off to start. `own`: the player's, on to start.
   */
  kind: 'rider' | 'add' | 'own';
  /**
   * Its dice roll in the weapon's own roll, named, rather than apart: damage of
   * the weapon's type (Sneak Attack, Enlarge), which takes resistance with it.
   */
  folds?: boolean | undefined;
  /** What it says beside its name: "rolls in", "once a turn", "slot", "next hit". */
  tag: string;
  /** When it holds or what it pays, said under the extras while it is on. */
  note?: string | undefined;
  /** Its once a turn went already (it is still yours to add: the sheet cannot see whose turn). */
  usedThisTurn?: boolean | undefined;
  /** Its dice roll once on a crit (a poison's flat dice the player said do not double). */
  noCrit?: boolean | undefined;
  /** Pays for it as the roll lands; false, with nothing left to pay with, leaves it out. */
  pay?: (() => boolean) | undefined;
  /** Paid with a spell slot (2014 Divine Smite): its tiles, built as it is put on. */
  slot?: (() => HeldCast) | undefined;
  /** A slot-paid spell's roll of this label, at the tile's level ("Searing Smite fire damage"). */
  diceLabel?: string | undefined;
  /**
   * The extra it rides on, by key: rolled only with that one on, and shown only
   * then (Divine Smite's d8 against a Fiend or Undead).
   */
  needs?: string | undefined;
  /** Whether it starts on, when not as its kind does (Savage Attacker, a used 2014 smite). */
  on?: boolean | undefined;
  /**
   * It rolls the weapon's own dice twice and keeps the higher total (Savage
   * Attacker), rather than dice of its own.
   */
  best?: boolean | undefined;
  /** Takes the player's own extra off the weapon for good. */
  remove?: (() => void) | undefined;
}

/** What the player types into the damage prompt to add (a poison, an arrow's extra). */
export interface OwnDamage {
  source: string;
  dice: string;
  damageType?: string | undefined;
  /** Gone once the next hit lands, or kept on the weapon until taken off. */
  once: boolean;
  /** Its dice roll twice on a crit, as the weapon's do. */
  crit: boolean;
  note?: string | undefined;
}

/**
 * A damage roll asked about before it is rolled (the damage prompt): the
 * weapon's dice and what is in them, whether the attack crit, and the extras
 * the character may roll with it.
 */
export interface DamageAsk {
  readonly kind: 'damage';
  /** "Longsword damage". */
  label: string;
  /** The weapon's own dice and modifiers ("1d8+3"). */
  expr: string;
  damageType?: string | undefined;
  /** What the modifiers are, in words ("STR +3, Rage +2"), '' when it says nothing. */
  parts: string;
  /** The attack it goes with crit: every die rolls twice, the modifiers once. */
  crit: boolean;
  /** More dice a crit adds, after the weapon's (Savage Attacks). */
  critDice?: { dice: string; source: string } | undefined;
  extras: readonly DamageExtra[];
  /**
   * Makes what the player typed an extra: kept on the weapon, or for this roll
   * alone when there is no weapon to keep it on (a spell's damage).
   */
  addOwn?: ((own: OwnDamage) => DamageExtra) | undefined;
  /** Whether what the player types can stay on the weapon. */
  keeps?: boolean | undefined;
  /** The next attack of the Attack action, asked once the damage lands. */
  next?: (() => NextAttack | undefined) | undefined;
  /** The attack it follows, in words, set as the prompt opens: "Longsword attack: 17". */
  after?: string | undefined;
  /**
   * A reroll of the weapon's own dice the result offers once it shows, the
   * higher total kept (2014 Savage Attacker, once a turn), and what paying for
   * it marks.
   */
  reroll?: { source: string; pay: () => void; used?: boolean | undefined } | undefined;
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
  /** The d20 test asked about; null for a cast with no d20 (Cure Wounds, Fireball, Bless). */
  ask: D20Ask | null;
  /** The spell this roll casts, with its ways to cast. */
  cast: HeldCast | undefined;
  /** The way to cast picked (`cast`'s tile id). */
  picked: string | null;
  onLanded: Landed | undefined;
  /** Side effects of asking that wait for the roll to land (`whenLanded`). */
  effects: Array<() => void>;
  /** The control that rolled it: tapped again it rolls, and focus goes back there. */
  from: HTMLElement | null;
  face: RollFace | undefined;
  /**
   * The prompt's choices: the mode, the dice that roll in left in, the one-use
   * dice added, what is declared for the turn.
   */
  mode: RollMode;
  rollsIn: boolean[];
  named: boolean[];
  declared: boolean[];
  /** Which of the ask's foretold numbers is the d20 (Portent), or none. */
  foretold: number | null;
  /**
   * Damage tapped while an attack waits, in order: made once the attack has
   * landed, so a crit doubles it, and landed with it. The cast spell's own
   * damage (`ofCast`) is made at the level picked, by its label.
   */
  damage: Array<{
    make: () => RollResult;
    onLanded: Landed | undefined;
    label: string;
    ofCast: boolean;
  }>;
  afterHit: FollowUp | undefined;
  /** The next attack of the Attack action, offered if this attack misses. */
  next?: (() => NextAttack | undefined) | undefined;
  /**
   * A damage prompt waiting (`damageFrom`): the weapon's damage and its
   * extras, which of them are on (`hitOn`). A slot-paid extra put on brings its
   * tiles as `cast`, paid as the damage lands.
   */
  hit: DamageAsk | null;
  hitOn: boolean[];
  /**
   * Damage tapped while this attack waits, which asks once it lands as a hit
   * (or rolls with it at once, when there is nothing to choose).
   */
  queued?:
    | {
        make: () => DamageAsk;
        onLanded: Landed | undefined;
        face: RollFace | undefined;
        from: HTMLElement | null;
        /** The attack it goes with, by name, and its label: a cast spell's own damage is asked at the level picked. */
        of?: string | undefined;
        label?: string | undefined;
      }
    | undefined;
}

export const heldRollStore = createStore<{ held: HeldRoll | null; seq: number }>(() => ({
  held: null,
  seq: 0,
}));

/** The damage a hit just landed offers, until it is rolled or another roll offers its own. */
export const followUpStore = createStore<{
  /** `from`: the attack's control, where focus goes back once the damage is rolled. */
  offer: { id: string; expr: string; go: () => void; from: HTMLElement | null } | null;
  /** The next attack of the Attack action, offered on the roll `id` (a miss, or the damage). */
  next?: { id: string; words: string; go: () => void; from: HTMLElement | null } | null;
  /**
   * A reroll of the weapon's dice the roll `id` offers (2014 Savage Attacker):
   * on the damage `target`, itself or shown under its attack. Its first
   * `terms` are the weapon's own, coming to `total`, and `weapon` rolls them
   * again.
   */
  reroll?: {
    id: string;
    target: string;
    /** Its once a turn went already: offered still, and said (the sheet cannot see whose turn). */
    used?: boolean | undefined;
    source: string;
    terms: number;
    total: number;
    weapon: () => RollResult;
    pay: () => void;
  } | null;
}>(() => ({ offer: null, next: null, reroll: null }));

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
  return attackRollInPlay()?.meta?.attack;
}

/** The roll `attackInPlay` reads: the newest past damage and plain dice, while no d20 waits. */
function attackRollInPlay(): RollResult | undefined {
  // A damage or cast prompt waiting has no d20: the attack before it is still in play.
  const waiting = heldRollStore.getState().held?.ask;
  if (waiting !== null && waiting !== undefined) return undefined;
  const last = rollLogStore
    .getState()
    .rolls.find((r) => r.kind !== 'damage' && (r.kind !== undefined || r.meta?.d20 !== undefined));
  return last?.meta?.attack === undefined ? undefined : last;
}

/**
 * The newest attack that landed from the prompt, and its next attack in the
 * Attack action: the damage that goes with it offers that next attack once it
 * lands, from the chip or the hit's offer alike.
 */
let lastAttack: { id: string; next: (() => NextAttack | undefined) | undefined } | null = null;

/** The next attack after the attack in play, when the damage goes with the newest one. */
function nextAfterAttackInPlay(): (() => NextAttack | undefined) | undefined {
  const r = attackRollInPlay();
  return r?.id !== undefined && r.id === lastAttack?.id ? lastAttack.next : undefined;
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
    cast,
    next,
  }: {
    face?: RollFace;
    afterHit?: FollowUp;
    /** The next attack of the Attack action, offered if this attack misses (`NextAttack`). */
    next?: (() => NextAttack | undefined) | undefined;
    /** `of`: the attack it goes with, by name, so the cast spell's own damage is made at its level. */
    joins?: { label: string; of?: string | undefined } | undefined;
    /** The spell an attack casts (a spell attack): its ways to cast join the prompt. */
    cast?: HeldCast | undefined;
  } = {},
): void {
  const { held } = heldRollStore.getState();
  // The same control again rolls what it asked; an attack chip tapped while its
  // hit's damage waits makes a new attack instead.
  if (held !== null && from !== null && held.from === from && held.hit === null) {
    rollHeld();
    return;
  }
  if (held?.ask?.attack === true && joins !== undefined) {
    // Made once the attack lands, so a crit there doubles it.
    const ofCast = held.cast !== undefined && joins.of === held.cast.spell;
    join(held, make as () => RollResult, onLanded, joins.label, ofCast);
    return;
  }
  const { value, effects } = made(make);
  if (isD20Ask(value)) {
    heldRollStore.setState((s) => ({
      seq: s.seq + 1,
      held: {
        seq: s.seq + 1,
        ask: value,
        cast,
        picked: cast?.picked ?? null,
        onLanded,
        effects,
        from,
        face,
        mode: value.preset,
        rollsIn: value.rollsIn.map(() => true),
        named: value.once.map(() => false),
        declared: value.thisTurn.map(() => false),
        foretold: null,
        damage: [],
        afterHit,
        next,
        hit: null,
        hitOn: [],
      },
    }));
    const why = value.cueFor(value.preset);
    const cost = cast === undefined ? '' : ` ${cast.note(cast.picked)}`;
    announce(`${value.label}${why === '' ? '' : `. ${why}`}.${cost} Choose, then Roll.`, {
      key: 'roll',
      repeat: true,
    });
    return;
  }
  // Landing lets the waiting roll go (the log's listener below).
  land({ result: value, onLanded, effects });
}

/**
 * A spell with no d20 to roll, cast from the prompt: Cure Wounds' healing,
 * Fireball's damage, Bless with nothing to roll. It waits with its ways to
 * cast; Roll (or Heal, or Cast), or the same control tapped again, spends the
 * tile picked and rolls the dice at its level. `onLanded` is what the control
 * does with that roll.
 */
export function castFrom(
  from: HTMLElement | null,
  cast: HeldCast,
  onLanded?: Landed,
  { face }: { face?: RollFace } = {},
): void {
  const { held } = heldRollStore.getState();
  if (held !== null && from !== null && held.from === from) {
    rollHeld();
    return;
  }
  heldRollStore.setState((s) => ({
    seq: s.seq + 1,
    held: {
      seq: s.seq + 1,
      ask: null,
      cast,
      picked: cast.picked,
      onLanded,
      effects: [],
      from,
      face,
      mode: 'normal',
      rollsIn: [],
      named: [],
      declared: [],
      foretold: null,
      damage: [],
      afterHit: undefined,
      hit: null,
      hitOn: [],
    },
  }));
  // The word the prompt's button says (RollToast's go word).
  const dice = cast.dice(cast.picked);
  const verb = cast.verb ?? 'Cast';
  const go = dice === undefined ? verb : dice.kind === 'heal' ? 'Heal' : 'Roll';
  announce(`${verb} ${cast.spell}. ${cast.note(cast.picked)} Choose, then ${go}.`, {
    key: 'roll',
    repeat: true,
  });
}

/**
 * A weapon's damage, asked before it is rolled (the damage prompt): its dice
 * and what is in them, whether the attack crit, the riders that roll in, and
 * what the character may add. Roll, or the same control tapped again, rolls
 * it. Tapped while an attack waits, it asks once that attack lands as a hit,
 * with the crit known; with nothing to choose it rolls with the attack then.
 */
export function damageFrom(
  from: HTMLElement | null,
  make: () => DamageAsk,
  onLanded?: Landed,
  {
    face,
    of,
    label,
  }: {
    face?: RollFace;
    /** The attack it goes with, by name, and its label (a spell's own damage, `queued`). */
    of?: string | undefined;
    label?: string | undefined;
  } = {},
): void {
  const { held } = heldRollStore.getState();
  if (held !== null && from !== null && held.from === from) {
    rollHeld();
    return;
  }
  if (held?.ask?.attack === true) {
    heldRollStore.setState({
      held: { ...held, queued: { make, onLanded, face, from, of, label } },
    });
    announce('Damage asks once the attack hits.', { key: 'roll', repeat: true });
    return;
  }
  holdDamage(from, make(), onLanded, face);
}

/** Can the damage prompt ask anything: an extra to add? */
export function asksAnything(ask: DamageAsk): boolean {
  return ask.extras.some((x) => x.kind === 'add');
}

/** Does an extra start on: as its kind does (a rider, the player's own), unless it says. */
export function startsOn(x: DamageExtra): boolean {
  return x.on ?? x.kind !== 'add';
}

/** The damage prompt opens with `ask`, in place of any roll waiting. */
function holdDamage(
  from: HTMLElement | null,
  ask: DamageAsk,
  onLanded: Landed | undefined,
  face: RollFace | undefined,
): void {
  heldRollStore.setState((s) => ({
    seq: s.seq + 1,
    held: {
      seq: s.seq + 1,
      ask: null,
      cast: undefined,
      picked: null,
      onLanded,
      effects: [],
      from,
      face,
      mode: 'normal',
      rollsIn: [],
      named: [],
      declared: [],
      foretold: null,
      damage: [],
      afterHit: undefined,
      hit: ask,
      hitOn: ask.extras.map(startsOn),
    },
  }));
  const after = ask.after === undefined ? '' : `${ask.after}. `;
  const crit = ask.crit ? 'Critical hit: every damage die rolls twice. ' : '';
  announce(`${after}${ask.label}. ${crit}Choose, then Roll.`, { key: 'roll', repeat: true });
}

/**
 * Puts an extra on the waiting damage roll, or takes it off. A slot-paid one
 * (Divine Smite) brings its tiles, and takes another slot-paid one's place.
 */
export function toggleHeldExtra(index: number): void {
  const { held } = heldRollStore.getState();
  const hit = held?.hit;
  const extra = hit?.extras[index];
  if (held === null || hit === null || hit === undefined || extra === undefined) return;
  const on = held.hitOn[index] !== true;
  const hitOn = held.hitOn.map((v, i) =>
    i === index
      ? on
      : on && extra.slot !== undefined && hit.extras[i]?.slot !== undefined
        ? false
        : v,
  );
  if (extra.slot === undefined) {
    heldRollStore.setState({ held: { ...held, hitOn } });
    return;
  }
  const cast = on ? extra.slot() : undefined;
  heldRollStore.setState({ held: { ...held, hitOn, cast, picked: cast?.picked ?? null } });
}

/** Adds what the player typed to the waiting damage roll, on, kept on the weapon when it can be. */
export function addHeldDamage(own: OwnDamage): void {
  const { held } = heldRollStore.getState();
  const hit = held?.hit;
  if (held === null || hit === null || hit === undefined || hit.addOwn === undefined) return;
  const extra = hit.addOwn(own);
  heldRollStore.setState({
    held: {
      ...held,
      hit: { ...hit, extras: [...hit.extras, extra] },
      hitOn: [...held.hitOn, true],
    },
  });
  announce(`${extra.source} added, +${extra.dice}.`, { key: 'roll', repeat: true });
}

/** Takes the player's own extra off the weapon, and out of the waiting roll. */
export function removeHeldExtra(index: number): void {
  const { held } = heldRollStore.getState();
  const hit = held?.hit;
  const extra = hit?.extras[index];
  if (held === null || hit === null || hit === undefined || extra?.remove === undefined) return;
  extra.remove();
  heldRollStore.setState({
    held: {
      ...held,
      hit: { ...hit, extras: hit.extras.filter((_, i) => i !== index) },
      hitOn: held.hitOn.filter((_, i) => i !== index),
    },
  });
  announce(`${extra.source} taken off.`, { key: 'roll', repeat: true });
}

/** A roll with dice of its own added after its terms, named for what adds them. */
export function withDice(
  result: RollResult,
  dice: string,
  source: string,
  critical = false,
): RollResult {
  const added = roll(dice, critical ? { critical: true } : {});
  return {
    ...result,
    total: result.total + added.total,
    terms: [...result.terms, ...added.terms],
    meta: {
      ...result.meta,
      from: [
        ...(result.meta?.from ?? []),
        ...added.terms.flatMap((t, i) =>
          t.kind === 'dice' ? [{ term: result.terms.length + i, source }] : [],
        ),
      ],
    },
  };
}

/**
 * The damage the prompt asked about, rolled under what it chose: the weapon's
 * dice (twice on a crit, with the crit's own dice after), the extras of its
 * type rolled in it, named, and the rest apart, in order. An extra that cannot
 * be paid now stays out; a slot-paid one rolls its dice at the tile picked and
 * spends it. Every roll after the first goes with it (`meta.withRoll`), or
 * with the attack `withRoll` when it rolled with one.
 */
/** The weapon's own damage: its dice twice on a crit, the crit's own dice after (Savage Attacks). */
function weaponRoll(hit: DamageAsk): RollResult {
  const r = roll(hit.expr, {
    label: hit.label,
    kind: 'damage',
    ...(hit.crit ? { critical: true } : {}),
  });
  return hit.crit && hit.critDice !== undefined
    ? withDice(r, hit.critDice.dice, hit.critDice.source)
    : r;
}

function rollDamage(
  hit: DamageAsk,
  on: readonly boolean[],
  cast: HeldCast | undefined,
  picked: string | null,
  withRoll?: string,
): { rolls: RollResult[]; weapon: { terms: number; total: number } } {
  const id = crypto.randomUUID();
  const weapon = () => weaponRoll(hit);
  let head: RollResult = { ...weapon(), id };
  // The weapon's own dice twice, the higher kept (Savage Attacker); the extras roll once.
  const best = hit.extras.find((x, i) => on[i] === true && x.best === true);
  if (best !== undefined && (best.pay === undefined || best.pay())) {
    const other = weapon();
    const kept = other.total > head.total ? other : head;
    head = {
      ...kept,
      id,
      meta: {
        ...kept.meta,
        cue: `${best.source}: rolled ${String(head.total)} and ${String(other.total)}, kept ${String(kept.total)}`,
      },
    };
  }
  // The weapon's own part, before the extras of its type roll into it: what a reroll replaces.
  const weaponPart = { terms: head.terms.length, total: head.total };
  const apart: RollResult[] = [];
  const isOn = (key: string) => hit.extras.some((y, j) => y.key === key && on[j] === true);
  hit.extras.forEach((x, i) => {
    if (on[i] !== true || x.best === true) return;
    if (x.needs !== undefined && !isOn(x.needs)) return;
    const twice = hit.crit && x.noCrit !== true;
    if (x.slot !== undefined) {
      const dice = cast?.dice(picked, x.diceLabel) ?? cast?.dice(picked);
      if (cast === undefined || picked === null || dice === undefined) return;
      cast.cast(picked);
      apart.push(
        roll(dice.expr, { label: x.label, kind: 'damage', ...(twice ? { critical: true } : {}) }),
      );
      return;
    }
    if (x.pay !== undefined && !x.pay()) return;
    if (x.folds === true) head = withDice(head, x.dice, x.source, twice);
    else
      apart.push(
        roll(x.dice, { label: x.label, kind: 'damage', ...(twice ? { critical: true } : {}) }),
      );
  });
  const goesWith = withRoll ?? id;
  const rolls = [
    withRoll === undefined ? head : { ...head, meta: { ...head.meta, withRoll } },
    ...apart.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      meta: { ...r.meta, withRoll: goesWith },
    })),
  ];
  return { rolls, weapon: weaponPart };
}

/** Offers the next attack of the Attack action on the roll `id`, if one is left. */
function offerNext(
  next: (() => NextAttack | undefined) | undefined,
  id: string | undefined,
  from: HTMLElement | null,
): void {
  const n = next?.();
  if (n === undefined || id === undefined) return;
  followUpStore.setState({ next: { id, words: n.words, go: n.go, from } });
}

/** Damage that waits with the attack, made once it lands. */
function join(
  held: HeldRoll,
  make: () => RollResult,
  onLanded: Landed | undefined,
  label: string,
  ofCast: boolean,
) {
  heldRollStore.setState({
    held: { ...held, damage: [...held.damage, { make, onLanded, label, ofCast }] },
  });
  announce(`${label} rolls with the attack.`, { key: 'roll', repeat: true });
}

/** Picks the way the waiting cast spends, when it can pay. */
export function pickHeldTile(id: string): void {
  const { held } = heldRollStore.getState();
  const tile = held?.cast?.groups.flatMap((g) => g.tiles).find((t) => t.id === id);
  if (held === null || tile === undefined || !tile.ok || held.picked === id) return;
  heldRollStore.setState({ held: { ...held, picked: id } });
}

/**
 * Rebuilds the waiting cast from row `id` with what is left now: a slot spent
 * on the sheet behind the prompt, or a long rest, changes its tiles. A tile
 * the player picked stays while it can still pay; otherwise the cast takes the
 * start tile now, so Roll never spends what the character no longer has, and
 * an unchosen cast never reaches past a slot that came back.
 */
export function refreshHeldCast(id: string, make: () => HeldCast): void {
  const { held } = heldRollStore.getState();
  if (held?.cast?.id !== id) return;
  const cast = make();
  const chosen = held.picked !== held.cast.picked;
  const stays =
    chosen && cast.groups.some((g) => g.tiles.some((t) => t.id === held.picked && t.ok));
  heldRollStore.setState({ held: { ...held, cast, picked: stays ? held.picked : cast.picked } });
}

/**
 * Lets the cast from row `id` go unrolled: the row has gone from the screen,
 * or has nothing left to cast with, so nothing keeps its tiles true.
 */
export function cancelHeldCast(id: string): void {
  if (heldRollStore.getState().held?.cast?.id === id) heldRollStore.setState({ held: null });
}

/** A cast spell's dice at its level: twice the dice on a crit. */
function rollCastDice(dice: CastDice, crit: boolean): RollResult {
  return roll(dice.expr, {
    label: dice.label,
    kind: dice.kind,
    ...(crit ? { critical: true } : {}),
  });
}

/** Picks the waiting roll's mode. */
export function setHeldMode(mode: RollMode): void {
  const { held } = heldRollStore.getState();
  if (held !== null && held.mode !== mode) heldRollStore.setState({ held: { ...held, mode } });
}

/** Leaves a die that rolls in (Bless) out of the waiting roll, or puts it back. */
export function toggleHeldRollIn(index: number): void {
  const { held } = heldRollStore.getState();
  if (held === null || held.ask?.rollsIn[index] === undefined) return;
  const rollsIn = [...held.rollsIn];
  rollsIn[index] = !rollsIn[index];
  heldRollStore.setState({ held: { ...held, rollsIn } });
}

/** Adds a one-use die to the waiting roll, or takes it back. */
export function nameHeldDie(index: number): void {
  const { held } = heldRollStore.getState();
  if (held === null || held.ask?.once[index] === undefined) return;
  const named = [...held.named];
  named[index] = !named[index];
  heldRollStore.setState({ held: { ...held, named } });
}

/**
 * Declares something for the turn on the waiting roll (Reckless Attack), or
 * takes it back: the mode goes back to what the sheet sets with it counted.
 */
export function declareHeld(index: number): void {
  const { held } = heldRollStore.getState();
  const ask = held?.ask;
  if (held === null || ask === null || ask === undefined || ask.thisTurn[index] === undefined)
    return;
  const declared = [...held.declared];
  declared[index] = !declared[index];
  heldRollStore.setState({ held: { ...held, declared, mode: ask.presetFor({ declared }) } });
}

/**
 * A claim for this roll that gives its mode and nothing else (2014 Inspiration,
 * Tides of Chaos): a foretold number in place of the d20 leaves it nothing to give.
 */
export function modeAlone(t: TurnExtra): boolean {
  return t.thisRoll === true && t.mode !== undefined && t.bonus === undefined;
}

/** Puts a foretold number in place of the waiting roll's d20 (Portent), or takes it back. */
export function foretellHeld(index: number): void {
  const { held } = heldRollStore.getState();
  if (held === null || held.ask?.foretold[index] === undefined) return;
  heldRollStore.setState({ held: { ...held, foretold: held.foretold === index ? null : index } });
}

/** Lets the waiting roll go unrolled, and any damage with it. */
export function cancelHeld(): void {
  if (heldRollStore.getState().held !== null) heldRollStore.setState({ held: null });
}

/**
 * The waiting roll lands, under the prompt's choices: the one-use dice added
 * roll in and are spent, and a cast spends its tile, hit or miss. Damage that
 * joined it is made next, in the order tapped, and lands marked as going with
 * it. A hit with nothing joined offers its damage (`afterHit`, or the spell's
 * at the level cast), unless a natural 1 or an automatic failure settled it. A
 * cast with no d20 rolls its dice at the level picked, if it has any.
 */
export function rollHeld(): void {
  const { held } = heldRollStore.getState();
  if (held === null) return;
  heldRollStore.setState({ held: null });
  const id = crypto.randomUUID();
  const { ask, cast, picked } = held;
  if (held.hit !== null) {
    landDamage(held.hit, held.hitOn, cast, picked, held.onLanded, held.from);
    return;
  }
  if (ask === null) {
    const dice = cast?.dice(picked);
    if (dice !== undefined) {
      land({
        result: { ...rollCastDice(dice, dice.crit === true), id },
        onLanded: held.onLanded,
        effects: held.effects,
      });
    }
    cast?.cast(picked);
    return;
  }
  // A feature's own die or claim is paid for as its Use is, before the d20:
  // one that cannot be paid now (its last use or the reaction went while the
  // prompt waited) stays out of the roll.
  const { pay } = rollOffersStore.getState();
  const named = held.named.map((on, i) => {
    const o = ask.once[i];
    return on && (o?.pay === undefined || pay?.(o, true) === true);
  });
  // A foretold number is paid for (its use, and the number) or the d20 is rolled.
  const told = held.foretold === null ? undefined : ask.foretold[held.foretold];
  const foretold =
    told !== undefined && pay?.({ source: told.source, pay: told.pay }, true) === true
      ? held.foretold
      : null;
  // With no d20 rolled, a claim of the mode alone gives nothing, so it is not paid.
  const isDeclared = held.declared.map((on, i) => {
    const extra = ask.thisTurn[i];
    if (foretold !== null && extra !== undefined && modeAlone(extra)) return false;
    const paid = extra?.paid;
    return on && (paid === undefined || paid());
  });
  // A claim left out takes its advantage with it, unless the mode was picked by hand.
  const dropped = isDeclared.some((on, i) => on !== held.declared[i]);
  const mode =
    dropped && held.mode === ask.presetFor({ declared: held.declared })
      ? ask.presetFor({ declared: isDeclared })
      : held.mode;
  const result: RollResult = {
    ...ask.roll({
      mode,
      rollsIn: held.rollsIn,
      named,
      declared: isDeclared,
      dropUnnamed: rollOffersStore.getState().before,
      ...(foretold !== null ? { foretold } : {}),
    }),
    id,
  };
  const spent = ask.once.flatMap((o, i) =>
    named[i] === true && o.effectId !== undefined ? [o.effectId] : [],
  );
  const declared = ask.thisTurn.filter((_, i) => isDeclared[i] === true);
  land({
    result,
    onLanded: held.onLanded,
    effects: [
      ...held.effects,
      ...spent.map((effectId) => () => rollOffersStore.getState().spend?.(effectId, true)),
      ...declared.map((d) => d.declare),
    ],
  });
  cast?.cast(picked);
  const crit = result.meta?.attack?.crit === true;
  const castDamage = cast?.dice(picked);
  for (const d of held.damage) {
    // The spell's own damage, at the level picked; its chip's dice when the
    // spell has no roll of that label.
    const own = d.ofCast ? cast?.dice(picked, d.label) : undefined;
    const make = own !== undefined ? () => rollCastDice(own, crit) : d.make;
    const { value, effects } = made(make);
    land({
      result: { ...value, meta: { ...value.meta, withRoll: id } },
      onLanded: d.onLanded,
      effects,
    });
  }
  const missed = result.meta?.autoFail === true || result.meta?.d20?.natural === 1;
  if (result.meta?.attack !== undefined) lastAttack = { id, next: held.next };
  // A reroll on the toast can turn the attack into a crit: the damage reads it as the log has it.
  const critNow = () =>
    rollLogStore.getState().rolls.find((r) => r.id === id)?.meta?.attack?.crit === true;
  // A spell attack's hit asks for the spell's damage at the level cast.
  const after: FollowUp | undefined =
    castDamage !== undefined
      ? {
          expr: castDamage.expr,
          go: () => undefined,
          ask: () => spellDamageAsk(castDamage, critNow()),
        }
      : held.afterHit;
  const { queued } = held;
  if (queued !== undefined && !missed) {
    // Damage tapped while the attack waited asks now, the crit known; with
    // nothing to choose it rolls with the attack, and shows with it.
    // The cast spell's own damage, at the level picked; its chip's dice when it has no roll of that label.
    const own =
      cast !== undefined && queued.of === cast.spell
        ? (cast.dice(picked, queued.label) ?? castDamage)
        : undefined;
    const asked = own !== undefined ? spellDamageAsk(own, crit) : queued.make();
    const hit = { ...asked, after: attackWords(result) };
    if (!asksAnything(hit)) {
      const on = hit.extras.map(startsOn);
      landDamage(hit, on, undefined, null, queued.onLanded, held.from, id);
      return;
    }
    const back = queued.from?.isConnected === true ? queued.from : held.from;
    holdDamage(back, hit, queued.onLanded, queued.face);
    return;
  }
  if (after !== undefined && held.damage.length === 0 && !missed) {
    const { ask } = after;
    // The prompt it opens says the attack it follows, as the log has it then.
    const go =
      ask === undefined
        ? after.go
        : () => {
            const shown = rollLogStore.getState().rolls.find((r) => r.id === id);
            const hit = { ...ask(), after: shown === undefined ? undefined : attackWords(shown) };
            // No face: the attack chip it goes back to is no control that rolls it.
            holdDamage(held.from, hit, undefined, undefined);
          };
    followUpStore.setState({
      offer: { id, expr: crit ? critDice(after.expr) : after.expr, go, from: held.from },
    });
  }
  // The Attack action's next attack, hit or miss: the table may say a hit missed
  // its AC, and the next swing should not wait on damage that never comes.
  offerNext(held.next, id, held.from);
}

/**
 * A spell attack's damage at the level cast, asked as a weapon's is: its dice,
 * twice on a crit, and what the player adds for this roll alone.
 */
export function spellDamageAsk(dice: CastDice, crit: boolean): DamageAsk {
  return {
    kind: 'damage',
    label: dice.label,
    expr: dice.expr,
    parts: '',
    crit,
    extras: [],
    addOwn: ownForThisRoll,
  };
}

let ownSeq = 0;

/** What the player typed, for this roll alone: there is no weapon to keep it on. */
export function ownForThisRoll(own: OwnDamage): DamageExtra {
  ownSeq += 1;
  return {
    key: `own-roll-${String(ownSeq)}`,
    dice: own.dice,
    source: own.source,
    damageType: own.damageType,
    label: own.damageType === undefined ? own.source : `${own.source} ${own.damageType} damage`,
    kind: 'own',
    tag: 'this roll',
    note: own.note,
    ...(own.crit ? {} : { noCrit: true }),
  };
}

/** The attack a damage prompt follows, in words: "Longsword attack: 17, critical hit". */
function attackWords(r: RollResult): string {
  const crit = r.meta?.attack?.crit === true ? ', critical hit' : '';
  return `${r.label ?? 'Attack'}: ${r.total}${crit}`;
}

/**
 * The damage prompt's roll lands: the weapon's damage first, then its extras
 * apart, the chip showing the whole of it. Then the Attack action's next attack
 * is offered, if one is left.
 */
function landDamage(
  hit: DamageAsk,
  on: readonly boolean[],
  cast: HeldCast | undefined,
  picked: string | null,
  onLanded: Landed | undefined,
  from: HTMLElement | null,
  withRoll?: string,
): void {
  // Read before the damage lands: past it, damage is the newest roll, and the attack stays in play.
  const next = hit.next ?? nextAfterAttackInPlay();
  const { rolls, weapon } = rollDamage(hit, on, cast, picked, withRoll);
  const total = rolls.reduce((n, r) => n + r.total, 0);
  rolls.forEach((r, i) => {
    land({
      result: r,
      onLanded: i === 0 && onLanded !== undefined ? () => onLanded({ ...r, total }) : undefined,
      effects: [],
    });
  });
  // A reroll the result offers on the weapon's damage, shown as the toast's own
  // roll or under the attack it rolled with.
  const head = rolls[0];
  const { reroll } = hit;
  if (reroll !== undefined && head?.id !== undefined) {
    followUpStore.setState({
      reroll: {
        id: withRoll ?? head.id,
        target: head.id,
        used: reroll.used,
        source: reroll.source,
        terms: weapon.terms,
        total: weapon.total,
        weapon: () => weaponRoll(hit),
        pay: reroll.pay,
      },
    });
  }
  offerNext(next, withRoll ?? head?.id, from);
}

// A roll that lands from anywhere else (the dice tray, the Build page) lets
// the waiting one go: the toast is for the newest roll.
rollLogStore.subscribe((state, prev) => {
  if (state.seq !== prev.seq) cancelHeld();
});
