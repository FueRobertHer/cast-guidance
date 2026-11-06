import { isBook2024 } from '@/data5e/rulesVersion';
import { hasHomebrewTitle, sourceName } from '@/data5e/sourceNames';
import { badgeClass } from './Badge';

/** Titles like "Player's Handbook (2024)" already carry the year. */
const HAS_YEAR = /\(20\d\d\)/;

/** Full title for a source, with the edition spelled out when the title doesn't. */
export function sourceBadgeLabel(source: string): string {
  const full = sourceName(source);
  // A brew's own title stays as written, even on a code an official book shares:
  // the edition belongs to that book, and the brew's rows do not read as 2024.
  const rulesBook = isBook2024(source) && !hasHomebrewTitle(source);
  return rulesBook && !HAS_YEAR.test(full) ? `${full} (2024 rules)` : full;
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
 *
 * Every book's badge is the neutral one, the newest book's included (DS-001):
 * a green 2024 badge read as a status rather than as where a rule comes from.
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
  const label = sourceBadgeLabel(source);
  const className = `${badgeClass()} uppercase`;

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
