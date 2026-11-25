import { BUILT_IN_THEMES, type BuiltInThemeId, builtInTheme, isBuiltInTheme } from './builtins';
import { isLight } from './colour';
import { fontId, fontStack } from './fonts';
import { MAX_THEME_BYTES } from './link';
import { rawTokens, themeRules } from './themeCss';
import { CHOICES, TOKEN_NAMES, type TokenKind, VOCABULARY } from './vocabulary';

/**
 * A theme file (docs/theme-format.md): a built-in base and the tokens it
 * changes, each checked by its kind. Read from anywhere, so nothing in it
 * reaches the page unchecked: a value that fails is dropped and named, and
 * the rest still draws. Looks are the person's own business; what is checked
 * is safety and what keeps the layout whole.
 */

/** The schema this build reads and writes. It moves only for a breaking change. */
export const THEME_SCHEMA = 1;

export type TokenValue = string | number;

export interface ThemeFile {
  castGuidanceTheme: typeof THEME_SCHEMA;
  name: string;
  author?: string;
  base: BuiltInThemeId;
  /** Vocabulary name to value, as the file writes it once normalised. */
  tokens: Record<string, TokenValue>;
}

export interface ParsedTheme {
  file: ThemeFile;
  /** What was left out, each a short line for the preview. */
  dropped: string[];
}

export type ParseResult = { ok: true; theme: ParsedTheme } | { ok: false; reason: string };

const KIND: ReadonlyMap<string, TokenKind> = new Map(VOCABULARY.map((t) => [t.name, t.kind]));

const MAX_TEXT = 60;

/** Plain text, one line: no control or bidirectional characters, at most 60 characters. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const plain = value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
    .replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...plain].slice(0, MAX_TEXT).join('').trim();
}

export type Check = { value: TokenValue } | { error: string };

function colour(raw: unknown, opaque: boolean): Check {
  if (typeof raw !== 'string') return { error: 'not a colour' };
  const v = raw.trim().toLowerCase();
  if (v === 'transparent') return opaque ? { error: 'must be opaque' } : { value: v };
  // #rgb and #rgba, written out.
  const short = /^#([0-9a-f]{3,4})$/.exec(v)?.[1];
  const hex = short ? `#${[...short].map((c) => c + c).join('')}` : v;
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return { error: 'not #rrggbb' };
  if (opaque && hex.length === 9 && !hex.endsWith('ff')) return { error: 'must be opaque' };
  return { value: opaque ? hex.slice(0, 7) : hex };
}

/** A length in px, from `<n>px`, `<n>rem` (16px) or a bare number (px). */
function px(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(px|rem)?\s*$/i.exec(raw);
  if (m === null) return null;
  const n = Number(m[1]);
  return m[2]?.toLowerCase() === 'rem' ? n * 16 : n;
}

/** Up to two decimals, so a value reads back the way it was meant. */
const round = (n: number) => Math.round(n * 100) / 100;

function radius(raw: unknown): Check {
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'full') return { value: 'full' };
  const n = px(raw);
  if (n === null) return { error: 'not a length' };
  if (n < 0 || n > 48) return { error: 'outside 0 to 48px' };
  return { value: `${round(n)}px` };
}

function edge(raw: unknown, min: number, max: number): Check {
  const n = px(raw);
  if (n === null) return { error: 'not a length' };
  if (n < min || n > max) return { error: `outside ${min} to ${max}px` };
  return { value: `${round(n)}px` };
}

function weight(raw: unknown): Check {
  const n = typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n % 100 !== 0 || n < 300 || n > 800) {
    return { error: 'not 300 to 800 in hundreds' };
  }
  return { value: n };
}

function stroke(raw: unknown): Check {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 3) {
    return { error: 'outside 1 to 3' };
  }
  return { value: round(n) };
}

function font(raw: unknown): Check {
  if (typeof raw !== 'string') return { error: 'not a font' };
  const id = raw.trim().toLowerCase();
  return fontStack(id) === undefined ? { error: 'not a bundled font' } : { value: id };
}

/**
 * `none`, or up to three layers of `[inset] x y [blur [spread]] colour`, in
 * px: offsets within 32px, blur within 64px, spread within 16px.
 */
function shadow(raw: unknown): Check {
  if (typeof raw !== 'string') return { error: 'not a shadow' };
  const text = raw.trim().toLowerCase();
  if (text === 'none') return { value: 'none' };
  const layers = text.split(',').map((l) => l.trim());
  if (layers.length > 3) return { error: 'more than three layers' };
  const out: string[] = [];
  for (const layer of layers) {
    // CSS takes `inset` and the colour at either end; this writes them out
    // as `[inset] lengths colour`.
    let parts = layer.split(/\s+/);
    const inset = parts.includes('inset');
    parts = parts.filter((p) => p !== 'inset');
    const at = parts.findIndex((p) => p.startsWith('#') || p === 'transparent');
    if (at !== 0 && at !== parts.length - 1) return { error: 'a layer has no #rrggbb colour' };
    const hue = colour(parts.splice(at, 1)[0], false);
    if ('error' in hue) return { error: 'a layer has no #rrggbb colour' };
    const lengths = parts.map(px);
    if (lengths.length < 2 || lengths.length > 4 || lengths.some((n) => n === null)) {
      return { error: 'a layer is not x y [blur [spread]]' };
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths as number[];
    if (Math.abs(x) > 32 || Math.abs(y) > 32 || blur < 0 || blur > 64 || Math.abs(spread) > 16) {
      return { error: 'a layer is past its bounds' };
    }
    const sizes = [x, y, blur, spread].slice(0, lengths.length).map((n) => `${round(n)}px`);
    out.push([...(inset ? ['inset'] : []), ...sizes, hue.value].join(' '));
  }
  return { value: out.join(', ') };
}

/** One token's value checked and normalised by its kind, as a file holds it. */
export function checkToken(name: string, raw: unknown): Check {
  switch (KIND.get(name)) {
    case 'colour':
      return colour(raw, name === 'bg');
    case 'font':
      return font(raw);
    case 'weight':
      return weight(raw);
    case 'radius':
      return radius(raw);
    case 'border':
      return name === 'border-strong' ? edge(raw, 1, 4) : edge(raw, 0, 3);
    case 'stroke':
      return stroke(raw);
    case 'shadow':
      return shadow(raw);
    case 'choice': {
      const look = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
      return CHOICES[name]?.includes(look)
        ? { value: look }
        : { error: `not one of ${(CHOICES[name] ?? []).join(', ')}` };
    }
    default:
      return { error: 'not a theme token' };
  }
}

/**
 * A value as the preview quotes it: plain, and short. A list or an object is
 * named by its kind, never written out, since one nested deep enough would
 * not stringify at all.
 */
function brief(raw: unknown): string {
  if (Array.isArray(raw)) return 'a list';
  if (typeof raw === 'object' && raw !== null) return 'an object';
  const text = cleanText(String(raw));
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/** Reads a theme file's JSON (any version this build knows), checking every value. */
export function parseThemeFile(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, reason: 'This is not a Cast Guidance theme.' };
  }
  const record = input as Record<string, unknown>;
  const version = record.castGuidanceTheme;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, reason: 'This is not a Cast Guidance theme.' };
  }
  if (version > THEME_SCHEMA) {
    return {
      ok: false,
      reason: 'This theme was made by a newer version of Cast Guidance. Update the app to use it.',
    };
  }
  // Version 1 is the only one so far; a later one migrates older files here.
  const dropped: string[] = [];
  let base: BuiltInThemeId = 'dark';
  if (isBuiltInTheme(record.base)) base = record.base;
  else
    dropped.push(`base ${brief(record.base)} (not a built-in theme here, so it is drawn on Dark)`);

  const tokens: Record<string, TokenValue> = {};
  const given =
    typeof record.tokens === 'object' && record.tokens !== null && !Array.isArray(record.tokens)
      ? (record.tokens as Record<string, unknown>)
      : {};
  for (const [name, raw] of Object.entries(given)) {
    if (!TOKEN_NAMES.has(name)) {
      dropped.push(`${brief(name)} (not a theme token)`);
      continue;
    }
    const result = checkToken(name, raw);
    if ('error' in result) dropped.push(`${name}: ${brief(raw)} (${result.error})`);
    else tokens[name] = result.value;
  }

  // The selected edge has to be wider than the resting one, or selection
  // vanishes: the file's selected edge goes first, then its resting one, each
  // held to the base's in its place.
  const [restingBase, selectedBase] = builtInTheme(base).edges;
  for (const name of ['border-strong', 'border'] as const) {
    const resting = px(tokens.border) ?? restingBase;
    const selected = px(tokens['border-strong']) ?? selectedBase;
    if (selected > resting || tokens[name] === undefined) continue;
    dropped.push(`${name}: ${tokens[name]} (the selected edge must be wider than the resting one)`);
    delete tokens[name];
  }

  const name = cleanText(record.name) || 'Untitled theme';
  const author = cleanText(record.author);
  return {
    ok: true,
    theme: {
      file: {
        castGuidanceTheme: THEME_SCHEMA,
        name,
        ...(author === '' ? {} : { author }),
        base,
        tokens,
      },
      dropped,
    },
  };
}

/** Reads a theme file's text: at most `MAX_THEME_BYTES`, and JSON. */
export function parseThemeText(text: string): ParseResult {
  if (new TextEncoder().encode(text).byteLength > MAX_THEME_BYTES) {
    return { ok: false, reason: 'This file is too large to be a theme.' };
  }
  try {
    return parseThemeFile(JSON.parse(text));
  } catch {
    return { ok: false, reason: 'This is not a Cast Guidance theme.' };
  }
}

/** A token's value as CSS. */
function cssValue(name: string, value: TokenValue): string {
  const kind = KIND.get(name);
  if (kind === 'font') return fontStack(String(value)) ?? String(value);
  if (kind === 'radius' && value === 'full') return 'calc(infinity * 1px)';
  if (kind === 'shadow' && value === 'none') return '0 0 #0000';
  return String(value);
}

/** The custom properties a file sets over its base, by full name (its choices aside). */
export function themeVars(file: ThemeFile): Record<string, string> {
  return Object.fromEntries(
    Object.entries(file.tokens)
      .filter(([name]) => KIND.get(name) !== 'choice')
      .map(([name, value]) => [`--cg-${name}`, cssValue(name, value)]),
  );
}

/** The attributes a file's choices are drawn with (decor.css): `data-cg-texture`. */
export function themeAttrs(file: ThemeFile): Record<string, string> {
  return Object.fromEntries(
    Object.entries(file.tokens)
      .filter(([name]) => KIND.get(name) === 'choice')
      .map(([name, value]) => [`data-cg-${name}`, String(value)]),
  );
}

/**
 * Light or dark ground, from the file's own `bg` when it sets one (black text
 * would read better on it than white), else the base's: native controls and
 * scrollbars follow it.
 */
export function themeScheme(file: ThemeFile): 'light' | 'dark' {
  const bg = file.tokens.bg;
  if (typeof bg !== 'string') return builtInTheme(file.base).scheme;
  return isLight(bg) ? 'light' : 'dark';
}

/** The colour of the browser's bars: the file's `bg`, else the base's. */
export function themePageColour(file: ThemeFile): string {
  const bg = file.tokens.bg;
  return typeof bg === 'string' ? bg : builtInTheme(file.base).pageColour;
}

/** One string per theme's content, so importing a theme already saved finds it. */
export function themeKey(file: ThemeFile): string {
  const tokens = Object.keys(file.tokens)
    .sort()
    .map((k) => [k, file.tokens[k]]);
  return JSON.stringify([file.base, tokens]);
}

/**
 * A built-in theme as a complete file to start from by hand: every token its
 * own rules set in themes.css (passed in as text, so the page loads it only
 * when someone exports), fonts as ids. The aliases (`roll` is `brand`) are
 * left out, so they keep following the role they name when it changes.
 */
export function builtInFile(id: BuiltInThemeId, css: string): ThemeFile {
  const raw = rawTokens(id, themeRules(css));
  const tokens: Record<string, TokenValue> = {};
  for (const t of VOCABULARY) {
    const value = raw[t.name];
    if (value === undefined || /^var\(/.test(value)) continue;
    const asFile =
      t.kind === 'font'
        ? (fontId(value) ?? value)
        : t.kind === 'radius' && /infinity/.test(value)
          ? 'full'
          : t.kind === 'shadow' && value === '0 0 #0000'
            ? 'none'
            : value;
    // Written the way a file holds it; a value outside a file's bounds stays
    // as it is, and file.test.ts fails on it.
    const checked = checkToken(t.name, asFile);
    tokens[t.name] = 'value' in checked ? checked.value : asFile;
  }
  // Choices are not in its CSS as values (decor.css): builtins.ts lists them.
  Object.assign(tokens, builtInTheme(id).decor);
  const label = BUILT_IN_THEMES.find((t) => t.id === id)?.label ?? id;
  return { castGuidanceTheme: THEME_SCHEMA, name: label, base: id, tokens };
}
