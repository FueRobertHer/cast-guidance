/** Board 4's words on the sheet: a reminder and a note, with nothing to count. */
import type { KindSpec } from './kit/types';

/** The heading its cards are listed under on the add sheet. */
export const group = 'Reminders';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['cue'],
    add: 'Reminder',
    does: 'A line on the sheet with nothing to count',
    make: () => ({ kind: 'cue', tone: 'info', text: 'Remember to' }),
    fields: [{ key: 'text', label: 'What to remember', type: 'text' }],
    line: (e) => String(e.text),
  },
  {
    kinds: ['note'],
    add: 'Note',
    // The sheet lists it, after what gives it, among the notes at the foot of the Build page.
    does: "A note in the sheet's notes on the Build page, with nothing to count",
    make: () => ({ kind: 'note', text: 'Ask the DM before using this' }),
    fields: [{ key: 'text', label: 'Note', type: 'text' }],
    line: (e) => String(e.text),
    notInPlay: true,
  },
];
