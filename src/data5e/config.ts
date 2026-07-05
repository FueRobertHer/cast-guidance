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
