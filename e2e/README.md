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
- **Network guard**: every other host is aborted and fails the test.
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

- Import `test` and `expect` from `support/test.ts`, not from `@playwright/test`.
- Locate by role and accessible name, and keep page flows in `support/app.ts`.
- Never sleep. Use web-first assertions, `expect.poll` on IndexedDB, and
  events (`statechange`, `download`, `load`). Fake time with `page.clock`,
  installed only after the page has booted.
- The first load is never controlled by the service worker (prompt mode, no
  `clientsClaim`). Call `waitForSwControl` before anything offline.
- Settings counts the cached files once, when it mounts, so open it with
  `expectDataSettled` only after an install has finished (poll
  `countDataFiles` first), or the count it shows is stale.
- No retries: a flaky spec is a bug. Fix it, or mark a genuine product gap
  with `test.fixme` and a reason.

## Specs

| Spec | Covers |
|---|---|
| `first-load` | Fresh online boot: roster, download banner, full install of the pinned release, one release-list request, worker activated; SPA fallback for a cold deep link; the one-time "Ready to use offline" notice; the getting-started card and its dismissal; the 404 screen; the routing canary for a controlled page. |
| `offline-reload` | Reload and deep links offline from the precache and IndexedDB, nothing re-downloaded once back online; a browser restart in airplane mode. |
| `lifecycle` | Create, rename, edit, reload, delete; the save debounce on a frozen clock, and the flushes on `visibilitychange` and `pagehide`. |
| `import-export` | Export file shape, import back, a duplicate import gets a new id, refused files change nothing, export offline. |
| `sw-update` | Apply, defer (Later) and a failed install, each against a new build served by the variant server, with offline checks. |
| `manifest` | The manifest's content type, every icon it lists served and decoded at its declared size, opaque maskable corners, the Apple touch icon link; Chromium's own installability verdict in full Chromium (new headless, `launchProfile(dir, { newHeadless: true })`), with a no-manifest canary. |
| `data-install` | A first install failing mid-drain (essentials usable, the error banner, Retry fetches only what is missing); an update from Settings (the old release swept once a registry builds, the new one active after a reload); a failed update (the old release active and usable until the swap, staged rows pruned, Retry downloads everything again); an update interrupted by closing the browser (the old release boots whole, the staged rows are swept, installing again succeeds); the boot toast after the remembered release list goes stale; the rollback of a release whose registry builds keep failing to finish, with its notice. |

The rollback spec seeds the start counter (`dataTagRollback.starts`) instead of
crashing two launches for real. The normalizer is built to contain malformed
entries (it skips them or warns), so there is no known release the installer
accepts that makes the official build throw, and a build that starts and never
finishes cannot be timed from outside the page. The immediate
rollback of a build that throws stays covered by
`src/data5e/installRollback.indexeddb.test.ts`, which mocks the normalizer.
