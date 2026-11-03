import { HeartCrack } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rollDetail } from '@/dice/format';
import type { RollResult } from '@/dice/types';
import { announce } from '@/stores/announcer';
import { useRollLog } from '@/stores/rollLog';
import { D20Icon } from './D20Icon';
import { ROLL_INK, type RollTone, rollTone } from './rollTone';

/**
 * The toast's edge and its tile. A plain result has the `line` hairline every
 * floating panel has; a nat 20 or nat 1 a 2px edge in its colour instead.
 */
const TONE: Record<RollTone, { edge: string; tile: string }> = {
  d20: { edge: 'ring-1 ring-line', tile: 'bg-roll-soft text-roll' },
  damage: { edge: 'ring-1 ring-line', tile: 'bg-danger-soft text-danger' },
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
  const nat = result.meta?.d20?.natural;
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

/**
 * Global roll feedback: whenever anything rolls, a toast slides up for a
 * moment so the result is never missed. It sits just above the tab bar, or
 * where the dice dock is on screen (Play and Stats), just above the dock, so
 * the roll mode the result was made in stays in sight.
 *
 * The toast is a plain visual. It remounts for every roll, and a region
 * that mounts with its text is announced unreliably, so the result is said
 * through the announcer (A11Y-002). Every roll is a new event, so the same
 * result twice is said twice; a burst of taps is cut to its first and last.
 */
export function RollToast() {
  const seq = useRollLog((s) => s.seq);
  const latest = useRollLog((s) => s.rolls[0]);
  const [visible, setVisible] = useState<RollResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The roll last said, so a re-render that hands over the same roll is quiet.
  const spoken = useRef(0);

  useEffect(() => {
    if (seq === 0 || latest === undefined) return;
    setVisible(latest);
    if (spoken.current !== seq) {
      spoken.current = seq;
      announce(rollAnnouncement(latest), { key: 'roll', repeat: true });
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(null), 2800);
    return () => clearTimeout(timer.current);
  }, [seq, latest]);

  if (visible === null) return null;
  const autoFail = visible.meta?.autoFail === true;
  // An automatic failure is not a natural 20 to celebrate, nor a natural 1.
  const nat = autoFail ? undefined : visible.meta?.d20?.natural;
  const tone = rollTone(visible);
  const Icon = tone === 'damage' ? HeartCrack : D20Icon;

  return (
    // Keyed on the roll counter so a second roll while the first is still up
    // replays the animation instead of silently swapping the number. The dock
    // marks itself `data-dice-dock` (AdvToggle); its top is 124px up, and
    // the toast clears it by 8.
    <div
      key={seq}
      className={`fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-sheet bg-surface py-3 pr-4 pl-3 shadow-overlay ring-inset ${TONE[tone].edge} motion-safe:animate-toast-in lg:right-6 lg:bottom-6 lg:left-auto lg:w-80 [:root:has([data-dice-dock])_&]:bottom-[calc(132px+env(safe-area-inset-bottom))] lg:[:root:has([data-dice-dock])_&]:bottom-20`}
    >
      <div
        className={`flex size-11 shrink-0 items-center justify-center rounded-[0.875rem] ${TONE[tone].tile}`}
      >
        <Icon size={24} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-strong">
          {visible.label ?? visible.expr}
          {nat === 20 && (
            <span className="ml-1.5 font-bold text-dice-small text-heal">Nat 20!</span>
          )}
          {nat === 1 && <span className="ml-1.5 font-bold text-danger text-dice-small">Nat 1</span>}
          {autoFail && <span className="ml-1.5 font-bold text-danger text-dice-small">Fails</span>}
        </div>
        <div className="truncate text-dice-small text-ink-muted tabular-nums">
          {rollDetail(visible)}
        </div>
        {/* What the character's conditions did to the roll, whole, since a
            cut line could hide why the total is what it is. */}
        {visible.meta?.cue !== undefined && (
          <div className="text-caption text-guide">{visible.meta.cue}</div>
        )}
      </div>
      <span
        className={`shrink-0 text-stat tabular-nums motion-safe:animate-total-in ${ROLL_INK[tone]}`}
      >
        {visible.total}
      </span>
    </div>
  );
}
