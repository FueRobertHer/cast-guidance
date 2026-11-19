/**
 * The stored homebrew files as the Workshop's Collections shelf lists them
 * (ADR-002, D1): a file is one collection, and the books one compendium was
 * stored as are one together, as the Homebrew page groups them.
 *
 * A collection's address names one of its rows: a file's own id, or for a
 * compendium its newest book's. Any of its books' ids finds the same
 * collection, so the address survives the others being deleted.
 */
import { fileKey } from '@/db/homebrewBooks';
import type { HomebrewFileMeta } from '@/db/homebrewRepo';

export interface Collection {
  /** The row its address names. */
  id: string;
  name: string;
  /** Where it came from, in words. */
  from: string;
  /** The file, or each book of the compendium, newest first. */
  rows: HomebrewFileMeta[];
  /** How many entries it holds, over every row. */
  entries: number;
}

export const collectionPath = (id: string) => `/workshop/collection/${encodeURIComponent(id)}`;

const total = (rows: readonly HomebrewFileMeta[]) =>
  rows.reduce((n, r) => n + Object.values(r.counts).reduce((a, b) => a + b, 0), 0);

/** Rows that are books of one compendium, by the file they came from. */
const groupKey = (r: HomebrewFileMeta) => (r.book === undefined ? undefined : fileKey(r.fileName));

function fromOf(rows: readonly HomebrewFileMeta[]): string {
  const [r] = rows;
  if (r === undefined) return '';
  if (rows.length > 1)
    return `A compendium of ${rows.length} books${r.url === undefined ? '' : ', from a link'}`;
  if (r.editable) return 'Yours. Made in this app';
  if (r.subset === true) return 'Part of a book, what a character brought';
  if (r.book !== undefined) return 'One book of a compendium';
  return r.url === undefined ? 'A homebrew file you imported' : 'A homebrew file, from a link';
}

function nameOf(rows: readonly HomebrewFileMeta[], names: ReadonlyMap<string, string>): string {
  const [r] = rows;
  if (r === undefined) return '';
  if (rows.length > 1) return r.fileName;
  return names.get(r.id) ?? r.book ?? r.fileName;
}

/**
 * Every collection in `rows` (newest first, as the Homebrew page lists
 * them), placed where its newest row falls. `names` are the names the
 * player gave the files they made, by id.
 */
export function collectionsOf(
  rows: readonly HomebrewFileMeta[],
  names: ReadonlyMap<string, string> = new Map(),
): Collection[] {
  const groups = new Map<string, HomebrewFileMeta[]>();
  for (const r of rows) {
    const key = groupKey(r);
    if (key === undefined) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [r]);
    else group.push(r);
  }
  const out: Collection[] = [];
  const placed = new Set<string>();
  for (const r of rows) {
    const key = groupKey(r);
    if (key !== undefined && placed.has(key)) continue;
    if (key !== undefined) placed.add(key);
    const members = key === undefined ? [r] : (groups.get(key) ?? [r]);
    out.push({
      id: r.id,
      name: nameOf(members, names),
      from: fromOf(members),
      rows: members,
      entries: total(members),
    });
  }
  return out;
}

/** The collection a row id belongs to, if any row has it. */
export function collectionWith(
  id: string,
  rows: readonly HomebrewFileMeta[],
  names?: ReadonlyMap<string, string>,
): Collection | undefined {
  return collectionsOf(rows, names).find((c) => c.rows.some((r) => r.id === id));
}

/**
 * How much a collection holds and whether this device uses it ("2 entries.
 * On"). Only the device's switch: a character can turn a collection off for
 * itself (`sourceSwitches`), so "on" is never "on for every character".
 */
export function holdsOf(c: Collection): string {
  const holds = c.entries === 0 ? 'Empty' : `${c.entries} ${c.entries === 1 ? 'entry' : 'entries'}`;
  const on = c.rows.filter((r) => r.enabled).length;
  const where =
    on === c.rows.length ? 'On' : on === 0 ? 'Off' : `${on} of ${c.rows.length} books on`;
  return `${holds}. ${where}`;
}

/** The name the player gave a file they made: its book's full name. */
export function madeName(json: Record<string, unknown>): string | undefined {
  const meta = json._meta;
  const sources =
    typeof meta === 'object' && meta !== null ? (meta as { sources?: unknown }).sources : undefined;
  const first = Array.isArray(sources) ? (sources[0] as { full?: unknown } | undefined) : undefined;
  return typeof first?.full === 'string' && first.full.trim() !== '' ? first.full : undefined;
}
