/**
 * The Workshop's editors, found by file name (ADR-001, "How the phases stay
 * apart"): each `editors/<Name>Editor.tsx` is its own lazy chunk, and the type
 * it edits is its name, lower case (`FeatEditor` edits `feat`). A later phase
 * adds an editor by adding its file; the shell, the routes and the Library's
 * Edit a copy all find it here without being touched.
 */
import type { ComponentType } from 'react';
import type { EntityRegistry } from '@/data5e/normalize';

export type Json = Record<string, unknown>;

export interface EditorProps {
  /** The entry as it stands: every field, a copy's original ones included. */
  draft: Json;
  /** Set top-level fields; `undefined` takes one out. */
  change: (patch: Json) => void;
  /** The entry a copy is made from, as the player's data has it. */
  original?: Json;
  registry: EntityRegistry;
  /** Shown but not editable: a copy whose original is not in the player's data. */
  readOnly: boolean;
}

/** What each editor file exports, as `editor`. */
export interface EditorSpec {
  /** What one is called in a sentence: "feat", "species". */
  noun: string;
  /** The fields a new one starts with, besides its name and book. */
  blank: () => Json;
  Body: ComponentType<EditorProps>;
  /** Why the entry cannot be saved as it stands, if it cannot. */
  check?: (draft: Json) => string | undefined;
}

const FILES = import.meta.glob<{ editor: EditorSpec }>('./editors/*Editor.tsx');

/** Editor names that are not the registry's type name. */
const TYPE_OF: Readonly<Record<string, string>> = { species: 'race' };

/** Each editor's loader, by the registry type it edits. */
export const EDITORS: ReadonlyMap<string, () => Promise<{ editor: EditorSpec }>> = new Map(
  Object.entries(FILES).map(([path, load]) => {
    const name = (/(\w+)Editor\.tsx$/.exec(path)?.[1] ?? '').toLowerCase();
    return [TYPE_OF[name] ?? name, load] as const;
  }),
);

/** True when the Workshop can make and copy entries of this type. */
export function hasEditor(type: string): boolean {
  return EDITORS.has(type);
}
