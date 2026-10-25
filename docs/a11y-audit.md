# Accessibility audit

The record [#114](https://github.com/FueRobertHer/cast-guidance/issues/114)
(A11Y-003) asks for: what is checked automatically on every change, what a
person has to check on a device, the results of each pass, and the decisions
taken along the way. The automated part is a gate in CI; the manual part is
what keeps #114 open until someone has run it.

## Automated coverage

### axe, on every main route and overlay

[`e2e/a11y/axe.spec.ts`](../e2e/a11y/axe.spec.ts) runs
[axe-core](https://github.com/dequelabs/axe-core) (through
`@axe-core/playwright`, pinned exactly) against the production build in
Chromium, in the existing `e2e` CI job. Rules: WCAG 2.0, 2.1 and 2.2, levels A
and AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`).
`best-practice` rules are not run, and no rule is disabled.

Each scan is a named state, scanned only once it is settled: the data install
finished, the one-time offline notice kept away (it has a state of its own),
the overlay open and its slide-in finished. The viewport is the suite's fixed
phone (Pixel 7); four states are scanned again at a desktop size, where the
app nav and the sheet's tabs move into a side rail.

For the length of each scan, vaul's drag overshoot strip
(`[data-vaul-drawer]::after`, off screen below a resting sheet) is hidden.
Its `background: inherit` left axe unable to work out the background of any
text in an open drawer, so every such node was undecided rather than judged,
and a failing label in a drawer passed: the review showed it by reverting the
dice tray's Roll button. With the strip hidden, that revert fails `dice-tray`.

| Area | States |
|---|---|
| Roster | `roster-empty` (with the getting-started card), `roster`, `roster-actions` (the actions sheet), `rename-dialog`, `delete-confirm`, `character-import-preview` (a character file's preview, before anything is written) |
| Character sheet | `sheet-play`, `sheet-stats`, `sheet-items`, `sheet-spells`, `sheet-more`, `sheet-build`, `sheet-spells-caster` (a caster's spell list, two classes and a known spell) |
| Sheet overlays | `dice-tray`, `history-drawer`, `breakdown-sheet` (a number's breakdown), `entity-info-sheet` (an option's full description, from Build), `spell-info-sheet` (a spell's rules text, from a caster's Play tab), `spell-pack-problem` (the same sheet with the spell files failed to download: its panel, the alert inside the modal) |
| Library | `library`, `library-spells` (a virtualized list), `library-detail`, `library-search` |
| Homebrew | `homebrew-empty`, `homebrew-import-preview` (a homebrew file's preview), `homebrew` (one imported file), `homebrew-remove-confirm`, `text-prompt` (the collection name prompt), `homebrew-builder`, `homebrew-builder-unknown` |
| Other routes | `settings`, `creator` (step 1), `not-found` |
| Sheet confirm | `long-rest-confirm` (a confirm that is not destructive, so its button is the red fill) |
| Banners and toasts | `toast-offline-ready`, `banner-data-download`, `banner-data-error`, `settings-update-failed` (a newer release that fails to install: Settings' alert and the "Update to ... failed" banner), `toast-data-update` ("Game data ... available"), `toast-app-update` ("A new version of the app is ready.", from a new build on the variant server), `banner-save-error` (character writes refused, as a full disk would), `banner-db-closed` (the database deleted, as clearing site data from another tab does) |
| Desktop layout | `desktop-roster`, `desktop-library`, `desktop-settings`, `desktop-sheet-play` |

The character is a blank sheet, except in the caster states (the Sorcerer 13
and Cleric 2 of `e2e/fixtures/caster.ts`, who knows Fireball), and the game
data is the suite's small fixture release (one class, one spell, one of most
other things), so a scan sees every control a page draws but not every row a
full compendium would. Not scanned yet: the creator past step 1, a character
at 0 HP (the death-save row), and the caster's other tabs.

### Reduced motion

The app honours `prefers-reduced-motion: reduce` everywhere: a block at the end
of [`src/styles/app.css`](../src/styles/app.css) takes every animation and
transition down to 0.01 ms (not `none`, so the end events Radix waits on still
fire) and turns off smooth scrolling. The one smooth scroll asked for from
script (Build's "jump to the next choice") checks the preference itself
(`src/lib/motion.ts`). The roll toast and the roster's fade-ins were already
`motion-safe:`.

[`e2e/a11y/reduced-motion.spec.ts`](../e2e/a11y/reduced-motion.spec.ts) records
every animation and transition that starts while the dice tray and the history
drawer open and close and a die is rolled: with `reducedMotion: 'reduce'` none
runs longer than 0.01 ms, and the same flow without the preference (the
canary) does animate.

### Touch target sizes

[`e2e/a11y/target-size.spec.ts`](../e2e/a11y/target-size.spec.ts)
([#113](https://github.com/FueRobertHer/cast-guidance/issues/113), A11Y-002)
measures the boxes the browser lays out, on the suite's phone. It measures
the element's own box, as axe's `target-size` rule does, so a hit area drawn
by a pseudo-element would not count. Two checks:

- **Inventoried controls, 44 by 44:** the HP steppers, the exhaustion and
  point-pool steppers, the death saves, Build's level and ability steppers,
  the creator's ability steppers, the sheet's and the creator's back links,
  and Homebrew's row actions (enable, edit, download, delete). Pips are held
  to 32 wide by 44 tall (the decision below). Each check also counts the
  controls it found, so a renamed one cannot drop out unseen.
- **Everything else, 24 by 24 (WCAG 2.5.8):** every visible button, link,
  `summary` and `role="button"`. The one exemption is 2.5.8's inline one: a
  roll chip in rules text, which `renderEntries` draws with `RollChip`'s
  `inline` (marked `data-inline-target`) only when there are words around
  it. A marked chip with no sentence beside it fails the check, so the mark
  cannot hide a stray control; a chip alone, in a table cell say, is a full
  24 by 24 target.

States: the Play tab of a caster (Sorcerer 13 and Cleric 2, from homebrew
the character file carries, since the suite's data release has no caster:
spell slots, a sorcery-point stepper, Channel Divinity pips, a level of
exhaustion), the same at 0 HP (the death saves), Build with every section
and picker open, Homebrew with one file of your own, and the creator's
abilities step on point buy. Not measured yet: spell rows on Play (the
caster knows no spells), the Stats, Items, Spells and More tabs, the
library, Settings, and the creator's other steps. axe's `target-size` still
runs on every scanned state.

### Unit guards

- `src/styles/contrast.test.ts`: the button fill (`accent-fill`) clears 4.5:1
  with white and with the ink colour, `accent-ink` clears it on a raised
  control and its hover step, and every bare `bg-accent` token in the source
  (opacity variants included) is on one of a listed set of unlabelled mark
  lines. A token in a conditional or a variable counts too, and moving one
  from a mark onto a label in the same file fails.
- `src/features/sheet/tabs/targetSize.test.tsx`: the sheet's small controls,
  the Stats ability scores and the death saves included, carry a thumb-sized
  class. The E2E spec above is the real guard; this one only fails fast.
- `e2e/a11y/baseline.test.ts`: the baseline policy below.

### Keyboard, focus trap and focus return

[`e2e/a11y/keyboard.spec.ts`](../e2e/a11y/keyboard.spec.ts), at a desktop size
(no touch, the app nav and the sheet's tabs in a side rail):

- **Dialogs and drawers:** the roster's actions sheet, Rename, the Delete
  confirm, the character import preview, the homebrew import preview, the dice
  tray, the history drawer, the long rest confirm, a number's breakdown (STR),
  an entity's info sheet (Fighter, a sheet deferred until first used) and
  Add item (whose focus must land on its search box). Each is opened by Enter
  on its trigger, and must take focus; Tab and Shift+Tab, each pressed two
  more times than the dialog has controls, keep focus inside and visit every
  control (a dialog with none must keep focus on itself); Escape closes it and
  focus is back on the trigger (for Rename and Delete, which open from the
  actions sheet, the row's Actions button the chain started from).
- **Pages by Tab and Enter:** the roster (the character, its Actions, the
  blank sheet and wizard options and Import, in that order; Enter creates a
  character and opens one), the library (search, a result, a type tile, the
  list's filter, a row, each opening with Enter), and the sheet's tab bar
  (each tab the next Tab stop after the one before, Enter opening it).
- **The library's long list:** 150 generated spells, tabbed through first to
  last and 30 back with Shift+Tab: every press lands on the next row, which
  is rendered and inside both the list's box and the window, says its place
  (`aria-posinset` n, `aria-setsize` 150), and the list still renders at most
  60 rows. Arrow keys are not checked, because the list has none (see the
  open findings).

### The library at scale

[`e2e/specs/library-scale.spec.ts`](../e2e/specs/library-scale.spec.ts), with
1,000 generated spells on the suite's phone: at most 60 rows rendered, before
and after filtering to 100; a row's estimated height equal to its rendered
height at 16 px and at 200% text; and Back from a spell opened 500 rows down
(reached a screenful at a time) returning to that row, within one; and row 4,
focused, kept rendered with rows 3 and 5 ahead of the window's rows after a
scroll far away, Tab then going to row 5 and Shift+Tab twice to row 3.
`src/ui/VirtualList.test.tsx` holds the rest at unit level: the window, the
focused row and its neighbours kept rendered through a scroll (also by key
when the list changes under it, and while the window is in the background,
and let go when its row is taken out), the list's start re-measured, and no
list role while empty.

### Zoom, text size and landscape

[`e2e/a11y/layout.spec.ts`](../e2e/a11y/layout.spec.ts), on the suite's phone:

- **Reflow (1.4.10):** at 320 by 640 CSS px, no main route scrolls sideways
  (`scrollWidth <= clientWidth`): the roster, library index, a type list, a
  detail page, homebrew, settings, the creator, not-found and the six sheet
  tabs, each with every fold (`<details>`) opened, so collapsed content is
  measured too.
- **Text at 200% (1.4.4):** the root font set to 200% through
  `page.addStyleTag`, so everything sized in rem grows as with the browser's
  text-size setting: the same routes, folds open, do not scroll sideways, and
  each one's
  primary controls (the roster's create and import buttons, the library's
  search and filter, Settings' update check, the creator's Next, the sheet's
  tab and Back link, the dice tray and Long rest) are whole on screen once
  scrolled to.
- **Landscape (851 by 393):** on every sheet tab the character name is whole
  on screen and clear of the bottom tab bar, the content starts below the
  sticky header with more than half the screen between the bars, and no
  control in the page is entirely hidden behind the header, the build page's
  bar or the tab bar when Tab or Shift+Tab moves to it (2.4.11). The same
  walk runs on the roster and Settings, and down and back up a 150-spell
  library list, under the app nav.

The reflow and 200% passes set the page's font to DejaVu Sans (and DejaVu
Sans Mono for its monospace runs), installed on the CI runner and locally:
the app asks for the system UI font, which each Linux machine resolves to its
own fallback, and CI's (DejaVu Sans, the wider) made a route that fit locally
scroll sideways there. They first check that both fonts draw text at a width
their generic fallbacks do not, so a machine without them fails rather than
quietly measuring its own.

The two are checked apart, as WCAG asks: 320 px at the normal text size,
and 200% text at the phone's own width (412 px). Both at once is not
required, and still scrolls sideways on the roster (5 px), Play (13 px),
Stats (42 px) and Build (79 px), folds open, measured 2026-10-25.

Not automated: the real OS text settings (iOS Larger Text, Android font and
display size, which also scale media queries, unlike a root font size), safe
areas on a notched device, and the installed app. Those stay manual below.

## Baseline policy

[`e2e/a11y/axe-baseline.json`](../e2e/a11y/axe-baseline.json) lists, per state,
the rules axe still reports and how many nodes each one hits. It counts nodes
by rule rather than keeping selectors, because Tailwind classes churn and
every selector would be a false change.

- **Fails:** a rule the baseline does not list for that state (a new state
  counts as listing nothing), or more nodes than it allows. Every impact
  level is held, since the WCAG rule set has no advice-only rules in it.
- **Never fails:** fewer nodes, or a rule gone. The run reports it (a test
  annotation and the CI summary) with "please update the baseline", so a fix
  never turns the build red, and the gain is banked by updating the file.
- **Not gated:** nodes axe could not decide (`incomplete`, contrast over a
  translucent layer, say). The CI summary lists them under "Needs review".
- **Stale states fail:** when the run is not narrowed (no grep, inverted
  grep, shard, last-failed, changed-files, test-list or `file:line` filter)
  and every axe test ran to an end, passed or skipped, a baseline state no
  scan covered fails the run: a renamed or removed state must leave the
  baseline too, and a skipped test does not switch the check off (its own
  states fail it, until the test is unskipped or its states are taken out).
  A narrowed run, or one in which an axe test failed, only lists such
  states.
- **Updating:** `bun run e2e:a11y:update` (after `bun run build`) reruns the
  axe spec with `A11Y_BASELINE_UPDATE=1` and rewrites the file from the
  states that passed. States it did not scan are kept, unless every axe test
  passed in an un-narrowed run, when they are pruned. Commit the diff with the reason. A rule
  kept on purpose can carry a `note` (an issue link), which updates preserve.
  An update is refused when `CI` is set: CI only checks the baseline.
- **CI:** the `e2e` job's step summary carries the axe table (regressions,
  improvements, what the baseline still allows) under the E2E counts.

The first run found 14 serious nodes across 9 states. Unmasking the drawers
found one more (a destructive choice's red label in the actions sheet). All
are fixed, so the baseline is empty: axe reports no violation in any of the
46 states. That is not the same as every node passing. Some nodes are
undecided, and those are listed, not gated:

| Undecided `color-contrast` | Nodes | States |
|---|---:|---:|
| Before hiding vaul's overshoot strip | 59 | 15 |
| After it, same 37 states | 16 | 9 |
| After it, with the 6 states added since (the two import previews add none) | 22 | 12 |
| With the caster's 3 states (`sheet-spells-caster` adds none) | 26 | 14 |

What is left is of two kinds. Most are symbols with no text (the Inspiration
star, the toast icon), which have no contrast requirement: in `sheet-play`,
`desktop-sheet-play`, `dice-tray`, `history-drawer`, `long-rest-confirm`,
`spell-info-sheet`, `spell-pack-problem`, `banner-save-error`,
`banner-db-closed` and `toast-offline-ready`. The rest
are text another layer partly covers, so axe cannot pick one background:
under the fixed bottom nav or the update toast (`settings`,
`desktop-settings`, `toast-app-update`), on a translucent toast
(`toast-offline-ready`), and one line each in `history-drawer` and
`breakdown-sheet`. None is ratcheted: they move with scroll position and
which layer sits on top, and a count that moves would be a flaky gate. The
colours involved all pass on paper (ink-muted, the dimmest text, is 6.91:1 on
surface and 5.81:1 on surface-2; ink is far above both), and the
screen-reader and zoom passes below look at them on a device.

## Fixes and decisions

| Date | Finding | Resolution |
|---|---|---|
| 2026-10-25 | `color-contrast`: white or ink labels on the red fill (red-500) were 3.6 to 3.8:1, under 4.5:1. Hit every filled button axe reached (Import file, the creator's Next, dialog OK, the update toasts, the download retry). | A new `accent-fill` token (red-600) for labelled controls: 4.8:1 with white, 4.6:1 with ink. `accent` stays for text and marks on the page, and icon-only fills, which need 3:1. After #166 landed, its database-closed banner's Reload and the save-error banner's Retry moved to `accent-fill` too; the unit guard has no allowlist for labels. |
| 2026-10-25 | `color-contrast`: #169's import preview drew its Import button white on `bg-accent`, 3.8:1. | Moved to `accent-fill`, like every labelled red button; both preview states fail without it. |
| 2026-10-25 | `color-contrast`, found once drawers were unmasked: a destructive choice (the roster's Delete) drew its label in `accent` on a surface-2 button, 4.0:1, and 2.8:1 on the hover step. | A new `accent-ink` token (red-300) for red words on a raised control: 7.8:1 and 5.5:1. |
| 2026-10-25 | `target-size`: the Stats tab's ability scores (the breakdown buttons) were 13 by 16 px. | Now 44 by 44 targets (`tap`), the card's bottom padding absorbing part of the growth. |
| 2026-10-25 | Target sizes, measured (#113): the death-save circles on Play (shown at 0 HP) were 20 by 20, under 44 and under 24. | 44 by 44 targets around the same 20 px circle. Successes sit over failures, with Roll save beside them (below them on a phone narrower than about 360 px). |
| 2026-10-25 | Homebrew's row actions: download, delete and edit were 27 by 27, the enable toggle 63 by 22. | All four 44 tall (`tap`), the icons 44 by 44; a negative margin keeps the row its height, and the toggle keeps its pill inside the target. Below 360 px the name takes the row's first line and the toggle and actions the second, or the name would get about 66 px. |
| 2026-10-25 | The creator: the abilities step's steppers were 32 by 32, its back link 20 by 20. | 44 by 44 targets around the same 32 px circle, with the gap between them dropped so a card still fits half of a 320 px screen; the back link as on the sheet. |
| 2026-10-25 | Under 24 on Play: the "temp HP" and "breakdown" links (16 tall), the resource names that open their rules (20 tall), the attack row's roll chips (24 by 18 and 17 by 18). | At least 24 tall, the chips 24 by 24. A roll chip in rules text keeps the size of its line (`RollChip`'s `inline`). Action names and weapon names, which open rules the same way, got the same 24 px height. |
| 2026-10-25 | Under 24 on Build: the pickers' summaries ("Add a class (multiclass)", "Pick a species to start" and the like) were 16 tall. | 24 tall (`py-1`), keeping the disclosure marker. |
| 2026-10-25 | No reduced-motion handling beyond the roll toast and the roster. | App-wide block in `app.css`, plus the script-driven smooth scroll. See above. |
| 2026-10-25 (from #163) | Resource pips are 44 px tall and 32 px wide around a 16 px dot, not 44 by 44: a 12-use row at 44 px a pip wraps onto a third line at 320 px. | Owner decision: keep 44x32. The height is what a thumb misses by; 32 px is above WCAG 2.5.8's 24 px floor, and axe's `target-size` passes it. Revisit if the manual passes find mis-taps. `e2e/a11y/target-size.spec.ts` holds slot and resource pips to 32 by 44. |
| 2026-10-25 | Focus left behind on opening: every drawer but the ask* dialogs (the dice tray, history, the info and breakdown sheets, Add item) kept focus on its opener, by then `aria-hidden` behind the overlay. vaul turns Radix's open-time focus off unless asked. | `Sheet.Root` turns `autoFocus` on by default (a sheet can still opt out), so focus moves to the sheet's first control, or the sheet itself, as it opens. With focus inside, Radix's own trap and its return to the trigger on close pass unchanged. Pinned in `src/ui/sheet.test.tsx`; `keyboard.spec.ts` fails without it. Add item's first control is its search box, which would pop a phone's on-screen keyboard over the list it filters, so on a coarse pointer it focuses the sheet itself instead (`onOpenAutoFocus`, unit tested in `InventoryTab.test.tsx`); with a keyboard focus lands in the box, which the spec checks. |
| 2026-10-25 (review) | Text at 200% with the Conditions fold open: the Exhaustion stepper's count sat in a fixed `w-10` between `justify-between` neighbours, so the + ran out of its card and the page was 478 px wide at 412 px. | The count grows with its text (`min-w-10`, no wrap), and the stepper wraps under the name, at the right, when both do not fit. The 200% and 320 px passes now open every fold. The HP total also stays readable: it breaks only before "/ max", and a floor of 3.25rem or its min-content, whichever is wider, gives it a line of its own at large text rather than split "0 / 0". Measured: at 360 and 412 px totals up to 1234 / 1234 sit between the pairs; at 320 px a two-digit total does, breaking before "/ max", and a three- or four-digit one moves the heal pair onto a line of its own rather than overlap it. |
| 2026-10-25 | Focus not obscured (2.4.11): in landscape, Tab scrolled a control just into view under the bottom tab bar (the Play tab's turn tracker, Stats' skills, Build's sections), and Shift+Tab under the sheet header and the build page's bar, entirely hidden. | The page's scroll padding clears the bars: 4rem at the bottom below `lg` (app.css), and at the top the sheet header's and the build bar's measured heights (`useStickyHeight`, which now also publishes `--sheet-header-h` from the root). |
| 2026-10-25 | Reflow at 320 px: the Play tab's turn tracker (Action, Bonus, Reaction, End turn) was 5 px wider than the screen. | The row wraps, End turn kept at the right, only when it cannot fit. |
| 2026-10-25 (#106) | A failure inside a modal sheet: the spell info sheet now says why it has no spell when the spell files failed to download. By the one-voice rule (A11Y-002) its panel would be a plain visual while the shell's data banner alerts the outage, but the open sheet's modal sets `aria-hidden` on the whole app behind it, banner and announcer included, so nothing would say it. Opened offline, a screen reader would read "Loading spell…" and then nothing as the failure landed. | The panel takes `alert="always"` (`PackProblem`), for in-modal use only: inside the modal it is the only voice, so it is not a second one. The same goes for its closed-database line ("Reload this tab to load this spell's description."), an alert in the modal because the database banner is hidden too. `useFailureAlert`'s contract is unchanged everywhere else. While no spell is shown, the sheet's `aria-describedby` points at the line saying why (not at the body, which holds Retry), so focus landing on Retry or the sheet as it opens reads the reason. Pinned in `SpellInfoSheet.test.tsx` and `PackProblem.test.tsx`; the offline route matrix expects exactly one alert inside the sheet below `full`, and axe scans the state as `spell-pack-problem`. |
| 2026-10-25 | Text at 200%: a library tile's one-word label (Backgrounds, Languages) ran past its card and the screen; the Play tab's HP row (the damage and heal pairs around the total) was 121 px wider than the phone. | The tile label breaks inside a long word (`break-words`). The HP row wraps, the heal pair kept at the right; the total has a zero flex basis, so a three-digit total at 320 px still breaks onto two lines in place, as before, and the row wraps only where it would have overflowed. |
| 2026-10-25 (#114) | P2, performance: the library list did not virtualize. `AppShell` is only `min-h-dvh`, so the VirtualList box (`flex-1`) grew to the full height of its rows, the window scrolled instead, and every row was rendered (1,000 of 1,000). | `VirtualList` windows on the window's scroll (`useWindowVirtualizer`), measured from where the list starts in the page, so Back's scroll restore, the mobile address bar and the html scroll padding work as before. Rows are keyed by entry, are a list labelled by the page heading with `aria-posinset` and `aria-setsize`, and the focused row and its neighbours stay rendered through a scroll. A row's estimate is its exact height (LibraryPage), so Back lands on the row it left; the first version scrolled the window to the top as it mounted, which `library-scale.spec.ts` caught. Measured with 1,000 spells at 1280 by 720, before then after (two or three runs each): rows rendered 1,000 then 22; opening the list from the library home 575 to 756 ms then 58 to 96 ms (3.0 to 3.7 s then about 200 ms at 4x CPU throttle); filtering with the whole query typed at once ("Spell 9", then cleared), median 67 to 112 ms then 23 to 27 ms, worst 229 to 251 then 25 to 32 (4x: median 159 to 190 then 50 to 61, worst 553 to 845 then 67 to 82); one keystroke, median 25 to 38 ms then 17 to 21, worst 51 to 176 then 31 to 36 (4x: 126 to 146 then 46 to 61, worst 289 to 689 then 77 to 82), with 4.6 to 5.1 s of long tasks over ten rounds at 4x, then 52 to 112 ms; a Tab press down the list 46 to 61 ms then 11 to 17 (4x: 204 to 288 then 37 to 50). The 150-row keyboard walk takes about 6 s either way, now without the slow budget. Each time runs from the key or input event to two frames after the count changes. The finding's first figure, 1.0 to 1.4 s a filter, did not reproduce this way on the machine measured. |
| 2026-10-25 (#114) | Accepted trade-off: find in page (Ctrl+F, Safari's Find on Page) only sees the rendered rows of a library list. | Kept: the Filter box above the list does the same job, faster, and the library search covers every type. `content-visibility: auto` would keep find in page, but still renders every row, which is the cost being cut. |
| 2026-10-25 (#114) | Accepted trade-off: NVDA's and JAWS's browse mode reads a library list only as far as its last rendered row, about ten past the screen. | Kept, for the same reasons: Tab, and a VoiceOver or TalkBack swipe, scroll the next rows in; every row says "n of total", so the list's length is never hidden; and the Filter box narrows the list. The manual "Virtual list" pass checks it. |

Open findings, for follow-up issues:

- The library's virtualized list (`src/ui/VirtualList.tsx`) has no arrow-key
  navigation; rows are reachable by Tab only (one stop per row, which
  `keyboard.spec.ts` checks end to end). Each row carries its position and
  the list's size; whether a screen reader says them is a manual item below.
- At 200% text, the Play tab's Concentration toggle truncates its label
  ("oncentr") beside Inspiration. Nothing scrolls sideways and the control
  keeps its full accessible name, but the visible text is cut; the manual
  Dynamic Type pass should judge it.
- The builder's "This homebrew file is no longer on this device." page has no
  heading (axe's `page-has-heading-one`, a best-practice rule, so not gated).
- Not scanned yet, for want of a hermetic setup: the data banner's rollback
  notice ("could not start, so the app went back"), the database banner's
  `superseded` and `stale` wordings (same layout as `deleted`, which is
  scanned), and the "open in another tab" line on the sheet.
- With a dialog or drawer open, axe cannot decide `aria-hidden-focus` for a
  few controls left behind the overlay (3 to 8 per state, under "Needs
  review" in the CI summary). `keyboard.spec.ts` settles it: with each
  dialog open, Tab and Shift+Tab never reach a control outside it.

## Manual checklist

Run each flow with each check, on a real device where the check names one.
Record every pass in the results table below, failures included, with the
device, OS and assistive-technology version, and link the issue or fix.

Flows: roster (create, rename, delete, import, export); creator; sheet tabs
(Play, Stats, Items, Spells, More); Build; library browse, detail and search;
homebrew import and builder; settings (data, update, reset); dialogs and
drawers; the dice tray; toasts and banners.

The automated column says what CI already holds in Chromium (passing on
2026-10-25); the manual pass is still needed for what it leaves out.

| Check | What to look for | Automated |
|---|---|---|
| VoiceOver (iOS Safari, and the installed app) | Every control has a spoken name and role; dialogs and drawers announce themselves and keep the swipe order inside; toasts and banners are announced once, not repeatedly; the HP meter reads its value; pip state (spent or available) is spoken. | Names, roles and states only, through axe. |
| TalkBack (Android Chrome, and the installed app) | The same as VoiceOver, with TalkBack's linear navigation and explore by touch. | As for VoiceOver. |
| Dynamic Type and zoom | iOS Larger Text at the largest size, Android font size and display size at maximum, and browser zoom to 200%: no text clipped or overlapping, no horizontal scrolling for prose, primary buttons still on screen. | `layout.spec.ts`: no sideways scrolling at 320 px or with a 200% root font, primary controls whole on screen. Not clipping or overlap, and not the OS settings. |
| Safe area and landscape | On a notched phone, portrait and landscape: the sheet header, tab bar, dice button and toasts clear the notch, the home indicator and rounded corners; nothing sits under the system bars in the installed app. | `layout.spec.ts` at 851 by 393: the header and tab bar leave the name and content in sight, and no focused control is hidden behind them. No safe-area insets (none in an emulated viewport). |
| External keyboard | Every action reachable with Tab and Shift+Tab in a sensible order; Enter and Space activate; Escape closes dialogs and drawers; focus is visible throughout. | `keyboard.spec.ts`: the roster, the library and the sheet's tabs by Tab and Enter; Escape on every listed dialog. Not Space, every page, or how visible focus is. |
| Focus trap and return | Opening a dialog or drawer moves focus inside and keeps it there; closing it returns focus to the control that opened it. | `keyboard.spec.ts`, for the eleven dialogs and drawers listed above. |
| Virtual list | In the library's long lists: rows are reachable and announced while scrolling, focus does not get lost when a focused row scrolls out, and the list's length is discoverable ("37 of 1000"). | `keyboard.spec.ts`: 150 rows tabbed through, each rendered and in view, with the list windowed (at most 60 rows) and each row's `aria-posinset` and `aria-setsize` right. `library-scale.spec.ts`: 1,000 rows, the window, the filter and Back. `VirtualList.test.tsx`: a focused row kept rendered through a scroll. Not what is announced. |
| Reduced motion | With Reduce Motion on (iOS) or Remove animations (Android): sheets appear without sliding and nothing spins or fades. | `reduced-motion.spec.ts`. |
| A failure inside a sheet | Offline, without the spell files, open a known spell's rules text from a caster's Play tab: the sheet is announced with its name, the reason ("You're offline, so this spell's description can't be downloaded yet.") is read once, whether the failure lands before or after focus moves into the sheet, and Retry is reachable. | `offline-routes.spec.ts`: one alert inside the sheet, none outside it; `SpellInfoSheet.test.tsx`: the sheet's description is the reason. Not the timing against a real screen reader. |

### Results

| Date | Flow | Check | Device, OS, AT version | Tester | Result | Issue or fix |
|---|---|---|---|---|---|---|
| | | | | | | |
