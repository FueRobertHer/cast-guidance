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

```bash
bun install
bun run dev        # dev server
bun run test       # unit tests (engine, dice, data layer)
bun run lint       # biome check
bun run typecheck  # tsc -b
bun run build      # production build
```

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
