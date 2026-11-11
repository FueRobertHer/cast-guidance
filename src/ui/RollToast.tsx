import {
  Check,
  ChevronsUp,
  HeartCrack,
  HeartPlus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import {
  lazy,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { canReroll, rawTotal, rerollD20, withRaw } from '@/dice/reroll';
import { roll } from '@/dice/roll';
import type {
  CritDamage,
  DiceRollDetail,
  ModDetail,
  RerollOffer,
  RollOffer,
  RollResult,
} from '@/dice/types';
import type { CharacterDoc } from '@/engine/types';
import { RULE_WORDS } from '@/lib/docDiff';
import { signed } from '@/lib/signed';
import { announce } from '@/stores/announcer';
import { characterSessionStore, useCharacterSession } from '@/stores/characterSession';
import { diceTrayStore, useDiceTray } from '@/stores/diceTray';
import {
  cancelHeld,
  critDice,
  declareHeld,
  followUpStore,
  foretellHeld,
  type HeldRoll,
  heldRollStore,
  nameHeldDie,
  pickHeldTile,
  type RollFace,
  rollHeld,
  setHeldMode,
  toggleHeldRollIn,
} from '@/stores/heldRoll';
import { rollLogStore, useRollLog } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { ChipFace } from './ChipFace';
import { D20Icon } from './D20Icon';
import { Lift } from './Lift';
import { RollDetail } from './RollDetail';
import { ROLL_MODES } from './rollModes';
import { critWithoutNatural20, naturalOf, ROLL_INK, type RollTone, rollTone } from './rollTone';
import { SegmentedControl } from './SegmentedControl';

/**
 * The toast's edge and its tile. A plain result has the `line` hairline every
 * floating panel has; a nat 20 or nat 1 a 2px edge in its colour instead.
 */
const TONE: Record<RollTone, { edge: string; tile: string }> = {
  d20: { edge: 'ring-1 ring-line', tile: 'bg-roll-soft text-roll' },
  damage: { edge: 'ring-1 ring-line', tile: 'bg-danger-soft text-danger' },
  heal: { edge: 'ring-1 ring-line', tile: 'bg-heal-soft text-heal' },
  crit: { edge: 'ring-2 ring-heal', tile: 'bg-heal-soft text-heal' },
  fumble: { edge: 'ring-2 ring-danger', tile: 'bg-danger-soft text-danger' },
};

type Term = RollResult['terms'][number];

/**
 * One die group in words: the kept faces, then any dropped ones. Dice a
 * critical hit set to their maximum come first, said so ("maximum 8, rolled 3").
 */
function diceSpeech(term: Pick<DiceRollDetail, 'rolls' | 'maxed'>): string {
  const maxed = term.maxed ?? 0;
  const rolls = term.rolls.slice(maxed);
  const kept = rolls.filter((r) => r.kept).map((r) => r.v);
  const dropped = rolls.filter((r) => !r.kept).map((r) => r.v);
  const said = kept.length > 0 ? kept.join(', ') : 'none kept';
  const top =
    maxed > 0
      ? `maximum ${term.rolls
          .slice(0, maxed)
          .map((r) => r.v)
          .join(', ')}, rolled `
      : '';
  return `${top}${dropped.length > 0 ? `${said}, dropped ${dropped.join(', ')}` : said}`;
}

/** One term in words, signed as "plus" or "minus" after the first. */
function termSpeech(term: Term, first: boolean): string {
  if (term.kind === 'multiplier') {
    const by = term.detail.kind === 'dice' ? diceSpeech(term.detail) : String(term.value);
    return `times ${by}`;
  }
  const negative = term.kind === 'dice' ? term.sign < 0 : term.value < 0;
  const body = term.kind === 'dice' ? diceSpeech(term) : String(Math.abs(term.value));
  if (first) return negative ? `minus ${body}` : body;
  return `${negative ? 'minus' : 'plus'} ${body}`;
}

/**
 * A roll as a screen reader hears it: what, the total, then the dice in words
 * ("Initiative: 18. Rolled 13, dropped 4, plus 5"). The on-screen detail is
 * brackets and parentheses, which a reader spells out symbol by symbol.
 */
export function rollAnnouncement(result: RollResult): string {
  const nat = naturalOf(result);
  const flag =
    result.meta?.autoFail === true
      ? ', automatic failure'
      : nat === 20
        ? ', natural 20'
        : nat === 1
          ? ', natural 1'
          : critWithoutNatural20(result)
            ? ', critical hit'
            : result.meta?.critical === true
              ? ', critical'
              : '';
  const rerolled = result.meta?.rerolled ?? [];
  const setBy = result.meta?.setBy ?? [];
  const foretold = result.meta?.foretold;
  const dice = result.terms
    .map((t, i) => {
      if (i > 0) return termSpeech(t, false);
      return [
        termSpeech(t, true),
        ...(foretold !== undefined ? [`foretold by ${foretold}`] : []),
        ...(rerolled.length > 0 ? [`rerolled by ${andWords(rerolled)}`] : []),
        ...(setBy.length > 0 ? [`set by ${andWords(setBy)}`] : []),
      ].join(', ');
    })
    .join(', ');
  const floor = result.meta?.floor;
  const held =
    floor !== undefined && floor.raw < floor.at
      ? `, ${floor.raw} set to ${floor.at} by ${floor.source}`
      : '';
  const rolled = dice === '' ? '' : `. Rolled ${dice}${held}`;
  const cue = result.meta?.cue === undefined ? '' : `. ${result.meta.cue}`;
  return `${result.label ?? result.expr}${flag}: ${result.total}${rolled}${cue}`;
}

/** "Bless", "Bless and Heroism", "Bless, Heroism and Enlarge". */
function andWords(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The newest roll as the toast shows it: an attack with the damage tapped
 * while it waited (`meta.withRoll`), which landed after it in the order tapped,
 * or the newest roll alone.
 */
export function withItsDamage(
  rolls: readonly RollResult[],
): { roll: RollResult; damage: RollResult[] } | undefined {
  let i = 0;
  while (rolls[i]?.meta?.withRoll !== undefined) i++;
  const attack = rolls[i];
  const damage = rolls.slice(0, i);
  if (i > 0 && attack?.id !== undefined && damage.every((d) => d.meta?.withRoll === attack.id)) {
    return { roll: attack, damage: damage.reverse() };
  }
  const newest = rolls[0];
  return newest === undefined ? undefined : { roll: newest, damage: [] };
}

/** How long a roll stays up (DS-001 RollToast), unless hovered or focused. */
export const ROLL_TOAST_MS = 4000;
/** How long offered dice wait to be added, at most (the buffs canvas, Dice A). */
export const OFFER_WAIT_MS = 60_000;

/** A die rolled for an offer: once per toast, so taking it off and on keeps it. */
interface Rolled {
  value: number;
  /** A die rolled, or a flat bonus a feature adds (Guided Strike's +10). */
  term: DiceRollDetail | ModDetail;
}

/** The roll with the offered dice that are added: their terms, named, and the total. */
export function withAdded(
  base: RollResult,
  rolled: ReadonlyArray<Rolled | undefined>,
  on: readonly boolean[],
): RollResult {
  const offers = base.meta?.offers ?? [];
  const terms = [...base.terms];
  const from = [...(base.meta?.from ?? [])];
  // Counted from what the terms come to, so a floor (Indomitable Might) still holds.
  let total = rawTotal(base);
  offers.forEach((o, i) => {
    const r = rolled[i];
    if (on[i] !== true || r === undefined) return;
    from.push({ term: terms.length, source: o.source });
    terms.push(r.term);
    total += r.value;
  });
  if (from.length === (base.meta?.from ?? []).length) return base;
  return withRaw({ ...base, terms, meta: { ...base.meta, from } }, total);
}

/** "1d8" as the chip says it: "d8". */
const dieWord = (dice: string) => dice.replace(/^1d/, 'd');

/** What an offered die's chip is named, for a screen reader. */
function offerName(o: RollOffer, rolled: Rolled | undefined, on: boolean): string {
  if (on && rolled !== undefined) return `${o.source}, ${rolled.value} added. Tap to take it off`;
  const price = o.pay !== undefined ? `. It ${o.pay.words}` : '';
  const when = o.when !== undefined ? `. ${o.when}` : '';
  return `Add ${o.source}, +${dieWord(o.dice)}${o.ifFailed ? ', if the roll failed' : ''}${price}${when}`;
}

/**
 * What adding a feature's own extra pays and when it holds, said once under
 * the offers: "Precision Attack spends 1 Superiority Dice." One spent only if
 * the roll then succeeds says that taking it off gives the use back.
 */
export function offerPrices(offers: readonly RollOffer[]): string {
  return offers
    .flatMap((o) => {
      if (o.pay === undefined) return [];
      const parts = [`${o.source} ${o.pay.words}`];
      if (o.when !== undefined) parts.push(o.when);
      if (o.spentOnSuccess === true)
        parts.push('If the roll still fails, take it off for the use back');
      return [`${parts.join('. ')}.`];
    })
    .join(' ');
}

/**
 * What each reroll on offer pays and when it holds, said once under the
 * offers: "Indomitable spends an Indomitable use." One that is free says only
 * when it holds ("Fanatical Focus: Once a Rage."), and one with neither, nothing.
 */
export function rerollPrices(rerolls: readonly RerollOffer[]): string {
  return rerolls
    .flatMap((o) => {
      if (o.pay !== undefined)
        return [`${[`${o.source} ${o.pay.words}`, o.when].filter(Boolean).join('. ')}.`];
      return o.when !== undefined ? [`${o.source}: ${o.when}.`] : [];
    })
    .join(' ');
}

/** What a reroll's chip is named, for a screen reader: a set says the number. */
function rerollName(o: RerollOffer): string {
  const price = o.pay !== undefined ? `. It ${o.pay.words}` : '';
  const when = o.when !== undefined ? `. ${o.when}` : '';
  const what = o.to !== undefined ? `Set the d20 to ${o.to} with` : 'Reroll with';
  return `${what} ${o.source}${o.ifFailed ? ', if the roll failed' : ''}${price}${when}`;
}

/** Was this focused from the keyboard? A browser that cannot say counts it as not. */
function keyboardFocus(el: HTMLElement): boolean {
  try {
    return el !== document.body && el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Global roll feedback: whenever anything rolls, a toast slides up for a
 * moment so the result is never missed. It sits just above the tab bar, or
 * where the dice button is on screen (Play and Stats), just above it, so the
 * two never cover each other.
 *
 * It stays four seconds, and waits while the pointer is on it or it has
 * focus, so a slow reader can finish it (WCAG 2.2.1). On the sheet's pages it
 * is a button that opens the dice tray's history.
 *
 * The toast itself is no live region. It remounts for every roll, and a
 * region that mounts with its text is announced unreliably, so the result is
 * said through the announcer (A11Y-002), once per roll: a roll removed from
 * the log, or the toast pausing, says nothing again. Every roll is a new
 * event, so the same result twice is said twice; a burst of taps is cut to
 * its first and last.
 *
 * A roll an effect offers dice to (Guidance, Bardic Inspiration) is a group:
 * the history button and the dice are siblings (the buffs canvas, Dice A). A
 * die tapped rolls once and joins the total, which is said again; tapped
 * again it comes off and its use comes back. The dice wait a minute at most,
 * until the toast closes, another roll comes, or the hit points change. A roll
 * made from the keyboard moves focus to the first die (or a hit's damage);
 * Esc closes, and focus goes back.
 *
 * A d20 test waits here first, as the roll prompt (`stores/heldRoll`): the
 * mode, the extras, then Roll (or the same control again), or Cancel. It never
 * times out, since nothing has happened yet; focus goes to Roll, and back when
 * it lands. Damage tapped while the attack waits lands with it, and the two
 * show together; a hit with nothing joined offers its damage instead.
 */
export function RollToast() {
  // The critical hit rule's sheet, opened from a crit's chip: loaded only then,
  // so the entry chunk carries none of it.
  const [rule, setRule] = useState<{
    open: boolean;
    mine: boolean;
    back: HTMLElement | null;
  } | null>(null);
  const doc = useCharacterSession((s) => s.doc);
  return (
    <>
      <RollResultToast
        sheetDoc={doc}
        onRule={(mine, back) => setRule({ open: true, mine, back })}
      />
      {rule !== null && (
        <Suspense fallback={null}>
          <RuleSheet
            rule={rule.open ? 'critDamage' : null}
            onClose={() => setRule({ ...rule, open: false })}
            character={
              doc === null ? null : { doc, update: characterSessionStore.getState().update }
            }
            mine={rule.mine}
            returnFocus={rule.back}
          />
        </Suspense>
      )}
    </>
  );
}

const RuleSheet = lazy(() =>
  import('@/features/settings/RuleSheet').then((m) => ({ default: m.RuleSheet })),
);

/** The rule a critical roll was counted under, and whether it is the open character's own. */
function critRuleOf(rolls: readonly RollResult[]): CritDamage | undefined {
  const crit = rolls.find((r) => r.meta?.critical === true);
  return crit === undefined ? undefined : (crit.meta?.critRule ?? 'doubleDice');
}

function RollResultToast({
  sheetDoc,
  onRule,
}: {
  /** The open character, whose rule a crit's chip names when it is their own. */
  sheetDoc: CharacterDoc | null;
  /** Open the rule's sheet; `back` takes focus as it closes, since the toast is gone by then. */
  onRule: (mine: boolean, back: HTMLElement | null) => void;
}) {
  const seq = useRollLog((s) => s.seq);
  const opensTray = useDiceTray((s) => s.mounted > 0);
  const [visible, setVisible] = useState<RollResult | null>(null);
  // Damage that went with the shown attack, landed after it.
  const [joined, setJoined] = useState<readonly RollResult[]>([]);
  const waiting = useStore(heldRollStore, (s) => s.held);
  const followUp = useStore(followUpStore, (s) => s.offer);
  const heldSeq = waiting?.seq;
  const rollButton = useRef<HTMLButtonElement | null>(null);
  // The offered dice: rolled once each, and which are added.
  const [rolled, setRolled] = useState<ReadonlyArray<Rolled | undefined>>([]);
  const [added, setAdded] = useState<readonly boolean[]>([]);
  // Which offered rerolls were made: each once a roll, and the new roll stands.
  const [rerolledWith, setRerolledWith] = useState<readonly boolean[]>([]);
  // Kept as it is (the x), or no longer waiting (hit points changed).
  const [settled, setSettled] = useState(false);
  const expired = useStore(rollOffersStore, (s) => s.expired);
  const expiredAt = useRef(expired);
  // A keyboard roll with dice on offer: focus goes to the first, and back on Esc.
  const firstOffer = useRef<HTMLButtonElement | null>(null);
  const focusOffer = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The roll last shown, so only a new roll shows (and is said), and never
  // one made before this mounted.
  const shown = useRef(seq);
  const toast = useRef<HTMLElement | null>(null);
  const setToast = (el: HTMLElement | null) => {
    toast.current = el;
  };
  // What had focus before the toast was pressed, for the tray to return to.
  const before = useRef<HTMLElement | null>(null);
  // What last pressed the toast: a tap leaves `:hover` behind.
  const pressedBy = useRef<string | null>(null);
  /** Keep `el` as what had focus before the toast, when it is outside it. */
  const keepBefore = (el: EventTarget | null) => {
    if (el instanceof HTMLElement && el !== document.body && !toast.current?.contains(el)) {
      before.current = el;
    }
  };

  useEffect(() => {
    if (seq === shown.current) return;
    shown.current = seq;
    const newest = withItsDamage(rollLogStore.getState().rolls);
    if (newest === undefined) return;
    const { roll: shownRoll, damage } = newest;
    setVisible(shownRoll);
    setJoined(damage);
    setRolled([]);
    setAdded([]);
    setRerolledWith([]);
    setSettled(false);
    expiredAt.current = rollOffersStore.getState().expired;
    // The last toast is gone, and with it whatever pointer or focus it had.
    setHovered(false);
    setFocused(false);
    before.current = null;
    pressedBy.current = null;
    const active = document.activeElement;
    const offering =
      (shownRoll.meta?.offers?.length ?? 0) > 0 ||
      (shownRoll.meta?.rerolls?.length ?? 0) > 0 ||
      followUpStore.getState().offer?.id === shownRoll.id;
    const fromKeys = offering && active instanceof HTMLElement && keyboardFocus(active);
    focusOffer.current = fromKeys;
    returnTo.current = fromKeys ? (active as HTMLElement) : null;
    announce([shownRoll, ...damage].map(rollAnnouncement).join('. '), {
      key: 'roll',
      repeat: true,
    });
  }, [seq]);

  // A roll starts waiting: the last toast gives way to it, focus goes to Roll.
  useEffect(() => {
    if (heldSeq === undefined) return;
    setVisible(null);
    setJoined([]);
    setHovered(false);
    setFocused(false);
  }, [heldSeq]);
  useLayoutEffect(() => {
    if (heldSeq !== undefined) rollButton.current?.focus();
  }, [heldSeq]);

  // The dice stop waiting (the x, or the hit points changed). The group gives
  // way to the plain toast and takes the focus and pointer in it with it, and
  // an element removed while React commits sends no blur or leave: so the hold
  // lets go here (the timer holds again for a mouse still resting on it), and
  // focus goes back where the roll came from.
  const letGo = useCallback(() => {
    const inside = toast.current?.contains(document.activeElement) === true;
    setSettled(true);
    setFocused(false);
    setHovered(false);
    const back = returnTo.current ?? before.current;
    if (inside && back?.isConnected === true) back.focus();
  }, []);

  // The hit points changed: the dice stop waiting.
  useEffect(() => {
    if (expired !== expiredAt.current) letGo();
  }, [expired, letGo]);

  useLayoutEffect(() => {
    if (!focusOffer.current || firstOffer.current === null) return;
    focusOffer.current = false;
    firstOffer.current.focus();
  });

  const offers = settled ? [] : (visible?.meta?.offers ?? []);
  // A reroll can land an attack on a natural 1, 20 or crit, which settles it as the
  // roll itself does (`d20Ask`): no die left to add, no damage on the 1, and no
  // reroll after a crit. A die already added stays, to be taken off.
  const struck = visible?.meta?.attack;
  const crits = struck !== undefined && (visible?.meta?.d20?.natural === 20 || struck.crit);
  const misses = struck !== undefined && visible?.meta?.d20?.natural === 1;
  const open = offers.map((_, i) => !(crits || misses) || added[i] === true);
  // A hit's damage, offered until it is rolled or the toast is kept as it is.
  const damageOffer =
    !settled &&
    !misses &&
    followUp !== null &&
    visible?.id !== undefined &&
    followUp.id === visible.id
      ? followUp
      : null;
  // A reroll not made yet that could still change the roll.
  const rerolls = settled || visible === null ? [] : (visible.meta?.rerolls ?? []);
  const rerollable = rerolls.map(
    (o, i) => !crits && visible !== null && rerolledWith[i] !== true && canReroll(visible, o),
  );
  // Still to decide: a die not added yet, or one whose use comes back if the
  // roll still fails (Tactical Mind), until the player knows; or a reroll.
  const deciding =
    offers.some((o, i) => open[i] && (added[i] !== true || o.spentOnSuccess === true)) ||
    rerollable.includes(true) ||
    damageOffer !== null;
  const held = hovered || focused;
  useEffect(() => {
    if (visible === null || held) return;
    if (deciding) {
      const timer = setTimeout(() => setVisible(null), OFFER_WAIT_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      // A toast that rose under a resting mouse has had no enter event. Only
      // where there is hover, and never after a finger or pen pressed it: a
      // tapped element keeps `:hover`, on a phone or a touchscreen laptop.
      const resting =
        window.matchMedia?.('(hover: hover)').matches === true &&
        (pressedBy.current === null || pressedBy.current === 'mouse') &&
        toast.current?.matches(':hover') === true;
      if (resting) setHovered(true);
      else setVisible(null);
    }, ROLL_TOAST_MS);
    return () => clearTimeout(timer);
  }, [visible, held, deciding]);

  if (waiting !== null) return <RollPrompt held={waiting} rollButton={rollButton} />;
  if (visible === null) return null;
  const current = withAdded(visible, rolled, added);
  const autoFail = current.meta?.autoFail === true;
  const nat = naturalOf(current);
  const tone = rollTone(current);
  const Icon = tone === 'damage' ? HeartCrack : tone === 'heal' ? HeartPlus : D20Icon;
  const flag = (word: string, ink: string) => (
    <span className={`shrink-0 font-bold text-dice-small ${ink}`}>{word}</span>
  );

  // Where it floats and its edge, then how its row is laid out.
  const frame = `${FRAME} ${TONE[tone].edge}`;
  // Spans, shown as blocks, since the toast may be a button.
  const body = (
    <>
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-[0.875rem] ${TONE[tone].tile}`}
      >
        <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="block min-w-0 flex-1">
        {/* The label gives way to the words: a long one is cut, never
            "Natural 20!". */}
        <span className="flex items-baseline gap-1.5">
          <span className="min-w-0 truncate text-body-strong">{current.label ?? current.expr}</span>
          {nat === 20 && flag('Natural 20!', 'text-heal')}
          {critWithoutNatural20(current) && flag('Critical hit!', 'text-heal')}
          {nat === 1 && flag('Natural 1', 'text-danger')}
          {/* Damage a crit doubled: why the dice show twice what the chip says. */}
          {current.meta?.critical === true && flag('Critical', 'text-danger')}
          {autoFail && flag('Fails', 'text-danger')}
        </span>
        <span className="block truncate text-dice-small text-ink-muted tabular-nums">
          <RollDetail roll={current} />
        </span>
        {/* What the character's conditions did to the roll, whole, since a
            cut line could hide why the total is what it is. */}
        {current.meta?.cue !== undefined && (
          <span className="block text-caption text-guide">{current.meta.cue}</span>
        )}
      </span>
      {/* Keyed on the total, so a die added lands it again. */}
      <span
        key={current.total}
        className={`shrink-0 text-stat tabular-nums motion-safe:animate-total-in ${ROLL_INK[tone]}`}
      >
        {current.total}
      </span>
    </>
  );
  // A mouse only: a tap fires a mouse enter with no leave after it, which
  // would hold the toast up until the next tap somewhere else.
  const hold = {
    onPointerEnter: (event: ReactPointerEvent) => {
      if (event.pointerType === 'mouse') setHovered(true);
    },
    onPointerLeave: (event: ReactPointerEvent) => {
      if (event.pointerType === 'mouse') setHovered(false);
    },
    onPointerDown: (event: ReactPointerEvent) => {
      pressedBy.current = event.pointerType;
    },
  };

  /** Add an offered die, rolling it the first time, or take it off again. */
  const toggle = (i: number) => {
    const o = offers[i];
    if (o === undefined) return;
    let r = rolled[i];
    if (r === undefined) {
      const res = roll(o.dice);
      const term = res.terms[0];
      if (term === undefined || term.kind === 'multiplier') return;
      r = { value: res.total, term };
    }
    const on = added[i] !== true;
    const nextRolled = [...rolled];
    nextRolled[i] = r;
    // A feature's own die goes on only once paid for, as its Use is; with
    // nothing left to pay with it stays off, and the notice says why.
    if (on && o.pay !== undefined && rollOffersStore.getState().pay?.(o, true) !== true) {
      setRolled(nextRolled);
      return;
    }
    const nextAdded = [...added];
    nextAdded[i] = on;
    setRolled(nextRolled);
    setAdded(nextAdded);
    const next = withAdded(visible, nextRolled, nextAdded);
    rollLogStore.getState().replace(next);
    if (o.once && o.effectId !== undefined) rollOffersStore.getState().spend?.(o.effectId, on);
    // Taken off, a feature's own die gives back what it paid.
    if (!on && o.pay !== undefined) rollOffersStore.getState().pay?.(o, false);
    announce(`${o.source} ${on ? `added, ${r.value}` : 'taken off'}. ${rollAnnouncement(next)}`, {
      key: 'roll',
      repeat: true,
    });
  };

  /**
   * Reroll with a feature, paid first as its Use is: with nothing left to pay
   * with, the roll stands, and the notice says why. The new roll stands too,
   * so there is no taking it back; the dice added stay on it.
   */
  const rerollWith = (i: number) => {
    const o = rerolls[i];
    // A reroll made, or one that can change nothing, rolls no die.
    if (o === undefined || rerollable[i] !== true) return;
    // A free set the player claims for the roll holds for a reroll after it (Trance of Order).
    const base = rerollD20(
      visible,
      o.to !== undefined && o.pay === undefined ? { ...o, hold: true } : o,
    );
    if (base === undefined) return;
    if (o.pay !== undefined && rollOffersStore.getState().pay?.(o, true) !== true) return;
    const nextRerolled = [...rerolledWith];
    nextRerolled[i] = true;
    setRerolledWith(nextRerolled);
    setVisible(base);
    // Rerolled into a crit, the damage offered says it rolls its dice twice, as it will.
    if (damageOffer !== null && base.meta?.attack?.crit === true && struck?.crit !== true)
      followUpStore.setState({ offer: { ...damageOffer, expr: critDice(damageOffer.expr) } });
    const next = withAdded(base, rolled, added);
    rollLogStore.getState().replace(next);
    const done = o.to !== undefined ? `set to ${o.to}` : 'rerolled';
    announce(`${o.source}: ${done}. ${rollAnnouncement(next)}`, { key: 'roll', repeat: true });
  };

  // The dice an effect offers, after the roll: tap to add, tap again to take
  // off. Then a hit's damage, rolled as its chip rolls it, and the rerolls.
  const prices = [
    offerPrices(offers.filter((_, i) => open[i])),
    rerollPrices(rerolls.filter((_, i) => rerollable[i])),
  ]
    .filter((p) => p !== '')
    .join(' ');
  // A reroll made stays as a chip that says so, so the focus on it stays in the toast.
  const shownReroll = rerolls.map((_, i) => rerollable[i] === true || rerolledWith[i] === true);
  const firstReroll = shownReroll.indexOf(true);
  const firstOpen = open.indexOf(true);
  const offerRow = (firstOpen >= 0 || damageOffer !== null || firstReroll >= 0) && (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-line border-t pt-2">
      {offers.map((o, i) => {
        if (open[i] !== true) return null;
        const on = added[i] === true;
        const r = rolled[i];
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: an offer's place is its identity in this roll
            key={i}
            ref={i === firstOpen ? firstOffer : undefined}
            type="button"
            aria-pressed={on}
            aria-label={offerName(o, r, on)}
            onClick={() => toggle(i)}
            className={`inline-flex min-h-tap items-center gap-1 rounded-full px-3 font-semibold text-label ${
              on ? 'bg-ink text-bg' : 'bg-surface-raised text-ink hover:bg-surface-hover'
            }`}
          >
            {on && r !== undefined ? (
              <>
                +{r.value} {o.source}
                <X size={14} aria-hidden="true" className="shrink-0" />
              </>
            ) : (
              <>
                <ChevronsUp size={14} aria-hidden="true" className="shrink-0 text-heal" />+
                {dieWord(o.dice)} {o.source}
                {o.ifFailed ? ', if it failed' : ''}
                {o.pay !== undefined && <span className="font-normal text-ink-muted">· paid</span>}
              </>
            )}
          </button>
        );
      })}
      {damageOffer !== null && (
        <button
          ref={firstOpen < 0 ? firstOffer : undefined}
          type="button"
          onClick={() => {
            // The button goes with the toast it was in: focus goes back where
            // the roll came from, as the x sends it.
            const inside = toast.current?.contains(document.activeElement) === true;
            const back = damageOffer.from ?? returnTo.current ?? before.current;
            followUpStore.setState({ offer: null });
            damageOffer.go();
            if (inside && back?.isConnected === true) back.focus();
          }}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-full bg-danger-soft px-3.5 font-bold text-danger text-label hover:brightness-112"
        >
          <HeartCrack size={16} aria-hidden="true" className="shrink-0" />
          Roll {damageOffer.expr}
        </button>
      )}
      {rerolls.map(
        (o, i) =>
          shownReroll[i] && (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: a reroll's place is its identity in this roll
              key={i}
              ref={
                i === firstReroll && firstOpen < 0 && damageOffer === null ? firstOffer : undefined
              }
              type="button"
              aria-label={
                rerolledWith[i] !== true
                  ? rerollName(o)
                  : o.to !== undefined
                    ? `Set to ${o.to} with ${o.source}`
                    : `Rerolled with ${o.source}`
              }
              aria-disabled={rerolledWith[i] === true}
              onClick={() => rerollWith(i)}
              className={`inline-flex min-h-tap items-center gap-1 rounded-full px-3 font-semibold text-ink text-label ${
                rerolledWith[i] === true
                  ? 'bg-heal-soft ring-[1.5px] ring-heal ring-inset'
                  : 'bg-surface-raised hover:bg-surface-hover'
              }`}
            >
              {rerolledWith[i] === true ? (
                <>
                  <Check size={14} aria-hidden="true" className="shrink-0 text-heal" />
                  {o.to !== undefined ? `Set to ${o.to}` : 'Rerolled'}, {o.source}
                </>
              ) : (
                <>
                  {o.to !== undefined ? (
                    <ChevronsUp size={14} aria-hidden="true" className="shrink-0 text-heal" />
                  ) : (
                    <RefreshCw size={14} aria-hidden="true" className="shrink-0 text-heal" />
                  )}
                  {o.to !== undefined ? `Set ${o.to}` : 'Reroll'}, {o.source}
                  {o.ifFailed ? ', if it failed' : ''}
                  {o.pay !== undefined && (
                    <span className="font-normal text-ink-muted">· paid</span>
                  )}
                </>
              )}
            </button>
          ),
      )}
      {prices !== '' && <p className="basis-full text-caption text-ink-muted">{prices}</p>}
      {deciding && (
        <button
          type="button"
          aria-label="Keep this roll as it is"
          onClick={letGo}
          className="ml-auto inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-hover"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  // Damage that went with the attack, under it: what each rolled and its total.
  const damageRows = joined.length > 0 && (
    <div className="mt-2 flex flex-col gap-1 border-line border-t pt-2 pl-14">
      {joined.map((d, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: the damage rolls' order is fixed once landed
          key={i}
          className="flex items-baseline justify-between gap-3"
        >
          <span className="min-w-0 truncate text-dice-small text-ink-muted tabular-nums">
            {d.label ?? d.expr}
            {d.meta?.critical === true ? ', critical' : ''}: <RollDetail roll={d} />
          </span>
          <span className={`shrink-0 text-title-sheet tabular-nums ${ROLL_INK[rollTone(d)]}`}>
            {d.total}
          </span>
        </div>
      ))}
    </div>
  );

  // A critical hit's rule (the Rules board, C's chip): what counted the damage,
  // opening the same sheet as Settings, for the open character or everyone.
  const critRule = opensTray ? critRuleOf([current, ...joined]) : undefined;
  // Their own only when it is a value the app reads (a stored one it does not
  // know counts nothing), and only for the character who rolled, when the roll says.
  const ownValue = sheetDoc?.tableRules?.critDamage;
  const ownCrit = ownValue !== undefined && Object.hasOwn(RULE_WORDS.critDamage, ownValue);
  const rolledBy = [current, ...joined].find((r) => r.meta?.attack !== undefined)?.meta?.attack?.by;
  const ruleRow = critRule !== undefined &&
    sheetDoc !== null &&
    (rolledBy === undefined || rolledBy === sheetDoc.id) && (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-line border-t pt-2">
        <button
          type="button"
          aria-haspopup="dialog"
          // The chip goes with its toast, so the sheet hands focus back to what
          // had it before: read on the press, or as focus arrives from the keys.
          onPointerDown={() => keepBefore(document.activeElement)}
          onFocus={(event) => keepBefore(event.relatedTarget)}
          onClick={() => {
            const back = returnTo.current ?? before.current;
            setVisible(null);
            setHovered(false);
            setFocused(false);
            onRule(ownCrit, back);
          }}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-full bg-surface-raised px-3 font-semibold text-label text-ink hover:bg-surface-hover"
        >
          <SlidersHorizontal size={14} aria-hidden="true" className="shrink-0 text-ink-muted" />
          {ownCrit
            ? sheetDoc.name.trim()
              ? `${sheetDoc.name.trim()}’s rule`
              : 'Their rule'
            : 'Rule'}
          : {RULE_WORDS.critDamage[critRule]}
          <span className="font-normal text-ink-muted">· Change</span>
        </button>
      </div>
    );

  // Keyed on the roll counter so a second roll while the first is still up
  // replays the animation instead of silently swapping the number. The dice
  // button marks itself `data-dice-dock` (DiceTray); its top is 128px up, and
  // the toast clears it by 8.
  const grouped = offerRow !== false || damageRows !== false || ruleRow !== false;
  const history = opensTray && (
    <button
      type="button"
      // Named as it is said, not by its brackets, and for where it leads.
      aria-label={`${[current, ...joined].map(rollAnnouncement).join('. ')}. Open roll history`}
      className={grouped ? `${ROW} w-full` : `${frame} ${ROW}`}
      {...(grouped ? {} : { key: seq, ref: setToast, ...hold })}
      // A pressed button takes focus before its click, or never (Safari), so
      // what had it is read on the press; from the keyboard, as it arrives.
      onPointerDown={(event) => {
        if (!grouped) hold.onPointerDown(event);
        const el = document.activeElement;
        if (el instanceof HTMLElement && el !== document.body && !toast.current?.contains(el)) {
          before.current = el;
        }
      }}
      onFocus={(event) => {
        setFocused(true);
        if (
          event.relatedTarget instanceof HTMLElement &&
          !toast.current?.contains(event.relatedTarget)
        )
          before.current = event.relatedTarget;
      }}
      onBlur={grouped ? undefined : () => setFocused(false)}
      onClick={() => {
        diceTrayStore.getState().show('history', before.current);
        setVisible(null);
        setHovered(false);
        setFocused(false);
      }}
    >
      {body}
    </button>
  );
  if (!grouped) {
    if (history !== false) return history;
    return (
      <div key={seq} ref={setToast} className={`${frame} ${ROW}`} {...hold}>
        {body}
      </div>
    );
  }
  // Esc lets the dice go with the toast, and focus goes back where it was.
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    const back = returnTo.current ?? before.current;
    setVisible(null);
    setHovered(false);
    setFocused(false);
    if (back?.isConnected === true) back.focus();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls, not a fieldset of inputs
    <div
      key={seq}
      ref={setToast}
      role="group"
      aria-label="Roll result"
      className={frame}
      {...hold}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setFocused(false);
      }}
    >
      {history !== false ? history : <div className={ROW}>{body}</div>}
      {damageRows}
      {offerRow}
      {ruleRow}
    </div>
  );
}

/** Where every toast floats, whatever its edge. */
const FRAME =
  'fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 rounded-sheet bg-surface py-3 pr-4 pl-3 shadow-overlay ring-inset motion-safe:animate-toast-in lg:right-6 lg:bottom-6 lg:left-auto lg:w-80 [:root:has([data-dice-dock])_&]:bottom-[calc(136px+env(safe-area-inset-bottom))] lg:[:root:has([data-dice-dock])_&]:bottom-21';
/** A toast's top row: the tile, the words, the total. */
const ROW = 'flex items-center gap-3 text-left';

/**
 * One extra in the prompt: a die that rolls in (Bless), a one-use die
 * (Guidance, Bardic Inspiration), or something declared for the turn with no
 * die of its own (Reckless Attack). On, it keeps the heal green of a raised
 * number with a tick, so the mode's ink pill and Roll stay the loudest.
 */
function Extra({
  on,
  dice,
  bonus,
  source,
  when,
  holds,
  onClick,
}: {
  on: boolean;
  dice?: string;
  /** What it adds to the roll with no die of its own (flanking's +2). */
  bonus?: number | undefined;
  source: string;
  when: string;
  /**
   * Said to a screen reader after `when`: when it holds, for one the app cannot
   * see (flanking), or what a feature's own die pays.
   */
  holds?: string | undefined;
  onClick: () => void;
}) {
  const name =
    dice !== undefined
      ? `+${dieWord(dice)} ${source}`
      : bonus !== undefined && bonus !== 0
        ? `${signed(bonus)} ${source}`
        : source;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${name}, ${when}${holds === undefined ? '' : `: ${holds}`}`}
      onClick={onClick}
      className={`inline-flex min-h-tap items-center gap-1 rounded-full px-3 font-semibold text-label ${
        on
          ? 'bg-heal-soft text-ink ring-[1.5px] ring-heal ring-inset'
          : 'bg-surface-raised text-ink hover:bg-surface-hover'
      }`}
    >
      {on ? (
        <Check size={14} aria-hidden="true" className="shrink-0 text-heal" />
      ) : (
        <ChevronsUp size={14} aria-hidden="true" className="shrink-0 text-heal" />
      )}
      {name}
      <span className="font-normal text-ink-muted">· {when}</span>
    </button>
  );
}

/**
 * The prompt's header: a copy of the control that rolled, wearing what it
 * wears on the sheet (a condition's face, a buff's ring and lift; the rolls
 * canvas, Wear B). A mode that sets the conditions aside drains the face, as
 * Ignore once does. No control's look, and it is the d20 tile.
 */
function PromptHeader({ face, setAside }: { face: RollFace | undefined; setAside: boolean }) {
  if (face === undefined) {
    return (
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-[0.875rem] ${TONE.d20.tile}`}
      >
        <D20Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      </span>
    );
  }
  const chip =
    'inline-flex h-11 min-w-14 shrink-0 items-center justify-center rounded-chip font-semibold text-dice tabular-nums';
  const cast = face.tone === 'cast';
  if (face.wear !== undefined) {
    return (
      <span className={`relative ${chip} ${cast ? 'ring-1 ring-line-strong ring-inset' : ''}`}>
        <span aria-hidden="true" className="contents">
          <ChipFace
            wear={{ ...face.wear, ignored: face.wear.ignored || setAside }}
            rolls={0}
            showing={false}
            surface={cast ? 'cast' : 'chip'}
            tone={face.tone === 'cast' ? undefined : face.tone}
            lift={face.lift}
            down={face.down}
          >
            {face.text}
          </ChipFace>
        </span>
      </span>
    );
  }
  return (
    <Lift on={face.lift === true} down={face.down === true} className="shrink-0 rounded-chip">
      <span className={`${chip} px-2 ${FACE_TONE[face.tone ?? 'roll']}`} aria-hidden="true">
        {face.text}
      </span>
    </Lift>
  );
}

/** The header chip's plain colour, as the chip it copies has it. */
const FACE_TONE = {
  roll: 'bg-roll-soft text-roll',
  danger: 'bg-danger-soft text-danger',
  heal: 'bg-heal-soft text-heal',
  cast: 'text-ink ring-1 ring-line-strong ring-inset',
} as const;

/**
 * The ways to cast a spell, as tiles by source (the rolls canvas, "Every way
 * to cast" A): each group under its heading, its tiles filling the row, each
 * its level over what is left or what it costs. One that cannot pay stays,
 * faint, so what is gone is said rather than hidden.
 */
function CastTiles({ held }: { held: HeldRoll }) {
  const groups = held.cast?.groups ?? [];
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.tiles[0]?.id ?? group.title} className="flex flex-col gap-1">
          <span className="px-0.5 font-semibold text-caption text-ink-muted">
            {group.title}
            {group.sub === undefined ? '' : <span className="font-normal"> · {group.sub}</span>}
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a fieldset of inputs */}
          <div role="group" aria-label={group.title} className="flex flex-wrap gap-1.5">
            {group.tiles.map((tile) => {
              const on = held.picked === tile.id;
              return (
                <button
                  key={tile.id}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={!tile.ok}
                  aria-label={tile.aria}
                  onClick={() => pickHeldTile(tile.id)}
                  className={`flex min-h-tap min-w-14 flex-1 flex-col items-center justify-center rounded-control px-1.5 py-1 leading-tight ${
                    on
                      ? 'bg-ink text-bg'
                      : tile.ok
                        ? 'bg-surface-raised text-ink hover:bg-surface-hover'
                        : 'cursor-default text-ink-muted ring-1 ring-line ring-inset'
                  }`}
                >
                  <span className="font-bold text-label">{tile.head}</span>
                  <span className={`text-caption ${on ? 'text-bg' : 'text-ink-muted'}`}>
                    {tile.sub}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The roll prompt (the rolls canvas, picked 2026-11-09): a d20 test waiting
 * before its d20 is rolled, in the toast's place above the thumb. The header
 * is the control that rolled; the mode is preset to what the sheet sets, with
 * why; the extras are the dice that roll in (on), the one-use dice that may
 * be added first (off), and what may be declared for the turn (off: Reckless
 * Attack, which moves the mode). One note sits by Roll: what a declaration
 * costs and what the roll spends, else what happens to the dice left, else
 * that the control tapped again rolls too.
 * Roll and Cancel, or Esc, send focus back to the control, when it was in here,
 * and the sheet scrolls that control clear of the prompt as it opens.
 *
 * A spell cast here ("Level at cast" A) shows its ways to cast as tiles by
 * source, and the note says what the tile picked spends. One with no d20
 * (Cure Wounds, Fireball, Bless) has no mode to pick: its header shows its dice
 * at the level picked, and its button says what it does (Heal, Roll, Cast).
 */
function RollPrompt({
  held,
  rollButton,
}: {
  held: HeldRoll;
  rollButton: { current: HTMLButtonElement | null };
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const dropUnnamed = useStore(rollOffersStore, (s) => s.before);
  const { ask, cast, picked } = held;
  const choice = {
    mode: held.mode,
    rollsIn: held.rollsIn,
    named: held.named,
    declared: held.declared,
    ...(held.foretold !== null ? { foretold: held.foretold } : {}),
  };
  const told = held.foretold === null ? undefined : ask?.foretold[held.foretold];
  const why = ask?.cueFor(held.mode, choice) ?? '';
  const setAside = ask !== null && held.mode !== ask.presetFor(choice) && ask.conditions;
  const once = ask?.once ?? [];
  const named = once.filter((_, i) => held.named[i] === true);
  const left = once.filter((_, i) => held.named[i] !== true);
  // Under the house rule an effect's die left is gone; a feature's own comes back.
  const gone = dropUnnamed ? left.filter((o) => o.pay === undefined) : [];
  // What declaring costs comes first: it lasts past this roll.
  // One that holds for this roll alone says, by its name, what it pays and
  // when it holds ("Flanking: only with an ally next to the target ...",
  // "Lucky: spends 1 Luck Points.").
  const costs = (ask?.thisTurn ?? [])
    .filter((_, i) => held.declared[i] === true)
    .map((t) =>
      t.thisRoll === true
        ? `${t.source}: ${t.cost.charAt(0).toLowerCase()}${t.cost.slice(1)}.`
        : `${t.cost}.`,
    );
  // An effect's die spends the effect; a feature's own die says what it pays.
  const unpaid = named.filter((o) => o.pay === undefined);
  const spends = [
    told !== undefined ? `Uses ${told.source}'s ${told.v}.` : '',
    unpaid.length > 0 ? `Spends ${andWords(unpaid.map((o) => o.source))}.` : '',
    offerPrices(named),
  ]
    .filter((n) => n !== '')
    .join(' ');
  const leftNote =
    left.length === 0
      ? ''
      : gone.length === left.length
        ? 'Dice you leave are gone once the d20 shows.'
        : gone.length === 0
          ? 'Dice you leave come back after the roll.'
          : `Left, ${andWords(gone.map((o) => o.source))} ${gone.length === 1 ? 'is' : 'are'} gone once the d20 shows; the rest come back after the roll.`;
  // One note: what declaring costs and what the roll spends (the cast's
  // tile, then the dice added), else what happens to the dice left, else
  // that the control rolls too.
  const note =
    cast !== undefined
      ? [
          ...costs,
          cast.note(picked),
          spends !== '' ? spends.replace(/^Spends/, 'Also spends') : leftNote,
        ]
          .filter((n) => n !== '')
          .join(' ')
      : costs.length > 0 || spends !== ''
        ? [...costs, spends].filter((n) => n !== '').join(' ')
        : leftNote !== ''
          ? leftNote
          : `Tap ${held.face?.text ?? 'it'} again to roll.`;
  // A cast with no d20: its header chip shows the dice at the level picked,
  // and its button says what it does.
  const dice = cast?.dice(picked);
  const face =
    ask === null && held.face !== undefined
      ? { ...held.face, text: dice?.expr ?? held.face.text }
      : held.face;
  const line = cast?.line(picked);
  const verb = cast?.verb ?? 'Cast';
  const label = ask?.label ?? `${verb} ${cast?.spell ?? ''}`;
  const go =
    ask !== null
      ? { word: 'Roll', icon: D20Icon, tone: GO.roll }
      : dice === undefined
        ? { word: verb, icon: Sparkles, tone: GO.roll }
        : dice.kind === 'heal'
          ? { word: 'Heal', icon: HeartPlus, tone: GO.heal }
          : { word: 'Roll', icon: dice.kind === 'damage' ? HeartCrack : D20Icon, tone: GO.roll };
  const GoIcon = go.icon;
  const leave = (act: () => void) => {
    const inside = box.current?.contains(document.activeElement) === true;
    const back = held.from;
    act();
    if (inside && back?.isConnected === true) back.focus();
  };
  // The control that rolled stays in sight above the prompt, as it opens and
  // as it grows (damage joining). Near the foot of the page there is no room
  // to scroll it clear, so a spacer past the page's end lends what it lacks,
  // while a prompt is up.
  const spacer = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: as each prompt opens, and as it grows
  useLayoutEffect(() => {
    const from = held.from;
    const el = box.current;
    if (from?.isConnected !== true || el === null) return;
    // Where the prompt settles: its rise in (a transform) is not counted.
    const over = from.getBoundingClientRect().bottom - el.offsetTop;
    if (over <= 0) return;
    const page = document.scrollingElement;
    if (page !== null) {
      const short = over + 8 - (page.scrollHeight - window.innerHeight - window.scrollY);
      if (short > 0) {
        const s = spacer.current ?? document.createElement('div');
        s.setAttribute('aria-hidden', 'true');
        s.style.cssText = `position:absolute;left:0;width:1px;height:1px;pointer-events:none;top:${page.scrollHeight + short - 1}px`;
        if (!s.isConnected) document.body.appendChild(s);
        spacer.current = s;
      }
    }
    window.scrollBy?.({ top: over + 8 });
  }, [held.seq, held.damage.length]);
  useEffect(
    () => () => {
      spacer.current?.remove();
      spacer.current = null;
    },
    [],
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls, not a fieldset of inputs
    <div
      key={held.seq}
      ref={box}
      role="group"
      aria-label={`${label}, choose and ${go.word.toLowerCase()}`}
      className={`${FRAME} ${TONE.d20.edge} flex flex-col gap-2`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        leave(cancelHeld);
      }}
    >
      <div className={ROW}>
        <PromptHeader face={face} setAside={setAside} />
        <span className="block min-w-0 flex-1">
          {/* Whole, unlike a result's: nothing here competes with it. */}
          <span className="block break-words text-body-strong">{label}</span>
          <span className="block text-dice-small text-ink-muted tabular-nums">
            {ask === null
              ? (line ?? '')
              : `${ask.formula(choice)}${line === undefined ? '' : `, ${line}`}`}
          </span>
        </span>
        <button
          type="button"
          aria-label={ask === null ? `Cancel this ${verb.toLowerCase()}` : 'Cancel this roll'}
          onClick={() => leave(cancelHeld)}
          className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center self-start rounded-full text-ink-muted hover:bg-surface-hover"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <CastTiles held={held} />
      {/* A foretold d20 is not rolled: there is no mode to pick. */}
      {ask !== null && told === undefined && (
        <SegmentedControl
          label="Roll mode"
          options={ROLL_MODES}
          value={held.mode}
          onChange={setHeldMode}
          block
        />
      )}
      {why !== '' && <p className="text-caption text-guide">{why}</p>}
      {ask !== null &&
        (ask.foretold.length > 0 ||
          ask.rollsIn.length > 0 ||
          ask.once.length > 0 ||
          ask.thisTurn.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {ask.foretold.map((f, i) => (
              <Extra
                // biome-ignore lint/suspicious/noArrayIndexKey: an extra's place is its identity in this roll
                key={`told${i}`}
                on={held.foretold === i}
                source={`${f.source} ${f.v}`}
                when="foretold"
                holds={`${f.v} in place of the d20`}
                onClick={() => foretellHeld(i)}
              />
            ))}
            {ask.rollsIn.map((d, i) => (
              <Extra
                // biome-ignore lint/suspicious/noArrayIndexKey: an extra's place is its identity in this roll
                key={`in${i}`}
                on={held.rollsIn[i] === true}
                dice={d.dice}
                source={d.source}
                when="rolls in"
                onClick={() => toggleHeldRollIn(i)}
              />
            ))}
            {ask.once.map((o, i) => (
              <Extra
                // biome-ignore lint/suspicious/noArrayIndexKey: an extra's place is its identity in this roll
                key={`once${i}`}
                on={held.named[i] === true}
                dice={o.dice}
                source={o.source}
                // A feature's own die is paid for: what it pays is said to a screen reader.
                when={o.pay !== undefined ? 'paid' : 'once'}
                holds={o.pay !== undefined ? offerPrices([o]) : undefined}
                onClick={() => nameHeldDie(i)}
              />
            ))}
            {ask.thisTurn.map((t, i) => (
              <Extra
                // biome-ignore lint/suspicious/noArrayIndexKey: an extra's place is its identity in this roll
                key={`turn${i}`}
                on={held.declared[i] === true}
                bonus={t.bonus}
                source={t.source}
                // Flanking holds for this roll alone, when an ally stands across.
                when={t.thisRoll === true ? 'this roll' : 'this turn'}
                holds={t.thisRoll === true ? t.cost : undefined}
                onClick={() => declareHeld(i)}
              />
            ))}
          </div>
        )}
      {held.damage.length > 0 && (
        <p className="text-dice-small text-ink-muted">
          {held.damage.length === 1
            ? 'Damage rolls with the attack'
            : `${held.damage.length} damage rolls go with the attack`}
        </p>
      )}
      <div className="flex items-center gap-3 border-line border-t pt-2">
        <p className="min-w-0 flex-1 text-caption text-ink-muted">{note}</p>
        <button
          ref={rollButton}
          type="button"
          onClick={() => leave(rollHeld)}
          className={`inline-flex min-h-tap shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-5 font-bold text-label ${go.tone}`}
        >
          <GoIcon size={16} aria-hidden="true" />
          {go.word}
        </button>
      </div>
    </div>
  );
}

/** The prompt's main button: the roll blue, or the heal green for a spell that heals. */
const GO = {
  roll: 'bg-brand text-on-brand hover:bg-brand-hover',
  heal: 'bg-heal text-on-brand hover:brightness-112',
} as const;
