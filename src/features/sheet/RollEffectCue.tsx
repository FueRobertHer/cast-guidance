import { AlertTriangle } from 'lucide-react';
import { Chip } from '@/ui/Chip';

/**
 * What the character's conditions do to the rolls that start here, said
 * before the roll: a `guide` line per effect ("Disadvantage: Poisoned"), then
 * what the sheet cannot decide for itself in `ink-muted` ("Blinded: you fail
 * checks that need sight"). "Ignore once" makes the next roll here without
 * them, then lets go; switching a condition off for longer is on its own
 * sheet, from the condition strip. With nothing to say it is nothing.
 *
 * The button wraps under the lines where both do not fit, as a narrow phone
 * or large text needs, rather than squeezing them.
 */
export function RollEffectCue({
  heading,
  lines,
  notes = [],
  rolls,
  ignored,
  onIgnore,
}: {
  /** What the lines are about, where nothing nearby says: "Initiative". */
  heading?: string;
  lines: readonly string[];
  notes?: readonly string[];
  /** The rolls it is about, for the button's name: "attack roll", "save". */
  rolls: string;
  ignored: boolean;
  onIgnore: () => void;
}) {
  if (lines.length === 0 && notes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 px-1">
      <div className="flex min-w-0 flex-1 basis-48 gap-1.5 py-0.5 text-caption">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-guide" aria-hidden="true" />
        <div className="flex min-w-0 flex-col">
          {heading !== undefined && <span className="font-semibold text-guide">{heading}</span>}
          {lines.map((line) => (
            <span key={line} className="text-guide">
              {line}
            </span>
          ))}
          {notes.map((note) => (
            <span key={note} className="text-ink-muted">
              {note}
            </span>
          ))}
        </div>
      </div>
      {lines.length > 0 && (
        <Chip
          tone="outline"
          pressed={ignored}
          onClick={onIgnore}
          aria-label={`Ignore once: your next ${rolls} without these effects`}
          className="-my-1.5 shrink-0 px-3"
        >
          Ignore once
        </Chip>
      )}
    </div>
  );
}
