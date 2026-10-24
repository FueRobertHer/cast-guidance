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

/** What each step is called in its heading and the document title. */
export const STEP_LABELS: Readonly<Record<Step, string>> = {
  basics: 'Basics',
  class: 'Class',
  species: 'Species / Race',
  abilities: 'Abilities',
  background: 'Background',
  equipment: 'Equipment',
  spells: 'Spells',
  choices: 'Choices',
  review: 'Review',
};

/**
 * How many wizard entries were pushed above this one in the tab's history
 * (0 = the entry the wizard was entered on). Each step push records its depth
 * in `location.state`, which is untrusted: it survives reloads and can come
 * from an older build, so anything but a non-negative integer reads as 0.
 */
export function wizardDepth(state: unknown): number {
  if (typeof state !== 'object' || state === null) return 0;
  const depth = (state as { creatorDepth?: unknown }).creatorDepth;
  return typeof depth === 'number' && Number.isInteger(depth) && depth >= 0 ? depth : 0;
}
