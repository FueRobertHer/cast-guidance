/**
 * The player's own entries, as the Workshop's home lists them and its editor
 * finds them: kept apart from both pages, so neither page's chunk pulls in
 * the other.
 */

import { canonicalSource, isKnownSource } from '@/data5e/sourceNames';
import { type EntryPick, type HomebrewFile, internals } from '@/db/homebrewRepo';
import { ENTRY_PARENT_KEYS } from '@/engine/castGuidance';
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
  action: 'Action',
  background: 'Background',
  baseitem: 'Equipment',
  book: 'Book',
  class: 'Class',
  condition: 'Condition',
  disease: 'Disease',
  feat: 'Feat',
  item: 'Item',
  language: 'Language',
  optionalfeature: 'Optional feature',
  race: 'Species',
  sense: 'Sense',
  skill: 'Skill',
  spell: 'Spell',
  status: 'Status',
  subclass: 'Subclass',
  subrace: 'Subrace',
  variantrule: 'Rule',
};
export const kindOf = (type: string) => ONE[type] ?? labelOf(type);

/** Where one of the player's entries opens: two files can hold one by the same name and book. */
export const editPath = (type: string, name: string, source: string) =>
  `/workshop/edit/${type}/${keyOf(name, source)}`;
export const inFile = (fileId: string) => `?file=${encodeURIComponent(fileId)}`;

/**
 * One of the player's entries, told apart from every other: its file, its
 * type, its name and book, and its parents' keys (in the changes file two
 * subraces of one name and book are two changes).
 */
export function mineKey(m: Mine): string {
  const parents = Object.hasOwn(ENTRY_PARENT_KEYS, m.type) ? (ENTRY_PARENT_KEYS[m.type] ?? []) : [];
  return [m.fileId, m.type, ...['name', 'source', ...parents].map((k) => String(m.entry[k] ?? ''))]
    .join('|')
    .toLowerCase();
}

/** An entry as `homebrewRepo.removeEntries` takes it: matched by its own fields. */
export const pickOf = (m: Mine): EntryPick => ({
  fileId: m.fileId,
  type: m.type,
  key: { ...m.entry, name: String(m.entry.name), source: String(m.entry.source) },
});

const isJson = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const lower = (v: unknown) => String(v).toLowerCase();

/**
 * A homebrew file of the picked entries, to share: each with the entries it
 * owns (a class's features, a subclass's), and the books they are in as their
 * files declare them. It carries no collection's id, so importing it never
 * takes the place of the whole collection it came from.
 */
export function selectionFile(files: readonly HomebrewFile[], picked: readonly Mine[]): Json {
  const out: Record<string, unknown[]> = {};
  const sources = new Map<string, unknown>();
  for (const m of picked) {
    const file = files.find((f) => f.id === m.fileId);
    if (file === undefined) continue;
    (out[m.type] ??= []).push(m.entry);
    const own = internals.OWNED[m.type];
    const owned =
      own === undefined
        ? []
        : listOf(file.json[own.type]).filter((e): e is Json => isJson(e) && own.owns(m.entry, e));
    if (own !== undefined && owned.length > 0) (out[own.type] ??= []).push(...owned);
    const meta = isJson(file.json._meta) ? file.json._meta : {};
    // Its book, and its own entries' (a feature can keep a book of its own).
    // A file that declares the book beats one that only names it, in any order.
    for (const e of [m.entry, ...owned]) {
      if (typeof e.source !== 'string' || e.source === '') continue;
      const book = lower(e.source);
      const declared = listOf(meta.sources).find((s) => isJson(s) && lower(s.json) === book);
      sources.set(
        book,
        declared ?? sources.get(book) ?? { json: e.source, abbreviation: e.source, full: e.source },
      );
    }
  }
  return { _meta: { sources: [...sources.values()] }, ...out };
}

/**
 * A source for a collection started on the move sheet, from its name
 * (`Lantern Coast` as `LanternCoast`), as `MyHomebrew` is. A name that is a
 * published book's code in any case (`DSotDQ`), or reads like one (short, or
 * capitals only: `MM`), gets `Homebrew` after it; the repo makes it unique
 * among the files here.
 */
export function newSource(name: string): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  const joined = words
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join('')
    .slice(0, 24);
  if (joined === '') return 'MyCollection';
  const book = joined.length < 6 || !/[a-z]/.test(joined) || isKnownSource(canonicalSource(joined));
  return book ? `${joined.slice(0, 16)}Homebrew` : joined;
}
