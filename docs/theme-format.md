# Theme files

A theme changes how Cast Guidance looks: colours, fonts, weights, corners,
edges, shadows and the icon stroke. It never changes the layout: spacing, tap
targets, text sizes and the focus ring stay the app's. Themes live on the
device that imports them; there is no server and no gallery. They travel as
`.json` files or as links.

The design and its reasons are in [theming-plan.md](theming-plan.md). The code
is `src/theme/` (the vocabulary, the reader, the link) and `src/lib/theme.ts`
(saving and drawing).

## The file

```json
{
  "castGuidanceTheme": 1,
  "name": "Midnight Tide",
  "author": "Vela",
  "base": "dark",
  "tokens": {
    "bg": "#0b1d2a",
    "surface": "#102838",
    "brand": "#5ee0c8",
    "font-display": "alegreya",
    "radius-card": "10px"
  }
}
```

- **`castGuidanceTheme`** (required): the schema version, `1`. It says what
  the file is, and moves only for a change that breaks older readers. A new
  token does not move it: a reader drops tokens it does not know. A file with
  a higher version than the app knows is refused ("made by a newer version").
- **`name`**, **`author`**: one line of plain text each, at most 60
  characters. Control and bidirectional characters are removed. A theme with
  no name is called "Untitled theme".
- **`base`**: a built-in theme, `light`, `dark`, `parchment`, `modern` or
  `contrast`. It fills every token the file leaves out, so a file can set
  three values or all of them. It also means a theme that sets few values
  follows its base when the base is retuned in a later version. An unknown
  base is drawn on `dark`.
- **`tokens`**: the values the theme sets, by name. Anything else in the file
  is ignored.

**Export this theme** in Settings writes the theme in use. For a built-in
that is every value it sets, a complete file to start from.

## Values

| Kind | Written as | Bounds |
| --- | --- | --- |
| colour | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or `transparent` | `bg` must be opaque |
| font | a font id (below) | |
| weight | a number | 300 to 800, in hundreds |
| radius | `6px`, `0.5rem`, a bare number (px), or `full` | 0 to 48px |
| border | `1px` or a bare number | `border` 0 to 3px, `border-strong` 1 to 4px and wider than `border` |
| stroke | a number | 1 to 3 |
| shadow | `none`, or up to three layers `[inset] x y [blur [spread]] colour` | offsets within 32px, blur 0 to 64px, spread within 16px, lengths in px |

Fonts are the ones the app bundles (the security policy allows no other font
origin) or the device's own:

| Id | Font |
| --- | --- |
| `atkinson` | Atkinson Hyperlegible Next |
| `literata` | Literata |
| `alegreya` | Alegreya |
| `inter` | Inter |
| `system` | the device's sans serif |
| `serif` | the device's serif (Georgia where it has it) |

A value that fails its check, or a name that is not a token, is left out,
and the preview before a theme is used lists each one. The rest of the theme
still draws. There are no rules on how a theme looks: a theme is its maker's
business, contrast included. The built-in themes are held to the design
system's ratios; themes people make are not.

## Tokens

The names are `src/theme/vocabulary.ts`, without the `--cg-` the CSS uses.

**Grounds** (colour):
`bg` the page, `surface` cards and panels, `surface-raised` controls inside a
card, `surface-hover` their hover and pressed step, `line` decorative
hairlines, `line-strong` the edge of an outlined control, `track` the empty
part of a meter, `edge` the resting edge of a filled control with no border,
`scrim` behind an open sheet.

**Text** (colour): `ink` anything to be read, `ink-muted` labels and
metadata, `ink-faint` disabled labels and placeholders.

**Roles** (colour): `brand` action, `brand-hover` its hover, `on-brand` words
on it; `guide` guidance and `guide-soft` its tint; `focus` the focus ring;
`danger`, `danger-fill` (destructive buttons), `on-danger` (words on them) and
`danger-soft`; `heal` and `heal-soft`; `ward` (temporary hit points) and
`ward-soft`; `roll` and `roll-soft` (rolls); `arcane` and `arcane-soft`
(spellcasting); `meter-mid` a meter half spent. In the built-ins `focus` and
`meter-mid` follow `guide`, and `roll` follows `brand`, unless a theme sets
them.

**Conditions** (colour): each condition's colour and the tint it lays on a
roll: `cx-poisoned`, `cx-poisoned-soft`, `cx-paralyzed`, `cx-paralyzed-soft`,
`cx-frightened`, `cx-frightened-soft`, `cx-blinded`, `cx-blinded-soft`,
`cx-prone`, `cx-prone-soft`, `cx-restrained`, `cx-restrained-soft`,
`cx-grappled`, `cx-grappled-soft`, `cx-exhaustion`, `cx-exhaustion-soft`,
`cx-invisible`, `cx-invisible-soft`, `cx-stunned`, `cx-stunned-soft`,
`cx-unconscious`, `cx-unconscious-soft`, `cx-incapacitated`,
`cx-incapacitated-soft`, `cx-petrified`, `cx-petrified-soft`; and
`cx-edge-hover`, a roll chip's edge on hover.

**Shadows** (shadow): `shadow-card` under cards, `shadow-float` under the
dice button, `shadow-overlay` under sheets, dialogs and the roll toast.

**Type**: `font-sans` everything but titles, `font-display` names and
titles (font); `weight-normal`, `weight-semibold`, `weight-bold` (weight).

**Shape**: `radius-chip` chips and badges, `radius-control` buttons, fields
and rows, `radius-card` cards and panels, `radius-sheet` a sheet's top,
`radius-pill` pill-shaped chips, buttons and meters (`full` for round ends)
(radius); `border` every edge and divider, `border-strong` a selected card or
row (border).

**Icons**: `icon-stroke`, the line width of icons drawn at their default
(stroke).

## Getting a theme in

In Settings, under the theme picker:

- **Import a theme** reads a `.json` file, at most 64 KB.
- **Paste a theme link** reads a link copied from elsewhere. On iOS a link
  opens in Safari, whose storage is not the installed app's; paste it into
  the app instead.
- Opening a theme link goes to Settings and offers the theme there.

Each shows a preview first: the name and author, a miniature drawn in the
theme, and anything left out. **Try this theme** saves it to the picker and
draws the app in it, in that tab only. A banner then asks to keep it, and goes
back by itself after 30 seconds unless **Keep** is pressed. Reloading
meanwhile goes back too. Importing a theme already saved picks the saved one.

## Getting a theme out

- **Export this theme** downloads the theme in use as `<name> theme.json`.
- **Share this theme** (a theme of one's own) hands its link to the share
  sheet, or copies it where there is none.

A link is `https://<app>/settings#theme=1.<payload>`: the file's JSON,
deflated (`deflate-raw`) and written base64url, after the encoding version
`1.`. It is in the hash, so it never reaches a server. A reader stops inflating
past 64 KB.

## Getting back

A theme can make the app unreadable. Three ways back to a built-in:

- Settings' **Appearance** section is always drawn in the theme's built-in
  base, so the picker stays readable.
- **`?theme=reset`** on any address draws Dark before anything else loads,
  stores Dark as the choice, and comes off the address. Saved themes are kept.
- The installed app's icon has a **Reset theme** shortcut to that address,
  where the platform shows icon shortcuts.

## On the device

Themes are a preference of the device, in `localStorage`:
`cast-guidance:theme` (the choice: `system`, a built-in id, or
`custom:<id>`), `cast-guidance:themes` (the saved themes, each with a random
id that never changes), and `cast-guidance:theme-applied` (a copy of the
active theme's values for `public/theme-boot.js`, which draws it before first
paint; rebuilt from the saved file at every start). Each saved theme is read
again by the current rules at every start.
