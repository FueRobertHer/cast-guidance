import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A11Y-003: a button label on the red fill has to clear 4.5:1 (WCAG 1.4.3).
// White on `accent` (red-500) is 3.8:1, which axe flagged on every filled
// button it reached, so labels sit on `accent-fill` instead. This holds the
// token to the ratio and keeps labelled controls off the lighter red; the axe
// gate (e2e/a11y) measures the rendered pages.

const SRC = path.resolve(import.meta.dirname, '..');
const CSS = readFileSync(path.join(SRC, 'styles/app.css'), 'utf8');

function token(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(CSS);
  if (m?.[1] === undefined) throw new Error(`no --color-${name} in app.css`);
  return m[1];
}

/** WCAG 2 relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every component source file, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return sources(file);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [file] : [];
  });
}

/**
 * Every bare `bg-accent` the app is allowed, per file, and what each one is.
 * None carries a label: they are marks and icon-only fills, which need 3:1
 * (WCAG 1.4.11) and get 3.8:1. Anything with words on it uses
 * `bg-accent-fill`. A new use has to be added here on purpose, which is the
 * point: a class list can be split across a conditional, a variable or a prop
 * where no per-attribute check would see it.
 */
const MARKS: Readonly<Record<string, { count: number; what: string }>> = {
  'app/AppNav.tsx': { count: 1, what: 'the current tab bar' },
  'features/sheet/SheetLayout.tsx': { count: 1, what: "the sheet's current tab bar" },
  'features/characters/CharacterListPage.tsx': { count: 1, what: 'the low HP bar' },
  'features/sheet/tabs/PlayTab.tsx': {
    count: 3,
    what: 'the low HP bar, a failed death save, resource pips',
  },
  'features/dice/DiceTray.tsx': { count: 1, what: 'the icon-only dice button' },
  'ui/DataBanner.tsx': { count: 1, what: "the download bar's fill" },
  'ui/ProfDot.tsx': { count: 1, what: 'the proficiency dot' },
};

/** Bare `bg-accent` class tokens (not `bg-accent-deep`, `-fill`, or `/40`). */
const BARE = /(?<![\w-])bg-accent(?![\w/-])/g;

describe('label contrast on the accent fill (A11Y-003)', () => {
  it('accent-fill clears 4.5:1 with white and with ink', () => {
    expect(contrast(token('accent-fill'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent-fill'), token('ink'))).toBeGreaterThanOrEqual(4.5);
  });

  it('measures the ratio the way WCAG does', () => {
    // The pair that failed: white on red-500.
    expect(contrast(token('accent'), '#ffffff')).toBeCloseTo(3.76, 2);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('uses the lighter bg-accent only for the listed marks', () => {
    const seen: Record<string, number> = {};
    for (const file of sources(SRC)) {
      const n = readFileSync(file, 'utf8').match(BARE)?.length ?? 0;
      if (n > 0) seen[path.relative(SRC, file).split(path.sep).join('/')] = n;
    }
    const allowed = Object.fromEntries(Object.entries(MARKS).map(([f, m]) => [f, m.count]));
    expect(seen).toEqual(allowed);
  });

  it('sees a token inside a conditional, which a class-list check would miss', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source text to scan, not a template
    const source = "className={`text-sm ${danger ? 'bg-accent-deep' : 'bg-accent'}`}";
    expect(source.match(BARE)).toEqual(['bg-accent']);
    expect('bg-accent-fill bg-accent-deep bg-accent/40 border-accent'.match(BARE)).toBeNull();
  });
});
