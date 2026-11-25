# Themes: build plan

Status: phases 1 to 4 built (2026-11-25); the owner approved the three reskins
before phase 3. Phase 5 (decor and more fonts) is next. Owner decisions, 2026-11-24: full reskins in the VS Code
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
- **Theme files** (phase 3): JSON, `{ castGuidanceTheme, name, author, base,
  tokens }`, with `tokens` flat and keyed by the vocabulary's names. `base` is
  a built-in id that fills every token the file leaves out, so files stay
  small and survive new tokens (and follow their base when it is retuned).
  Applied by setting `data-theme` to the base and each override with
  `documentElement.style.setProperty`, which `style-src` does not gate.
- **Storage**: device preferences in localStorage, as the theme is today
  (details under phase 3).
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

### Phase 3: theme files (built)

**The file** (`src/theme/file.ts`, documented in `docs/theme-format.md`):

```json
{
  "castGuidanceTheme": 1,
  "name": "Midnight",
  "author": "optional",
  "base": "dark",
  "tokens": { "bg": "#101418", "font-display": "alegreya", "radius-card": "6px" }
}
```

- `castGuidanceTheme` is the schema version and says what the file is. It
  moves only for a breaking change (unknown tokens are dropped, so a new
  token needs none). A higher version than the app knows is refused ("made
  by a newer version"); each older version gets a migration step.
- `base` is a built-in id. It fills every token the file leaves out, so a
  file can be three lines or all 74, and a token added later takes the
  base's value.
- `tokens` is flat, keyed by the vocabulary's names (as VS Code's `colors`).
  Each value is checked by its kind: colours `#rgb`, `#rrggbb`, `#rrggbbaa`
  or `transparent` (stored lowercase `#rrggbb[aa]`), except `bg`, which must
  be opaque (the page shows through otherwise, and the browser's bars take
  no alpha); fonts an id from the
  bundled list (`atkinson`, `literata`, `alegreya`, `inter`, `system`,
  `serif`), turned into a stack by `src/theme/fonts.ts`; weights 300 to 800
  in hundreds (the browser picks the nearest face a font has); radii 0 to 48px (px or rem) or `full`; edges 0 to 3px and the
  selected edge 1 to 4px and wider than the resting one; the icon stroke 1
  to 3; shadows `none` or up to three layers of
  `[inset] x y [blur [spread]] colour`, in px, offsets within 32px, blur
  within 64px, spread within 16px. A value that fails is dropped and named
  in the preview; unknown keys likewise. Name and author: plain text, 60
  characters at most, control and bidirectional characters removed. A file
  over 64 KB is refused.

**Applying one**: `data-theme` is the base, and each override is set on
<html> with `style.setProperty('--cg-<name>', value)` (not gated by
`style-src`). Switching away removes every inline `--cg-*`. `color-scheme`
follows the theme's own `bg` (light or dark by luminance), not its base's,
so a light theme on a dark base still gets light native controls. The page
colour for the browser's bars is the theme's `bg`.

**Storage** (localStorage, as the theme choice is today):
- `cast-guidance:theme` holds `system`, a built-in id, or `custom:<id>`.
- `cast-guidance:themes` holds the saved themes: `[{ id, file }]`, each file
  already validated. Ids are random and never change (the editor will edit
  in place); importing a theme already saved picks the saved one instead.
- `cast-guidance:theme-applied` caches the active custom theme as the boot
  script needs it: `{ v, id, base, scheme, pageColour, vars, attrs }`, the
  resolved `--cg-*` values (`attrs` waits for phase 5's decor). The boot
  script applies it only when its `id` matches the stored choice, so the two
  keys can never draw a stale theme, and checks it loosely again (names
  `--cg-[a-z0-9-]+`, values from a small character set, at most 100). The
  app rebuilds it from the saved file at every start, so a migration or a
  retuned base reaches it. Missing, stale or unreadable: the base, else Dark.
- A write storage refuses keeps the theme for this tab, as a built-in
  choice does today, and says it could not be saved.

**Getting one in and out** (Settings, Appearance, under the picker):
- Saved themes are cards in the picker after the built-ins, each drawn in
  its own values (inline variables on its preview).
- **Import a theme**: a `.json` file. **Paste a theme link**: for a link
  opened in Safari on iOS, whose storage is not the installed app's.
  **Export this theme**: the current theme as a file. A built-in exports
  every token from its own rules in themes.css (read through a `?raw`
  import, loaded only then), fonts as ids, leaving out the aliases
  (`roll`, `focus`, `meter-mid`) so they keep following the role they name; a
  complete file to start from by hand. A saved theme exports its own file.
- **Share this theme** (saved themes): a link,
  `<origin>/settings#theme=1.<payload>`, the file as JSON, deflated
  (`CompressionStream('deflate-raw')`) and base64url, after an encoding
  version. In the hash, so it never reaches a server, and the app removes it
  from the address once read. Copied to the clipboard, or the share sheet where
  there is one. Decoding stops past 64 KB inflated.
- **Delete this theme** (saved themes, with Undo): the choice falls back to
  the theme's base.
- Opening a link or a file shows a preview sheet: the name and author, a
  preview drawn in the theme, anything dropped, and Use this theme or Cancel.
  Use saves it to Your themes and draws the page in it, in this tab only,
  and a bar asks "Keep this theme?". It reverts by itself after 30 seconds
  unless Keep is pressed, and only Keep stores the choice, so a reload
  meanwhile also reverts. The bar is drawn in the previous built-in theme
  (a subtree with its `data-theme`), so a theme too unreadable to read the
  bar in still lets it be read.
- Settings' Appearance section is always drawn in a built-in theme (the
  custom theme's base), so whatever a theme does, the way back to a
  built-in stays readable.
- `?theme=reset` on any address: the boot script stores Dark and drops the
  cached custom theme before first paint, then takes the parameter off the
  address (`history.replaceState`), so a reload does not reset again. The
  installed app has no address bar, so its icon gets a Reset theme shortcut
  (manifest `shortcuts`) to the same address.

**Tests**: the validator (every kind, its bounds, normalising, unknown keys,
the edge rule, versions), link encode and decode (round trip, the size
limit, junk), storage and apply (save, choose, delete, a refused write), the
boot script against the module for custom choices and the reset address, the
picker with saved themes, the preview sheet. E2E: import a file, keep it,
reload into it from the first frame; open a share link in a fresh page;
let the revert run out; `?theme=reset`.

### Phase 4: theme editor (built)

**Where**: a focused, full-screen flow like the Workshop's editors (its own
header, no tab bar): `/settings/theme` makes a new theme from the one in use,
`/settings/theme/<id>` edits a saved one. Settings, under the picker: **Make a
theme** (always) and **Edit this theme** (a theme of one's own). Back asks
"Leave without saving?" when there are changes, as the Workshop does.

**Preview**: the editor page stays in the theme in use; a sticky sample at the
top draws the draft (its base's `data-theme` with the draft's values on it,
built as a saved theme's are, through `appliedTheme`): a small sheet with a
header, an HP card and bar, damage and heal, the action and outline buttons,
chips and a selected card, a condition chip, body and muted text, icons. The
draft never touches <html>, so nothing (a dialog, a toast, another tab's
change) can be drawn in a half-made theme. Saving draws the app in it.

**The draft** (`src/theme/draft.ts`): a theme file, the tokens the person set
themselves, and an undo history. Every control shows the token's value in the
draft: its own if set, else derived (below), else the base's (from themes.css,
loaded with the editor), with **Reset** on a token set by hand. Every edit goes
through `checkToken`, so the draft is always a valid file; an invalid entry
says why next to the field and changes nothing. The draft is kept in
localStorage as it changes, so a tab the phone closed can pick up where it was.

**Related tokens move together** (`src/theme/derive.ts`), while the person has
not set them by hand, and only once something they follow has been set:
- grounds from `surface` toward `ink` (`surface-raised`, `surface-hover`,
  `line`, `track`), `line-strong` from `bg` toward `ink`, `edge` (none on a
  dark page, `line` on a light one);
- text from `ink` toward `bg` (`ink-muted`, `ink-faint`);
- `brand-hover` (`brand` toward `ink`), `on-brand` (`surface` or `ink`,
  whichever reads better on it), `danger-fill` (`danger` darkened until white
  reads on it), `on-danger` (white or black);
- each role's `-soft` and `roll-soft`, a tint of it over `surface`;
- `hp-trail` and `hp-bloom` (`danger` and `heal` halfway to white),
  `hp-sheen` by the page's lightness;
- the condition hues by the page's lightness (Dark's on a dark page, Light's
  on a light one), each `-soft` a tint once its hue is set by hand.

A following row says what it follows ("Follows Action", "Follows the page"), with **Set its own**. The
derived values are written into the file as plain values, so a file never
depends on the editor; the list of tokens set by hand is kept beside the saved
theme (not in the file), so following survives saving. A theme with no such
list (imported) counts a token as following when its value is what derivation
gives.

**Groups**, in order, the first open: **Start here** (`bg`, `surface`, `ink`,
`brand`, `font-sans`, `font-display`, `radius-card`), **Page and surfaces**,
**Text**, **Actions and roles**, **Conditions** (13 hues; their tints tucked
away), **Type**, **Shape**, **Shadows**, **Icons**. The name (prefilled, "<the
theme it starts from> copy") and author sit above them; **Start from** (the
base) below the sample, keeping every token set by hand when it changes.

**Controls**, one per kind (a map, so phase 5's enumerated kinds slot in):
colour, a swatch (the native picker) and a hex field for pasting, with an
opacity slider for the tokens that take it (`scrim`, `hp-sheen`); font, the
bundled fonts; weight, the weights the body font has; radius, a slider with
steppers, 0 to 48px, and **Round ends** for `radius-pill`; edges, steppers in
halves; icon stroke, a slider with steppers; shadows, presets (None, Soft,
Deep, Outline, the base's). **Undo** in the header takes back the last change.

**Saving**: a new theme is saved to Your themes (one already saved with the
same content is picked instead); an edited one is replaced in place, keeping
its id and its place, or **Save as a copy** saves it alongside. Either is then
chosen, as Keep would.

**Tests**: derivation (each relation, following only after a source is set,
and stopping once a token is set by hand; following worked out again for a
theme with no hand-set list), the draft (set, reset, base change, invalid
entries, the edge rule, undo, keeping and resuming), saving new, in place and
as a copy, the editor page (a change draws at once in the sample and never on
<html>, leaving asks only when changed), and E2E: make a theme from Parchment,
change its page colour and font, save, reload into it from the first frame;
edit it again.

### Phase 5: decor and more fonts

**Decor as choices, drawn by attribute.** Two new tokens of a new kind,
`choice`, each a short list of named looks rather than a value:

- `texture`, behind the page: `none`, `paper`, `linen`, `grain`. Each is a
  small tiling SVG noise in app CSS (`decor.css`), a data URI (the CSP allows
  `data:` images), grey and blended with `soft-light` over `bg`, so one tile
  suits any page colour, light or dark.
- `frame`, around cards: `plain`, `double` (a hairline inside the edge),
  `stitched` (a dashed line inside it), `inked` (a heavy outline outside it).
  Drawn with `outline` and `outline-offset`, which take no room and leave the
  layout alone.

A choice is never set as a custom property (the boot script would have to
trust a data URI): it is an attribute, `data-cg-texture="paper"`, on the
element the theme is drawn on (<html>, the editor's sample, a picker card),
and decor.css keys on it, so a subtree draws its own. `appliedTheme` already
carries `attrs` for the boot script, which checks names (`data-cg-*`) and
values (`[a-z0-9-]`) before setting them. A built-in's choices live in
builtins.ts (Parchment: paper, double; the rest none, plain), set the same
way, and the boot script repeats them, held to builtins.ts by its test as the
page colours are.

**One hook on every card.** `cardClass` gains `cg-card`, and the 23 cards
that build their own classes move to it or take the hook; a scan test fails
on a card-shaped class list (`rounded-card` with a `bg-surface`) without it.

**Title tracking.** `tracking-display` (em, -0.05 to 0.2): added to each
title size's own letter-spacing, 0 in every built-in, so they draw as now,
and a capitals face like Cinzel can open up.

**More fonts.** EB Garamond, Fraunces, Cinzel and IM Fell English (book and
display), Lexend (a readable sans), OpenDyslexic, and JetBrains Mono, all
OFL-1.1, 400 and 700 (Cinzel and Fell what they have). Not precached (the
precache has about 140 KB left): the cache-first route keeps each face on
first use, and drawing a theme asks for its faces while online, so a theme in
use stays whole offline. The editor's font control becomes a list, each font
named in itself and loaded as its row scrolls into view, with Loading and
"Not saved for offline yet" states, and a search box.

**Tests**: choices read and checked as a file's other values (an unknown
look dropped), drawn as attributes on <html> before first paint and on
subtrees, never as custom properties; the boot script's choices for the
built-ins against builtins.ts; every card with the hook; built-ins pixel for
pixel unchanged apart from Parchment's decor; the editor's choice and font
controls; a theme using a library font draws in it after a reload while
online, and falls back cleanly offline before first use.

### Phase 6: uploaded fonts (only on demand)

`FontFace` from bytes stored in IndexedDB. Test in Safari. Cannot travel in a
share link.

## Out of scope

Spacing, tap targets, text sizes, layout, focus ring width and colour role
(accessibility), motion, per-character themes, an in-app gallery.
