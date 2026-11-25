import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as css from '../src/theme/themeCss';

/**
 * src/theme/themeCss.ts, reading src/styles/themes.css from disk unless a
 * test hands it other rules.
 */

export type { ThemeRule } from '../src/theme/themeCss';

export const THEMES_CSS_PATH = path.resolve(import.meta.dirname, '../src/styles/themes.css');

export function themeRules(text: string = readFileSync(THEMES_CSS_PATH, 'utf8')): css.ThemeRule[] {
  return css.themeRules(text);
}

export const themeIds = (rules: readonly css.ThemeRule[] = themeRules()) => css.themeIds(rules);
export const rawTokens = (id: string, rules: readonly css.ThemeRule[] = themeRules()) =>
  css.rawTokens(id, rules);
export const pageTokens = (id: string, rules: readonly css.ThemeRule[] = themeRules()) =>
  css.pageTokens(id, rules);
export const themeProperties = (id: string, rules: readonly css.ThemeRule[] = themeRules()) =>
  css.themeProperties(id, rules);
export const themeTokens = (id: string, rules: readonly css.ThemeRule[] = themeRules()) =>
  css.themeTokens(id, rules);
