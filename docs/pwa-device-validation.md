# PWA device validation

The record for the device half of PWA-002
([#107](https://github.com/FueRobertHer/cast-guidance/issues/107)). The icons,
the manifest and Chromium's installability verdict are automated
(`scripts/pwaManifest.test.ts`, `e2e/specs/manifest.spec.ts`), and so are
offline reload and service-worker updates in desktop Chromium
(`e2e/specs/offline-reload.spec.ts`, `e2e/specs/sw-update.spec.ts`). None of
that proves what a phone does: iOS Safari has its own install flow, its own
storage rules and no install prompt, and Android installs a WebAPK whose icon
is masked by the launcher. #107 stays open until every row below has a pass
on both platforms.

## Targets

| Platform | Browser | Minimum |
|---|---|---|
| iOS / iPadOS | Safari (Home Screen web app) | iOS 17, and the current major |
| Android | Chrome (WebAPK) | Android 12, Chrome stable |

Record each run in the [results table](#results). One row per check per
device; a failed check gets a GitHub issue linked from its row.

## Setting up a test deployment

Service-worker updates only happen within one origin, and every Vercel
deployment gets its own URL. Use a branch alias, which always points at the
newest deployment of its branch:

1. **Turn off Deployment Protection for the run.** Vercel protects preview
   deployments by default, and the browser fetches the manifest without
   credentials, so even a bypass cookie never reaches it: the manifest gets a
   401 and Android will not offer to install. In
   the project's Settings, Deployment Protection, disable Vercel
   Authentication (and any password protection) while the run lasts, and turn
   it back on afterwards.
2. Create a branch such as `pwa-device-check` from `main` and push it. Its
   alias is `cast-guidance-git-pwa-device-check-<team>.vercel.app` (shown on
   the deployment page). Every step below uses that URL.
3. **Build A** is that first push. Install from it.
4. **Builds B and C** (for the update checks): two more pushes, each changing
   something visible, such as the Settings heading to `Settings (B)` and then
   `Settings (C)`, so you can tell which build is running. Push each one only
   when its step says so.
5. **Build D, broken** (for the failed update): a build whose new service
   worker cannot install. Override the Vercel build command for the branch to
   `bun run build && rm dist/assets/LibraryPage-*.js` and push. `sw.js` still
   lists that chunk, and because `vercel.json` rewrites every path outside
   `assets/` to `index.html`, only a file under `assets/` really answers 404;
   the precache request fails and the new worker goes redundant, as the
   `v2-broken` E2E variant does. (Deleting `favicon.svg`, say, would not break
   anything: the rewrite answers it with `index.html` and a 200.)
6. **Build E, fixed** (for recovery): restore the normal build command and
   push again with another visible change (`Settings (E)`).

Delete the branch and restore Deployment Protection when the run is done.

The app checks for a new version only when it loads: there is no periodic
`registration.update()`, so bringing an open app back to the foreground shows
nothing new. Every update step below therefore kills the app (swipe it away)
and relaunches it from its icon, online. A standalone app also has no reload
control (and pull to refresh is off), so a relaunch is the only reload.

## Checklist

Do the steps in order on each device; later steps rely on the state the
earlier ones leave.

### 1. Install

- [ ] **Android**: open the alias in Chrome, wait for the roster and the
      "Ready to use offline" notice, then use the install prompt or menu,
      Install app. The installed app appears in the launcher and app drawer.
- [ ] **iOS**: open the alias in Safari, wait for the roster, then Share, Add
      to Home Screen. The suggested name is "Cast Guidance".

### 2. Icon and launch

- [ ] **Android**: the launcher icon is the hexagon on the dark background,
      filling the launcher's shape (circle, squircle or teardrop) with no white
      plate and nothing clipped. Try two launcher shapes if the device allows.
- [ ] **iOS**: the Home Screen icon is the 180 px touch icon, not a page
      screenshot, with iOS's own rounded corners and no black edges.
- [ ] Launching from the icon opens standalone: no browser address bar, the
      status bar in the dark theme colour, the splash (Android) on the dark
      background.

### 3. Offline reload

- [ ] Open the app online once more and let Settings show "Offline
      compendium: ready ✓".
- [ ] Kill the app, turn on airplane mode, launch from the icon. The roster
      opens.
- [ ] Still offline, open a character sheet, the Library (a list and an entry)
      and Settings. Each renders from the cache, with offline wording rather
      than a spinner or an error screen.
- [ ] Create a character offline, kill the app, relaunch offline. It is
      still there.

### 4. Deferred update

- [ ] Deploy build B. Online, kill and relaunch the app.
- [ ] "A new version of the app is ready." appears. Tap **Later**. The toast
      goes, and the app keeps working on build A as you move between screens
      (Settings heading unchanged, no prompt).
- [ ] Kill and relaunch online. With no window left on build A, the waiting
      worker takes over on its own: the app opens on build B (`Settings (B)`)
      without a prompt, characters and data intact. If it opens on build A
      with the prompt again instead (iOS may keep a standalone app's process
      alive), note it in the row and tap **Update**.

### 5. Apply update

- [ ] Deploy build C. Online, kill and relaunch the app. The prompt appears.
- [ ] Tap **Update**. The app reloads once into build C (`Settings (C)`).
- [ ] Characters and game data are intact, and nothing downloads again
      (Settings shows "ready ✓" at once).
- [ ] Kill, airplane mode, relaunch: build C opens offline.

### 6. Failed update

- [ ] Deploy build D (broken). Online, kill and relaunch the app a few times.
- [ ] No update prompt appears, and the app keeps running build C, online and
      offline. A failed install must never leave a half-updated app.

### 7. Recovery

- [ ] Deploy build E (fixed). Online, kill and relaunch the app.
- [ ] The update prompt appears. Tap **Update**: the app reloads into build E
      (`Settings (E)`), characters and data intact.
- [ ] Kill, airplane mode, relaunch: build E opens offline.

### 8. Storage

- [ ] Note Settings' "Browser storage" figures, and whether the app was
      granted persistent storage, in the row's notes.
- [ ] **iOS**: Safari may evict the storage of a web app that has not been
      opened for weeks. Note the device's iOS version and whether Low Power
      Mode or low storage was in play for any lost data.
- [ ] **Android**: after a few days without opening the app, launch offline
      and confirm characters and the compendium survived.

## Results

Result is pass, fail (with an issue link) or n/a (with a reason).

| Date | Tester | Device | OS | Browser | Check | Result | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | 1. Install | | |
| | | | | | 2. Icon and launch | | |
| | | | | | 3. Offline reload | | |
| | | | | | 4. Deferred update | | |
| | | | | | 5. Apply update | | |
| | | | | | 6. Failed update | | |
| | | | | | 7. Recovery | | |
| | | | | | 8. Storage | | |

## Changing the icons

The PNGs in `public/icons/` are generated from `public/favicon.svg`. After
editing the SVG, run `bun run icons:generate` and commit the new files along
with `scripts/icons-source.json`, the hash of the SVG they came from;
`bun run test` fails while the SVG and that hash disagree. The SVG draws its
glyphs as paths, so the output does not depend on installed fonts, and the
script refuses an SVG with `<text>`, `<tspan>`, `<textPath>` or
`<foreignObject>` in it. Rendering on another machine or Chromium build can
still move a few anti-aliased pixels, which is why the PNGs are committed
rather than built. Then rerun the icon checks above on at least one device per
platform.
