# Cast Guidance

Mobile-first D&D 5e character creator and play sheet. Local-first PWA: pick race, class,
background, feats, and equipment, and the sheet derives everything — proficiencies, AC, HP,
initiative, attacks, spell slots — with manual overrides on top. Tracks a live session
(HP, conditions, slots, resources), rolls dice, and supports 5etools-format homebrew
(import, share, and an in-app builder).

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind CSS 4 · react-router · Zustand · Dexie
(IndexedDB) · MiniSearch · vite-plugin-pwa · Vitest · Biome · Bun (package manager)

## Development

Requires Bun (pinned via `.bun-version` / `packageManager`).

```bash
bun install
bun run dev            # dev server
bun run test           # unit + integration tests (engine, dice, data, repos, components)
bun run test:coverage  # tests with a V8 coverage report
bun run lint           # biome check (src, scripts, tests-fixtures)
bun run typecheck      # tsc -b
bun run build          # production / PWA build
bun run check          # lint + typecheck + test (the full offline gate)
bun run data:audit     # download the pinned dataset and audit normalization (network-gated)
```

Tests run on Vitest with `fake-indexeddb` (persistence) and jsdom +
`@testing-library/react` (components). CI (`.github/workflows/ci.yml`) runs the
frozen install, lint, typecheck, tests, and build on every push and PR.

## Game data & copyright

**This repository contains no D&D game content.** The app downloads the 5etools dataset at
runtime from a pinned release tag of the community mirror (via CDN) and caches it in the
browser's IndexedDB, entirely on the user's device. Test fixtures are synthetic entities
that only mimic the JSON schema. Homebrew files use the standard 5etools homebrew format.

## Architecture (short version)

- `src/engine/` — pure derivation: `(CharacterDoc, EngineContext) -> DerivedSheet`. No React.
- `src/data5e/` — data download/cache, `_copy`/`_mod` resolution, entity registry,
  rules-version (2014/2024) filtering, `{@tag}` entry rendering.
- `src/dice/` — pure dice expression parser + roller.
- `src/db/` — Dexie tables behind repo interfaces (cloud sync can slot in later).
- `src/features/` — UI: character list, creator wizard, sheet tabs, library, homebrew, settings.

Characters store **choices + play state, never derived results**; every derived number is
recomputed on read and individually overridable.

## Docs

- [`docs/export-format.md`](docs/export-format.md) — the character export envelope, homebrew DTO, and import/migration guarantees.
- [`docs/security-headers.md`](docs/security-headers.md) — deployment security headers and the report-only → enforced CSP path.
- [`FUTURE_WORK.md`](FUTURE_WORK.md) — the open product and engineering backlog.
