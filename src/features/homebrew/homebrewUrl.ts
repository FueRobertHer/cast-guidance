/**
 * Which hosts a homebrew URL import may fetch from.
 *
 * The production Content-Security-Policy keeps `connect-src` closed to a short
 * list of origins (see docs/security-headers.md), so a fetch to any other host
 * would fail in the browser with a bare network error. Checking here first
 * turns that into guidance the player can act on, and keeps this list and the
 * policy in step: `src/app/securityHeaders.test.ts` fails when they differ.
 */
export const HOMEBREW_FETCH_ORIGINS = [
  'https://raw.githubusercontent.com',
  'https://gist.githubusercontent.com',
  'https://cdn.jsdelivr.net',
] as const;

/** Page URLs that people paste, which name a file a fetchable host also serves. */
const GITHUB_ORIGIN = 'https://github.com';
const GIST_ORIGIN = 'https://gist.github.com';

export type HomebrewUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Why a URL is refused, worded for the player. */
export const REFUSED_HOST_REASON =
  'Cast Guidance fetches homebrew directly only from GitHub (raw files or gists) and jsDelivr.';

/** Why a GitHub page that is not a single file (a repo, folder, or gist page) is refused. */
export const GITHUB_PAGE_REASON =
  'That GitHub page is not a single file. Open the file on GitHub and copy the link from its Raw button.';

/**
 * Turn a GitHub page URL into the raw URL for the same file, or return the URL
 * unchanged. Covers `github.com/{owner}/{repo}/blob|raw/{ref}/{path}` and
 * `gist.github.com/{user}/{id}/raw/...`, the shapes the sites link to.
 */
function rewriteGithubPage(u: URL): URL {
  const parts = u.pathname.split('/').slice(1);
  if (u.origin === GITHUB_ORIGIN) {
    const [owner, repo, kind, ...rest] = parts;
    if (
      owner !== undefined &&
      repo !== undefined &&
      (kind === 'blob' || kind === 'raw') &&
      rest.length >= 2
    ) {
      return new URL(`/${owner}/${repo}/${rest.join('/')}`, 'https://raw.githubusercontent.com');
    }
  }
  if (u.origin === GIST_ORIGIN) {
    const [user, id, kind] = parts;
    if (user !== undefined && id !== undefined && kind === 'raw') {
      return new URL(u.pathname, 'https://gist.githubusercontent.com');
    }
  }
  return u;
}

/**
 * Check a URL the player typed against the allowed hosts. It must parse, use
 * https, carry no credentials, and have an origin on the list exactly: the
 * origin comparison is what keeps out look-alikes such as a suffix host
 * (`raw.githubusercontent.com.example`) or a non-default port.
 */
export function checkHomebrewUrl(raw: string): HomebrewUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'That is not a complete URL.' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'URLs with a user name or password are not fetched.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Only https URLs are fetched.' };
  }
  const target = rewriteGithubPage(parsed);
  // Still on a GitHub page origin: the URL named no file the rewrite knows.
  if (target.origin === GITHUB_ORIGIN || target.origin === GIST_ORIGIN) {
    return { ok: false, reason: GITHUB_PAGE_REASON };
  }
  const allowed: readonly string[] = HOMEBREW_FETCH_ORIGINS;
  if (!allowed.includes(target.origin)) return { ok: false, reason: REFUSED_HOST_REASON };
  return { ok: true, url: target.href };
}
