import { useEffect, useRef, useState } from 'react';
import type { RollResult } from '@/dice/types';
import { useRollLog } from '@/stores/rollLog';

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
  const detail = visible.terms
    .map((t) =>
      t.kind === 'dice'
        ? `[${t.rolls.map((x) => (x.kept ? x.v : `(${x.v})`)).join(',')}]`
        : t.value >= 0
          ? `+${t.value}`
          : `${t.value}`,
    )
    .join(' ');

  return (
    <output
      className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 rounded-lg border border-surface-2 bg-surface/95 px-4 py-2.5 shadow-lg backdrop-blur lg:left-auto lg:right-6 lg:w-80"
      aria-live="polite"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">
          {visible.label ?? visible.expr}
          {nat === 20 && <span className="ml-1.5 text-emerald-300">Nat 20!</span>}
          {nat === 1 && <span className="ml-1.5 text-accent">Nat 1</span>}
        </div>
        <div className="truncate font-mono text-xs text-ink-muted">{detail}</div>
      </div>
      <span
        className={`shrink-0 text-2xl font-bold ${
          nat === 20 ? 'text-emerald-300' : nat === 1 ? 'text-accent' : ''
        }`}
      >
        {visible.total}
      </span>
    </output>
  );
}
