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
