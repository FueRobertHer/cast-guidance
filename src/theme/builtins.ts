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
   * Its resting and selected edge widths in px, so a theme file that sets one
   * can be held to the other (file.ts). vocabulary.test.ts checks them
   * against themes.css.
   */
  readonly edges: readonly [resting: number, selected: number];
  /**
   * Its decor (vocabulary.ts `CHOICES`): the look of its page and cards. Its
   * rule in themes.css sets the same through decor.css's variables, so a
   * subtree drawn in it needs no attribute; vocabulary.test.ts holds the two
   * to the same.
   */
  readonly decor: Readonly<Record<'texture' | 'frame', string>>;
}

const PLAIN = { texture: 'none', frame: 'plain' } as const;

/** Settings' order, after System: the device's pair first, then the reskins. */
export const BUILT_IN_THEMES: readonly BuiltInTheme[] = [
  {
    id: 'light',
    label: 'Light',
    scheme: 'light',
    pageColour: '#eee6d5',
    edges: [1, 2],
    decor: PLAIN,
  },
  { id: 'dark', label: 'Dark', scheme: 'dark', pageColour: '#121110', edges: [1, 2], decor: PLAIN },
  {
    id: 'parchment',
    label: 'Parchment',
    scheme: 'light',
    pageColour: '#e9dfc6',
    edges: [1, 2],
    decor: { texture: 'paper', frame: 'double' },
  },
  {
    id: 'modern',
    label: 'Modern',
    scheme: 'light',
    pageColour: '#f2f4f7',
    edges: [1, 2],
    decor: PLAIN,
  },
  {
    id: 'contrast',
    label: 'High contrast',
    scheme: 'dark',
    pageColour: '#000000',
    edges: [2, 3],
    decor: PLAIN,
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
