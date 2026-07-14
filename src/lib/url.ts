/**
 * URL safety for content-driven links (e.g. 5etools `{@link}` targets).
 *
 * Data files are third-party and untrusted, so a link target can be anything —
 * including `javascript:` / `data:` payloads or protocol strings obfuscated
 * with control characters. Everything that is not a plain http(s) URL is
 * rejected and rendered as inert text instead of a navigable link.
 */

/** Only these protocols may back a content-driven link. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Code points browsers ignore when sniffing a URL's protocol: ASCII/C1 control
 * chars plus common zero-width and BOM characters. `java\tscript:` navigates in
 * a browser, so we drop these before parsing rather than trusting the raw
 * string. Built from char codes so the source stays plain ASCII.
 */
const IGNORED_CODE_POINTS = new Set<number>([
  ...range(0x00, 0x20), // C0 controls + space
  0x7f, // DEL
  ...range(0x80, 0x9f), // C1 controls
  0x200b, // zero-width space
  0x200c, // zero-width non-joiner
  0x200d, // zero-width joiner
  0x2060, // word joiner
  0xfeff, // BOM / zero-width no-break space
]);

function range(startInclusive: number, endInclusive: number): number[] {
  const out: number[] = [];
  for (let c = startInclusive; c <= endInclusive; c++) out.push(c);
  return out;
}

function stripIgnored(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    if (code !== undefined && IGNORED_CODE_POINTS.has(code)) continue;
    out += ch;
  }
  return out;
}

/**
 * Return a safe href for a content-supplied URL, or `undefined` when it is
 * malformed or uses a disallowed protocol.
 */
export function safeExternalHref(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = stripIgnored(raw);
  if (cleaned === '') return undefined;
  let url: URL;
  try {
    // No base: a bare/relative string has no protocol and is rejected, which
    // is correct for external links (they must be absolute).
    url = new URL(cleaned);
  } catch {
    return undefined;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return undefined;
  return url.href;
}
