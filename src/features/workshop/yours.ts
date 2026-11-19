/**
 * The player's own entries, as the Workshop's home lists them and its editor
 * finds them: kept apart from both pages, so neither page's chunk pulls in
 * the other.
 */
import type { HomebrewFile } from '@/db/homebrewRepo';
import { TYPE_LABELS } from '@/features/library/browseTypes';
import { EDITORS, type Json } from './editorTypes';

/** One of the player's entries, where it is kept. */
export interface Mine {
  type: string;
  entry: Json;
  fileId: string;
}

/** Every entry of a kind the Workshop edits, in the files the player owns. */
export function entriesOf(files: readonly HomebrewFile[]): Mine[] {
  const out: Mine[] = [];
  for (const file of files) {
    for (const type of EDITORS.keys()) {
      const list = file.json[type];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (typeof entry === 'object' && entry !== null && typeof (entry as Json).name === 'string')
          out.push({ type, entry: entry as Json, fileId: file.id });
      }
    }
  }
  return out;
}

const keyOf = (name: string, source: string) => encodeURIComponent(`${name}|${source}`);

/** A kind as a Library section names it ("Feats"). */
export const labelOf = (type: string) => TYPE_LABELS.get(type) ?? type;

/** One of a kind, as a row says what an entry is ("Feat"). */
const ONE: Readonly<Record<string, string>> = {
  background: 'Background',
  class: 'Class',
  condition: 'Condition',
  feat: 'Feat',
  item: 'Item',
  optionalfeature: 'Optional feature',
  race: 'Species',
  spell: 'Spell',
  subclass: 'Subclass',
};
export const kindOf = (type: string) => ONE[type] ?? labelOf(type);

/** Where one of the player's entries opens: two files can hold one by the same name and book. */
export const editPath = (type: string, name: string, source: string) =>
  `/workshop/edit/${type}/${keyOf(name, source)}`;
export const inFile = (fileId: string) => `?file=${encodeURIComponent(fileId)}`;
