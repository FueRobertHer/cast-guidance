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
| Roster | `roster-empty` (with the getting-started card), `roster`, `roster-actions` (the actions sheet), `rename-dialog`, `delete-confirm` |
| Character sheet | `sheet-play`, `sheet-stats`, `sheet-items`, `sheet-spells`, `sheet-more`, `sheet-build` |
| Sheet overlays | `dice-tray`, `history-drawer`, `breakdown-sheet` (a number's breakdown), `entity-info-sheet` (an option's full description, from Build) |
| Library | `library`, `library-spells` (a virtualized list), `library-detail`, `library-search` |
| Homebrew | `homebrew-empty`, `homebrew` (one imported file), `homebrew-remove-confirm`, `text-prompt` (the collection name prompt), `homebrew-builder`, `homebrew-builder-unknown` |
| Other routes | `settings`, `creator` (step 1), `not-found` |
| Sheet confirm | `long-rest-confirm` (a confirm that is not destructive, so its button is the red fill) |
| Banners and toasts | `toast-offline-ready`, `banner-data-download`, `banner-data-error`, `settings-update-failed` (a newer release that fails to install: Settings' alert and the "Update to ... failed" banner), `toast-data-update` ("Game data ... available"), `toast-app-update` ("A new version of the app is ready.", from a new build on the variant server), `banner-save-error` (character writes refused, as a full disk would), `banner-db-closed` (the database deleted, as clearing site data from another tab does) |
| Desktop layout | `desktop-roster`, `desktop-library`, `desktop-settings`, `desktop-sheet-play` |

The character is a blank sheet, and the game data is the suite's small fixture
release (one class, one spell, one of most other things), so a scan sees every
control a page draws but not every row a full compendium would. Not scanned
yet: the creator past step 1, a character at 0 HP (the death-save row), and
the sheet with a high-level, multiclass character.

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

### Unit guards

- `src/styles/contrast.test.ts`: the button fill (`accent-fill`) clears 4.5:1
  with white and with the ink colour, `accent-ink` clears it on a raised
  control and its hover step, and every bare `bg-accent` token in the source
  is one of a listed set of unlabelled marks (counted per file, so a token in
  a conditional or a variable counts too).
- `src/features/sheet/tabs/targetSize.test.tsx`: the sheet's small controls,
  the Stats ability scores included, carry a thumb-sized class.
- `e2e/a11y/baseline.test.ts`: the baseline policy below.

### Not automated here

Keyboard operation (focus traps, focus return, tab order) and layout checks
(320px reflow, 200% text, landscape) are the next PR's specs. Until then they
are manual items below.

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
- **Stale states fail:** when the run is complete (no grep, inverted grep,
  shard, last-failed, changed-files, test-list or `file:line` filter, and
  every axe test ran and passed), a baseline state no scan covered fails the
  run: a renamed or removed state must leave the baseline too. A narrowed run
  only lists such states.
- **Updating:** `bun run e2e:a11y:update` (after `bun run build`) reruns the
  axe spec with `A11Y_BASELINE_UPDATE=1` and rewrites the file from the
  states that passed. States it did not scan are kept, unless the run was
  complete, when they are pruned. Commit the diff with the reason. A rule
  kept on purpose can carry a `note` (an issue link), which updates preserve.
  An update is refused when `CI` is set: CI only checks the baseline.
- **CI:** the `e2e` job's step summary carries the axe table (regressions,
  improvements, what the baseline still allows) under the E2E counts.

The first run found 14 serious nodes across 9 states. Unmasking the drawers
found one more (a destructive choice's red label in the actions sheet). All
are fixed, so the baseline is empty: axe reports no violation in any of the
41 states. That is not the same as every node passing. Some nodes are
undecided, and those are listed, not gated:

| Undecided `color-contrast` | Nodes | States |
|---|---:|---:|
| Before hiding vaul's overshoot strip | 59 | 15 |
| After it, same 37 states | 16 | 9 |
| After it, with the 4 states added since | 22 | 12 |

What is left is of two kinds. Most are symbols with no text (the Inspiration
star, the toast icon), which have no contrast requirement: in `sheet-play`,
`desktop-sheet-play`, `dice-tray`, `history-drawer`, `long-rest-confirm`,
`banner-save-error`, `banner-db-closed` and `toast-offline-ready`. The rest
are text another layer partly covers, so axe cannot pick one background:
under the fixed bottom nav or the update toast (`settings`,
`desktop-settings`, `toast-app-update`), on a translucent toast
(`toast-offline-ready`), and one line each in `history-drawer` and
`breakdown-sheet`. None is ratcheted: they move with scroll position and
which layer sits on top, and a count that moves would be a flaky gate. The
colours involved all pass on paper (ink and ink-muted on surface, 7:1 or
more), and the screen-reader and zoom passes below look at them on a device.

## Fixes and decisions

| Date | Finding | Resolution |
|---|---|---|
| 2026-10-25 | `color-contrast`: white or ink labels on the red fill (red-500) were 3.6 to 3.8:1, under 4.5:1. Hit every filled button axe reached (Import file, the creator's Next, dialog OK, the update toasts, the download retry). | A new `accent-fill` token (red-600) for labelled controls: 4.8:1 with white, 4.6:1 with ink. `accent` stays for text and marks on the page, and icon-only fills, which need 3:1. After #166 landed, its database-closed banner's Reload and the save-error banner's Retry moved to `accent-fill` too; the unit guard has no allowlist for labels. |
| 2026-10-25 | `color-contrast`, found once drawers were unmasked: a destructive choice (the roster's Delete) drew its label in `accent` on a surface-2 button, 4.0:1, and 2.8:1 on the hover step. | A new `accent-ink` token (red-300) for red words on a raised control: 7.8:1 and 5.5:1. |
| 2026-10-25 | `target-size`: the Stats tab's ability scores (the breakdown buttons) were 13 by 16 px. | Now 44 by 44 targets (`tap`), the card's bottom padding absorbing part of the growth. |
| 2026-10-25 | No reduced-motion handling beyond the roll toast and the roster. | App-wide block in `app.css`, plus the script-driven smooth scroll. See above. |
| 2026-10-25 (from #163) | Resource pips are 44 px tall and 32 px wide around a 16 px dot, not 44 by 44: a 12-use row at 44 px a pip wraps onto a third line at 320 px. | Owner decision: keep 44x32. The height is what a thumb misses by; 32 px is above WCAG 2.5.8's 24 px floor, and axe's `target-size` passes it. Revisit if the manual passes find mis-taps. |

Open findings, for follow-up issues:

- The library's virtualized list (`src/ui/VirtualList.tsx`) has no arrow-key
  navigation; rows are reachable by Tab only. Whether a screen reader
  announces the list's size and position is a manual item below.
- The death-save circles on Play (shown at 0 HP) are 20 px targets, under 44
  and under axe's 24. No scanned state reaches 0 HP yet.
- The builder's "This homebrew file is no longer on this device." page has no
  heading (axe's `page-has-heading-one`, a best-practice rule, so not gated).
- Not scanned yet, for want of a hermetic setup: the data banner's rollback
  notice ("could not start, so the app went back"), the database banner's
  `superseded` and `stale` wordings (same layout as `deleted`, which is
  scanned), and the "open in another tab" line on the sheet.
- With a dialog or drawer open, axe cannot decide `aria-hidden-focus` for a
  few controls left behind the overlay (3 to 8 per state, under "Needs
  review" in the CI summary). The focus-trap check below is what settles it.

## Manual checklist

Run each flow with each check, on a real device where the check names one.
Record every pass in the results table below, failures included, with the
device, OS and assistive-technology version, and link the issue or fix.

Flows: roster (create, rename, delete, import, export); creator; sheet tabs
(Play, Stats, Items, Spells, More); Build; library browse, detail and search;
homebrew import and builder; settings (data, update, reset); dialogs and
drawers; the dice tray; toasts and banners.

| Check | What to look for |
|---|---|
| VoiceOver (iOS Safari, and the installed app) | Every control has a spoken name and role; dialogs and drawers announce themselves and keep the swipe order inside; toasts and banners are announced once, not repeatedly; the HP meter reads its value; pip state (spent or available) is spoken. |
| TalkBack (Android Chrome, and the installed app) | The same as VoiceOver, with TalkBack's linear navigation and explore by touch. |
| Dynamic Type and zoom | iOS Larger Text at the largest size, Android font size and display size at maximum, and browser zoom to 200%: no text clipped or overlapping, no horizontal scrolling for prose, primary buttons still on screen. |
| Safe area and landscape | On a notched phone, portrait and landscape: the sheet header, tab bar, dice button and toasts clear the notch, the home indicator and rounded corners; nothing sits under the system bars in the installed app. |
| External keyboard | Every action reachable with Tab and Shift+Tab in a sensible order; Enter and Space activate; Escape closes dialogs and drawers; focus is visible throughout. |
| Focus trap and return | Opening a dialog or drawer moves focus inside and keeps it there; closing it returns focus to the control that opened it. |
| Virtual list | In the library's long lists: rows are reachable and announced while scrolling, focus does not get lost when a focused row scrolls out, and the list's length is discoverable. |
| Reduced motion | With Reduce Motion on (iOS) or Remove animations (Android): sheets appear without sliding and nothing spins or fades. |

### Results

| Date | Flow | Check | Device, OS, AT version | Tester | Result | Issue or fix |
|---|---|---|---|---|---|---|
| | | | | | | |
