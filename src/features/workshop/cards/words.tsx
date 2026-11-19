/** Board 4's words on the sheet: a reminder, with nothing to count. */
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
];
