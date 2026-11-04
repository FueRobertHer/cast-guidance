import { readJsonBounded } from '@/lib/boundedRead';
import { COMPARE_API_URL, MAX_RELEASE_DIFF_BYTES, RELEASE_DIFF_TIMEOUT_MS } from './config';

/** The most files GitHub lists in one comparison, however many there are. */
const COMPARE_FILE_LIMIT = 300;

const DATA_DIR = 'data/';

/**
 * Which data files changed, from a GitHub comparison of two releases, or
 * undefined unless the answer can be trusted. A file left off this list is
 * reused from the old release without being looked at again, so anything short
 * of certain means downloading everything, never a guess:
 *
 * - `behind` (a downgrade) and `diverged` compare against the point the two
 *   histories split. A downgrade lists no files at all, which is not the same
 *   as nothing having changed.
 * - A list at the limit may have been cut short.
 * - `ahead` with no files is more likely a diff GitHub declined to work out than
 *   a release that changed nothing. `identical` is how it says the latter.
 */
export function changedFilesFromComparison(body: unknown): ReadonlySet<string> | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const { status, files } = body as { status?: unknown; files?: unknown };
  if (status !== 'ahead' && status !== 'identical') return undefined;
  if (!Array.isArray(files) || files.length >= COMPARE_FILE_LIMIT) return undefined;
  if (status === 'ahead' && files.length === 0) return undefined;

  const changed = new Set<string>();
  for (const file of files) {
    if (file === null || typeof file !== 'object') return undefined;
    const { filename, previous_filename: previous } = file as {
      filename?: unknown;
      previous_filename?: unknown;
    };
    if (typeof filename !== 'string') return undefined;
    for (const path of [filename, previous]) {
      if (typeof path === 'string' && path.startsWith(DATA_DIR)) {
        changed.add(path.slice(DATA_DIR.length));
      }
    }
  }
  return changed;
}

/**
 * The data files `to` changed since `from`, or undefined when that cannot be
 * known. Never throws: every way this fails (offline, GitHub's rate limit, an
 * answer that is not a comparison) just means the install downloads everything.
 */
export async function changedFilesBetween(
  from: string,
  to: string,
): Promise<ReadonlySet<string> | undefined> {
  try {
    const url = `${COMPARE_API_URL}/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(RELEASE_DIFF_TIMEOUT_MS) });
    if (!res.ok) return undefined;
    return changedFilesFromComparison(await readJsonBounded(res, MAX_RELEASE_DIFF_BYTES));
  } catch {
    return undefined;
  }
}
