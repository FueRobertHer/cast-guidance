import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// DS-001: every pair the design system promises, held in both themes. Text
// clears 4.5:1 (WCAG 1.4.3), edges, marks and the focus ring 3:1 (WCAG
// 1.4.11). The values come from the two `--cg-*` blocks in app.css, and the
// colour utilities from the `--color-*` names that point at them, so a token
// or an alias that moves is measured where it lands. The axe gate (e2e/a11y)
// measures the rendered pages in both themes.

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

/** The `--cg-*` token a colour utility reads: `accent` gives `brand`. */
function utilityToken(name: string): string {
  const m = new RegExp(`--color-${name}:\\s*var\\(--cg-([\\w-]+)\\)`).exec(CSS);
  if (m?.[1] === undefined) throw new Error(`no --color-${name} in app.css`);
  return m[1];
}

/** A colour in one theme: a utility name, or a hex value as written. */
function colour(theme: Theme, name: string): string {
  if (name.startsWith('#')) return name;
  const value = TOKENS[theme][name] ?? TOKENS[theme][utilityToken(name)];
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

describe('the temporary aliases still pass (DS-001)', () => {
  it('points each old name at the role it took', () => {
    expect(
      Object.fromEntries(
        ['surface-2', 'surface-3', 'accent', 'accent-deep', 'accent-ink', 'white'].map((n) => [
          n,
          utilityToken(n),
        ]),
      ),
    ).toEqual({
      'surface-2': 'surface-raised',
      'surface-3': 'surface-hover',
      accent: 'brand',
      'accent-deep': 'roll-soft',
      'accent-ink': 'danger',
      white: 'on-brand',
    });
  });

  it('keeps the old pairs readable: labels on the fills, words on the tints', () => {
    expect(
      below(4.5, [
        // `bg-accent-fill` paints brand with an on-brand label.
        ['white', 'accent'],
        ['accent-ink', 'surface-2'],
        ['accent-ink', 'surface-3'],
        ['ink', 'accent-deep'],
        ['ink-muted', 'accent-deep'],
        ['accent', 'surface'],
      ]),
    ).toEqual([]);
  });

  it('gives the bg-accent-fill utility the label colour that reads on it', () => {
    const rule = /@utility bg-accent-fill \{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(rule).toContain('background-color: var(--cg-brand)');
    expect(rule).toContain('color: var(--cg-on-brand)');
  });
});

/** Every component source file, tests left out. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return sources(file);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [file] : [];
  });
}

/**
 * Every bare `bg-accent` the app is allowed, and what each one is (A11Y-003).
 * The alias is the action blue now, which ink does not read on in either
 * theme, so none carries a label: they are marks and icon-only fills, which
 * need 3:1 (WCAG 1.4.11; the test above). Anything with words on it uses
 * `bg-accent-fill`, which brings its label colour, or `bg-brand` with
 * `text-on-brand`.
 *
 * Each entry names the source line by a piece of it, so the list pins the
 * lines rather than a count per file: moving the token from a mark onto a
 * label in the same file leaves the mark's entry unused and the label's
 * line unlisted, and both fail. A new use has to be added here on purpose,
 * which is the point: a class list split across a conditional, a variable
 * or a prop is out of reach of any per-attribute check.
 */
const MARKS: ReadonlyArray<{ file: string; line: string; what: string }> = [
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
  { file: 'ui/ProfDot.tsx', line: "? 'bg-accent'", what: 'the proficiency dot' },
];

/**
 * Bare `bg-accent` class tokens, opacity variants (`bg-accent/90`) included:
 * those are the same fill. Not `bg-accent-deep` or `bg-accent-fill`.
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

describe('bare bg-accent carries no label (A11Y-003)', () => {
  it('uses bg-accent only on the listed marks', () => {
    expect(bareLines()).toEqual({ unlisted: [], unused: [] });
  });

  it('sees a token inside a conditional or with an opacity, and not the other names', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source text to scan, not a template
    expect(BARE.test("className={`text-sm ${danger ? 'bg-accent-deep' : 'bg-accent'}`}")).toBe(
      true,
    );
    expect(BARE.test('rounded bg-accent/90 text-white')).toBe(true);
    expect(BARE.test('bg-accent-fill bg-accent-deep bg-accent-deep/40 border-accent')).toBe(false);
  });
});
