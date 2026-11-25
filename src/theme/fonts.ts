/**
 * The fonts a theme may name (docs/theme-format.md): an id in a theme file,
 * a `font-family` stack in CSS. The bundled faces are self-hosted and
 * precached (src/main.tsx, vite.config.ts); the CSP allows no other font
 * origin, so a theme picks from these or from the device's own system faces.
 *
 * Every built-in theme's stacks are in this list (fonts.test.ts), so any
 * theme exports as ids.
 */

export interface ThemeFont {
  readonly id: string;
  /** Its name in an editor's list. */
  readonly label: string;
  readonly stack: string;
}

export const THEME_FONTS: readonly ThemeFont[] = [
  {
    id: 'atkinson',
    label: 'Atkinson Hyperlegible Next',
    stack: '"Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  { id: 'literata', label: 'Literata', stack: '"Literata", Georgia, "Times New Roman", serif' },
  { id: 'alegreya', label: 'Alegreya', stack: '"Alegreya", "Literata", Georgia, serif' },
  {
    id: 'inter',
    label: 'Inter',
    stack: '"Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    id: 'system',
    label: "This device's sans serif",
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  { id: 'serif', label: "This device's serif", stack: 'Georgia, "Times New Roman", serif' },
];

export function fontStack(id: string): string | undefined {
  return THEME_FONTS.find((f) => f.id === id)?.stack;
}

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
