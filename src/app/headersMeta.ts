import type { Plugin } from 'vite';

/**
 * Build-time link between the response headers and the app shell's cache key.
 *
 * The service worker answers navigations with the precached `index.html`, and
 * the cached response keeps the headers it was fetched with, Content-Security-
 * Policy included. Workbox only refetches a precached file when its revision
 * (a hash of the file's bytes) changes, so a header change alone would leave
 * installed copies running under the old policy indefinitely. Writing a digest
 * of the header config into `index.html` makes every header change a change to
 * the file, so the next deploy ships a new revision and the update prompt
 * brings the new headers with it.
 *
 * This module runs in the Vite config (Node) and in the unit tests, so it uses
 * only Web Crypto and no app imports.
 */

/** The first 12 hex digits of the SHA-256 of the header config, as JSON. */
export async function headersDigest(headers: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(headers));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/** Injects `<meta name="cg-headers" content="<digest>">` into `index.html`. */
export function headersMetaPlugin(headers: unknown): Plugin {
  return {
    name: 'cg-headers-meta',
    async transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { name: 'cg-headers', content: await headersDigest(headers) },
          injectTo: 'head',
        },
      ];
    },
  };
}
