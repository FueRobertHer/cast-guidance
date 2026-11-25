import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_THEMES } from '@/theme/builtins';
import { CONDITION_HUES } from '@/theme/vocabulary';
import { themeIds, themeTokens } from '../../tests-fixtures/themeCss';

// DS-001: every pair the design system promises, held in every built-in
// theme. Text clears 4.5:1 (WCAG 1.4.3), edges, marks and the focus ring 3:1
// (WCAG 1.4.11). The values come from the theme rules in themes.css, which the
// colour utilities of the same name read, so a token that moves is measured
// where it lands. The axe gate (e2e/a11y) measures the rendered pages in each.
// Themes people make for themselves are theirs, and held to none of this.

const SRC = path.resolve(import.meta.dirname, '..');

type Theme = string;
const THEMES: readonly Theme[] = themeIds();

const TOKENS: Readonly<Record<Theme, Record<string, string>>> = Object.fromEntries(
  THEMES.map((theme) => [theme, themeTokens(theme)]),
);

/** A colour in one theme: a token name, or a hex value as written. */
function colour(theme: Theme, name: string): string {
  if (name.startsWith('#')) return name;
  const value = TOKENS[theme]?.[name];
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

describe('design token contrast, every built-in theme (DS-001)', () => {
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
        // The roll prompt's Heal, for a spell that heals.
        ['on-brand', 'heal'],
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
// design's roles, but the number on them is text.

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
  const c = TOKENS[theme]?.[`cx-${look}`];
  const cs = TOKENS[theme]?.[`cx-${look}-soft`];
  if (c === undefined || cs === undefined) throw new Error(`no ${theme} hue for ${look}`);
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

describe('the number on a condition’s chip, every built-in theme', () => {
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

  it('draws each condition in its own hue tokens, so the pairs above are the ones on screen', () => {
    const wrong = CONDITION_HUES.filter(
      (look) =>
        !CHIP_CSS.includes(
          `.cx-${look} {\n  --c: var(--cg-cx-${look});\n  --cs: var(--cg-cx-${look}-soft);\n}`,
        ),
    );
    expect(wrong).toEqual([]);
    // And nowhere else sets them: no theme-keyed override, no stray hue.
    expect(CHIP_CSS.match(/^\s*--cs?:/gm)?.length).toBe(CONDITION_HUES.length * 2);
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

// The page textures (styles/decor.css) lay grey noise over `bg`, blended
// `soft-light` at a strength each texture sets. Text on the page has to read
// over the darkest and the lightest the noise can make it.

const DECOR_CSS = readFileSync(path.join(SRC, 'styles/decor.css'), 'utf8');

/** A texture's strength: the alpha at the end of its noise's colour matrix. */
function textureStrength(texture: string): number {
  const url = new RegExp(`--cg-texture-${texture}: url\\("([^"]+)"\\)`).exec(DECOR_CSS)?.[1];
  if (url === undefined) throw new Error(`no texture ${texture} in decor.css`);
  const matrix = [...decodeURIComponent(url).matchAll(/feColorMatrix values='([^']+)'/g)].at(
    -1,
  )?.[1];
  const alpha = Number(matrix?.trim().split(/\s+/).at(-1));
  if (!Number.isFinite(alpha)) throw new Error(`no strength for ${texture}`);
  return alpha;
}

/** `ground` under noise of grey `g` (0 to 1) at `alpha`, blended soft-light (W3C). */
function softLight(ground: string, g: number, alpha: number): string {
  const channel = (i: number) => {
    const b = Number.parseInt(ground.slice(i, i + 2), 16) / 255;
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    const blended = g <= 0.5 ? b - (1 - 2 * g) * b * (1 - b) : b + (2 * g - 1) * (d - b);
    return Math.round(((1 - alpha) * b + alpha * blended) * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

describe('text on a textured page, every built-in with a texture', () => {
  const textured = BUILT_IN_THEMES.filter((t) => t.decor.texture !== 'none');

  it('has one to check (Parchment)', () => {
    expect(textured.map((t) => t.id)).toContain('parchment');
  });

  it.each(
    textured,
  )('holds $label’s text to 4.5:1 over its texture at its darkest and lightest', (theme) => {
    const alpha = textureStrength(theme.decor.texture);
    const bg = colour(theme.id, 'bg');
    const failing = [0, 1].flatMap((g) => {
      const ground = softLight(bg, g, alpha);
      return ['ink', 'ink-muted', 'brand', 'guide', 'danger', 'heal', 'ward', 'roll', 'arcane']
        .map((t) => [t, contrast(colour(theme.id, t), ground)] as const)
        .filter(([, ratio]) => ratio < 4.5)
        .map(([t, ratio]) => `${t} on ${ground} (${ratio.toFixed(2)})`);
    });
    expect(failing).toEqual([]);
  });
});
