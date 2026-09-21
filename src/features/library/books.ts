/**
 * Reading a book's own entry: its table of contents, and an index of what the
 * device already holds from it.
 *
 * `books.json` is bibliography, not prose: each entry carries the book's
 * metadata and its chapter listing, while the chapter text lives in files the
 * app never downloads. So a book page is a way *into* the compendium rather
 * than something to read: the contents say what the book covers, and the
 * index links to the entries from it that are already here.
 *
 * Tolerant throughout, like the rest of the 5etools readers: a chapter with no
 * ordinal, headers that are objects instead of strings, or a `contents` that is
 * not a list at all each contribute what they can and nothing more.
 */
import type { Entity } from '@/data5e/copyMod';
import type { EntityRegistry, EntityType } from '@/data5e/normalize';
import { BROWSE_TYPES } from './browseTypes';

export interface BookChapter {
  /**
   * Stable list key. Ordinal and name alone repeat across a few books (two
   * unnumbered appendices called "Creatures"), and React wants them distinct.
   */
  id: string;
  /** "Chapter 3", "Appendix A"; absent when the data carries no ordinal. */
  ordinal?: string;
  name: string;
  /** Section headings inside the chapter; often empty. */
  headers: string[];
}

export interface BookSection {
  type: EntityType;
  label: string;
  count: number;
}

const ORDINAL_LABELS: Record<string, string> = {
  chapter: 'Chapter',
  part: 'Part',
  appendix: 'Appendix',
  bonus: 'Bonus',
  section: 'Section',
};

/** "Chapter 3" from `{ type: 'chapter', identifier: 3 }`. */
function ordinalLabel(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { type, identifier } = value as Record<string, unknown>;
  if (typeof type !== 'string' || type === '') return undefined;
  const label = ORDINAL_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
  if (typeof identifier === 'string' && identifier !== '') return `${label} ${identifier}`;
  if (typeof identifier === 'number') return `${label} ${identifier}`;
  return label;
}

/** A header is either a bare string or `{ header, depth }`. */
function headerName(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (typeof value !== 'object' || value === null) return undefined;
  const { header } = value as Record<string, unknown>;
  return typeof header === 'string' && header !== '' ? header : undefined;
}

/** The book's chapter listing, as much of it as the data supports. */
export function bookContents(entity: Entity): BookChapter[] {
  const contents = entity.contents;
  if (!Array.isArray(contents)) return [];
  const out: BookChapter[] = [];
  const seen = new Map<string, number>();
  for (const raw of contents) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { name, headers, ordinal } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || name === '') continue;
    const label = ordinalLabel(ordinal);
    const base = `${label ?? ''}|${name}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    out.push({
      id: nth === 0 ? base : `${base}#${nth}`,
      ordinal: label,
      name,
      headers: Array.isArray(headers)
        ? headers.map(headerName).filter((h): h is string => h !== undefined)
        : [],
    });
  }
  return out;
}

/**
 * How many browsable entries carry this source, per section.
 *
 * Counts what the registry holds, which is what has downloaded: the packs
 * behind spells and items stream in after boot, so a book opened early can
 * report fewer than it finally has. Sections at zero are dropped rather than
 * listed empty, since a link promising nothing is worse than no link.
 */
export function bookIndex(registry: EntityRegistry, source: string): BookSection[] {
  const wanted = source.toLowerCase();
  const out: BookSection[] = [];
  for (const { type, label } of BROWSE_TYPES) {
    // A book listing "Books: 1" would only ever lead back to itself.
    if (type === 'book') continue;
    let count = 0;
    for (const e of registry.byType(type)) {
      if (typeof e.source === 'string' && e.source.toLowerCase() === wanted) count++;
    }
    if (count > 0) out.push({ type, label, count });
  }
  return out;
}
