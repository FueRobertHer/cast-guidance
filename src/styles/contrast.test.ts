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
        // A spell's concentration mark while it is being concentrated on.
        ['surface', 'arcane'],
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

// The condition hues on rolls (ui/chipFace.css) are a named exception to the
// design's roles, so they are not tokens, but the number on them is text.

const CHIP_CSS = readFileSync(path.join(SRC, 'ui/chipFace.css'), 'utf8');

/**
 * The piece of each signature that lays the most colour behind the number,
 * taken at full strength. It may be a gradient or a sliver that never covers
 * the number, which only makes this the floor. Invisible has no fill. Paralyzed's
 * bolts and every flash go by in a moment, and the spec accepts those dips; held
 * still, the bolts park clear of the number (chipFace.test.ts). Restrained's
 * chains hold to the edges for good (chipFace.test.ts too), so all that is behind
 * its number is its tint, which `null` says.
 */
const FILLS: Readonly<Record<string, string | null>> = {
  poisoned: 'liquid',
  paralyzed: 'lit',
  frightened: 'vignette',
  blinded: 'fog',
  prone: 'pile',
  restrained: null,
  grappled: 'prong',
  exhaustion: 'charge',
  stunned: 'wash',
  unconscious: 'dusk',
  incapacitated: 'strike',
  petrified: 'course',
};

/** A condition's colour (`c`) and tint (`cs`) in one theme. */
function hue(theme: Theme, look: string): { c: string; cs: string } {
  const selector = theme === 'dark' ? `.cx-${look}` : `[data-theme="light"] .cx-${look}`;
  const at = CHIP_CSS.split('\n').indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${theme} hue for ${look} in chipFace.css`);
  const [c, cs] = CHIP_CSS.split('\n')
    .slice(at + 1, at + 3)
    .map((line) => /:\s*([^;]+);/.exec(line)?.[1]);
  if (c === undefined || cs === undefined) throw new Error(`unreadable hue for ${look}`);
  return { c, cs };
}

/** A piece's strongest opacity: what its rule sets, or its own keyframes raise it to. */
function strength(piece: string): number {
  const rule = new RegExp(`^\\.cx-${piece} \\{[^}]*?\\n\\s*opacity: ([\\d.]+);`, 'm').exec(
    CHIP_CSS,
  );
  if (rule === null) throw new Error(`no opacity on .cx-${piece}`);
  const frames = new RegExp(`@keyframes cx-${piece} \\{(?:[^{}]*\\{[^{}]*\\})*`).exec(CHIP_CSS);
  const raised = [...(frames?.[0] ?? '').matchAll(/opacity: ([\d.]+);/g)].map((m) => Number(m[1]));
  return Math.max(Number(rule[1]), ...raised);
}

describe('the number on a condition’s chip, both themes', () => {
  it('holds ink to 4.5:1 over each condition’s strongest layer on its tint', () => {
    const failing = THEMES.flatMap((theme) =>
      Object.entries(FILLS).flatMap(([look, piece]) => {
        const { c, cs } = hue(theme, look);
        const behind = piece === null ? cs : over(c, strength(piece), cs);
        const ratio = contrast(colour(theme, 'ink'), behind);
        return ratio < 4.5 ? [`${theme}: ${look} (${ratio.toFixed(2)})`] : [];
      }),
    );
    expect(failing).toEqual([]);
  });

  it('reads Paralyzed’s glow at its peak, not its still pose', () => {
    expect(strength('lit')).toBe(0.26);
    expect(strength('liquid')).toBe(0.34);
    expect(strength('strike')).toBe(0.4);
    expect(strength('prong')).toBe(0.45);
  });

  it('keeps Invisible as glass: the number stands on the page', () => {
    for (const theme of THEMES) expect(hue(theme, 'invisible').cs).toBe('transparent');
  });

  it('holds the 2024 exhaustion tag to 4.5:1 on its surface, where it pokes past the chip', () => {
    for (const theme of THEMES) {
      const ratio = contrast(hue(theme, 'exhaustion').c, colour(theme, 'surface'));
      expect(ratio, theme).toBeGreaterThanOrEqual(4.5);
    }
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
