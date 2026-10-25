# Cast Guidance

Mobile-first D&D 5e character creator and play sheet. Local-first PWA: pick race, class,
background, feats, and equipment, and the sheet derives everything (proficiencies, AC, HP,
initiative, attacks, spell slots) with manual overrides on top. Tracks a live session
(HP, conditions, slots, resources), rolls dice, and supports 5etools-format homebrew
(import, share, and an in-app builder).

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS 4 · react-router · Zustand · Dexie
(IndexedDB) · MiniSearch · vite-plugin-pwa · Vitest · Playwright · Biome · Bun (package manager)

## Development

Requires Bun. No version is pinned, so install a current release.

```bash
bun install
bun run dev            # dev server
bun run test           # unit + integration tests (engine, dice, data, repos, components)
bun run test:coverage  # tests with a V8 coverage report
bun run lint           # biome check (src, scripts, tests-fixtures, e2e)
bun run typecheck      # tsc -b
bun run build          # production / PWA build
bun run check          # lint + typecheck + test (the fast offline gate)
bun run ci             # what CI runs: lint, typecheck, coverage gate, build, bundle budget, notices check
bun run bundle:budget  # check dist/ against scripts/bundle-budget.json (after a build)
bun run notices        # regenerate THIRD_PARTY_NOTICES.md from dist/ (after a build)
bun run notices:check  # fail when THIRD_PARTY_NOTICES.md is out of date (after a build)
bun run data:audit     # audit the pinned dataset against scripts/data-audit-budget.json (network-gated)
bun run e2e            # browser E2E against dist/ (build first)
bun run e2e:ci         # build, then browser E2E
bun run icons:generate # render public/icons/*.png from public/favicon.svg (commit the output)
```

The data audit downloads the real pinned release, runs it through the app's
own normalization, and fails when a count leaves its budget: entities, parser
warnings, unresolved `_copy` targets, spell rolls the dice engine refuses,
`{@tag}`s the renderer does not draw, or a multi-name `additionalSpells` block
nobody has confirmed is a choice. `--tag <tag|latest>` audits another release,
`--write-budget` writes that release's budget entry, `--json <path>` saves the
report, and `--report-only` never exits 1. `.github/workflows/data-audit.yml`
runs it weekly (pinned tag and newest release) and on PRs that touch the data
pipeline. A `DATA_TAG` bump needs a budget entry, or `bun run test` fails.

Tests run on Vitest with `fake-indexeddb` (persistence) and jsdom +
`@testing-library/react` (components). CI (`.github/workflows/ci.yml`) runs the
frozen install, lint, typecheck, tests with coverage floors, the build, a bundle
budget, and the third-party notices check on every push and PR, and fails
when coverage drops below the floors in `vite.config.ts`, the build outgrows
`scripts/bundle-budget.json`, or `THIRD_PARTY_NOTICES.md` no longer matches
what the build ships.

### Browser E2E

`e2e/` holds Playwright specs that run the production build in Chromium, as a
phone, with the service worker on and every network host mocked: first load,
offline reload and cold offline restart, service-worker updates (apply, defer,
failed install), the character lifecycle and its save flushes, import and
export, and data installs (failed, interrupted and retried, updates and their
rollback). The server copies `vercel.json`'s headers and rewrites, so the suite
runs under the enforced CSP, and any console error or CSP violation fails a
test. CI runs it as the separate `e2e` job. Install the pinned browser once
with `bunx playwright install chromium`; see [`e2e/README.md`](e2e/README.md)
for how the harness works, debugging, and writing specs.

## Game data & copyright

**This repository contains no compendium.** On a fresh install the app downloads the
5etools dataset at runtime from the community mirror (via CDN): the newest release
compatible with the build, with the build's `DATA_TAG` as the fallback. It
caches the data in the browser's IndexedDB, entirely on the user's device. Test fixtures
are synthetic entities that only mimic the JSON schema. Homebrew files use the standard
5etools homebrew format.

Two small pieces of game-related material do ship with the app: the book titles behind
the source badges (`src/data5e/sourceNames.ts`) and a few dozen hand-coded feature
mechanics (`src/engine/curated/curatedEffects.ts`). The mirror itself republishes book
text beyond the SRD. How all of this sits with Wizards of the Coast's policies is still
under review; [`docs/content-notice.md`](docs/content-notice.md) is the draft notice,
with the options and the open questions.

Draft wording, pending the owner's approval (see the checklist in the content notice):
Cast Guidance is unofficial and is not affiliated with or endorsed by Wizards of the
Coast. Dungeons & Dragons and D&D are trademarks of Wizards of the Coast LLC.

## License

Cast Guidance's own code is released under the [MIT License](LICENSE). The license
covers the original code only: not the book titles, names, terms or rules text in
`sourceNames.ts` and `curatedEffects.ts`, not the game data the app downloads, and not
any trademark.

The production build bundles open source packages under their own licenses, listed with
their full texts in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). That file is
generated from what the build actually ships (app bundle, search worker, service worker
and stylesheet). After a dependency change, regenerate it with
`bun run build && bun run notices`; `bun run notices:check` (part of `bun run ci` and
CI) fails when it is out of date, when a shipped package has no license text, or when a
license is outside the allowlist in `scripts/thirdPartyNotices.ts`.

## Architecture (short version)

- `src/engine/`: pure derivation, `(CharacterDoc, EngineContext) -> DerivedSheet`. No React.
- `src/data5e/`: data download/cache, `_copy`/`_mod` resolution, entity registry,
  rules-version (2014/2024) filtering, `{@tag}` entry rendering.
- `src/dice/`: pure dice expression parser + roller.
- `src/db/`: Dexie tables behind repo interfaces (cloud sync can slot in later).
- `src/features/`: UI for the character list, creator wizard, sheet tabs, library, homebrew, and settings.

Characters store **choices + play state, never derived results**; every derived number is
recomputed on read and individually overridable.

## Docs

- [`docs/export-format.md`](docs/export-format.md): the character export envelope, homebrew DTO, and import/migration guarantees.
- [`docs/security-headers.md`](docs/security-headers.md): deployment security headers, the enforced CSP, and how to add a host.
- [`docs/content-notice.md`](docs/content-notice.md): DRAFT content and attribution notice for the owner's legal review: where game data comes from, what ships, and the options.
- [`FUTURE_WORK.md`](FUTURE_WORK.md): the product principle, the measured
  baseline, the delivery order, and the P2/P3 themes. Release-quality (P1) work
  is tracked as [GitHub issues](https://github.com/FueRobertHer/cast-guidance/issues?q=is%3Aissue+is%3Aopen+label%3AP1);
  the doc indexes them.
