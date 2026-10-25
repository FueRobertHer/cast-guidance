import { useEffect, useRef, useState } from 'react';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import { currentAdvantage } from '@/stores/advMode';
import { rollLogStore } from '@/stores/rollLog';

export interface RollChipProps {
  /** Dice expression, e.g. "2d6+3". Invalid expressions render as plain text. */
  expr: string;
  /** What shows on the chip; defaults to the expression. */
  display?: string;
  /** Log label, e.g. "Fireball damage". */
  label?: string;
  variant?: 'dice' | 'damage' | 'd20';
  /** Fires after a successful roll (e.g. to spend a limited-use resource). */
  onRolled?: (total: number) => void;
  /**
   * In running text: sized by the line, as WCAG 2.5.8 allows a target in a
   * sentence. Otherwise (a row of controls) the chip is at least 24 by 24.
   * Marked `data-inline-target`, the one exemption the E2E size check allows.
   */
  inline?: boolean;
}

/** Tappable dice roll. Shows the result on the chip for a moment. */
export function RollChip({
  expr,
  display,
  label,
  variant = 'dice',
  onRolled,
  inline,
}: RollChipProps) {
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
    // d20-style chips honor the global advantage toggle.
    const r = roll(expr, {
      label,
      advantage: variant === 'd20' ? currentAdvantage() : undefined,
    });
    rollLogStore.getState().append(r);
    onRolled?.(r.total);
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
      data-inline-target={inline ? '' : undefined}
      className={`${
        inline
          ? 'inline-block align-baseline'
          : 'inline-flex min-h-6 min-w-6 items-center justify-center'
      } cursor-pointer rounded border bg-surface px-1 font-mono text-[0.85em] leading-snug hover:bg-surface-2 ${color}`}
      title={label ?? expr}
    >
      {result !== null ? <strong>{result}</strong> : (display ?? expr)}
    </button>
  );
}
