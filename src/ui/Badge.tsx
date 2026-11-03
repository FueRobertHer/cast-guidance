import type { ReactNode } from 'react';

/**
 * A small label on a card or row that is not a control (DS-001): where
 * something comes from (XPHB, Homebrew), or a short status.
 *
 * `neutral` is the default, and is what every source badge is, the newest
 * book included: a green 2024 badge read as a status. `outline` marks an
 * older edition on a 2024 character. A tinted tone carries its role's
 * meaning: `arcane` a spell DC, `guide` choices to make, `heal` done,
 * `danger` a problem.
 */
export type BadgeTone = 'neutral' | 'outline' | 'arcane' | 'guide' | 'heal' | 'danger';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-raised text-ink-muted',
  outline: 'text-ink-muted ring-1 ring-line-strong ring-inset',
  arcane: 'bg-arcane-soft text-arcane',
  guide: 'bg-guide-soft text-guide',
  heal: 'bg-heal-soft text-heal',
  danger: 'bg-danger-soft text-danger',
};

export function badgeClass(tone: BadgeTone = 'neutral'): string {
  return `inline-flex h-5.5 items-center gap-1 whitespace-nowrap rounded-chip px-1.75 text-overline tracking-[0.04em] ${TONE[tone]}`;
}

export function Badge({
  tone,
  children,
  className,
}: {
  tone?: BadgeTone;
  /** The text, with an optional 14px Lucide icon before it. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`${badgeClass(tone)}${className ? ` ${className}` : ''}`}>{children}</span>
  );
}
