import { describe, expect, it } from 'vitest';
import {
  rawTokens,
  themeIds,
  themeProperties,
  themeRules,
  themeTokens,
} from '../../tests-fixtures/themeCss';
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

  it('finds the built-in themes, Dark first', () => {
    expect(IDS[0]).toBe('dark');
    expect(IDS).toContain('light');
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

  it('draws a page with no `data-theme` in Dark: `:root` goes with Dark, and only with it', () => {
    const mismatched = RULES.filter(
      (r) => r.selectors.includes(':root') !== r.selectors.includes('[data-theme="dark"]'),
    ).map((r) => r.selectors.join(', '));
    expect(mismatched).toEqual([]);
  });
});
