/**
 * The grounds a screen lays on `bg` (DS-001).
 *
 * A card is `surface` with `card` corners, a `line` hairline and, in light
 * only, `shadow-card`: paper on paper needs an edge, and in dark the lighter
 * fill is the edge. Padding is 4 (16px), 5 for a hero card such as HP.
 *
 * A list is a card whose rows sit flush, divided by `line` hairlines, for a
 * settings group or a set of links. Each row pads itself (`px-4 py-2`, at
 * least 56px tall with a title and a caption).
 */
export const cardClass = 'rounded-card bg-surface p-4 shadow-card ring-1 ring-line ring-inset';

export const listClass =
  'flex flex-col divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card ring-1 ring-line ring-inset';

/**
 * A list with attack chips in its rows: unclipped, because a condition's marks
 * go past a chip's edge, and Unconscious's Z's past the top of the first row.
 * With nothing clipping its corners, it gives them to its first and last rows,
 * for a row that paints a ground of its own (`SpellRow`, while concentrating).
 */
export const openListClass =
  'flex flex-col divide-y divide-line rounded-card bg-surface shadow-card ring-1 ring-line ring-inset *:first:rounded-t-card *:last:rounded-b-card';

/** A list row's padding and size: a title over a caption, an action at the end. */
export const listRowClass = 'flex min-h-14 items-center gap-3 px-4 py-2';
