import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A theme sets corners, edge widths and weights (src/theme/vocabulary.ts), so a
// class that hard-codes one draws the same in every theme and breaks the
// reskin. These are the utilities that do: Tailwind's own corner sizes and
// arbitrary corners (use a tier: `rounded-chip`, `-control`, `-card`,
// `-sheet`, `-pill`, or a derived one in app.css; `rounded-full` is for true
// circles), ring widths (bare `ring` is the theme's edge, `ring-strong` its
// selected edge; `ring-0` is none), and weights the vocabulary has no token
// for. Explicit border widths (`border-4`, `border-8`) are transparent tap
// insets, and arbitrary ring widths (`ring-[1.5px]`) an effect's mark, as in
// ui/lift.css, so they may stay.

const SRC = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) return sources(file);
    return /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [file] : [];
  });
}

const VARIANTS = String.raw`(?:[\w\-\[\]&:*>@/.()]+:)*`;
const SIZED = new RegExp(
  String.raw`(?<![\w-])${VARIANTS}(?:` +
    // Tailwind's corner scale and arbitrary corners, on any side.
    String.raw`rounded(?:-[trblse]{1,2})?-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|\[[^\]]*\]|\([^)]*\))` +
    // A ring width other than the theme's.
    String.raw`|ring-[1-9]\d*` +
    // A weight with no token.
    '|font-(?:thin|extralight|light|medium|extrabold|black)' +
    String.raw`)(?![\w-])`,
);
/**
 * Bare `rounded` (4px) is also English, so it counts only in a class list:
 * right after a quote, or after a token shaped like a class (it has a hyphen
 * or a variant colon, and nothing a sentence has).
 */
const BARE = new RegExp(
  String.raw`(?:['"\x60]|\}\s+|(?<![\w,.])[a-z0-9]+(?:[-:][\w.\[\]/%-]+)+\s+)${VARIANTS}rounded(?:-[trblse]{1,2})?(?=[\s'"\x60])`,
);

function hardCoded(line: string): boolean {
  return SIZED.test(line) || BARE.test(line);
}

describe('classes leave the look to the theme (DS-001)', () => {
  it('hard-codes no corner, ring width or untokened weight', () => {
    const uses = sources(SRC).flatMap((file) => {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter(hardCoded)
        .map((line) => `${rel}: ${line.trim()}`);
    });
    expect(uses).toEqual([]);
  });

  it('sees them under variants, in conditionals and in arbitrary values, and not the tokens', () => {
    // Joined from halves, so Tailwind scanning this file builds none of them.
    const caught = [
      ['className="h-3.5 ', 'rounded bg-surface"'],
      ["'", "rounded px-2'"],
      ['hover:rounded-', 'lg'],
      ['rounded-tr-', 'md'],
      ['rounded-[0.', '875rem]'],
      ['has-checked:ring-', '2'],
      ['ring-', '1 ring-line'],
      ['font-', 'medium'],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text to scan, not a template
      ['`flex ${a} ', 'rounded`'],
    ].map((halves) => halves.join(''));
    expect(caught.filter((s) => !hardCoded(s))).toEqual([]);

    const fine = [
      'rounded-control ring ring-line ring-inset has-checked:ring-strong',
      'rounded-full rounded-pill rounded-tile rounded-tr-none ring-0 font-semibold',
      'ring-[1.5px] ring-heal ring-inset hover:ring-(--cg-cx-edge-hover)',
      ' * the 1 px line above it, rounded as a measured',
      'return `Half your proficiency bonus, rounded down`;',
    ];
    expect(fine.filter(hardCoded)).toEqual([]);
  });
});

/**
 * A card-shaped class list: card corners on the card ground with a hairline
 * edge, not an overlay (a menu, a popover), which floats rather than sits.
 */
function unhookedCards(text: string): string[] {
  return [...text.matchAll(/(["'\x60])((?:(?!\1)[^\n])*\brounded-card\b(?:(?!\1)[^\n])*)\1/g)]
    .map((m) => m[2] ?? '')
    .filter(
      (cls) =>
        /\bbg-surface\b/.test(cls) &&
        /\bring-line\b/.test(cls) &&
        !/\bshadow-overlay\b/.test(cls) &&
        !/\bcg-card\b/.test(cls),
    );
}

describe('every card carries the hook its frame draws on (styles/decor.css)', () => {
  it('finds no card without `cg-card`', () => {
    const missing = sources(SRC).flatMap((file) => {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      return unhookedCards(readFileSync(file, 'utf8')).map((cls) => `${rel}: ${cls}`);
    });
    expect(missing).toEqual([]);
  });

  it('sees a card in any quotes, and lets overlays and other grounds be', () => {
    const card = ['rounded-', 'card bg-surface p-4 ring ring-line ring-inset'].join('');
    expect(unhookedCards(`className="${card}"`)).toHaveLength(1);
    expect(unhookedCards(`const c = \`flex ${card}\`;`)).toHaveLength(1);
    expect(unhookedCards(`'cg-card ${card}'`)).toEqual([]);
    expect(unhookedCards(`"${card} shadow-overlay"`)).toEqual([]);
    expect(unhookedCards(`"rounded-card bg-bg ring ring-line"`)).toEqual([]);
  });
});

/**
 * Title-sized class lists that are not titles: a title size carries the
 * theme's title tracking (`tracking-display`), so text at a title size is in
 * the title font, or says its own tracking (a number sized as a title keeps
 * the spacing around it with `tracking-[inherit]`).
 */
function untrackedTitles(text: string): string[] {
  return [
    ...text.matchAll(
      /(["'\x60])((?:(?!\1)[^\n])*\btext-title-(?:page|sheet|card)\b(?:(?!\1)[^\n])*)\1/g,
    ),
  ]
    .map((m) => m[2] ?? '')
    .filter((cls) => !/\bfont-display\b/.test(cls) && !/(?:^|\s)tracking-/.test(cls));
}

describe('text at a title size is a title, or keeps its own tracking', () => {
  it('finds none that would take the title tracking unasked', () => {
    const loose = sources(SRC).flatMap((file) => {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      return untrackedTitles(readFileSync(file, 'utf8')).map((cls) => `${rel}: ${cls}`);
    });
    expect(loose).toEqual([]);
  });

  it('sees one in any quotes, and lets titles and set tracking be', () => {
    const size = ['text-title-', 'sheet'].join('');
    expect(untrackedTitles(`className="shrink-0 ${size} tabular-nums"`)).toHaveLength(1);
    expect(untrackedTitles(`\`flex ${size}\``)).toHaveLength(1);
    expect(untrackedTitles(`"font-display ${size}"`)).toEqual([]);
    expect(untrackedTitles(`'${size} tracking-[inherit]'`)).toEqual([]);
  });
});
