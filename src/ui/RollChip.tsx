import { useEffect, useRef, useState } from 'react';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import type { RollKind, RollResult } from '@/dice/types';
import { currentAdvantage } from '@/stores/advMode';
import { rollLogStore } from '@/stores/rollLog';
import { ChipFace, type ChipWear, TOTAL_MS } from './ChipFace';
import { Lift } from './Lift';

export interface RollChipProps {
  /** Dice expression, e.g. "2d6+3". Invalid expressions render as plain text. */
  expr: string;
  /** What shows on the chip; defaults to the expression. */
  display?: string;
  /** Log label, e.g. "Fireball damage". */
  label?: string;
  /**
   * The chip's colour: `roll` for a d20 (`d20`) and other dice (`dice`),
   * `danger` for damage, `heal` for healing.
   */
  variant?: 'dice' | 'damage' | 'd20' | 'heal';
  /** Fires after a successful roll (e.g. to spend a limited-use resource). */
  onRolled?: (total: number) => void;
  /**
   * Makes the roll in place of the chip's own: a sheet's d20 test, which the
   * character's conditions change (`rollD20Test`). The chip still shows and
   * logs what it returns.
   */
  roller?: () => RollResult;
  /**
   * In running text: sized by the line, as WCAG 2.5.8 allows a target in a
   * sentence. Otherwise (a row of controls) the chip is at least 24 by 24.
   * Marked `data-inline-target`, the one exemption the E2E size check allows.
   */
  inline?: boolean;
  /**
   * The conditions that reach the roll, for a chip they can change: a sheet's
   * attack chips and the dice chip that casts a spell, plain ones included, so a
   * condition can arrive on them. It draws the chip on a `ChipFace`, in the same
   * tone; every other chip has no use for one.
   */
  wear?: ChipWear | undefined;
  /**
   * The effects in play that raised this roll (Rage on a damage chip): the
   * chip wears their ring and lift mark, and its name says who raised it. On a
   * chip that wears conditions they are its face's, so they move with it.
   */
  raisedBy?: readonly string[];
}

/**
 * The kind a chip's roll is logged with, so the toast and the history colour
 * it as the chip does. Plain `dice` have no known use, so they get none.
 */
const KIND: Record<NonNullable<RollChipProps['variant']>, RollKind | undefined> = {
  dice: undefined,
  d20: 'd20',
  damage: 'damage',
  heal: 'heal',
};

/** A chip's tone: its text colour on that colour's tint (DS-001). */
const TONE: Record<NonNullable<RollChipProps['variant']>, string> = {
  dice: 'bg-roll-soft text-roll',
  d20: 'bg-roll-soft text-roll',
  damage: 'bg-danger-soft text-danger',
  heal: 'bg-heal-soft text-heal',
};

/** The same tone on a `ChipFace`: roll blue is its own plain colour. */
const FACE_TONE: Record<NonNullable<RollChipProps['variant']>, 'danger' | 'heal' | undefined> = {
  dice: undefined,
  d20: undefined,
  damage: 'danger',
  heal: 'heal',
};

/**
 * Tappable dice roll. Shows the result on the chip for a moment, landing as
 * the toast's total does. In a row of controls it is 34px tall, a tap past
 * WCAG 2.5.8's 24 without crowding an attack row's other chips.
 */
export function RollChip({
  expr,
  display,
  label,
  variant = 'dice',
  onRolled,
  roller,
  inline,
  wear,
  raisedBy = [],
}: RollChipProps) {
  const [result, setResult] = useState<number | null>(null);
  const [rolls, setRolls] = useState(0);
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
    const r =
      roller?.() ??
      roll(expr, {
        label,
        advantage: variant === 'd20' ? currentAdvantage() : undefined,
        kind: KIND[variant],
      });
    rollLogStore.getState().append(r);
    onRolled?.(r.total);
    setResult(r.total);
    setRolls((n) => n + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult(null), TOTAL_MS);
  };

  const text =
    result !== null ? (
      <strong className="inline-block motion-safe:animate-total-in">{result}</strong>
    ) : (
      (display ?? expr)
    );

  const raised = raisedBy.length > 0;
  const chip = (
    <button
      type="button"
      onClick={onRoll}
      data-inline-target={inline ? '' : undefined}
      className={`${
        inline
          ? 'inline-block px-1.25 py-px align-baseline text-[0.92em] leading-snug'
          : `inline-flex h-8.5 min-w-13 items-center justify-center text-dice ${
              wear === undefined ? 'px-2' : 'relative'
            }`
      } rounded-chip font-semibold tabular-nums transition-[filter,transform] duration-120 ease-out hover:brightness-112 active:scale-95 ${
        wear === undefined ? TONE[variant] : ''
      }`}
      title={label ?? expr}
    >
      {wear === undefined ? (
        text
      ) : (
        <ChipFace
          wear={wear}
          rolls={rolls}
          showing={result !== null}
          tone={FACE_TONE[variant]}
          lift={inline ? undefined : raised}
        >
          {text}
        </ChipFace>
      )}
      {raised && <span className="sr-only">, raised by {raisedBy.join(', ')}</span>}
    </button>
  );
  // Always wrapped in a row, so the ring can draw in as an effect arrives; a
  // chip in running text never wears one, and a face draws its own.
  return inline || wear !== undefined ? (
    chip
  ) : (
    <Lift on={raised} className="rounded-chip">
      {chip}
    </Lift>
  );
}
