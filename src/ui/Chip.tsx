import type { ButtonHTMLAttributes } from 'react';

/**
 * A pill-shaped control for a short value (DS-001): a filter or preset to
 * pick, an active condition to tap. 32px tall to the eye, a 44px tap
 * (A11Y-002) from a transparent border, as the small button does.
 *
 * With `pressed`, it is a toggle (`aria-pressed`), and a pressed chip is a
 * filled `ink` pill: selection is ink in this system, never a hue. `outline`
 * is for an empty or "add" chip that invites a first value.
 *
 * Its label stays on one line wherever it fits, and wraps (centred) only
 * where it is wider than the space it has, as with large text on a phone,
 * rather than running out of the chip and the screen (A11Y-003).
 */
export type ChipTone = 'raised' | 'outline';

// Hover is for the unpressed chip only: on a pressed one it would repaint the
// ink pill.
const TONE: Record<ChipTone, string> = {
  raised: 'bg-surface-raised text-ink not-aria-pressed:hover:bg-surface-hover',
  outline: 'text-ink-muted ring-1 ring-line-strong ring-inset not-aria-pressed:hover:text-ink',
};

export function chipClass(tone: ChipTone = 'raised'): string {
  return `inline-flex min-h-tap min-w-tap items-center justify-center gap-1.5 text-center rounded-full border-[0.375rem] border-transparent bg-clip-padding [--tap-inset:0.375rem] px-1.5 text-label transition-colors duration-120 aria-pressed:bg-ink aria-pressed:text-bg aria-pressed:ring-0 ${TONE[tone]}`;
}

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ChipTone;
  /** Makes the chip a toggle, drawn filled while true. */
  pressed?: boolean;
}

export function Chip({ tone, pressed, className, type = 'button', ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={`${chipClass(tone)}${className ? ` ${className}` : ''}`}
      {...props}
    />
  );
}
