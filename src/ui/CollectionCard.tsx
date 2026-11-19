import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cardClass } from './surfaces';

/**
 * One set of content as a card (the One Workshop canvas, board 1): its name,
 * where it came from, how much it holds and where it is on, with a badge for
 * what needs the player, the whole card opening it.
 */
export function CollectionCard({
  to,
  name,
  from,
  holds,
  badge,
}: {
  to: string;
  name: string;
  /** Where it came from ("Yours. Made in this app"). */
  from: string;
  /** How much it holds and where it is on ("2 entries. On"). */
  holds: string;
  badge?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`${cardClass} flex items-start gap-3 transition-colors duration-120 hover:bg-surface-raised`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body-strong break-words">{name}</span>
        {/* A flex column draws no space between its items; a name read aloud needs one. */}
        <span className="sr-only">,</span>{' '}
        <span className="text-caption text-ink-muted">{from}</span>
        <span className="sr-only">,</span>{' '}
        <span className="text-caption text-ink-muted">{holds}</span>
        {badge !== undefined && <span className="mt-1.5 flex flex-wrap gap-1.5">{badge}</span>}
      </span>
      <ChevronRight size={18} aria-hidden className="mt-0.5 shrink-0 text-ink-muted" />
    </Link>
  );
}
