/** Board 4's words on the sheet: a reminder, with nothing to count. */
import type { KindSpec } from './kit/types';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['cue'],
    add: 'Reminder',
    make: () => ({ kind: 'cue', tone: 'info', text: 'Remember to' }),
    fields: [{ key: 'text', label: 'What to remember', type: 'text' }],
    line: (e) => String(e.text),
  },
];
