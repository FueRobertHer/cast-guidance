import { Dices } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rollDetail } from '@/dice/format';
import type { RollResult } from '@/dice/types';
import { announce } from '@/stores/announcer';
import { useRollLog } from '@/stores/rollLog';

/**
 * Nat 20 and nat 1 are the two results worth spotting from across the table,
 * so they get the whole snackbar rather than a word at the end of a line.
 * Everything else takes the bright neutral edge, which still has to stand off
 * a page whose cards are the same near-black.
 */
const TONE = {
  crit: { edge: 'border-emerald-400 shadow-emerald-500/25', ink: 'text-emerald-300' },
  fumble: { edge: 'border-accent shadow-accent/25', ink: 'text-accent' },
  plain: { edge: 'border-ink/30 shadow-black/70', ink: 'text-ink' },
} as const;

/** Which tone a result gets; see {@link TONE}. */
export function rollTone(result: RollResult): keyof typeof TONE {
  const nat = result.meta?.d20?.natural;
  return nat === 20 ? 'crit' : nat === 1 ? 'fumble' : 'plain';
}

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
  const flag = nat === 20 ? ', natural 20' : nat === 1 ? ', natural 1' : '';
  const dice = result.terms.map((t, i) => termSpeech(t, i === 0)).join(', ');
  const rolled = dice === '' ? '' : `. Rolled ${dice}`;
  return `${result.label ?? result.expr}${flag}: ${result.total}${rolled}`;
}

/**
 * Global roll feedback: whenever anything rolls, a snackbar slides up above
 * the tab bar for a moment so the result is never missed.
 *
 * The snackbar is a plain visual. It remounts for every roll, and a region
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
  const nat = visible.meta?.d20?.natural;
  const tone = TONE[rollTone(visible)];

  return (
    // Keyed on the roll counter so a second roll while the first is still up
    // replays the animation instead of silently swapping the number.
    <div
      key={seq}
      className={`fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-xl border-2 ${tone.edge} bg-surface-2 px-4 py-3 shadow-2xl motion-safe:animate-toast-in lg:right-6 lg:left-auto lg:w-80`}
    >
      <Dices size={20} aria-hidden className={`shrink-0 ${tone.ink}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">
          {visible.label ?? visible.expr}
          {nat === 20 && <span className="ml-1.5 text-emerald-300">Nat 20!</span>}
          {nat === 1 && <span className="ml-1.5 text-accent">Nat 1</span>}
        </div>
        <div className="truncate font-mono text-xs text-ink-muted">{rollDetail(visible)}</div>
      </div>
      <span
        className={`shrink-0 text-3xl font-bold tabular-nums motion-safe:animate-total-in ${tone.ink}`}
      >
        {visible.total}
      </span>
    </div>
  );
}
