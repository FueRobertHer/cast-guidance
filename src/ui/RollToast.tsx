import { Dices } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rollDetail } from '@/dice/format';
import type { RollResult } from '@/dice/types';
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

/**
 * Global roll feedback: whenever anything rolls, a snackbar slides up above
 * the tab bar for a moment so the result is never missed.
 */
export function RollToast() {
  const seq = useRollLog((s) => s.seq);
  const latest = useRollLog((s) => s.rolls[0]);
  const [visible, setVisible] = useState<RollResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (seq === 0 || latest === undefined) return;
    setVisible(latest);
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
    <output
      key={seq}
      className={`fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-xl border-2 ${tone.edge} bg-surface-2 px-4 py-3 shadow-2xl motion-safe:animate-toast-in lg:right-6 lg:left-auto lg:w-80`}
      aria-live="polite"
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
    </output>
  );
}
