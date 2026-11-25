import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  pageTokens,
  rawTokens,
  themeIds,
  themeProperties,
  themeRules,
  themeTokens,
} from '../../tests-fixtures/themeCss';
import { BUILT_IN_THEMES } from './builtins';
import { THEME_FONTS } from './fonts';
import { TOKEN_NAMES, type TokenKind, VOCABULARY } from './vocabulary';

// Every built-in theme in src/styles/themes.css sets every token in the
// vocabulary and nothing else, so a theme picker's miniature (a subtree with
// its own `data-theme`) is never drawn with a value leaking in from the page's
// theme, and a theme file can name every value a built-in sets.

const RULES = themeRules();
const IDS = themeIds(RULES);

/** What a value of each kind may look like in a built-in theme, once resolved. */
const SHAPE: Readonly<Record<TokenKind, RegExp>> = {
  colour: /^(#[0-9a-f]{6}([0-9a-f]{2})?|transparent)$/i,
  shadow: /^(\d|-|inset)[^;{}]*$/,
  font: /^("[^"]+"|[a-z-]+)(\s*,\s*("[^"]+"|[a-z-]+))*$/i,
  weight: /^[1-9]00$/,
  radius: /^(\d+(\.\d+)?(rem|px)|calc\(infinity \* 1px\))$/,
  border: /^\d+(\.\d+)?px$/,
  stroke: /^\d+(\.\d+)?$/,
};

describe('the theme vocabulary (DS-001)', () => {
  it('names each token once', () => {
    expect(TOKEN_NAMES.size).toBe(VOCABULARY.length);
  });

  it('finds the built-in themes, Dark first, as builtins.ts lists them', () => {
    expect(IDS[0]).toBe('dark');
    expect([...IDS].sort()).toEqual(BUILT_IN_THEMES.map((t) => t.id).sort());
  });

  it.each(BUILT_IN_THEMES)('gives $label the colour scheme and edges builtins.ts says', (theme) => {
    expect(themeProperties(theme.id, RULES)['color-scheme']).toBe(theme.scheme);
    const tokens = themeTokens(theme.id, RULES);
    expect([tokens.border, tokens['border-strong']]).toEqual(theme.edges.map((px) => `${px}px`));
  });

  it.each(IDS)('has %s set every token, and no others', (id) => {
    const names = Object.keys(rawTokens(id, RULES));
    expect(VOCABULARY.map((t) => t.name).filter((n) => !names.includes(n))).toEqual([]);
    expect(names.filter((n) => !TOKEN_NAMES.has(n))).toEqual([]);
  });

  it.each(IDS)('has every %s value in the shape its kind takes', (id) => {
    const tokens = themeTokens(id, RULES);
    const wrong = VOCABULARY.filter((t) => !SHAPE[t.kind].test(tokens[t.name] ?? '')).map(
      (t) => `${t.name}: ${tokens[t.name]}`,
    );
    expect(wrong).toEqual([]);
  });

  it.each(IDS)('gives %s a colour scheme, for native controls and scrollbars', (id) => {
    expect(['light', 'dark']).toContain(themeProperties(id, RULES)['color-scheme']);
  });

  it.each(IDS)('draws %s the same on the page as in its preview', (id) => {
    // A `:root` rule further down the file than a theme's own would win on
    // <html> (`:root` matches whatever the theme) and nowhere else.
    expect(pageTokens(id, RULES)).toEqual(rawTokens(id, RULES));
  });

  it('draws a page with no `data-theme` in Dark: `:root` goes with Dark, and only with it', () => {
    const mismatched = RULES.filter(
      (r) => r.selectors.includes(':root') !== r.selectors.includes('[data-theme="dark"]'),
    ).map((r) => r.selectors.join(', '));
    expect(mismatched).toEqual([]);
  });
});

describe('docs/theme-format.md', () => {
  const doc = readFileSync(path.resolve(import.meta.dirname, '../../docs/theme-format.md'), 'utf8');

  it('names every token, every font and every built-in a file may use', () => {
    const named = (word: string) => doc.includes(`\`${word}\``);
    expect(VOCABULARY.map((t) => t.name).filter((n) => !named(n))).toEqual([]);
    expect(THEME_FONTS.map((f) => f.id).filter((id) => !named(id))).toEqual([]);
    expect(BUILT_IN_THEMES.map((t) => t.id).filter((id) => !named(id))).toEqual([]);
  });
});
