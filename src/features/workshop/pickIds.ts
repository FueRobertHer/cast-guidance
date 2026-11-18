/**
 * The ids of a Workshop entry's picks. A pick's prompt is filed under the
 * entry it is asked for (a class's, for each of its features), so two picks
 * of one entry under one id would share one answer: the sheet asks the second
 * of them never. A new Pick card takes an id none of the entry's picks has,
 * and keeps it, since the answers saved for it are filed under it.
 */
import { createContext } from 'react';
import { isRecord } from '@/engine/castGuidance';

/** The ids of every stored pick in `v`, however deep it holds them. */
export function pickIdsIn(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const x of v) pickIdsIn(x, out);
  } else if (isRecord(v)) {
    if (v.kind === 'pick' && typeof v.id === 'string') out.add(v.id);
    for (const x of Object.values(v)) pickIdsIn(x, out);
  }
  return out;
}

/**
 * The pick ids the entry being edited holds, its original's too, which its
 * editor gives the cards it holds. Read when a pick is added, not on each change.
 */
export const EntryPickIds = createContext<() => ReadonlySet<string>>(() => new Set());

/** A new pick's id: "choice", else "choice-2" and on, one that none in `taken` has. */
export function freshPickId(taken: ReadonlySet<string>): string {
  if (!taken.has('choice')) return 'choice';
  let n = 2;
  while (taken.has(`choice-${n}`)) n += 1;
  return `choice-${n}`;
}
