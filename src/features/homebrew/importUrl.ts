import type { HomebrewFileRow } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { readJsonBounded } from '@/lib/boundedRead';
import { IMPORT_LIMITS } from '@/lib/guards';

/** How long a homebrew URL gets to answer before the import gives up. */
const IMPORT_URL_TIMEOUT_MS = 20_000;

/**
 * Fetch a homebrew file from a URL the user typed and import it.
 *
 * The body is read through a byte bound before it is parsed: the URL can point
 * anywhere, and `res.json()` would buffer and parse whatever came back,
 * however large, before the structural limits in `buildHomebrewRow` ever saw
 * it. Nothing is written unless the whole body fits and passes those limits.
 */
export async function importHomebrewFromUrl(
  url: string,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
  maxBytes: number = IMPORT_LIMITS.maxImportBytes,
): Promise<HomebrewFileRow> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(IMPORT_URL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await readJsonBounded(res, maxBytes);
  const name = url.split('/').pop() ?? 'homebrew.json';
  return homebrewRepo.importJson(raw, decodeURIComponent(name), url);
}
