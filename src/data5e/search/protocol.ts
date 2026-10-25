export interface SearchDoc {
  /** `${type}:${uid}` — unique across types. */
  id: string;
  type: string;
  uid: string;
  name: string;
  source: string;
}

/**
 * Structurally the same as the app's `SourcePolicy`, restated here so the
 * worker bundle stays free of anything that reaches for Dexie. Plain data, so
 * it survives structured clone.
 */
export type SearchSourceFilter =
  | { mode: 'all'; except: string[] }
  | { mode: 'only'; sources: string[] };

export type SearchWorkerRequest =
  | { kind: 'load'; serialized: string }
  | { kind: 'build'; docs: SearchDoc[] }
  // `sources` is applied BEFORE `limit`. Filtering a already-truncated page in
  // the caller would make search emptier the more books you hide, which is
  // backwards: the top 30 overall can be entirely hidden while good matches sit
  // at rank 31.
  | { kind: 'query'; id: number; q: string; limit?: number; sources?: SearchSourceFilter };

/**
 * What the worker was doing when it failed. The client acts on this rather
 * than on the message text: a `load` failure means the cached index is
 * undecodable and should be thrown away and rebuilt, while a `build` or
 * `query` failure says nothing about the cache and must not cost the user a
 * working index.
 */
export type SearchErrorPhase = 'load' | 'build' | 'query';

export type SearchWorkerResponse =
  | { kind: 'ready'; serialized?: string }
  /** `hiddenCount` is how many matches `sources` dropped, itself capped at `limit`. */
  | { kind: 'results'; id: number; hits: SearchDoc[]; hiddenCount: number }
  /** `id` is set when the failure was a query, so that one caller can settle. */
  | { kind: 'error'; message: string; phase: SearchErrorPhase; id?: number };

export const SEARCH_FIELDS = ['name'] as const;
export const STORE_FIELDS = ['type', 'uid', 'name', 'source'] as const;

// ---------------------------------------------------------------------------
// Work limits
// ---------------------------------------------------------------------------
//
// A query or a build the worker cannot finish is not stopped by anything: the
// query timeout settles the caller empty but leaves the worker grinding, and
// every later query waits behind it. Fuzzy prefix search costs grow with the
// number and length of terms, and builds with the number and length of names,
// so all four are bounded. Applied on both sides of the boundary: the client
// so it never sends the work, the worker so a caller that skipped the client
// still cannot hand it more.

/** Characters of a query that are searched. A name is rarely past forty. */
export const MAX_QUERY_LENGTH = 100;
/** Whitespace-separated terms of a query that are searched. */
export const MAX_QUERY_TERMS = 8;
/** Results one query may ask for. */
export const MAX_QUERY_LIMIT = 100;
/** Results when the caller does not say. */
export const DEFAULT_QUERY_LIMIT = 30;
/** Documents one index may hold. Official data is about 5,500. */
export const MAX_INDEX_DOCS = 50_000;
/** Characters of a name that are indexed. */
export const MAX_DOC_NAME_LENGTH = 200;

/** The part of `q` that is worth searching: bounded in length and terms. */
export function clampQuery(q: string): string {
  const terms = q.slice(0, MAX_QUERY_LENGTH).trim().split(/\s+/);
  return terms.slice(0, MAX_QUERY_TERMS).join(' ');
}

/** A result count between 1 and {@link MAX_QUERY_LIMIT}. */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_QUERY_LIMIT;
  return Math.min(MAX_QUERY_LIMIT, Math.max(1, Math.floor(limit)));
}

/** A name cut to what is indexed. */
export function clampDocName(name: string): string {
  return name.length > MAX_DOC_NAME_LENGTH ? name.slice(0, MAX_DOC_NAME_LENGTH) : name;
}

/**
 * At most {@link MAX_INDEX_DOCS} documents, names cut to what is indexed. The
 * id and uid are left whole: they are what a hit navigates by.
 */
export function clampDocs(docs: readonly SearchDoc[]): SearchDoc[] {
  return docs.slice(0, MAX_INDEX_DOCS).map((d) => {
    const name = clampDocName(d.name);
    return name === d.name ? d : { ...d, name };
  });
}

/**
 * Take a page of `limit` allowed hits from a full ranked list, counting what
 * the filter dropped along the way.
 *
 * The order matters and is the whole point: truncating first and filtering
 * after would let the top `limit` results be entirely from hidden books, so
 * search would return nothing while good matches sat just past the cut. Lives
 * here, pure, so both the worker and its tests use the same code.
 */
export function pageAllowedHits(
  ranked: readonly SearchDoc[],
  filter: SearchSourceFilter | undefined,
  limit: number,
): { hits: SearchDoc[]; hiddenCount: number } {
  const codes = new Set(
    filter === undefined ? [] : filter.mode === 'all' ? filter.except : filter.sources,
  );
  const allows = (source: string): boolean =>
    filter === undefined ? true : filter.mode === 'all' ? !codes.has(source) : codes.has(source);

  const hits: SearchDoc[] = [];
  let hiddenCount = 0;
  for (const h of ranked) {
    if (allows(h.source)) {
      if (hits.length < limit) {
        hits.push({ id: h.id, type: h.type, uid: h.uid, name: h.name, source: h.source });
      }
    } else if (hiddenCount < limit) {
      hiddenCount++;
    }
    if (hits.length >= limit && hiddenCount >= limit) break;
  }
  return { hits, hiddenCount };
}
