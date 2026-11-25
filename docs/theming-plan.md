# Themes: build plan

Status: phases 1 and 2 built (2026-11-24); phase 3 waits on the owner's look
at the three reskins. Owner decisions, 2026-11-24: full reskins in the VS Code
sense (layout fixed, look free), theme files with a closed vocabulary rather
than CSS themes, no contrast rules on themes people make for themselves, no
in-app gallery and no server storage, and three showcase reskins: Parchment,
Modern and High contrast.

## Goal

A theme changes how the app looks (colours, fonts, weights, borders, corners,
shadows, icon strokes, and later a few decor choices) and never how it is laid
out (spacing, tap targets, text sizes, the layout itself). Built-in themes ship
with the app and are held to the design system's contrast rules and the axe
gate. Themes people make are theirs: validated for safety and layout, never
for looks.

## What the code already gives us

- Colours are tokens: `--cg-*` custom properties per theme (in `app.css` before
  phase 1, `themes.css` since), read
  by Tailwind utilities through `@theme inline`, so a subtree with its own
  `data-theme` draws in that theme. No component hard-codes a colour.
- Tailwind 4 reads defaults from the theme, so these can become theme tokens
  with no call-site edits (checked by compiling probes):
  - `--default-border-width` drives bare `border`, `border-t`, `divide-y`.
  - `--default-ring-width` drives bare `ring`.
  - `--ring-width-<name>` gives `ring-<name>`.
  - `--font-weight-*` drives `font-semibold` and friends; the type scale's
    `--text-*--font-weight` sub-keys can sit in `@theme inline`.
  - `--font-sans`, `--font-display`, `--radius-*` likewise.
- Values in `@theme inline` resolve where they are used, so every themeable
  value must sit there, or the theme picker's miniatures would show the page's
  theme instead of their own.

## Architecture

- **Vocabulary** (`src/theme/vocabulary.ts`): the closed list of themeable
  tokens, each with a kind (colour, font, weight, length, shadow, number) and
  bounds. One source for validation, the editor, and the completeness test.
- **Built-in themes are CSS** (`src/styles/themes.css`, imported by `app.css`):
  one rule per theme, `[data-theme="<id>"]`, plus shared rules whose selector
  lists name every theme of one scheme (condition hues for dark grounds, for
  light grounds). CSS stays the source of truth, so first paint needs no
  JavaScript beyond setting `data-theme`.
- **Registry** (`src/theme/builtins.ts`): each built-in's id, label, scheme
  (light or dark, for `color-scheme`) and page colour (for
  `<meta name="theme-color">`). `public/theme-boot.js` repeats the id to page
  colour map; `theme.test.ts` keeps the two in step, as it does today.
- **Theme files** (phase 3): JSON, `{ schema, name, author, base, colors,
  fonts, weights, shape, shadows, icons }`. `base` is a built-in id that fills
  every token the file leaves out, so files stay small and survive new tokens.
  Applied by setting `data-theme` to the base and each override with
  `documentElement.style.setProperty`, which `style-src` does not gate.
- **Storage**: device preferences in localStorage, as the theme is today. The
  choice key holds `system`, a built-in id, or `custom:<id>`; the active custom
  theme's resolved overrides are cached so the boot script can apply them
  before first paint without parsing theme files.
- **Fonts**: each theme's stacks are in its rule; the faces are imported once
  in `src/main.tsx`. Every built-in theme's Latin faces are precached (about
  137 KB beyond the default themes'), so a theme, and every preview in
  Settings, works offline from install. A cache-first route keeps anything
  else (Inter's non-Latin subsets) on first fetch. A larger library (phase 5)
  may need the opposite: precache none, fetch a theme's faces when it is
  picked.

## Phases

Each phase lands as its own commit on the working branch, with `bun run ci`
green.

### Phase 1: make everything themeable (no visible change; built)

1. Move the two theme blocks into `src/styles/themes.css` and add tokens with
   today's values: `font-sans`, `font-display`, `weight-normal`,
   `weight-semibold`, `weight-bold`, `radius-chip`, `radius-control`,
   `radius-card`, `radius-sheet`, `border`, `border-strong`, `icon-stroke`,
   the condition hues (`cx-<condition>` and `cx-<condition>-soft`), and
   `cx-edge-hover`.
2. Map them in `@theme inline`: fonts, weights (and the type scale's weight
   sub-keys), radii, `--default-border-width`, `--default-ring-width`,
   `--ring-width-strong`.
3. `chipFace.css`: each condition reads its hue from tokens, and the
   `[data-theme="light"] .cx-*` overrides go.
4. Call sites: `ring-1` to `ring` (85), `ring-2` to `ring-strong` (9; none
   is a focus indicator, which uses `outline`).
5. Corners: the four tiers plus `radius-pill`. `rounded-full` splits into
   true circles (dots, round icon buttons, pips: stays `rounded-full`) and
   pill shapes (chips, badges, pill buttons, meter tracks: `rounded-pill`).
   The odd sizes are derived from a tier, so today's pixels hold and a theme
   moves them with it: `rounded-thumb` (control minus 2px, a segment's thumb
   and the picker's frames), `rounded-tile` (control plus 4px: a 44px icon
   tile, or a control inside a 4px transparent
   tap border), `rounded-control-lg` (control plus 2px), `rounded-tick`
   (chip minus 2px), `rounded-pill-tap` (a pill plus its own tap border,
   `--tap-inset`).
6. Icons: Lucide icons drawn at the default stroke (`[stroke-width="2"]`)
   read `--cg-icon-stroke` through one CSS rule, so icons given an explicit
   stroke keep it. `D20Icon` draws three weights in JavaScript, so it gets
   its own rule for each.
7. Borders: bare `border`, `divide-y` and `ring` read `--cg-border`. The
   explicit `border-2/4/8` stay fixed: the 4px and 8px ones are transparent
   tap insets (layout), the 2px ones are marks. A bordered box grows with its
   edge, so High contrast's 2px edges add a pixel to such boxes and rows; the
   layout checks pass with them. Rings are shadows and move nothing.
8. Tests: every built-in defines every vocabulary token; `contrast.test.ts`
   gets a small CSS reader that merges every rule naming a theme (so shared
   selector lists work); a scan fails on hard-coded visual utilities
   (`ring-<n>`, Tailwind's own radii).
9. Proof of no change: screenshots of key screens in both themes before and
   after, compared pixel for pixel, including a sheet with a condition on.

### Phase 2: three showcase reskins (built)

| | Parchment | Modern | High contrast |
|---|---|---|---|
| Scheme | light, warm paper | light, cool greys | dark, near black |
| Body font | Literata | Inter | Atkinson Hyperlegible Next |
| Display font | Alegreya | Inter | Atkinson Hyperlegible Next |
| Corners (chip, control, card, sheet) | 2, 4, 6, 10 px | 8, 12, 20, 28 px | 4, 6, 8, 12 px |
| Borders (edge, selected) | 1, 2 px | 1, 2 px | 2, 3 px |
| Shadows | soft, warm | almost flat | none |
| Icon stroke | 1.75 | 1.5 | 2.5 |

1. Registry and `theme.ts` generalised from `'light' | 'dark'` to the
   registry; boot script and its test follow. System keeps meaning the
   device's Dark or Light. An unknown stored value (a newer or older build's)
   falls back to the default, never to a blank page.
2. The three theme rules in `themes.css`, each clearing every contrast pair.
3. Fonts: Inter (the variable package, so weights are not limited to three)
   and Alegreya from `@fontsource` (OFL-1.1, already on the notices
   allowlist), and Literata's 400 and 700 alongside its 600. Literata's latin
   files carry `tnum`, so Parchment's stats stay tabular; no separate numbers
   font. The plan first named Cormorant Garamond; at card-title size its small
   x-height (0.39) made titles barely larger than the subtitles under them, so
   Alegreya (0.45) replaced it. The plan also first kept theme fonts out of
   the precache, cached on first use; Settings' previews draw every theme's
   title font, so opening Settings offline asked the network for them, and
   all of them are precached instead. Notices regenerated.
4. Settings: the picker lists System, Dark, Light, Parchment, Modern and High
   contrast, each miniature with an "Aa" in its fonts.
5. Gates: the axe scan and the layout checks run every built-in; the theme
   e2e spec picks a new theme and reloads into it.
6. **Checkpoint:** screenshots of each theme go to the owner before phase 3.
   If the three do not feel different enough, the vocabulary grows first.

### Phase 3: theme files

Schema and validator (`src/theme/file.ts`): colours as hex, lengths bounded,
fonts from the bundled list, shadows as structured layers, the selected
border wider than the resting one (or selection vanishes), unknown keys
dropped, a migration per schema version. Export the current theme as `.json`;
import a file; a share link that carries the whole theme compressed in the URL.
Opening a link or file shows a preview and asks before applying, then offers a
timed "Keep this theme?" revert. `?theme=reset` in any URL returns to the
default, handled by the boot script. "Your themes" in Settings.
`docs/theme-format.md` documents the file.

### Phase 4: theme editor

Settings, Themes, Create: start from any theme, edit by group (colours, fonts,
weights, shape, shadows, icons) with the app itself as the live preview; save
to Your themes. No contrast rules.

### Phase 5: decor and more fonts

Two or three enumerated decor choices (a paper texture behind the page, card
frame styles), then more bundled fonts. Card frames need one shared hook on
every card, which today are ad hoc; that refactor comes with this phase.
Themeable letter-spacing for titles also waits for here, unless a phase 2
font needs it sooner.

### Phase 6: uploaded fonts (only on demand)

`FontFace` from bytes stored in IndexedDB. Test in Safari. Cannot travel in a
share link.

## Out of scope

Spacing, tap targets, text sizes, layout, focus ring width and colour role
(accessibility), motion, per-character themes, an in-app gallery.
