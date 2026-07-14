/**
 * Pinned 5etools data release. Content at a tag is immutable, so the tag IS the
 * cache version — updating data means installing a different tag.
 */
export const DATA_TAG = 'v2.32.0';

export type Endpoint = (tag: string, path: string) => string;

/** jsDelivr first (brotli, edge-cached); raw GitHub as fallback. Both send CORS `*`. */
export const ENDPOINTS: Endpoint[] = [
  (tag, path) => `https://cdn.jsdelivr.net/gh/5etools-mirror-3/5etools-src@${tag}/data/${path}`,
  (tag, path) =>
    `https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/${tag}/data/${path}`,
];

export const FETCH_TIMEOUT_MS = 20_000;
export const FETCH_CONCURRENCY = 4;

export interface TagVersion {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a `v2.32.0`-style release tag; returns null if it isn't that shape. */
export function parseTagVersion(tag: string): TagVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (m === null) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Whether a data tag is safe to install with this build. The app parses the
 * 5etools schema of its pinned major version; a different major (or a
 * malformed tag) can carry schema changes we cannot represent, so it must not
 * be offered or activated. Compatibility is intentionally major-only —
 * newer minor/patch releases within the same major are allowed.
 */
export function isCompatibleTag(tag: string, baseTag: string = DATA_TAG): boolean {
  const candidate = parseTagVersion(tag);
  const base = parseTagVersion(baseTag);
  if (candidate === null || base === null) return false;
  return candidate.major === base.major;
}
