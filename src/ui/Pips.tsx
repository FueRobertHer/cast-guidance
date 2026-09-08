interface PipsProps {
  /** How many uses the pool holds when full. */
  total: number;
  /** How many of them are already spent. */
  spent: number;
  onChange: (spent: number) => void;
  /**
   * Names one use for assistive tech, numbered in the order they are spent, so
   * use 1 is the first one you burn. Colour is the only cue sighted players
   * get, so each pip also reports whether it is pressed (spent).
   */
  label: (use: number) => string;
  /** Classes for a use still available; a spent one is always the flat grey. */
  tone: string;
  title?: string;
}

/**
 * A row of uses, spent from the right.
 *
 * Draining left to right meant the pips you had left drifted away from the
 * name they belong to, and the count you actually want ("how many are still
 * lit") started somewhere in the middle of the row. Spending from the right
 * keeps what remains anchored under the label, so the row reads like a bar
 * going down rather than a progress bar filling up: at a glance the lit run on
 * the left IS the number left.
 *
 * Tapping an available pip spends it and everything to its right; tapping a
 * spent one gives back it and everything to its left, so a mis-tap costs one
 * tap to undo.
 *
 * Renders the pips alone, with no wrapper: the caller supplies the flex row
 * they sit in, since the row is usually shared with a label or a count.
 */
export function Pips({ total, spent, onChange, label, tone, title }: PipsProps) {
  const remaining = total - spent;
  return (
    <>
      {Array.from({ length: total }, (_, i) => {
        const available = i < remaining;
        return (
          <button
            key={`pip-${String(i)}`}
            type="button"
            aria-label={label(total - i)}
            aria-pressed={!available}
            title={title}
            onClick={() => onChange(available ? total - i : total - i - 1)}
            className={`h-4 w-4 rounded-full border ${
              available ? tone : 'border-surface-2 bg-surface-2'
            }`}
          />
        );
      })}
    </>
  );
}
