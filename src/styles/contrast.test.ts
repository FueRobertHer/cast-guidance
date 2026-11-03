import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// DS-001: every pair the design system promises, held in both themes. Text
// clears 4.5:1 (WCAG 1.4.3), edges, marks and the focus ring 3:1 (WCAG
// 1.4.11). The values come from the two `--cg-*` blocks in app.css, which the
// colour utilities of the same name read, so a token that moves is measured
// where it lands. The axe gate (e2e/a11y) measures the rendered pages in both
// themes.

const SRC = path.resolve(import.meta.dirname, '..');
const CSS = readFileSync(path.join(SRC, 'styles/app.css'), 'utf8');

type Theme = 'dark' | 'light';
const THEMES: readonly Theme[] = ['dark', 'light'];

/** One theme's `--cg-*` values, with `var(--cg-…)` references followed. */
function themeTokens(theme: Theme): Record<string, string> {
  const selector = theme === 'dark' ? ':root,\n[data-theme="dark"] {' : '[data-theme="light"] {';
  const start = CSS.indexOf(selector);
  if (start < 0) throw new Error(`no ${theme} block in app.css`);
  const body = CSS.slice(start, CSS.indexOf('\n}', start));
  const raw: Record<string, string> = {};
  for (const m of body.matchAll(/--cg-([\w-]+):\s*([^;]+);/g)) {
    if (m[1] !== undefined && m[2] !== undefined) raw[m[1]] = m[2].trim();
  }
  const resolve = (name: string, seen = new Set<string>()): string => {
    const value = raw[name];
    if (value === undefined) throw new Error(`no --cg-${name} in the ${theme} block`);
    const ref = /^var\(--cg-([\w-]+)\)$/.exec(value)?.[1];
    if (ref === undefined) return value;
    if (seen.has(ref)) throw new Error(`--cg-${name} refers to itself`);
    return resolve(ref, seen.add(name));
  };
  return Object.fromEntries(Object.keys(raw).map((k) => [k, resolve(k)]));
}

const TOKENS: Record<Theme, Record<string, string>> = {
  dark: themeTokens('dark'),
  light: themeTokens('light'),
};

/** A colour in one theme: a token name, or a hex value as written. */
function colour(theme: Theme, name: string): string {
  if (name.startsWith('#')) return name;
  const value = TOKENS[theme][name];
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} is not an opaque #rrggbb colour in ${theme}: ${value}`);
  }
  return value;
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

/** `fg` at `alpha` over `ground`, as the browser composites it. */
function over(fg: string, alpha: number, ground: string): string {
  const mix = [1, 3, 5].map((i) => {
    const f = Number.parseInt(fg.slice(i, i + 2), 16);
    const g = Number.parseInt(ground.slice(i, i + 2), 16);
    return Math.round(f * alpha + g * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  });
  return `#${mix.join('')}`;
}

/** Each failing pair as `theme: fg on ground (ratio)`, so a failure names them all. */
function below(min: number, pairs: ReadonlyArray<readonly [string, string]>): string[] {
  return THEMES.flatMap((theme) =>
    pairs.flatMap(([fg, ground]) => {
      const ratio = contrast(colour(theme, fg), colour(theme, ground));
      return ratio < min ? [`${theme}: ${fg} on ${ground} (${ratio.toFixed(2)})`] : [];
    }),
  );
}

const cross = (fgs: readonly string[], grounds: readonly string[]) =>
  fgs.flatMap((fg) => grounds.map((ground) => [fg, ground] as const));

/** The grounds text sits on: the page, a card, a raised control. */
const GROUNDS = ['bg', 'surface', 'surface-raised'] as const;

describe('design token contrast, both themes (DS-001)', () => {
  it('reads the same token names in both themes', () => {
    expect(Object.keys(TOKENS.light).sort()).toEqual(Object.keys(TOKENS.dark).sort());
  });

  it('holds every text colour to 4.5:1 on the page, a card and a raised control', () => {
    const text = ['ink', 'ink-muted', 'brand', 'guide', 'danger', 'heal', 'ward', 'roll', 'arcane'];
    expect(below(4.5, cross(text, GROUNDS))).toEqual([]);
  });

  it('holds the words a control keeps on its hover step to 4.5:1', () => {
    expect(below(4.5, cross(['ink', 'ink-muted', 'brand', 'danger'], ['surface-hover']))).toEqual(
      [],
    );
  });

  it('holds each hue, ink and ink-muted to 4.5:1 on that hue’s soft tint', () => {
    const pairs = ['guide', 'danger', 'heal', 'ward', 'roll', 'arcane'].flatMap((hue) =>
      cross([hue, 'ink', 'ink-muted'], [`${hue}-soft`]),
    );
    expect(below(4.5, pairs)).toEqual([]);
  });

  it('holds the labels on the filled grounds to 4.5:1', () => {
    expect(
      below(4.5, [
        ['on-brand', 'brand'],
        ['on-brand', 'brand-hover'],
        ['on-danger', 'danger-fill'],
        // The danger banner's main action: the fill's red on a white button.
        ['danger-fill', 'on-danger'],
        // A snackbar, and a pressed chip or segment: the theme inverted.
        ['bg', 'ink'],
      ]),
    ).toEqual([]);
  });

  it('holds the snackbar’s detail line, at 75% of its ink, to 4.5:1', () => {
    for (const theme of THEMES) {
      const ink = colour(theme, 'ink');
      expect(contrast(over(colour(theme, 'bg'), 0.75, ink), ink), theme).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('holds outlined edges, marks and the focus ring to 3:1', () => {
    expect(
      below(3, [
        ...cross(['line-strong', 'brand', 'focus'], GROUNDS),
        ['focus', 'surface-hover'],
        // The ring takes the ground's label colour where gold would vanish.
        ['bg', 'ink'],
        ['on-danger', 'danger-fill'],
        // A meter's fill on its track.
        ...cross(['heal', 'meter-mid', 'danger', 'ward'], ['track']),
      ]),
    ).toEqual([]);
  });

  it('gives the theme-color meta and the boot script the page colour', () => {
    const boot = readFileSync(path.join(SRC, '../public/theme-boot.js'), 'utf8');
    for (const theme of THEMES) {
      expect(boot).toContain(`${theme}: '${colour(theme, 'bg')}'`);
    }
  });

  it('measures the ratio the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    // The grey commonly quoted as the lightest that passes on white.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

/** Every source file the app's classes come from, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return sources(file);
    return /\.(tsx?|css)$/.test(e.name) && !e.name.includes('.test.') ? [file] : [];
  });
}

/**
 * The colour names DS-001 retired, after any utility (`bg-`, `border-bs-`,
 * `text-shadow-`: matched by shape, so a utility Tailwind adds later is
 * covered too) or as a `--color-` variable, under any variant or opacity.
 * They were aliases onto the design's roles until every screen moved off
 * them. Now Tailwind skips the ones it has no colour for (`surface-2`,
 * `accent`) and draws its own palette for the rest (`white`, and
 * `amber-300`, 1.3:1 on the light page), so the build would not fail on one;
 * this test does. Use the role instead (app.css says what each is for). It
 * replaces A11Y-003's guard on bare `bg-accent`, which has no colour left.
 */
const RETIRED =
  /(?<![\w-])(?:[a-z]+(?:-[a-z]+)*-|--color-)(?:surface-[23]|accent(?:-deep|-ink|-fill)?|white|(?:amber|emerald|sky|purple|orange)-\d+)(?![\w-])/;

describe('the colour names DS-001 retired stay retired', () => {
  it('uses none of them in the source', () => {
    const files = [...sources(SRC), path.join(SRC, '../index.html')];
    const uses = files.flatMap((file) => {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => RETIRED.test(line))
        .map((line) => `${rel}: ${line.trim()}`);
    });
    expect(uses).toEqual([]);
  });

  it('sees a name in a conditional, under a variant or with an opacity, and not the roles', () => {
    // Joined from halves, neither of them a class: Tailwind scans this file
    // too, and would build the white and the hues into the stylesheet.
    const retired = [
      ['rounded bg-', 'accent/90'],
      ['text-', 'white'],
      ['hover:bg-', 'surface-3'],
      ['border-t-', 'amber-300'],
      ['border-bs-', 'white'],
      ['text-shadow-', 'sky-400'],
      ['bg-', 'accent-fill'],
      ['from-', 'emerald-900'],
      ['bg-[var(--color-', 'purple-300)]'],
    ].map((halves) => halves.join(''));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source text to scan, not a template
    retired.push("className={`text-sm ${danger ? 'bg-roll-soft' : 'bg-accent'}`}");
    expect(retired.filter((s) => !RETIRED.test(s))).toEqual([]);
    // `accent-ink` is the checkbox's accent-color in ink, not the old name.
    const roles =
      'bg-surface-raised hover:bg-surface-hover text-on-brand text-ink-muted accent-ink';
    expect(RETIRED.test(roles)).toBe(false);
  });
});
