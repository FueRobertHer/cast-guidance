import { OUTSIDE_CHARACTER_SOURCES } from '@/data5e/sourceFilter';

/**
 * Marks a pick from a book outside the character's own source list. Words, not
 * a colour, so it reads the same to everyone; it labels the pick and never
 * blocks or removes it. Give it an `id` when a control's aria-label hides it,
 * so the control can point at it with aria-describedby.
 *
 * An outline badge (DS-001), as an older edition is on a 2024 character: both
 * say a pick sits outside the character's frame, and neither is a status. It
 * wraps rather than hold its row open at a narrow width.
 */
export function OutsideSourcesChip({ id }: { id?: string }) {
  return (
    <span
      id={id}
      className="inline-block self-start rounded-chip px-1.75 py-0.5 text-ink-muted text-overline tracking-[0.04em] ring-1 ring-line-strong ring-inset"
    >
      {OUTSIDE_CHARACTER_SOURCES}
    </span>
  );
}
