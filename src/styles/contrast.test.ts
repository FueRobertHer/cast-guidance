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
 * Labelled controls still on `bg-accent`, each with why. The save-error
 * banner's Retry lives in AppShell, which #166 is changing; it moves to
 * `bg-accent-fill` once that lands.
 */
const ALLOWED = new Set(['app/AppShell.tsx']);

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

  it('puts no text-styled class list on the lighter bg-accent', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      if (ALLOWED.has(rel)) continue;
      // Each quoted class list on its own: a string or a template literal.
      for (const m of readFileSync(file, 'utf8').matchAll(/(["'`])([^"'`]*)\1/g)) {
        const classes = (m[2] ?? '').split(/\s+/);
        if (!classes.includes('bg-accent')) continue;
        if (classes.some((c) => /^(font-|text-(xs|sm|base|lg|xl))/.test(c))) {
          offenders.push(`${rel}: ${m[2]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
