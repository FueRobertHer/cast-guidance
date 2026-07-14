/** Ordered creator wizard steps. The `?step=` query param addresses these. */
export const STEPS = [
  'basics',
  'class',
  'species',
  'abilities',
  'background',
  'equipment',
  'spells',
  'choices',
  'review',
] as const;

export type Step = (typeof STEPS)[number];

/**
 * Coerce a raw `?step=` value into a valid step. A bad or missing deep-link
 * value (e.g. `?step=garbage`) recovers to the first step instead of rendering
 * a broken wizard with an out-of-range index.
 */
export function normalizeStep(raw: string | null | undefined): Step {
  return (STEPS as readonly string[]).includes(raw ?? '') ? (raw as Step) : 'basics';
}
