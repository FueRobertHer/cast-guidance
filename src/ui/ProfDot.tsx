import type { ProfLevel } from '@/engine/types';

/** A proficiency level, or half proficiency (Jack of All Trades and the like). */
export type ProfMark = ProfLevel | 'half';

const LABELS: Record<ProfMark, string> = {
  0: 'not proficient',
  half: 'half proficient',
  1: 'proficient',
  2: 'expertise',
};

/**
 * Proficiency marker that reads without color: an empty ring (none), a ring
 * with its left half filled (half), a filled dot (proficient), and a filled dot
 * inside a ring (expertise). Carries the state as text for screen readers so
 * the meaning never depends on hue alone.
 *
 * The empty ring is `line-strong`; the dot takes its control's text colour, which is
 * `ink` in a skill row (DS-001: selection and proficiency are ink, told apart
 * by shape), and stays visible on a pressed `ink` pill. The half mark's ring is
 * that colour too, so it reads as the dot half filled rather than as the empty
 * ring. The expertise ring is an outline, so the gap inside it shows whatever
 * ground the dot sits on.
 *
 * `decorative` drops that text where the surrounding control already says the
 * level in words (otherwise a "Proficient" button reads "proficient Proficient").
 */
export function ProfDot({ level, decorative }: { level: ProfMark; decorative?: boolean }) {
  const shape =
    level === 2
      ? 'bg-current outline-[1.5px] outline-current outline-offset-2'
      : level === 1
        ? 'bg-current'
        : level === 'half'
          ? 'bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)] ring-[1.5px] ring-current ring-inset'
          : 'ring-[1.5px] ring-line-strong ring-inset';
  const dot = <span aria-hidden className={`inline-block size-2.5 rounded-full ${shape}`} />;
  if (decorative === true) return <span className="inline-flex items-center">{dot}</span>;
  return (
    <span className="inline-flex items-center" title={LABELS[level]}>
      {dot}
      <span className="sr-only">{LABELS[level]}</span>
    </span>
  );
}
