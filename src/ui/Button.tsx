import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The app's button (DS-001). The variant says how much the action matters:
 *
 * - `brand`: the one next step on a screen, and never two on screen at once
 *   (the action blue, with an `on-brand` label).
 * - `secondary`: an action beside the primary one (Back, Cancel).
 * - `outline`: an action that belongs to a card (Short rest, Use, Edit).
 * - `ghost`: low stakes or navigation (Skip for now, an icon-only History).
 * - `danger`: destroys data, and is always behind a confirmation.
 * - `damage` and `heal`: the HP card's two actions, and nothing else.
 *
 * Labels are sentence case and start with the verb ("Create character"), with
 * an optional 18px Lucide icon before them. A disabled button needs its reason
 * nearby ("Pick 1 more to confirm").
 *
 * Sizes: `md` is 44px tall, `lg` 52px (a wizard's footer, a sheet's confirm),
 * `icon` a 44px square. `sm` looks 36px tall for header and row actions but
 * still takes a 44px tap (A11Y-002): a transparent border pads the box, and
 * the fill is clipped inside it, so axe and the target-size check measure 44.
 */
export type ButtonVariant =
  | 'brand'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'damage'
  | 'heal';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap transition-[background-color,color,transform,filter] duration-120 ease-out active:scale-97 unavailable:cursor-default unavailable:bg-surface-raised unavailable:text-ink-faint unavailable:ring-0 unavailable:filter-none unavailable:active:scale-100';

const VARIANT: Record<ButtonVariant, string> = {
  brand: 'bg-brand text-on-brand hover:bg-brand-hover',
  secondary: 'bg-surface-raised text-ink hover:bg-surface-hover',
  outline: 'text-ink ring-1 ring-line-strong ring-inset hover:bg-surface-raised',
  ghost: 'text-ink-muted hover:bg-surface-raised hover:text-ink',
  danger: 'bg-danger-fill text-on-danger hover:brightness-108',
  damage: 'bg-danger-soft text-danger hover:brightness-112',
  heal: 'bg-heal-soft text-heal hover:brightness-112',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-tap min-w-tap rounded-control px-4 text-body-strong',
  // 10px corners on the visible fill: 4px of border plus the fill's own 10.
  sm: 'min-h-tap min-w-tap rounded-[0.875rem] border-4 border-transparent bg-clip-padding [--tap-inset:0.25rem] px-2 text-label',
  lg: 'min-h-13 min-w-tap rounded-[0.75rem] px-5 text-body-strong',
  icon: 'size-tap rounded-control',
};

/** The classes of a button, for a link or a label that has to look like one. */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  block = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width, as a sheet's confirm or a list's closing action. */
  block?: boolean;
} = {}): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}${block ? ' w-full' : ''}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export function Button({
  variant,
  size,
  block,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClass({ variant, size, block })}${className ? ` ${className}` : ''}`}
      {...props}
    />
  );
}

/**
 * A count inside a button, for choices still to make ("Edit 2"): `guide`, the
 * colour of things waiting on the player. The button's label says what it
 * counts, for a screen reader.
 */
export function ButtonCount({ children }: { children: ReactNode }) {
  return (
    <span className="h-5 min-w-5 rounded-full bg-guide-soft px-1.5 text-center font-bold text-[0.75rem] text-guide leading-5 tabular-nums">
      {children}
    </span>
  );
}
