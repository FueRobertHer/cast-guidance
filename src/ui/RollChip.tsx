import { useEffect, useRef, useState } from 'react';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import { rollLogStore } from '@/stores/rollLog';

export interface RollChipProps {
  /** Dice expression, e.g. "2d6+3". Invalid expressions render as plain text. */
  expr: string;
  /** What shows on the chip; defaults to the expression. */
  display?: string;
  /** Log label, e.g. "Fireball damage". */
  label?: string;
  variant?: 'dice' | 'damage' | 'd20';
}

/** Tappable inline dice roll. Shows the result on the chip for a moment. */
export function RollChip({ expr, display, label, variant = 'dice' }: RollChipProps) {
  const [result, setResult] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const valid = useRef<boolean | null>(null);

  if (valid.current === null) {
    try {
      parseDice(expr);
      valid.current = true;
    } catch {
      valid.current = false;
    }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!valid.current) return <span>{display ?? expr}</span>;

  const onRoll = () => {
    const r = roll(expr, { label });
    rollLogStore.getState().append(r);
    setResult(r.total);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), 1600);
  };

  const color =
    variant === 'damage'
      ? 'text-orange-300 border-orange-300/30'
      : 'text-sky-300 border-sky-300/30';

  return (
    <button
      type="button"
      onClick={onRoll}
      className={`inline-block cursor-pointer rounded border bg-surface px-1 font-mono text-[0.85em] leading-snug align-baseline hover:bg-surface-2 ${color}`}
      title={label ?? expr}
    >
      {result !== null ? <strong>{result}</strong> : (display ?? expr)}
    </button>
  );
}
