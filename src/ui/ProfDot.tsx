import type { ProfLevel } from '@/engine/types';

const LABELS: Record<ProfLevel, string> = {
  0: 'not proficient',
  1: 'proficient',
  2: 'expertise',
};

/**
 * Proficiency marker that reads without color: an empty ring (none), a filled
 * dot (proficient), and a ringed filled dot (expertise). Carries the state as
 * text for screen readers so the meaning never depends on hue alone.
 *
 * `decorative` drops that text where the surrounding control already says the
 * level in words (otherwise a "Proficient" button reads "proficient Proficient").
 */
export function ProfDot({ level, decorative }: { level: ProfLevel; decorative?: boolean }) {
  const shape =
    level === 2
      ? 'bg-amber-300 ring-2 ring-amber-300/40 ring-offset-1 ring-offset-surface'
      : level === 1
        ? 'bg-accent'
        : 'border border-ink-muted/50';
  const dot = <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${shape}`} />;
  if (decorative === true) return <span className="inline-flex items-center">{dot}</span>;
  return (
    <span className="inline-flex items-center" title={LABELS[level]}>
      {dot}
      <span className="sr-only">{LABELS[level]}</span>
    </span>
  );
}
