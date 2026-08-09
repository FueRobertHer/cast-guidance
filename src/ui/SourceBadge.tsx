import { SOURCES_2024 } from '@/data5e/rulesVersion';
import { sourceName } from '@/data5e/sourceNames';

/** Titles like "Player's Handbook (2024)" already carry the year. */
const HAS_YEAR = /\(20\d\d\)/;

/** Full title for a source, with the edition spelled out when the title doesn't. */
export function sourceBadgeLabel(source: string): string {
  const full = sourceName(source);
  return SOURCES_2024.has(source) && !HAS_YEAR.test(full) ? `${full} (2024 rules)` : full;
}

/**
 * The book an entity came from. The code alone ("PHB", "TCE") is only legible
 * to someone who already reads 5etools shorthand, so the full title travels
 * with it two ways: `title` for a desktop hover, and visually-hidden text for
 * screen readers.
 *
 * Deliberately not `<abbr title>`: iOS VoiceOver ignores `title` entirely and
 * NVDA only announces it behind a non-default setting, so on the platform this
 * app is built for that markup would have expanded to nothing. Real (hidden)
 * text is announced everywhere. Touch users, who have no hover either, get the
 * title as visible text on the library detail page and in every ⓘ drawer.
 */
export function SourceBadge({
  source,
  /**
   * Set when the full title is already visible right beside the badge. The
   * badge then carries no text of its own, so a screen reader reads the book
   * once instead of twice in a row.
   */
  titleShownNearby = false,
}: {
  source: string;
  titleShownNearby?: boolean;
}) {
  const is2024 = SOURCES_2024.has(source);
  const label = sourceBadgeLabel(source);
  const className = `inline-block rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
    is2024 ? 'bg-emerald-900/60 text-emerald-300' : 'bg-surface-2 text-ink-muted'
  }`;

  if (titleShownNearby) {
    return (
      <span aria-hidden="true" className={className}>
        {source}
      </span>
    );
  }
  return (
    <span title={label} className={className}>
      <span aria-hidden="true">{source}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
