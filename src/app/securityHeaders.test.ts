// @vitest-environment node
/**
 * SEC-001: the production Content-Security-Policy is enforced, and it matches
 * what the app actually loads and contacts.
 *
 * Vercel applies `vercel.json` (it ignores `public/_headers`, which is kept for
 * hosts that read it). A missed origin breaks a feature outright under an
 * enforced policy, and an extra one quietly widens it, so `connect-src` is
 * compared exactly against origins built from the app's own constants, and the
 * production source is scanned for URLs the policy does not account for.
 * Files are loaded raw through `import.meta.glob`, as in
 * `src/engine/architecture.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { DATA_TAG, ENDPOINTS, TAGS_API_URL } from '@/data5e/config';
import { HOMEBREW_FETCH_ORIGINS } from '@/features/homebrew/homebrewUrl';

const rawFiles = import.meta.glob(['/vercel.json', '/public/_headers', '/index.html'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const rawSources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const productionSources = Object.entries(rawSources).filter(
  ([path]) => !/\.test\.tsx?$/.test(path),
);

/** Every origin the app may connect to, derived from the code that does it. */
const CONNECT_ORIGINS = new Set<string>([
  ...ENDPOINTS.map((ep) => new URL(ep(DATA_TAG, 'x')).origin),
  new URL(TAGS_API_URL).origin,
  ...HOMEBREW_FETCH_ORIGINS,
]);

/**
 * URLs in production source that the app never connects to, each with the
 * reason. Anything else found by the scan must be in `connect-src`.
 */
const NON_CONNECT_ORIGINS: Record<string, string> = {
  'https://github.com':
    'pasted homebrew page URLs; homebrewUrl.ts rewrites them to raw.githubusercontent.com, never fetched',
  'https://gist.github.com':
    'pasted gist URLs; homebrewUrl.ts rewrites them to gist.githubusercontent.com, never fetched',
};

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

function vercelRule(): HeaderRule {
  const raw = rawFiles['/vercel.json'];
  if (raw === undefined) throw new Error('vercel.json is missing');
  const config = JSON.parse(raw) as { headers?: HeaderRule[] };
  const rule = config.headers?.find((r) => r.source === '/(.*)');
  if (rule === undefined) throw new Error('vercel.json has no "/(.*)" header rule');
  return rule;
}

function headerValue(name: string): string | undefined {
  return vercelRule().headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
}

/** The policy as directive name to its list of sources. */
function csp(): Map<string, string[]> {
  const value = headerValue('Content-Security-Policy');
  if (value === undefined) throw new Error('no Content-Security-Policy header');
  const out = new Map<string, string[]>();
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '') out.set(name, sources);
  }
  return out;
}

/** The `Name: value` lines under the `/*` rule of `public/_headers`. */
function underscoreHeaders(): { key: string; value: string }[] {
  const raw = rawFiles['/public/_headers'];
  if (raw === undefined) throw new Error('public/_headers is missing');
  const out: { key: string; value: string }[] = [];
  let inRule = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (!/^\s/.test(line)) {
      inRule = line.trim() === '/*';
      continue;
    }
    if (!inRule) continue;
    const colon = line.indexOf(':');
    out.push({ key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  return out;
}

describe('vercel.json security headers', () => {
  it('exists and enforces a Content-Security-Policy', () => {
    const keys = vercelRule().headers.map((h) => h.key);
    expect(keys).toContain('Content-Security-Policy');
    expect(keys.some((k) => /report-only/i.test(k))).toBe(false);
  });

  it('keeps the non-CSP hardening headers', () => {
    expect(headerValue('X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue('X-Frame-Options')).toBe('DENY');
    expect(headerValue('Referrer-Policy')).toBe('no-referrer');
    expect(headerValue('Permissions-Policy')).toContain('camera=()');
  });

  it('allows scripts and workers from this origin only', () => {
    const policy = csp();
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('worker-src')).toEqual(["'self'"]);
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
  });

  it('lets the app connect to exactly the origins its code contacts', () => {
    const connect = csp().get('connect-src') ?? [];
    expect(new Set(connect)).toEqual(new Set(["'self'", ...CONNECT_ORIGINS]));
    expect(connect).toHaveLength(CONNECT_ORIGINS.size + 1);
    for (const broad of ['*', 'https:', 'http:', 'data:', 'blob:']) {
      expect(connect).not.toContain(broad);
    }
  });
});

/**
 * Comment text, dropped before the scan so a URL in documentation does not
 * count as one the app contacts. Only comments that start a line are dropped
 * (`// ...` lines and `/* ... *\/` blocks opened at the start of a line): a
 * looser pattern could start inside a string and swallow real code. A URL in
 * a trailing comment is still scanned; move it to its own comment line.
 */
function stripComments(text: string): string {
  return text.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** URLs in `text` the policy does not account for, as `origin` or a description. */
function unaccountedUrls(text: string): string[] {
  const code = stripComments(text);
  const out: string[] = [];
  // A host the scan cannot read, built at runtime from a template or a
  // concatenation, could be anything: every fetch host must be a literal.
  for (const m of code.matchAll(/['"`](?:https?|wss?):\/\/(?:\$\{|['"`])/g)) {
    out.push(`runtime-built host: ${m[0]}`);
  }
  for (const m of code.matchAll(/\b(?:https?|wss?):\/\/[A-Za-z0-9.-]+(?::\d+)?/g)) {
    const origin = new URL(m[0]).origin;
    if (!CONNECT_ORIGINS.has(origin) && !(origin in NON_CONNECT_ORIGINS)) out.push(origin);
  }
  return out;
}

describe('the source scan', () => {
  it('flags a literal URL whose origin is not accounted for', () => {
    expect(unaccountedUrls("fetch('https://example.org/x.json');")).toEqual([
      'https://example.org',
    ]);
    expect(unaccountedUrls("const u = 'https://cdn.jsdelivr.net:8443/x';")).toEqual([
      'https://cdn.jsdelivr.net:8443',
    ]);
  });

  it('flags websocket URLs too', () => {
    expect(unaccountedUrls("new WebSocket('wss://example.org/live');")).toEqual([
      'wss://example.org',
    ]);
    expect(unaccountedUrls("new WebSocket('ws://example.org');")).toEqual(['ws://example.org']);
  });

  it('flags a host built at runtime', () => {
    // The text fetch(`https://${host}/x.json`), written without a placeholder.
    expect(unaccountedUrls(`fetch(\`https://${'$'}{host}/x.json\`);`)).toHaveLength(1);
    expect(unaccountedUrls("fetch('https://' + host + '/x.json');")).toHaveLength(1);
    expect(unaccountedUrls('fetch("wss://" + host);')).toHaveLength(1);
  });

  it('passes origins the policy allows or lists as never fetched', () => {
    expect(unaccountedUrls("fetch('https://raw.githubusercontent.com/a/b/c.json');")).toEqual([]);
    expect(unaccountedUrls("const page = 'https://github.com';")).toEqual([]);
  });

  it('ignores URLs in comments that start a line', () => {
    const text = [
      '// See https://example.org/docs for the format.',
      '/**',
      ' * Spec: https://example.net/spec',
      ' */',
      '  /* https://example.com */',
      "const ok = 'https://cdn.jsdelivr.net/x';",
    ].join('\n');
    expect(unaccountedUrls(text)).toEqual([]);
  });

  it('still scans code after a comment and in trailing comments', () => {
    const text = [
      '/* a comment */',
      "fetch('https://example.org/x.json');",
      'const a = 1; // https://example.net',
    ].join('\n');
    expect(unaccountedUrls(text)).toEqual(['https://example.org', 'https://example.net']);
  });
});

describe('production source', () => {
  it('names no URL origin the policy does not account for', () => {
    const unaccounted = productionSources.flatMap(([path, text]) =>
      unaccountedUrls(text).map((u) => `${path}: ${u}`),
    );
    expect(unaccounted).toEqual([]);
  });

  it('scans a real source tree', () => {
    // A glob that matched nothing would pass the scan above vacuously.
    expect(productionSources.length).toBeGreaterThan(50);
    expect(productionSources.some(([path]) => path === '/src/data5e/config.ts')).toBe(true);
  });
});

describe('index.html', () => {
  const html = rawFiles['/index.html'] ?? '';

  it('has no inline script', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, tag).toMatch(/\bsrc=/);
  });

  it('only warms up connections the policy allows', () => {
    const connect = new Set(csp().get('connect-src'));
    const hints = [
      ...html.matchAll(/<link\b[^>]*rel="(?:preconnect|dns-prefetch)"[^>]*href="([^"]+)"/g),
    ];
    expect(hints.length).toBeGreaterThan(0);
    for (const m of hints) expect(connect, m[1]).toContain(new URL(m[1] ?? '').origin);
  });
});

describe('public/_headers', () => {
  it('carries the same headers as vercel.json', () => {
    expect(underscoreHeaders()).toEqual(
      vercelRule().headers.map(({ key, value }) => ({ key, value })),
    );
  });
});
