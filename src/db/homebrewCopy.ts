import { own } from '@/engine/castGuidance';
import { assertJsonWithinLimits, homebrewEntityCounts } from '@/lib/guards';
import { db, type HomebrewFileRow } from './db';
import { COLLECTION_ID_KEY } from './homebrewOrder';
import {
  freeSource,
  partitionHomebrewMeta,
  partitionHomebrewRows,
  putHomebrewRow,
  withContent,
} from './homebrewRepo';

/**
 * An imported collection as a file the player can edit (track 7): the same
 * entries under books of its own, so the copy and the file it came from are
 * two collections, never one entry twice under one name and book. Characters
 * stay on the file they picked from; re-importing that file updates it, not
 * the copy, since the copy has its own collection stamp.
 */

type Row = Record<string, unknown>;

const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{@spell Fire Bolt|MYB}`: a tag, its name, and the parts after the name. */
const TAG = /\{@(\w+) ([^{}]*)\}/g;

/**
 * `json` with every book in `books` (old id, lowercased, to new id) replaced
 * wherever a book is named: a `source` or `...Source` field, the parts of a
 * `Name|Book|...` ref after its name (a `#c` after the book kept), whether the
 * ref is a value or a key (`feats: [{ "name|book": true }]`), and the same
 * inside `{@tag ...}` prose.
 * A part that only spells like a book in a ref is taken as one: refs hold
 * books in their later parts, and a display text that is exactly a book's
 * id is rare enough to accept.
 */
export function withBooks(json: Row, books: ReadonlyMap<string, string>): Row {
  const book = (s: string) => books.get(s.trim().toLowerCase());
  const ref = (s: string) => {
    const parts = s.split('|');
    if (parts.length < 2) return s;
    const part = (p: string) => {
      const at = p.indexOf('#');
      const id = book(at === -1 ? p : p.slice(0, at));
      return id === undefined ? p : at === -1 ? id : `${id}${p.slice(at)}`;
    };
    return parts.map((p, i) => (i === 0 ? p : part(p))).join('|');
  };
  const text = (s: string) =>
    s.includes('{@')
      ? s.replace(TAG, (all, tag: string, body: string) => {
          const next = ref(body);
          return next === body ? all : `{@${tag} ${next}}`;
        })
      : s.includes('|')
        ? ref(s)
        : s;
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === 'string') {
      if (key !== undefined && (key === 'source' || /Source$/.test(key))) return book(v) ?? v;
      return text(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (!isRecord(v)) return v;
    const out: Row = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === '__proto__') continue;
      out[k.includes('|') ? ref(k) : k] = walk(x, k);
    }
    return out;
  };
  return walk(json) as Row;
}

/**
 * The work of `homebrewRepo.copyEditable`, here so its code loads only when a
 * player asks for a copy. An entry under a book the file does not declare
 * keeps that book: it may be an official one (a subclass's `classSource`),
 * which must not move.
 */
export async function copyEditable(
  fileId: string,
): Promise<HomebrewFileRow & { json: Record<string, unknown> }> {
  return db.transaction('rw', db.homebrewFiles, db.homebrewJson, async () => {
    const stored = await db.homebrewFiles.get(fileId);
    if (stored === undefined) throw new Error('that collection is no longer on this device');
    const read = partitionHomebrewRows(await withContent([stored]));
    const file = read.files[0];
    if (file === undefined)
      throw new Error(read.errors[0]?.message ?? 'the file could not be read');
    if (file.editable) throw new Error('that collection is yours to change already');
    if (file.pack !== undefined || own(file.json, 'castGuidance') !== undefined) {
      throw new Error('a rule pack is changed from Review, not copied');
    }
    const all = partitionHomebrewMeta(await db.homebrewFiles.toArray()).files;
    const meta = isRecord(file.json._meta) ? file.json._meta : {};
    const declared = Array.isArray(meta.sources) ? meta.sources.filter(isRecord) : [];
    const books = new Map<string, string>();
    const sources = declared.map((s) => {
      const was = String(s.json);
      const id = freeSource(was, all, [...books.values()]);
      books.set(was.toLowerCase(), id);
      const full = typeof s.full === 'string' && s.full.trim() !== '' ? s.full.trim() : was;
      return {
        ...s,
        json: id,
        ...(typeof s.abbreviation === 'string' ? { abbreviation: id } : {}),
        full: `${full} (copy)`,
      };
    });
    const { _meta: _, ...content } = file.json;
    const { convertedFrom: _from, [COLLECTION_ID_KEY]: _stamp, ...rest } = meta;
    const json: Record<string, unknown> = {
      _meta: { ...rest, sources, [COLLECTION_ID_KEY]: crypto.randomUUID() },
      ...withBooks(content, books),
    };
    assertJsonWithinLimits(json);
    const title = String(sources[0]?.full ?? `${file.fileName} (copy)`);
    const row: HomebrewFileRow & { json: Record<string, unknown> } = {
      id: crypto.randomUUID(),
      fileName: `${title.replaceAll(/[^\w-]+/g, '_')}.json`,
      json,
      enabled: true,
      editable: true,
      sourceIds: sources.map((s) => s.json),
      counts: homebrewEntityCounts(json),
      addedAt: Date.now(),
    };
    await putHomebrewRow(row);
    return row;
  });
}
