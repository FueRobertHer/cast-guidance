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

/** A list row's padding and size: a title over a caption, an action at the end. */
export const listRowClass = 'flex min-h-14 items-center gap-3 px-4 py-2';
