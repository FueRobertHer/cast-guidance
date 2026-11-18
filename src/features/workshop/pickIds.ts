/**
 * The ids of a Workshop entry's picks and of their options. A pick's prompt is
 * filed under the entry it is asked for (a class's, for each of its features),
 * so two picks of one entry under one id would share one answer: the sheet
 * asks the second of them never. A new Pick card takes an id none of the
 * entry's picks has, nor had in a version the editor knows of, and keeps it,
 * since the answers saved for it are filed under it. A new option likewise
 * takes an id its pick's options never had, so an answer saved for one taken
 * out is not read as the new one.
 */
import { createContext, createElement, type ReactNode } from 'react';
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

/** The ids, trimmed and lower case as the reader compares them, of the options of each pick in `v` whose id is `pick`. */
export function optionIdsIn(v: unknown, pick: string, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) {
    for (const x of v) optionIdsIn(x, pick, out);
  } else if (isRecord(v)) {
    if (v.kind === 'pick' && v.id === pick && Array.isArray(v.options)) {
      for (const o of v.options) if (isRecord(o)) out.add(String(o.id).trim().toLowerCase());
    }
    for (const x of Object.values(v)) optionIdsIn(x, pick, out);
  }
  return out;
}

/**
 * The versions of the entry being edited its cards are told of: as it stands,
 * as it opened, as last saved, and the original a copy is made from. Read
 * when a pick or an option is added, not on each change.
 */
export const EntryVersions = createContext<() => readonly unknown[]>(() => []);

/** The cards of an entry being edited (`draft`), told of the versions it was `before`. */
export function EntryPicks({
  draft,
  before = [],
  children,
}: {
  draft: unknown;
  before?: readonly unknown[];
  children: ReactNode;
}) {
  return createElement(EntryVersions.Provider, { value: () => [draft, ...before] }, children);
}

/** A new pick's id: "choice", else "choice-2" and on, one that none in `taken` has. */
export function freshPickId(taken: ReadonlySet<string>): string {
  if (!taken.has('choice')) return 'choice';
  let n = 2;
  while (taken.has(`choice-${n}`)) n += 1;
  return `choice-${n}`;
}
