# Browser E2E

Playwright specs that run the production build in Chromium, as a phone
(Pixel 7), with the service worker on and no real network.

```bash
bun run build          # the suite tests dist/, so build first
bun run e2e            # run every spec
bun run e2e:ci         # build, then run every spec
bun run e2e -- e2e/specs/sw-update.spec.ts   # one file
bun run e2e -- -g "offline"                  # by title
bun run e2e -- --headed --workers=1          # watch it
bun run e2e -- --debug                       # step through with the inspector
bun run e2e:a11y                             # the accessibility specs only (axe, keyboard, layout, motion)
bun run e2e:a11y:update                      # rewrite the axe baseline from a run
```

A failing test keeps a trace in `test-results/e2e/`; open it with
`bunx playwright show-trace <path>/trace.zip`. In CI the `e2e` job uploads
`playwright-report/` and `test-results/` as the `e2e-report` artifact.

## Browsers

`@playwright/test` is pinned to an exact version, which pins the Chromium
build. Install it once with `bunx playwright install chromium` (CI adds
`--with-deps`). If your machine already has browsers for that version, point
`PLAYWRIGHT_BROWSERS_PATH` at them instead. `PW_CHROMIUM_EXECUTABLE` overrides
the binary outright, as an escape hatch when the two drift.

## How the harness works

- **Server** (`server/staticServer.ts`): a `node:http` server for `dist/`. One
  per worker, on a free port, so every worker has its own origin. Response
  headers (the enforced CSP included) and the SPA fallback come from
  `vercel.json` (`server/vercelRouting.ts`), so the suite runs under what
  production sends, and a deep link that would 404 on Vercel 404s here too.
  It stubs the Vercel analytics script and logs every request.
- **Down switch**: `server.setDown(true)` destroys every connection
  unanswered, as an unreachable host would.
- **Stable origin** (`support/stableOrigin.ts`): one more server, started in
  `global-setup.ts` for the whole run, on any free port (`E2E_PORT` picks
  one; anything but a port number fails the run at once). A profile is bound to the origin it was built on (its worker
  registration, IndexedDB and caches are keyed by host and port), so a profile
  built in one worker and opened in another needs an address both can reach.
  It has no down switch, since other tests share it: an offline launch is cut
  off from it in the browser instead (airplane mode, below).
- **Build variants** (`server/swVariants.ts`): `test.use({ privateServer: true })`
  gives a test its own server whose `setVariant('v2')` serves a new build (a
  new `index.html` revision and an `e2e-build` meta tag) and `'v2-broken'` one
  whose install fails. The transform throws if the build output stops
  matching its patterns, so a variant can never silently be the old build.
- **Mirror** (`fixtures/mirror.ts`): answers jsDelivr, raw GitHub and the
  GitHub tags API through `context.route`, with the release from
  `tests-fixtures/dataMirror.ts`. It counts hits per `tag:path`, and takes fail
  (`abort` or a status), hold and offline rules. A request it cannot answer
  and no test asked to fail (a URL shape the app should never build, a file
  the release does not have) gets a 404, as from a real mirror, and fails the
  test at teardown. `setTags` and `setBodies` publish a new release
  (`NEXT_TAG` and `withNextRelease` serve one with an extra species, so a page
  shows which release it reads).
- **Caster** (`fixtures/caster.ts`): the release has no caster, so a
  character file built on a stored blank character carries a homebrew
  Sorcerer and Cleric (slots, a point pool past twelve, a pool of pips).
  With `known`, the Sorcerer knows those spells; the fixture release's class
  spell index puts Fireball on the Sorcerer list, so a caster who knows it
  has a spell list to fill and a Play row that opens its rules text.
- **Network guard**: every other host is aborted and fails the test.
- **Below the routing layer** (`support/launch.ts`): some sockets never pass
  through `context.route` (a `<link rel="preconnect">`, a WebSocket, the
  browser's own background traffic). Every launch, the project's browser and
  persistent profiles alike, gets `--proxy-server=direct://` and a
  `--host-resolver-rules` that leaves only `localhost` and `127.0.0.1`
  resolvable, so a socket opened by host name cannot reach a real host or a
  proxy. Routed requests are answered before any lookup, so the mirror is
  unaffected. `harness.spec.ts` checks it with a WebSocket from both launch
  paths. Not covered: a connection to a literal IP address other than
  127.0.0.1, which needs no lookup, such as WebRTC over UDP. The app uses no
  WebRTC and names every host it talks to. Launch with
  `hermeticLaunchOptions` if you add another launch path.
- **Airplane mode** (`airplaneLaunchOptions` in `support/launch.ts`): the same
  flags without the loopback exclusions, so nothing resolves, our own servers
  included. `offline: true` alone fails the page's and the worker's fetches,
  but the browser's own update check for the worker still reaches the origin.
  `launchStable(dir, { offline: true })` (`support/coldLaunch.ts`) uses it,
  with the mirror refusing, and checks at teardown that the mirror fulfilled
  nothing and no origin response came from anywhere but the worker.
  `backOnline(launch)` ends the offline stretch (the origin stays unreachable,
  which the precache makes no difference to).
- **Console guard**: any console error or uncaught page error fails the test,
  with two exceptions. "Failed to load resource" is expected for a mirror
  request the test failed on purpose (`setFail`, or the mirror offline), and,
  only inside an offline window, for origin requests the browser or the down
  server refused. CSP violations are never allowed, so every spec also checks
  the policy.
- **Offline** is a harness state, not just a browser flag:
  `network.goOffline()` makes the mirror refuse, takes the server down and
  sets every context offline (`navigator.onLine` is what the app reads).
  `context.setOffline` alone would not stop `route.fulfill`. Then
  `network.assertNothingServedOffline()` checks, for every offline window, that
  the mirror fulfilled nothing and the server served nothing (only the worker's
  update check may have tried, and been refused).
- **Settled signals**: a check that something did not happen waits first for
  the point where it would have. `expectDataSettled` (Settings shows the
  download queue done and the compendium ready) is the usual one.
- **Persistent profiles**: `launchProfile(dir, { offline })` launches a real
  browser profile wired to the same server, mirror and guards, for cold
  restarts. `newHeadless: true` launches full Chromium (`channel: 'chromium'`)
  instead of the headless shell, which answers `Page.getInstallabilityErrors`
  with an empty list whatever the page.
- **Cache levels** (`support/cacheLevels.ts`, built by
  `specs/cache-levels.setup.ts`): one persistent profile per level of
  downloaded game data, built once per run at the stable origin, closed, and
  published in one rename. `none` is the app shell only, `essential` the
  essentials pack, `partial` everything up to the spell packs (classes and
  items, no spells or books), `full` the whole release. The mirror fails what
  a level leaves out while it is built; the drain stops at the first failure,
  so each is a real place for an install to stop. Each also holds a character
  and an editable homebrew file (`level.json` has their ids). `copyLevel`
  copies one for a cell without the browser's caches, so the precache alone
  must serve the app. A passing cell's profile is deleted at teardown; a
  failing one keeps its IndexedDB but not the worker's CacheStorage, and only
  the first three failures of a run keep one at all (counted on disk, since a
  failure replaces the worker), so a broken build cannot fill the report.
- **Overlays** (`handleOverlays` in `support/app.ts`): locator handlers dismiss
  the roster's getting-started card and wait out the "Ready to use offline"
  notice whenever either is on screen before an action or assertion, so specs
  do not depend on when they render. A spec that asserts on one of them
  removes its handler first (`page.removeLocatorHandler`).

Helpers: `support/sw.ts` (`waitForSwControl`, `triggerSwUpdate`, `swState`),
`support/idb.ts` (raw IndexedDB reads, and `putSetting` for state the UI cannot
reach in reasonable time), `support/app.ts` (roster, Settings and data-banner
flows by role and accessible name).

## Writing specs

- Import `test` and `expect` from `support/test.ts`, not from `@playwright/test`. A spec
  that launches at the stable origin imports them from `support/coldLaunch.ts`.
- Locate by role and accessible name, and keep page flows in `support/app.ts`.
- Never sleep. Use web-first assertions, `expect.poll` on IndexedDB, and
  events (`statechange`, `download`, `load`). Fake time with `page.clock`,
  installed only after the page has booted.
- The first load is never controlled by the service worker (prompt mode, no
  `clientsClaim`). Call `waitForSwControl` before anything offline.
- No retries: a flaky spec is a bug. Fix it, or mark a genuine product gap
  with `test.fixme` and a reason.

## Accessibility (`a11y/`)

The axe gate (A11Y-003). `scanState(page, 'state-id')` in `a11y/scan.ts` runs
axe (WCAG 2.x A and AA) on the page as it is and holds the result to
`a11y/axe-baseline.json`, which counts violating nodes per (state, rule):

- a rule the baseline does not list for that state, or a higher count, fails
  the test, with every offending node in the message;
- a lower count, or a rule gone, never fails: it adds a "please update the
  baseline" annotation;
- in a complete run (no grep, shard or `file:line` filter, and every axe test
  passed or was skipped), a baseline state no scan covered fails the run;
- `bun run e2e:a11y:update` rewrites the baseline from the states that passed
  (others are kept, or pruned after a complete run). Commit the diff, with the
  reason. It refuses to run with `CI` set.

`scanState` hides vaul's off-screen drag strip for the scan, or axe cannot
judge contrast inside an open drawer. Scan a state only once it is settled, or
its counts will move between runs:
`gotoRosterSettled` (data install done), `skipOfflineReadyNotice` (before the
first navigation), the overlay visible and `animationsSettled`. The reporter
(`a11y/reporter.ts`) writes `test-results/a11y-summary.md`, which CI puts in
the `e2e` job's step summary. `a11y/baseline.test.ts` (a Vitest unit test, run
by `bun run test`) covers the policy. The record of results, decisions and the
manual checklist is [`docs/a11y-audit.md`](../docs/a11y-audit.md).

## Specs

| Spec | Covers |
|---|---|
| `a11y/axe` | axe on every main route, the sheet's tabs, the dialogs, drawers and info sheets, the banners and toasts (the app update toast from the variant server), and four routes at a desktop size; see `docs/a11y-audit.md` for the list of states. |
| `a11y/keyboard` | At a desktop size: every dialog and drawer (roster actions, Rename, Delete, both import previews, dice tray, history, long rest, a breakdown, an info sheet, Add item) opened with Enter takes focus, keeps Tab and Shift+Tab inside and visits every control, closes on Escape and returns focus to its trigger; the roster, library and sheet tabs by Tab and Enter; a 150-spell library list tabbed through, each row rendered and in view, the list windowed (at most 60 rows) and each row saying its place (`aria-posinset`, `aria-setsize`). |
| `a11y/layout` | No sideways scrolling on any main route, folds open, at 320 by 640 or with a 200% root font (primary controls whole on screen); in landscape (851 by 393) the sheet header and tab bar leave the name and content in sight, and no focused control is hidden behind them, on the sheet tabs and under the app nav (a 150-spell library list walked down and back). The width checks use DejaVu Sans (and DejaVu Sans Mono), so every machine measures the same text, and fail if either is not installed. |
| `a11y/reduced-motion` | With `reducedMotion: 'reduce'`, no animation or transition runs longer than 0.01 ms while sheets open and close and a die is rolled; the same flow animates without it. |
| `a11y/target-size` | Measured boxes on a phone: the inventoried controls (HP, exhaustion and pool steppers, death saves, Build's and the creator's steppers, the back links, Homebrew's row actions) at least 44 by 44, pips 32 by 44, and every other visible control (button, link, `summary`, `role="button"`) at least 24 by 24, a roll chip in a sentence excepted; on a caster's Play tab (and at 0 HP), Build, Homebrew with one file and the creator's abilities step. |
| `library-scale` | The library with 1,000 spells (`fixtures/manySpells.ts`): at most 60 rows rendered, before and after a filter to 100; a row's estimated height equal to its rendered height at 16 px and 200%; Back from a spell 500 rows down returns to that row; a focused row and its neighbours outlast a scroll far away, and Tab and Shift+Tab go on from it. Timings are annotations, not asserted. |
| `first-load` | Fresh online boot: roster, download banner, full install of the pinned release, one release-list request, worker activated; SPA fallback for a cold deep link; the one-time "Ready to use offline" notice; the getting-started card and its dismissal; the 404 screen; the routing canary for a controlled page. |
| `offline-reload` | Reload and deep links offline from the precache and IndexedDB, nothing re-downloaded once back online; a browser restart in airplane mode. |
| `multi-tab` | One character in two pages of one context (real IndexedDB and BroadcastChannel), REL-007: both warn that it is open in another tab; a tab with nothing unsaved follows the other's save without a reload, and its own edit then lands on top (both changes stored). On a frozen clock (the context's, so the tab that saves first is flushed with a `pagehide`), a tab still holding a rename when the other saves damage is refused: its alert appears and nothing is written; Reload stored version shows the stored copy, focuses the sheet heading and puts the rename in History ("Not saved"); Keep mine saves the rename over it and the other tab follows; a character the other tab deleted is restored by Keep mine or stays deleted ("Character not found") on Discard. The same in process: `characterSession.multitab.indexeddb.test.ts`. Closing one tab clears the other's warning within `STALE_MS`, and a crashed one, which sends no goodbye, ages out. |
| `lifecycle` | Create, rename, edit, reload, delete; the save debounce on a frozen clock, and the flushes on `visibilitychange` and `pagehide`. |
| `import-export` | Export file shape (no stored `revision`), import back (through the preview), a duplicate import gets a new id, refused files change nothing and open no preview, export offline. |
| `import-preview` | IMP-002: a homebrew file is previewed (contents, size, source, a missing dependency, an official clash and its winner), Cancel writes nothing and returns focus, Import stores it, the same file again offers to keep the existing one; a character import previews as a copy and lands as one. |
| `sw-update` | Apply, defer (Later) and a failed install, each against a new build served by the variant server, with offline checks. |
| `manifest` | The manifest's content type, every icon it lists served and decoded at its declared size, opaque maskable corners, the Apple touch icon link; Chromium's own installability verdict in full Chromium (new headless, `launchProfile(dir, { newHeadless: true })`), with a no-manifest canary. |
| `cache-levels.setup` | Builds the four cache-level profiles (the `cache-levels` project). |
| `offline-routes` | PWA-001: every route, cold and offline, at every cache level (below); an airplane-mode canary (the worker's update check cannot reach the origin); the offline states recovering once back online (the sheet, the creator, a library section, the banner's download); essentials that only partly landed (no class index) reading "not downloaded yet" in Settings; online, a failed download told apart from offline, and a corrupted section repaired by "Download this section again". |
| `harness` | A socket the routes cannot see (a WebSocket to jsDelivr) fails to resolve, from the default context and from a persistent profile, so it never reaches a real host. |
| `data-install` | A first install failing mid-drain (essentials usable, the error banner, Retry fetches only what is missing); a first install interrupted by a reload (finished on the next launch under the tag pinned once); an update from Settings (the old release swept once a registry builds, the new one active after a reload); a failed update (the old release active and usable until the swap, staged rows pruned, Retry downloads everything again); an update interrupted by closing the browser (the old release boots whole, the staged rows are swept, installing again succeeds); the boot toast after the remembered release list goes stale; the rollback of a release whose registry builds keep failing to finish, with its notice. |

The rollback spec seeds the start counter (`dataTagRollback.starts`) instead of
crashing two launches for real. The normalizer is built to contain malformed
entries (it skips them or warns), so there is no known release the installer
accepts that makes the official build throw, and a build that starts and never
finishes cannot be timed from outside the page. The immediate
rollback of a build that throws stays covered by
`src/data5e/installRollback.indexeddb.test.ts`, which mocks the normalizer.

## The offline route matrix (PWA-001)

`offline-routes.spec.ts` runs in the `offline-routes` project, which depends on
`cache-levels`; the rest of the suite runs beside both. Every cell is a cold
launch: a copy of the level's profile in a new browser process, in airplane
mode. The routes and what each cell expects are in `support/routeMatrix.ts`.
Every cell lands in one of three states:

- **content**: the page itself;
- **offline**: what the page needs is not downloaded and cannot be while
  offline; it says so and offers Retry, and retries by itself once the device
  is back online;
- **not found**: there is no such thing, with a link to the nearest page.

Every cell also checks the title, the page's frame (the app nav, the sheet's
tab bar, or the focused flow's way back), that no spinner text is left, that
the route did not throw (`RouteError`), that the page is controlled by the
worker, and (below `full`) that the data banner says the device is offline,
with Retry. The download failure is said once (A11Y-002): the banner is the
only alert about it, the page's own panels are plain visuals while it alerts,
and the announcer does not say it again (every line it added during the visit
is recorded by an init script, `heardLines`, so a line said late or already
gone is still caught). With no banner to say it, a repair pressed offline at
`full`, the section panel is the one alert; online, with every mirror failing,
the banner and the section end as one alert whichever failed first. Panels
are found by their words and their Retry (`failurePanel`), not by role. The
exception is a sheet opened over the page (a cell's `open`, the spell info
sheet): the modal hides the rest of the app from assistive tech, banner
included, so inside it the sheet's own panel is the one alert, and the
checks run inside the dialog. Never a blank screen, an endless spinner or a
raw error.

| Route | none | essential | partial | full |
|---|---|---|---|---|
| `/` roster | content | content | content | content |
| `/library` | content | content | content | content |
| `/library/race` | offline | content | content | content |
| `/library/spell` | offline | offline | offline | content |
| `/library/spell/fireball%7Cphb` (entity) | offline | offline | offline | content |
| `/library/race/nope%7Cx` | offline | not found | not found | not found |
| `/library/bogus` | not found | not found | not found | not found |
| `/homebrew` | content | content | content | content |
| `/homebrew/edit/<id>` (homebrew file) | content | content | content | content |
| `/homebrew/edit/missing` | not found | not found | not found | not found |
| `/settings` | content ("not downloaded yet", Make available offline) | content ("13/19 files", Make available offline) | content ("16/19 files", Make available offline) | content ("ready ✓") |
| `/create` | offline | content | content | content |
| `/c/<id>` and its `stats`, `inventory`, `spells`, `features` tabs | offline | content | content | content |
| `/c/<id>/build` | offline | content, with the class list's offline panel | content | content |
| `/c/<caster>/spells` | offline | content: both classes, with one spell list offline panel | as essential | content: Fireball in the Sorcerer list, no panel |
| `/c/<caster>` with Fireball's sheet open | offline (no sheet) | content; in the sheet, the description's offline panel, the one alert | as essential | content; the sheet shows Fireball's facts |
| `/c/missing`, `/c/missing/spells` | not found | not found | not found | not found |
| `/nope` | not found | not found | not found | not found |

Recovery actions per state: offline, Retry (and on its own once back online:
the banner's queue, the game data panel, the class pickers, the spell list
and the library's section panel each retry on reconnect, each pinned by a
unit test that fails without it; the E2E recoveries mostly cannot tell them
apart, because the banner's resumed queue lands the same files, but the
caster's spell list at `partial` can: the queue lands Fireball, and only the
panel's own retry takes the panel away);
not downloaded while online, "This section couldn't be downloaded" with Retry;
not found, a link to the nearest page; a corrupted section, "Download this
section again".

Run it alone with `bun run e2e -- --project=offline-routes` (the levels are
built first). It is 107 tests, roughly 1.5 minutes on 3 workers.

The offline short circuit in the data source (no backoff retries while the
device reports offline, one try per endpoint) is covered by unit tests only:
an E2E check would have to time the offline panel, and a timing bound is
flaky on loaded runners.
