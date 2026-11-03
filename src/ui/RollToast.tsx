import { HeartCrack, HeartPlus } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { rollDetail } from '@/dice/format';
import type { RollResult } from '@/dice/types';
import { announce } from '@/stores/announcer';
import { diceTrayStore, useDiceTray } from '@/stores/diceTray';
import { rollLogStore, useRollLog } from '@/stores/rollLog';
import { D20Icon } from './D20Icon';
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
 */
export function RollToast() {
  const seq = useRollLog((s) => s.seq);
  const opensTray = useDiceTray((s) => s.mounted > 0);
  const [visible, setVisible] = useState<RollResult | null>(null);
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
    // The last toast is gone, and with it whatever pointer or focus it had.
    setHovered(false);
    setFocused(false);
    before.current = null;
    pressedBy.current = null;
    announce(rollAnnouncement(latest), { key: 'roll', repeat: true });
  }, [seq]);

  const held = hovered || focused;
  useEffect(() => {
    if (visible === null || held) return;
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
  }, [visible, held]);

  if (visible === null) return null;
  const autoFail = visible.meta?.autoFail === true;
  const nat = naturalOf(visible);
  const tone = rollTone(visible);
  const Icon = tone === 'damage' ? HeartCrack : tone === 'heal' ? HeartPlus : D20Icon;
  const flag = (word: string, ink: string) => (
    <span className={`shrink-0 font-bold text-dice-small ${ink}`}>{word}</span>
  );

  const className = `fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-sheet bg-surface py-3 pr-4 pl-3 text-left shadow-overlay ring-inset ${TONE[tone].edge} motion-safe:animate-toast-in lg:right-6 lg:bottom-6 lg:left-auto lg:w-80 [:root:has([data-dice-dock])_&]:bottom-[calc(132px+env(safe-area-inset-bottom))] lg:[:root:has([data-dice-dock])_&]:bottom-20`;
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
          <span className="min-w-0 truncate text-body-strong">{visible.label ?? visible.expr}</span>
          {nat === 20 && flag('Natural 20!', 'text-heal')}
          {nat === 1 && flag('Natural 1', 'text-danger')}
          {autoFail && flag('Fails', 'text-danger')}
        </span>
        <span className="block truncate text-dice-small text-ink-muted tabular-nums">
          {rollDetail(visible)}
        </span>
        {/* What the character's conditions did to the roll, whole, since a
            cut line could hide why the total is what it is. */}
        {visible.meta?.cue !== undefined && (
          <span className="block text-caption text-guide">{visible.meta.cue}</span>
        )}
      </span>
      <span
        className={`shrink-0 text-stat tabular-nums motion-safe:animate-total-in ${ROLL_INK[tone]}`}
      >
        {visible.total}
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

  // Keyed on the roll counter so a second roll while the first is still up
  // replays the animation instead of silently swapping the number. The dock
  // marks itself `data-dice-dock` (AdvToggle); its top is 124px up, and the
  // toast clears it by 8.
  if (!opensTray) {
    return (
      <div key={seq} ref={setToast} className={className} {...hold}>
        {body}
      </div>
    );
  }
  return (
    <button
      key={seq}
      ref={setToast}
      type="button"
      // Named as it is said, not by its brackets, and for where it leads.
      aria-label={`${rollAnnouncement(visible)}. Open roll history`}
      className={className}
      {...hold}
      // A pressed button takes focus before its click, or never (Safari), so
      // what had it is read on the press; from the keyboard, as it arrives.
      onPointerDown={(event) => {
        hold.onPointerDown(event);
        const el = document.activeElement;
        if (el instanceof HTMLElement && el !== document.body && !toast.current?.contains(el)) {
          before.current = el;
        }
      }}
      onFocus={(event) => {
        setFocused(true);
        if (event.relatedTarget instanceof HTMLElement) before.current = event.relatedTarget;
      }}
      onBlur={() => setFocused(false)}
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
}
