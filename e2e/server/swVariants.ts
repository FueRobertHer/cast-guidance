import type { Transform } from './staticServer.ts';

/**
 * Builds a static server can pretend to have deployed, for the service-worker
 * update specs:
 * - `v1`: `dist/` as built.
 * - `v2`: a new `index.html` revision in the precache manifest, and an
 *   `index.html` carrying `<meta name="e2e-build" content="v2">`, so a spec can
 *   tell which shell a page was served from.
 * - `v2-broken`: `v2` plus a precache entry that 404s, so installing the new
 *   worker fails and it goes redundant.
 */
export type SwVariant = 'v1' | 'v2' | 'v2-broken';

export const E2E_BUILD_META = 'e2e-build';

const INDEX_REVISION = /(\{url:"index\.html",revision:)"[^"]+"/;
const PRECACHE_LIST = /precacheAndRoute\(\[/;
const HEAD = /<head>/;

/** `pattern` must match `body`, or the build changed shape and the variant would be a no-op. */
function mustReplace(body: string, pattern: RegExp, replacement: string, file: string): string {
  if (!pattern.test(body)) {
    throw new Error(
      `swVariants: ${pattern} no longer matches ${file}. The build output changed shape; update e2e/server/swVariants.ts.`,
    );
  }
  return body.replace(pattern, replacement);
}

export const swVariantTransform: Transform = (rel, body, variant) => {
  if (variant === 'v1') return null;
  if (variant !== 'v2' && variant !== 'v2-broken') {
    throw new Error(`swVariants: unknown variant "${variant}"`);
  }
  if (rel === 'sw.js') {
    let out = mustReplace(body, INDEX_REVISION, '$1"e2e-v2"', rel);
    if (variant === 'v2-broken') {
      out = mustReplace(
        out,
        PRECACHE_LIST,
        'precacheAndRoute([{url:"assets/e2e-missing.js",revision:"e2e"},',
        rel,
      );
    }
    return out;
  }
  if (rel === 'index.html') {
    return mustReplace(body, HEAD, `<head><meta name="${E2E_BUILD_META}" content="v2">`, rel);
  }
  return null;
};
