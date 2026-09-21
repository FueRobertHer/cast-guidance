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

/** Where the compatible-release list comes from. */
export const TAGS_API_URL = 'https://api.github.com/repos/5etools-mirror-3/5etools-src/tags';

/**
 * How long a fetched release list stays good. The check exists to notice a new
 * data release, which happens every few weeks, so asking once per boot bought
 * nothing and cost a round-trip on the critical path of every cold start (plus
 * a slice of GitHub's 60-requests-an-hour unauthenticated budget, shared by
 * everyone behind the same address). Inside this window the answer comes from
 * IndexedDB and the update prompt can appear on the first frame.
 */
export const TAG_LIST_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Timeout for the release list. Shorter than `FETCH_TIMEOUT_MS` because
 * nothing in the app is waiting on the answer: a check that cannot complete
 * quickly is better retried next boot than left holding a connection.
 */
export const TAG_LIST_TIMEOUT_MS = 5_000;

/**
 * How long a fresh install waits for the release list before falling back to
 * the build's pinned tag. Every data read is gated behind tag resolution, so
 * this one request sits in front of the first screen's content; past a few
 * seconds it is better to start downloading the pin (and offer the newer
 * release later, once the list arrives) than to keep the app empty.
 */
export const BOOT_TAG_RESOLVE_TIMEOUT_MS = 3_000;
