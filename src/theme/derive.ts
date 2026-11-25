import { contrast, isLight, mix } from './colour';
import type { TokenValue } from './file';
import { CONDITION_HUES } from './vocabulary';

/**
 * The tokens that follow others in the theme editor (docs/theming-plan.md,
 * phase 4): change `brand` and its hover, the label on it and its tint move
 * with it, until the person sets one of them by hand. Without this a theme
 * made from four colours would keep its base's borders, muted text and tints,
 * tuned for a page it no longer has.
 *
 * The ratios are read off the built-in palettes, which they reproduce to
 * within about 20 levels a channel: Dark's and Light's raised surface sits
 * about 6% of the way from `surface` to `ink`, their muted text about 31% of
 * the way from `ink` to `bg`. A straight mix cannot copy the warmth Light's
 * darker papers gain, so derived values are a starting point, set by hand
 * where the eye wants more. A token is worked out only once something it follows has moved: a
 * base's own tuned values stand until then.
 */

export type Tokens = Readonly<Record<string, TokenValue>>;

export interface DeriveInput {
  /** The tokens set by hand. */
  own: Tokens;
  /** The base built-in's tokens, as a file writes them (builtInFile). */
  base: Tokens;
  /** Light's and Dark's tokens: the condition hues and glint for a page of either lightness. */
  light: Tokens;
  dark: Tokens;
}

/**
 * The tokens tuned for a page's lightness: the roles, the scrim, the shadows.
 * When the page turns from light to dark or back, they take the built-in
 * pair's (Dark's or Light's), or a dark red would be left on a dark card.
 */
const BY_LIGHTNESS = [
  'brand',
  'guide',
  'danger',
  'heal',
  'ward',
  'arcane',
  'scrim',
  'shadow-card',
  'shadow-float',
  'shadow-overlay',
] as const;

/** What each following token follows, first the one a person would name. */
export const FOLLOWS: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(BY_LIGHTNESS.map((t) => [t, ['bg']])),
  'cx-edge-hover': ['bg', 'line-strong'],
  'surface-raised': ['surface', 'ink'],
  'surface-hover': ['surface', 'ink'],
  line: ['bg', 'ink'],
  track: ['surface', 'ink'],
  'line-strong': ['bg', 'ink'],
  edge: ['bg', 'line'],
  'ink-muted': ['ink', 'bg'],
  'ink-faint': ['ink', 'bg'],
  'brand-hover': ['brand', 'ink'],
  'on-brand': ['brand', 'surface', 'ink'],
  'roll-soft': ['brand', 'surface'],
  'guide-soft': ['guide', 'surface'],
  'danger-fill': ['danger'],
  'on-danger': ['danger-fill'],
  'danger-soft': ['danger', 'surface'],
  'heal-soft': ['heal', 'surface'],
  'ward-soft': ['ward', 'surface'],
  'arcane-soft': ['arcane', 'surface'],
  'hp-trail': ['danger'],
  'hp-bloom': ['heal'],
  'hp-sheen': ['bg'],
  ...Object.fromEntries(
    CONDITION_HUES.flatMap((c) => [
      [`cx-${c}`, ['bg']],
      [`cx-${c}-soft`, [`cx-${c}`, 'bg']],
    ]),
  ),
};

/** The aliases the built-ins write as `var()`: they follow at runtime, never written. */
export const ALIASES: Readonly<Record<string, string>> = {
  focus: 'guide',
  roll: 'brand',
  'meter-mid': 'guide',
};

/** A role's tint: this much of it over `surface`. */
const TINT = 0.14;

/** `danger` darkened, a twentieth at a time, until white reads on it at 4.5:1. */
function fillFor(danger: string): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const c = mix(danger, '#000000', t);
    if (c !== null && contrast(c, '#ffffff') >= 4.5) return c;
  }
  return '#000000';
}

/**
 * The values of the tokens that follow, worked out from those set by hand,
 * for every following token at least one of whose sources has moved. Tokens
 * set by hand are never in it.
 */
export function derive({ own, base, light, dark }: DeriveInput): Record<string, TokenValue> {
  const out: Record<string, TokenValue> = {};
  const moved = new Set(Object.keys(own));
  const value = (name: string): string => String(own[name] ?? out[name] ?? base[name] ?? '');
  const lightPage = isLight(value('bg'));
  /** The page turned from light to dark or back: what is tuned for its lightness moves. */
  const flipped = isLight(String(base.bg ?? '')) !== lightPage;

  /** Works `name` out when something it follows moved (or the page flipped, for `onFlip`). */
  const set = (name: string, compute: () => TokenValue | null, onFlip = false) => {
    if (name in own) return;
    const sources = FOLLOWS[name] ?? [];
    const go = onFlip ? flipped : sources.some((s) => moved.has(s));
    if (!go) return;
    const v = compute();
    if (v === null) return;
    out[name] = v;
    moved.add(name);
  };
  const towards = (from: string, to: string, t: number) => () => mix(value(from), value(to), t);
  const tint = (role: string) => () => mix(value('surface'), value(role), TINT);
  const pair = lightPage ? light : dark;

  // What a page of the other lightness needs: the roles first, as their
  // labels and tints follow them.
  for (const t of BY_LIGHTNESS) set(t, () => pair[t] ?? null, true);

  // Grounds and text, from the page, the cards and the ink.
  set('surface-raised', towards('surface', 'ink', 0.06));
  set('surface-hover', towards('surface', 'ink', 0.11));
  set('line', towards('bg', 'ink', 0.11));
  set('track', towards('surface', 'ink', 0.11));
  set('line-strong', towards('bg', 'ink', 0.47));
  if (flipped || moved.has('line')) set('edge', () => (lightPage ? value('line') : 'transparent'));
  set('ink-muted', towards('ink', 'bg', 0.31));
  set('ink-faint', towards('ink', 'bg', 0.52));
  // A roll chip's edge on hover: the outline on a light page, none on a dark one.
  if (flipped || moved.has('line-strong')) {
    set('cx-edge-hover', () => (lightPage ? value('line-strong') : 'transparent'));
  }

  // Action, and the labels on the filled grounds.
  set('brand-hover', towards('brand', 'ink', 0.2));
  set('on-brand', () =>
    contrast(value('surface'), value('brand')) >= contrast(value('ink'), value('brand'))
      ? value('surface')
      : value('ink'),
  );
  set('danger-fill', () => fillFor(value('danger')));
  // White once it reads at 4.5:1, as every built-in has it; black only where it cannot.
  set('on-danger', () =>
    contrast(value('danger-fill'), '#ffffff') >= 4.5 ? '#ffffff' : '#000000',
  );

  // Each role's tint.
  set('roll-soft', tint('brand'));
  for (const role of ['guide', 'danger', 'heal', 'ward', 'arcane']) set(`${role}-soft`, tint(role));

  // The HP card's cues.
  set('hp-trail', () => mix(value('danger'), '#ffffff', 0.5));
  set('hp-bloom', () => mix(value('heal'), '#ffffff', 0.5));
  set('hp-sheen', () => pair['hp-sheen'] ?? null, true);

  // The condition hues: the built-in pair for the page's lightness, and a
  // hue set by hand gets its own tint.
  for (const c of CONDITION_HUES) {
    const hue = `cx-${c}`;
    const soft = `cx-${c}-soft`;
    set(hue, () => pair[hue] ?? null, true);
    if (hue in own) {
      if (!(soft in own) && pair[soft] !== 'transparent') {
        const v = mix(value('surface'), value(hue), TINT);
        if (v !== null) out[soft] = v;
      }
    } else {
      set(soft, () => pair[soft] ?? null, true);
    }
  }
  return out;
}

/**
 * Which of a theme's tokens were set by hand, for a theme saved with no such
 * list (an imported file): those whose value is not what following would give.
 */
export function inferOwn(tokens: Tokens, input: Omit<DeriveInput, 'own'>): string[] {
  const own = new Set(Object.keys(tokens));
  for (const name of Object.keys(FOLLOWS)) {
    if (!own.has(name)) continue;
    const without = Object.fromEntries(
      Object.entries(tokens).filter(([k]) => k !== name && own.has(k)),
    );
    if (derive({ ...input, own: without })[name] === tokens[name]) own.delete(name);
  }
  return [...own];
}
