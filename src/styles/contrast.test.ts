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
 * Every bare `bg-accent` the app is allowed, and what each one is. None
 * carries a label: they are marks and icon-only fills, which need 3:1 (WCAG
 * 1.4.11) and get 3.8:1. Anything with words on it uses `bg-accent-fill`.
 *
 * Each entry names the source line by a piece of it, so the list pins the
 * lines rather than a count per file: moving the token from a mark onto a
 * label in the same file leaves the mark's entry unused and the label's
 * line unlisted, and both fail. A new use has to be added here on purpose,
 * which is the point: a class list split across a conditional, a variable
 * or a prop is out of reach of any per-attribute check.
 */
const MARKS: ReadonlyArray<{ file: string; line: string; what: string }> = [
  { file: 'app/AppNav.tsx', line: 'h-0.5 rounded-full bg-accent', what: 'the current tab bar' },
  {
    file: 'features/sheet/SheetLayout.tsx',
    line: 'h-0.5 rounded-full bg-accent',
    what: "the sheet's current tab bar",
  },
  {
    file: 'features/characters/CharacterListPage.tsx',
    line: "ratio > 0.25 ? 'bg-amber-400' : 'bg-accent'",
    what: 'the low HP bar',
  },
  {
    file: 'features/sheet/tabs/PlayTab.tsx',
    line: "ratio > 0.25 ? 'bg-amber-400' : 'bg-accent'",
    what: 'the low HP bar',
  },
  {
    file: 'features/sheet/tabs/PlayTab.tsx',
    line: ": 'border-accent bg-accent'",
    what: 'a failed death save',
  },
  {
    file: 'features/sheet/tabs/PlayTab.tsx',
    line: 'tone="border-accent bg-accent"',
    what: 'resource pips',
  },
  {
    file: 'features/dice/DiceTray.tsx',
    line: 'h-12 w-12 items-center justify-center rounded-full bg-accent',
    what: 'the icon-only dice button',
  },
  {
    file: 'ui/DataBanner.tsx',
    line: 'h-full bg-accent transition-all',
    what: "the download bar's fill",
  },
  { file: 'ui/ProfDot.tsx', line: "? 'bg-accent'", what: 'the proficiency dot' },
];

/**
 * Bare `bg-accent` class tokens, opacity variants (`bg-accent/90`) included:
 * those are the same light red. Not `bg-accent-deep` or `bg-accent-fill`.
 */
const BARE = /(?<![\w-])bg-accent(?![\w-])/;

/** Every source line holding a bare token, as `file: line`, matched to MARKS. */
function bareLines(): { unlisted: string[]; unused: string[] } {
  const unused = new Set(MARKS);
  const unlisted: string[] = [];
  for (const file of sources(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!BARE.test(line)) continue;
      const mark = [...unused].find((m) => m.file === rel && line.includes(m.line));
      if (mark === undefined) unlisted.push(`${rel}: ${line.trim()}`);
      else unused.delete(mark);
    }
  }
  return { unlisted, unused: [...unused].map((m) => `${m.file}: ${m.what}`) };
}

describe('label contrast on the accent fill (A11Y-003)', () => {
  it('accent-fill clears 4.5:1 with white and with ink', () => {
    expect(contrast(token('accent-fill'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent-fill'), token('ink'))).toBeGreaterThanOrEqual(4.5);
  });

  it('accent-ink clears 4.5:1 on a raised control and its hover step', () => {
    for (const surface of ['surface-2', 'surface-3']) {
      expect(contrast(token('accent-ink'), token(surface))).toBeGreaterThanOrEqual(4.5);
    }
    // Why it exists: the page red does not, on either.
    expect(contrast(token('accent'), token('surface-2'))).toBeLessThan(4.5);
  });

  it('measures the ratio the way WCAG does', () => {
    // The pair that failed: white on red-500.
    expect(contrast(token('accent'), '#ffffff')).toBeCloseTo(3.76, 2);
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });

  it('uses the lighter bg-accent only on the listed marks', () => {
    expect(bareLines()).toEqual({ unlisted: [], unused: [] });
  });

  it('sees a token inside a conditional or with an opacity, and not the other reds', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source text to scan, not a template
    expect(BARE.test("className={`text-sm ${danger ? 'bg-accent-deep' : 'bg-accent'}`}")).toBe(
      true,
    );
    expect(BARE.test('rounded bg-accent/90 text-white')).toBe(true);
    expect(BARE.test('bg-accent-fill bg-accent-deep bg-accent-deep/40 border-accent')).toBe(false);
  });
});
