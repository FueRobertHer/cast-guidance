/**
 * Reads the built-in themes out of src/styles/themes.css: the tests that hold
 * them to the vocabulary and the design system's ratios read the file
 * (tests-fixtures/themeCss.ts), and exporting a built-in as a theme file reads
 * it as text (`builtInFile` in file.ts, through a `?raw` import).
 *
 * A theme is every top-level rule whose selector list names it,
 * `[data-theme="<id>"]`, merged in source order as the cascade would (the
 * selectors are all one attribute or `:root`, so order alone decides). A rule
 * that only says `:root` does not count: a theme picker's miniature is a
 * subtree with its own `data-theme`, which `:root` never reaches.
 */

export interface ThemeRule {
  selectors: readonly string[];
  /** The `--cg-*` declarations, by name without the prefix, as written. */
  tokens: Readonly<Record<string, string>>;
  /** Every other declaration, by property. */
  other: Readonly<Record<string, string>>;
}

/** The file's top-level rules. It has no at-rules or nesting. */
export function themeRules(css: string): ThemeRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: ThemeRule[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    const tokens: Record<string, string> = {};
    const other: Record<string, string> = {};
    for (const d of (m[2] ?? '').matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      const [prop, value] = [d[1] ?? '', (d[2] ?? '').trim()];
      if (prop.startsWith('--cg-')) tokens[prop.slice(5)] = value;
      else other[prop] = value;
    }
    rules.push({ selectors, tokens, other });
  }
  return rules;
}

const ID = /^\[data-theme="([\w-]+)"\]$/;

/** Every theme id the file names, in order of first mention. */
export function themeIds(rules: readonly ThemeRule[]): string[] {
  const ids: string[] = [];
  for (const rule of rules) {
    for (const s of rule.selectors) {
      const id = ID.exec(s)?.[1];
      if (id !== undefined && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** One theme's declarations as written, `var()` references left in. */
export function rawTokens(id: string, rules: readonly ThemeRule[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.selectors.includes(`[data-theme="${id}"]`)) Object.assign(merged, rule.tokens);
  }
  return merged;
}

/**
 * One theme's declarations as <html> sees them, where `:root` rules apply
 * whatever the theme: the cascade on the page itself, as against a
 * miniature's subtree (`rawTokens`). The two must agree, or the page and its
 * preview in Settings draw a theme differently.
 */
export function pageTokens(id: string, rules: readonly ThemeRule[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.selectors.includes(':root') || rule.selectors.includes(`[data-theme="${id}"]`)) {
      Object.assign(merged, rule.tokens);
    }
  }
  return merged;
}

/** One theme's other declarations (`color-scheme`), merged the same way. */
export function themeProperties(id: string, rules: readonly ThemeRule[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const rule of rules) {
    if (rule.selectors.includes(`[data-theme="${id}"]`)) Object.assign(merged, rule.other);
  }
  return merged;
}

/** One theme's tokens with every whole-value `var(--cg-…)` followed. */
export function themeTokens(id: string, rules: readonly ThemeRule[]): Record<string, string> {
  const raw = rawTokens(id, rules);
  const resolve = (name: string, seen: ReadonlySet<string> = new Set()): string => {
    const value = raw[name];
    if (value === undefined) throw new Error(`no --cg-${name} in the ${id} theme`);
    const ref = /^var\(--cg-([\w-]+)\)$/.exec(value)?.[1];
    if (ref === undefined) return value;
    if (seen.has(ref)) throw new Error(`--cg-${name} refers to itself in ${id}`);
    return resolve(ref, new Set([...seen, name]));
  };
  return Object.fromEntries(Object.keys(raw).map((k) => [k, resolve(k)]));
}
