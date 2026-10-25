import { readFileSync } from 'node:fs';

/**
 * The parts of `vercel.json` the E2E server copies, so the browser under test
 * gets the same headers (the enforced CSP above all) and the same SPA
 * fallback as production. `vercel.json` is the source of truth for both; the
 * app's build already reads it (see `vite.config.ts`).
 */
export interface VercelRouting {
  /** Every header whose rule matches `pathname`, later rules winning. */
  headersFor(pathname: string): Record<string, string>;
  /**
   * Where a path that matches no file is rewritten to, or null for a 404.
   * Vercel checks the filesystem first, so callers only ask after a miss.
   */
  rewriteFor(pathname: string): string | null;
}

interface HeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

interface RewriteRule {
  source: string;
  destination: string;
}

interface VercelConfig {
  headers?: HeaderRule[];
  rewrites?: RewriteRule[];
}

/**
 * Turns a Vercel `source` into an anchored RegExp. Vercel uses path-to-regexp
 * syntax: literal text, `(regex)` groups and `:name` parameters. This handles
 * exactly those and throws on anything else, so a new pattern style in
 * `vercel.json` fails loudly here instead of silently matching nothing.
 */
export function sourceToRegExp(source: string): RegExp {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === '(') {
      // Copy a balanced group verbatim: it is already a regular expression.
      let depth = 0;
      const start = i;
      for (; i < source.length; i++) {
        if (source[i] === '\\') {
          i++;
          continue;
        }
        if (source[i] === '(') depth++;
        if (source[i] === ')' && --depth === 0) break;
      }
      if (depth !== 0) throw new Error(`Unbalanced group in vercel.json source "${source}"`);
      out += source.slice(start, i + 1);
      i++;
      continue;
    }
    if (ch === ':') {
      const m = /^:(\w+)([*+?]?)/.exec(source.slice(i));
      if (m === null) throw new Error(`Bad parameter in vercel.json source "${source}"`);
      if (m[2] !== '') {
        throw new Error(`Unsupported modifier "${m[2]}" in vercel.json source "${source}"`);
      }
      out += '([^/]+)';
      i += m[0].length;
      continue;
    }
    if ('{}*+?'.includes(ch)) {
      throw new Error(`Unsupported token "${ch}" in vercel.json source "${source}"`);
    }
    out += ch.replace(/[.^$|[\]\\]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${out}$`);
}

/** Reads `vercel.json` at `configPath` into a {@link VercelRouting}. */
export function loadVercelRouting(configPath: string): VercelRouting {
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as VercelConfig;
  const headerRules = (config.headers ?? []).map((rule) => ({
    match: sourceToRegExp(rule.source),
    headers: rule.headers,
  }));
  const rewriteRules = (config.rewrites ?? []).map((rule) => {
    if (/[:$]/.test(rule.destination)) {
      throw new Error(
        `Rewrite destinations with parameters are not supported: ${rule.destination}`,
      );
    }
    return { match: sourceToRegExp(rule.source), destination: rule.destination };
  });

  return {
    headersFor(pathname) {
      const out: Record<string, string> = {};
      for (const rule of headerRules) {
        if (!rule.match.test(pathname)) continue;
        for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
      }
      return out;
    },
    rewriteFor(pathname) {
      return rewriteRules.find((rule) => rule.match.test(pathname))?.destination ?? null;
    },
  };
}
