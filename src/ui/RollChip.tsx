import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { parseDice } from '@/dice/parse';
import { roll } from '@/dice/roll';
import type { RollKind, RollResult } from '@/dice/types';
import type { D20Ask } from '@/features/sheet/d20Tests';
import { currentAdvantage } from '@/stores/advMode';
import { attackInPlay, rollFrom } from '@/stores/heldRoll';
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
  /**
   * Fires after a successful roll (e.g. to spend a limited-use resource), once
   * it lands: a d20 test that waits in the roll prompt fires it then,
   * and one cancelled never does.
   */
  onRolled?: (total: number) => void;
  /**
   * Asks about a sheet's d20 test in place of the chip's own roll (`d20Ask`):
   * the roll prompt opens, with the chip's look in its header, and the chip
   * tapped again or Roll rolls it. The chip still shows and logs what lands.
   */
  roller?: () => D20Ask;
  /**
   * An attack chip's damage, which its result offers after a hit (the rolls
   * canvas): rolled as that damage chip rolls it, so a crit doubles it.
   */
  damageAfter?: { expr: string; label?: string; withAttack?: RollChipProps['withAttack'] };
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
  /**
   * The attack a damage chip's roll goes with: the character's (`by`) attack
   * named `of` (a weapon's or a spell's), or any of theirs when `of` is absent
   * (Sneak Attack). When the attack in play (`attackInPlay`) is that one and
   * it crit, the dice roll twice and the modifiers once, and `critDice` roll
   * in after them, named (Savage Attacks' extra weapon die).
   */
  withAttack?: { by: string; of?: string; critDice?: { dice: string; source: string } };
}

/** Can this be rolled? Free text (a custom attack's damage) cannot. */
function isDice(expr: string): boolean {
  try {
    parseDice(expr);
    return true;
  } catch {
    return false;
  }
}

/** Did the attack this damage goes with crit? */
function critFor(withAttack: NonNullable<RollChipProps['withAttack']>): boolean {
  const attack = attackInPlay();
  return (
    attack?.crit === true &&
    attack.by === withAttack.by &&
    (withAttack.of === undefined || attack.of === withAttack.of)
  );
}

/**
 * A chip's own roll: d20-style dice under the dock's mode, and damage that goes
 * with an attack that crit rolls its dice twice, with `critDice` after them.
 */
function chipRoll(
  expr: string,
  label: string | undefined,
  variant: NonNullable<RollChipProps['variant']>,
  withAttack: RollChipProps['withAttack'],
): RollResult {
  const crit = variant === 'damage' && withAttack !== undefined && critFor(withAttack);
  const result = roll(expr, {
    label,
    // d20-style chips honor the global advantage toggle.
    advantage: variant === 'd20' ? currentAdvantage() : undefined,
    kind: KIND[variant],
    ...(crit ? { critical: true } : {}),
  });
  const extra = crit ? withAttack?.critDice : undefined;
  return extra === undefined ? result : withDice(result, extra.dice, extra.source);
}

/** A roll with dice of its own added after its terms, named for what adds them. */
function withDice(result: RollResult, dice: string, source: string): RollResult {
  const added = roll(dice);
  return {
    ...result,
    total: result.total + added.total,
    terms: [...result.terms, ...added.terms],
    meta: {
      ...result.meta,
      from: [
        ...(result.meta?.from ?? []),
        ...added.terms.flatMap((t, i) =>
          t.kind === 'dice' ? [{ term: result.terms.length + i, source }] : [],
        ),
      ],
    },
  };
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
  damageAfter,
  inline,
  wear,
  raisedBy = [],
  withAttack,
}: RollChipProps) {
  const [result, setResult] = useState<number | null>(null);
  const [rolls, setRolls] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const valid = useRef<boolean | null>(null);

  if (valid.current === null) valid.current = isDice(expr);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!valid.current) return <span>{display ?? expr}</span>;

  const raised = raisedBy.length > 0;

  // The roll lands through `rollFrom`: a d20 test waits in the roll prompt
  // first, and the total and `onRolled` wait for it. Damage tapped while an
  // attack waits, when it goes with one, is made once the attack lands, so a
  // crit doubles it.
  const onRoll = (event: MouseEvent<HTMLButtonElement>) =>
    rollFrom(
      event.currentTarget,
      () => roller?.() ?? chipRoll(expr, label, variant, withAttack),
      (r) => {
        onRolled?.(r.total);
        setResult(r.total);
        setRolls((n) => n + 1);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setResult(null), TOTAL_MS);
      },
      {
        face: { text: display ?? expr, wear, lift: raised },
        ...(variant === 'damage' && withAttack !== undefined
          ? { joins: { label: label ?? 'Damage' } }
          : {}),
        ...(damageAfter === undefined || !isDice(damageAfter.expr)
          ? {}
          : {
              afterHit: {
                expr: damageAfter.expr,
                go: () =>
                  rollFrom(null, () =>
                    chipRoll(damageAfter.expr, damageAfter.label, 'damage', damageAfter.withAttack),
                  ),
              },
            }),
      },
    );

  const text =
    result !== null ? (
      <strong className="inline-block motion-safe:animate-total-in">{result}</strong>
    ) : (
      (display ?? expr)
    );

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
