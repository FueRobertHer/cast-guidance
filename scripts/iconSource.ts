import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Ties the committed PNGs in `public/icons/` to the `public/favicon.svg` they
 * were rendered from. `scripts/generate-icons.ts` writes the source's hash to
 * {@link ICON_STAMP} beside its output, and `scripts/pwaManifest.test.ts`
 * fails when the SVG no longer matches it, which means someone changed the
 * SVG without running `bun run icons:generate`.
 *
 * The stamp lives in `scripts/`, not `public/icons/`, so it is never deployed.
 */

const REPO = path.resolve(import.meta.dirname, '..');

export const ICON_SOURCE = path.join(REPO, 'public/favicon.svg');
export const ICON_STAMP = path.join(REPO, 'scripts/icons-source.json');

export interface IconStamp {
  $comment: string;
  source: string;
  sha256: string;
}

/** SHA-256 of the SVG text, with line endings normalized so a CRLF checkout matches. */
export function hashIconSource(svg: string): string {
  return createHash('sha256').update(svg.replace(/\r\n?/g, '\n')).digest('hex');
}

/**
 * Elements that make Chromium draw with a font (or with HTML layout), which
 * would tie the PNGs to whatever fonts the machine has. Namespace prefixes
 * (`<svg:text>`) count too.
 */
export const FONT_DEPENDENT_ELEMENT = /<(?:[\w.-]+:)?(?:text|tspan|textPath|foreignObject)\b/i;
