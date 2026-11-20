/** Board 4's words on the sheet: a reminder and a note, with nothing to count. */
import { WideText } from './actions';
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
    fields: [],
    line: (e) => String(e.text),
    // Across the card: a note is a sentence.
    boxes: (p) => (
      <WideText effect={p.effect} title={p.title} field="text" label="Note" onChange={p.onChange} />
    ),
    notInPlay: true,
  },
];
