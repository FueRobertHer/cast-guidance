import { ChevronsUp, HeartCrack, HeartPlus, X } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { roll } from '@/dice/roll';
import type { DiceRollDetail, RollOffer, RollResult } from '@/dice/types';
import { announce } from '@/stores/announcer';
import { diceTrayStore, useDiceTray } from '@/stores/diceTray';
import { rollLogStore, useRollLog } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { D20Icon } from './D20Icon';
import { RollDetail } from './RollDetail';
import { naturalOf, ROLL_INK, type RollTone, rollTone } from './rollTone';

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

/** One die group in words: the kept faces, then any dropped ones. */
function diceSpeech(rolls: Array<{ v: number; kept: boolean }>): string {
  const kept = rolls.filter((r) => r.kept).map((r) => r.v);
  const dropped = rolls.filter((r) => !r.kept).map((r) => r.v);
  const said = kept.length > 0 ? kept.join(', ') : 'none kept';
  return dropped.length > 0 ? `${said}, dropped ${dropped.join(', ')}` : said;
}

/** One term in words, signed as "plus" or "minus" after the first. */
function termSpeech(term: Term, first: boolean): string {
  if (term.kind === 'multiplier') {
    const by = term.detail.kind === 'dice' ? diceSpeech(term.detail.rolls) : String(term.value);
    return `times ${by}`;
  }
  const negative = term.kind === 'dice' ? term.sign < 0 : term.value < 0;
  const body = term.kind === 'dice' ? diceSpeech(term.rolls) : String(Math.abs(term.value));
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
          : '';
  const dice = result.terms.map((t, i) => termSpeech(t, i === 0)).join(', ');
  const rolled = dice === '' ? '' : `. Rolled ${dice}`;
  const cue = result.meta?.cue === undefined ? '' : `. ${result.meta.cue}`;
  return `${result.label ?? result.expr}${flag}: ${result.total}${rolled}${cue}`;
}

/** How long a roll stays up (DS-001 RollToast), unless hovered or focused. */
export const ROLL_TOAST_MS = 4000;
/** How long offered dice wait to be added, at most (the buffs canvas, Dice A). */
export const OFFER_WAIT_MS = 60_000;

/** A die rolled for an offer: once per toast, so taking it off and on keeps it. */
interface Rolled {
  value: number;
  term: DiceRollDetail;
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
  let total = base.total;
  offers.forEach((o, i) => {
    const r = rolled[i];
    if (on[i] !== true || r === undefined) return;
    from.push({ term: terms.length, source: o.source });
    terms.push(r.term);
    total += r.value;
  });
  if (from.length === (base.meta?.from ?? []).length) return base;
  return { ...base, total, terms, meta: { ...base.meta, from } };
}

/** "1d8" as the chip says it: "d8". */
const dieWord = (dice: string) => dice.replace(/^1d/, 'd');

/** What an offered die's chip is named, for a screen reader. */
function offerName(o: RollOffer, rolled: Rolled | undefined, on: boolean): string {
  if (on && rolled !== undefined) return `${o.source}, ${rolled.value} added. Tap to take it off`;
  return `Add ${o.source}, +${dieWord(o.dice)}${o.ifFailed ? ', if the roll failed' : ''}`;
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
 * where the dice dock is on screen (Play and Stats), just above the dock, so
 * the roll mode the result was made in stays in sight.
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
 * made from the keyboard moves focus to the first die; Esc closes, and focus
 * goes back.
 */
export function RollToast() {
  const seq = useRollLog((s) => s.seq);
  const opensTray = useDiceTray((s) => s.mounted > 0);
  const [visible, setVisible] = useState<RollResult | null>(null);
  // The offered dice: rolled once each, and which are added.
  const [rolled, setRolled] = useState<ReadonlyArray<Rolled | undefined>>([]);
  const [added, setAdded] = useState<readonly boolean[]>([]);
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

  useEffect(() => {
    if (seq === shown.current) return;
    shown.current = seq;
    const latest = rollLogStore.getState().rolls[0];
    if (latest === undefined) return;
    setVisible(latest);
    setRolled([]);
    setAdded([]);
    setSettled(false);
    expiredAt.current = rollOffersStore.getState().expired;
    // The last toast is gone, and with it whatever pointer or focus it had.
    setHovered(false);
    setFocused(false);
    before.current = null;
    pressedBy.current = null;
    const active = document.activeElement;
    const fromKeys =
      (latest.meta?.offers?.length ?? 0) > 0 &&
      active instanceof HTMLElement &&
      keyboardFocus(active);
    focusOffer.current = fromKeys;
    returnTo.current = fromKeys ? (active as HTMLElement) : null;
    announce(rollAnnouncement(latest), { key: 'roll', repeat: true });
  }, [seq]);

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
  const deciding = offers.some((_, i) => added[i] !== true);
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
  const frame = `fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 rounded-sheet bg-surface py-3 pr-4 pl-3 shadow-overlay ring-inset ${TONE[tone].edge} motion-safe:animate-toast-in lg:right-6 lg:bottom-6 lg:left-auto lg:w-80 [:root:has([data-dice-dock])_&]:bottom-[calc(132px+env(safe-area-inset-bottom))] lg:[:root:has([data-dice-dock])_&]:bottom-20`;
  const row = 'flex items-center gap-3 text-left';
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
          {nat === 1 && flag('Natural 1', 'text-danger')}
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
      if (term === undefined || term.kind !== 'dice') return;
      r = { value: res.total, term };
    }
    const on = added[i] !== true;
    const nextRolled = [...rolled];
    nextRolled[i] = r;
    const nextAdded = [...added];
    nextAdded[i] = on;
    setRolled(nextRolled);
    setAdded(nextAdded);
    const next = withAdded(visible, nextRolled, nextAdded);
    rollLogStore.getState().replace(next);
    if (o.once && o.effectId !== undefined) rollOffersStore.getState().spend?.(o.effectId, on);
    announce(`${o.source} ${on ? `added, ${r.value}` : 'taken off'}. ${rollAnnouncement(next)}`, {
      key: 'roll',
      repeat: true,
    });
  };

  // The dice an effect offers, after the roll: tap to add, tap again to take off.
  const offerRow = offers.length > 0 && (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-line border-t pt-2">
      {offers.map((o, i) => {
        const on = added[i] === true;
        const r = rolled[i];
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: an offer's place is its identity in this roll
            key={i}
            ref={i === 0 ? firstOffer : undefined}
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
              </>
            )}
          </button>
        );
      })}
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

  // Keyed on the roll counter so a second roll while the first is still up
  // replays the animation instead of silently swapping the number. The dock
  // marks itself `data-dice-dock` (AdvToggle); its top is 124px up, and the
  // toast clears it by 8.
  const grouped = offerRow !== false;
  const history = opensTray && (
    <button
      type="button"
      // Named as it is said, not by its brackets, and for where it leads.
      aria-label={`${rollAnnouncement(current)}. Open roll history`}
      className={grouped ? `${row} w-full` : `${frame} ${row}`}
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
      <div key={seq} ref={setToast} className={`${frame} ${row}`} {...hold}>
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
      {history !== false ? history : <div className={row}>{body}</div>}
      {offerRow}
    </div>
  );
}
