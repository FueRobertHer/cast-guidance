/**
 * The fonts a theme may name (docs/theme-format.md): an id in a theme file,
 * a `font-family` stack in CSS. All are self-hosted; the CSP allows no other
 * font origin, so a theme picks from these or from the device's own faces.
 * The built-ins' faces come with the app (src/main.tsx) and are precached.
 * A library font's are not: they download the first time a theme uses one
 * (libraryFonts.ts) and the service worker keeps them from then on.
 *
 * Every built-in theme's stacks are in this list (fonts.test.ts), so any
 * theme exports as ids.
 */

export interface ThemeFont {
  readonly id: string;
  /** Its name in an editor's list. */
  readonly label: string;
  readonly stack: string;
  /**
   * The weights it has a face for (src/main.tsx): what the editor offers. The
   * device's own fonts may have more or fewer; those offer the usual range.
   */
  readonly weights: readonly number[];
  /** Where its faces come from: with the app, on first use, or the device. */
  readonly source: 'app' | 'library' | 'device';
  /** For titles only: a capitals or display face no one should read a page in. */
  readonly titlesOnly?: boolean;
}

export const THEME_FONTS: readonly ThemeFont[] = [
  {
    id: 'atkinson',
    source: 'app',
    label: 'Atkinson Hyperlegible Next',
    stack: '"Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", sans-serif',
    weights: [400, 600, 700],
  },
  {
    id: 'literata',
    source: 'app',
    label: 'Literata',
    stack: '"Literata", Georgia, "Times New Roman", serif',
    weights: [400, 600, 700],
  },
  {
    id: 'alegreya',
    source: 'app',
    label: 'Alegreya',
    stack: '"Alegreya", "Literata", Georgia, serif',
    weights: [600, 700],
  },
  {
    id: 'inter',
    source: 'app',
    label: 'Inter',
    stack: '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    weights: [300, 400, 500, 600, 700, 800],
  },
  {
    id: 'eb-garamond',
    source: 'library',
    label: 'EB Garamond',
    stack: '"EB Garamond", Georgia, "Times New Roman", serif',
    weights: [400, 600, 700],
  },
  {
    id: 'fraunces',
    source: 'library',
    label: 'Fraunces',
    stack: '"Fraunces", Georgia, "Times New Roman", serif',
    weights: [400, 600, 700],
  },
  {
    id: 'lexend',
    source: 'library',
    label: 'Lexend',
    stack: '"Lexend", system-ui, -apple-system, "Segoe UI", sans-serif',
    weights: [400, 600, 700],
  },
  {
    id: 'opendyslexic',
    source: 'library',
    label: 'OpenDyslexic',
    stack: '"OpenDyslexic", system-ui, -apple-system, "Segoe UI", sans-serif',
    weights: [400, 700],
  },
  {
    id: 'jetbrains-mono',
    source: 'library',
    label: 'JetBrains Mono',
    stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
    weights: [400, 600, 700],
  },
  {
    id: 'cinzel',
    source: 'library',
    label: 'Cinzel',
    stack: '"Cinzel", Georgia, "Times New Roman", serif',
    weights: [400, 600, 700],
    titlesOnly: true,
  },
  {
    // One weight, drawn at every weight a theme asks for (libraryFaces.ts)
    // rather than thickened by the browser.
    id: 'im-fell-english',
    source: 'library',
    label: 'IM Fell English',
    stack: '"IM Fell English", Georgia, "Times New Roman", serif',
    weights: [400],
    titlesOnly: true,
  },
  {
    id: 'system',
    source: 'device',
    label: "This device's sans serif",
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    weights: [300, 400, 500, 600, 700, 800],
  },
  {
    id: 'serif',
    source: 'device',
    label: "This device's serif",
    stack: 'Georgia, "Times New Roman", serif',
    weights: [400, 700],
  },
];

export function themeFont(id: string): ThemeFont | undefined {
  return THEME_FONTS.find((f) => f.id === id);
}

export function fontStack(id: string): string | undefined {
  return themeFont(id)?.stack;
}

/** The family a font's own faces are named by: the first in its stack. */
export function fontFamily(font: ThemeFont): string {
  return /^"([^"]+)"/.exec(font.stack)?.[1] ?? font.stack.split(',')[0]?.trim() ?? font.id;
}

/**
 * The service worker's cache for fonts outside the precache (vite.config.ts),
 * which a page not yet under its control fills itself (libraryFonts.ts).
 */
export const FONT_CACHE = 'theme-fonts';

/**
 * Where the build writes a library font's faces, for the precache to leave
 * out (vite.config.ts): Vite names an asset by its file, and each file is
 * named for its font (libraryFaces.ts, held to it by fonts.test.ts).
 */
export const LIBRARY_FONT_GLOBS: readonly string[] = THEME_FONTS.filter(
  (f) => f.source === 'library',
).map((f) => `assets/${f.id}-latin-*`);

/** The id of a stack as a theme writes it, quotes and spacing aside. */
export function fontId(stack: string): string | undefined {
  const norm = (s: string) =>
    s
      .replace(/['"]/g, '')
      .replace(/\s*,\s*/g, ',')
      .trim()
      .toLowerCase();
  const want = norm(stack);
  return THEME_FONTS.find((f) => norm(f.stack) === want)?.id;
}
