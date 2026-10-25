import { OUTSIDE_CHARACTER_SOURCES } from '@/data5e/sourceFilter';

/**
 * Marks a pick from a book outside the character's own source list. Words, not
 * a colour, so it reads the same to everyone; it labels the pick and never
 * blocks or removes it. Give it an `id` when a control's aria-label hides it,
 * so the control can point at it with aria-describedby.
 */
export function OutsideSourcesChip({ id }: { id?: string }) {
  return (
    <span
      id={id}
      className="inline-block self-start rounded border border-amber-300/40 px-1 py-0.5 text-[10px] font-medium text-amber-200"
    >
      {OUTSIDE_CHARACTER_SOURCES}
    </span>
  );
}
