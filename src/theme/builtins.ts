/**
 * The built-in themes (DS-001, docs/theming-plan.md): what Settings offers,
 * in its order. Each one's values are a rule in src/styles/themes.css; this
 * is what the app needs to know about it without reading CSS.
 *
 * `public/theme-boot.js` repeats each id's page colour, since it runs before
 * any module; theme.test.ts holds the two to the same answers, and
 * vocabulary.test.ts holds this list to the themes in themes.css.
 */

export type BuiltInThemeId = 'dark' | 'light' | 'parchment' | 'modern' | 'contrast';

export interface BuiltInTheme {
  readonly id: BuiltInThemeId;
  /** Its name in Settings. */
  readonly label: string;
  /** Light or dark ground: native controls, scrollbars, and what System picks between. */
  readonly scheme: 'light' | 'dark';
  /**
   * Its `bg`, for `<meta name="theme-color">`, which colours the browser's
   * own bars and the installed app's title bar. A meta tag cannot read a CSS
   * variable, so the value is repeated here.
   */
  readonly pageColour: string;
  /**
   * The faces it draws in that the default themes do not, as `font` shorthand
   * for `document.fonts.load`. Picking the theme loads every one, so all of
   * them are cached for offline play, not only those drawn so far.
   */
  readonly faces: readonly string[];
}

/** Settings' order, after System: the device's pair first, then the reskins. */
export const BUILT_IN_THEMES: readonly BuiltInTheme[] = [
  { id: 'light', label: 'Light', scheme: 'light', pageColour: '#eee6d5', faces: [] },
  { id: 'dark', label: 'Dark', scheme: 'dark', pageColour: '#121110', faces: [] },
  {
    id: 'parchment',
    label: 'Parchment',
    scheme: 'light',
    pageColour: '#e9dfc6',
    faces: ['400 1em "Literata"', '700 1em "Literata"', '600 1em "Alegreya"', '700 1em "Alegreya"'],
  },
  {
    id: 'modern',
    label: 'Modern',
    scheme: 'light',
    pageColour: '#f2f4f7',
    faces: ['400 1em "Inter Variable"', '700 1em "Inter Variable"'],
  },
  {
    id: 'contrast',
    label: 'High contrast',
    scheme: 'dark',
    pageColour: '#000000',
    faces: [],
  },
];

export function isBuiltInTheme(value: unknown): value is BuiltInThemeId {
  return BUILT_IN_THEMES.some((t) => t.id === value);
}

export function builtInTheme(id: BuiltInThemeId): BuiltInTheme {
  const theme = BUILT_IN_THEMES.find((t) => t.id === id);
  if (theme === undefined) throw new Error(`no built-in theme ${id}`);
  return theme;
}
