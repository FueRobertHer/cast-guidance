import { type LucideIcon, X } from 'lucide-react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

/**
 * A one-line, app-level message (DS-001). It sits in the page above the
 * screen and pushes it down, never over it, so it cannot cover the title or
 * the control someone is reaching for.
 *
 * The tone says what kind of message it is:
 * - `guide` (on `guide-soft`): something to do, such as an update to install;
 * - `neutral` (on `surface-raised`): something to know, such as the
 *   character being open in another tab;
 * - `danger` (`danger-fill`, `on-danger` text): something failing, such as a
 *   save. Several banners stack danger first.
 *
 * An icon, a sentence of 13px text, and one action, two only where the
 * choice cannot be put off (a save conflict).
 */
export type BannerTone = 'guide' | 'neutral' | 'danger';

const TONE: Record<BannerTone, string> = {
  guide: 'bg-guide-soft text-ink',
  neutral: 'bg-surface-raised text-ink',
  danger: 'bg-danger-fill text-on-danger',
};

const ICON: Record<BannerTone, string> = {
  guide: 'text-guide',
  neutral: 'text-ink-muted',
  danger: '',
};

/**
 * The banner's own box, for a banner whose element has to stay mounted when
 * empty (a live region): spread it as `{...bannerProps(tone)}`, which also
 * marks the ground for the focus ring (see `data-ground` in app.css).
 */
export function bannerProps(tone: BannerTone): {
  className: string;
  'data-ground'?: 'danger';
} {
  return {
    // From `lg` the pages clear the fixed side rail with `pl-40`; a banner
    // spans the same width, so it clears it the same way.
    className: `flex flex-wrap items-center gap-x-3 gap-y-1 py-1 pr-2 pl-4 text-caption lg:pl-40 ${TONE[tone]}`,
    ...(tone === 'danger' ? { 'data-ground': 'danger' as const } : {}),
  };
}

export function BannerIcon({ tone, icon: Icon }: { tone: BannerTone; icon: LucideIcon }) {
  return <Icon size={16} aria-hidden="true" className={`shrink-0 ${ICON[tone]}`} />;
}

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  tone: BannerTone;
  icon?: LucideIcon;
  /** The message: kept a direct child so the text can find its banner. */
  children: ReactNode;
  /** One `BannerAction`, two at most. */
  actions?: ReactNode;
}

export function Banner({ tone, icon, children, actions, ...rest }: BannerProps) {
  return (
    <div {...rest} {...bannerProps(tone)}>
      {icon !== undefined && <BannerIcon tone={tone} icon={icon} />}
      <span className="min-w-0 flex-1">{children}</span>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap gap-1">{actions}</div>}
    </div>
  );
}

/**
 * A banner's action: 32px to the eye, a 44px tap (A11Y-002) from a
 * transparent border. `primary` is the filled one, `secondary` an outline.
 */
const ACTION: Record<BannerTone, Record<'primary' | 'secondary', string>> = {
  guide: {
    primary: 'bg-surface text-ink hover:bg-surface-raised',
    secondary: 'text-ink ring-1 ring-line-strong ring-inset hover:bg-surface',
  },
  neutral: {
    primary: 'bg-surface text-ink hover:bg-surface-hover',
    secondary: 'text-ink ring-1 ring-line-strong ring-inset hover:bg-surface',
  },
  // A white button with the fill's red as its label: a translucent white
  // pill, as drawn, left white text at 4.1:1 on the dark theme's red.
  danger: {
    primary: 'bg-on-danger text-danger-fill',
    secondary: 'text-on-danger ring-1 ring-on-danger ring-inset',
  },
};

const DISMISS: Record<BannerTone, string> = {
  guide: 'text-ink-muted hover:bg-surface hover:text-ink',
  neutral: 'text-ink-muted hover:bg-surface hover:text-ink',
  danger: 'text-on-danger',
};

/**
 * A banner's "not now" as an X, 32px to the eye and a 44px tap (A11Y-002).
 * `label` is the word it stands for, which is what a screen reader says.
 */
export function BannerDismiss({
  tone,
  label,
  className,
  type = 'button',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  tone: BannerTone;
  label: string;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`inline-flex size-tap shrink-0 items-center justify-center rounded-[0.875rem] border-[0.375rem] border-transparent bg-clip-padding [--tap-inset:0.375rem] transition-colors duration-120 ${DISMISS[tone]}${className ? ` ${className}` : ''}`}
      {...props}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}

export interface BannerActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone: BannerTone;
  emphasis?: 'primary' | 'secondary';
}

export function BannerAction({
  tone,
  emphasis = 'primary',
  className,
  type = 'button',
  ...props
}: BannerActionProps) {
  return (
    <button
      type={type}
      data-emphasis={emphasis}
      className={`inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[0.875rem] border-[0.375rem] border-transparent bg-clip-padding [--tap-inset:0.375rem] px-1.5 font-bold text-caption transition-colors duration-120 unavailable:cursor-default unavailable:opacity-60 ${ACTION[tone][emphasis]}${className ? ` ${className}` : ''}`}
      {...props}
    />
  );
}
