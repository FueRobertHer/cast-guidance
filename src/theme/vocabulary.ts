/**
 * The theme vocabulary: every value a theme sets, and nothing else (DS-001,
 * docs/theming-plan.md). Each built-in theme in src/styles/themes.css
 * defines all of these and no others (vocabulary.test.ts), and a theme file
 * may set only these. Layout is not in it: spacing, tap targets, text sizes
 * and the focus ring stay the app's.
 *
 * Names are the custom property without its `--cg-` prefix.
 */

export type TokenKind =
  /** A colour: `#rrggbb`, `#rrggbbaa`, `transparent`, or another token. */
  | 'colour'
  /** A `box-shadow` list. */
  | 'shadow'
  /** A `font-family` stack. */
  | 'font'
  /** A numeric `font-weight`. */
  | 'weight'
  /** A corner radius, in rem or px. */
  | 'radius'
  /** An edge width, in px. */
  | 'border'
  /** An SVG stroke width on Lucide's 24px grid. */
  | 'stroke';

/** Where a token sits in an editor, and what a person would call the group. */
export type TokenGroup =
  | 'grounds'
  | 'text'
  | 'roles'
  | 'conditions'
  | 'shadows'
  | 'type'
  | 'shape'
  | 'icons';

export interface Token {
  readonly name: string;
  readonly kind: TokenKind;
  readonly group: TokenGroup;
}

const group =
  (g: TokenGroup, kind: TokenKind) =>
  (...names: string[]): Token[] =>
    names.map((name) => ({ name, kind, group: g }));

/** The conditions that draw in their own hue (ui/chipFace.css). */
export const CONDITION_HUES = [
  'poisoned',
  'paralyzed',
  'frightened',
  'blinded',
  'prone',
  'restrained',
  'grappled',
  'exhaustion',
  'invisible',
  'stunned',
  'unconscious',
  'incapacitated',
  'petrified',
] as const;

export const VOCABULARY: readonly Token[] = [
  ...group('grounds', 'colour')(
    'bg',
    'surface',
    'surface-raised',
    'surface-hover',
    'line',
    'line-strong',
    'track',
    'edge',
    'scrim',
  ),
  ...group('text', 'colour')('ink', 'ink-muted', 'ink-faint'),
  ...group('roles', 'colour')(
    'brand',
    'brand-hover',
    'on-brand',
    'guide',
    'guide-soft',
    'focus',
    'danger',
    'danger-fill',
    'on-danger',
    'danger-soft',
    'heal',
    'heal-soft',
    'ward',
    'ward-soft',
    'roll',
    'roll-soft',
    'arcane',
    'arcane-soft',
    'meter-mid',
    'hp-trail',
    'hp-bloom',
    'hp-sheen',
  ),
  ...group('conditions', 'colour')(
    ...CONDITION_HUES.flatMap((c) => [`cx-${c}`, `cx-${c}-soft`]),
    'cx-edge-hover',
  ),
  ...group('shadows', 'shadow')('shadow-card', 'shadow-float', 'shadow-overlay'),
  ...group('type', 'font')('font-sans', 'font-display'),
  ...group('type', 'weight')('weight-normal', 'weight-semibold', 'weight-bold'),
  ...group('shape', 'radius')(
    'radius-chip',
    'radius-control',
    'radius-card',
    'radius-sheet',
    'radius-pill',
  ),
  ...group('shape', 'border')('border', 'border-strong'),
  ...group('icons', 'stroke')('icon-stroke'),
];

export const TOKEN_NAMES: ReadonlySet<string> = new Set(VOCABULARY.map((t) => t.name));
