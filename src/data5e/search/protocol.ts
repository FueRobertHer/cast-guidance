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

export type SearchWorkerResponse =
  | { kind: 'ready'; serialized?: string }
  /** `hiddenCount` is how many matches `sources` dropped, itself capped at `limit`. */
  | { kind: 'results'; id: number; hits: SearchDoc[]; hiddenCount: number }
  | { kind: 'error'; message: string };

export const SEARCH_FIELDS = ['name'] as const;
export const STORE_FIELDS = ['type', 'uid', 'name', 'source'] as const;

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
