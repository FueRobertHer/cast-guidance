import type { HomebrewFileRow } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { readTextBounded } from '@/lib/boundedRead';
import { IMPORT_LIMITS } from '@/lib/guards';
import { checkHomebrewUrl } from './homebrewUrl';

/** How long a homebrew URL gets to answer before the import gives up. */
const IMPORT_URL_TIMEOUT_MS = 20_000;

/**
 * A URL the import will not fetch, refused before any request is made. It
 * carries what the player typed so the page can offer to open it instead.
 */
export class HomebrewUrlRefusedError extends Error {
  readonly url: string;
  constructor(url: string, reason: string) {
    super(reason);
    this.name = 'HomebrewUrlRefusedError';
    this.url = url;
  }
}

/** A homebrew file fetched and parsed, not yet validated or stored. */
export interface FetchedHomebrew {
  /** The parsed body. `homebrewRepo.prepare` validates it. */
  raw: unknown;
  /** The last path segment of the fetched URL, decoded. */
  fileName: string;
  /** The URL actually fetched (after any GitHub page rewrite). */
  url: string;
  /** UTF-8 size of the body that was read. */
  bytes: number;
}

/**
 * Fetch a homebrew file from a URL the user typed, writing nothing.
 *
 * The URL is checked against the allowed hosts first (`checkHomebrewUrl`), so
 * a host the Content-Security-Policy would block is refused with a reason
 * rather than left to fail as a bare network error, and no request is made.
 * GitHub page URLs are rewritten to the raw file they show.
 *
 * The body is read through a byte bound before it is parsed: `res.json()`
 * would buffer and parse whatever came back, however large, before the
 * structural limits in `buildHomebrewRow` ever saw it.
 */
export async function fetchHomebrewFromUrl(
  url: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  maxBytes: number = IMPORT_LIMITS.maxImportBytes,
): Promise<FetchedHomebrew> {
  const check = checkHomebrewUrl(url);
  if (!check.ok) throw new HomebrewUrlRefusedError(url, check.reason);
  const target = check.url;
  const res = await fetchImpl(target, { signal: AbortSignal.timeout(IMPORT_URL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await readTextBounded(res, maxBytes);
  const raw = JSON.parse(text) as unknown;
  const name = target.split('/').pop() ?? 'homebrew.json';
  return {
    raw,
    fileName: decodeURIComponent(name),
    url: target,
    bytes: new TextEncoder().encode(text).byteLength,
  };
}

/**
 * Fetch a homebrew file from a URL and import it: {@link fetchHomebrewFromUrl},
 * then `homebrewRepo.importJson`. Nothing is written unless the whole body
 * fits and passes the structural limits.
 */
export async function importHomebrewFromUrl(
  url: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  maxBytes: number = IMPORT_LIMITS.maxImportBytes,
): Promise<HomebrewFileRow> {
  const fetched = await fetchHomebrewFromUrl(url, fetchImpl, maxBytes);
  return homebrewRepo.importJson(fetched.raw, fetched.fileName, fetched.url);
}
