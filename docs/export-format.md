# Character export format

A "Download" from the character list writes a single self-contained JSON file.
This documents its shape, versioning, and how import treats it. (Source of
truth: `src/lib/guards.ts`, `src/db/characterRepo.ts`,
`src/features/characters/homebrewExport.ts`.)

## Envelope

```jsonc
{
  "$format": "cast-guidance/character@1",
  "character": { /* CharacterDoc — see src/engine/types.ts */ },
  "homebrew": [
    { "fileName": "my-brew.json", "json": { /* a 5etools homebrew file */ } }
  ]
}
```

- **`$format`** — the envelope version. Import rejects anything else.
- **`character`** — the stored `CharacterDoc`: choices + play state, never derived
  results. Carries its own `schemaVersion` (currently `1`).
- **`homebrew`** — only the homebrew files the character actually depends on
  (matched by the source ids its refs use), each as a **minimal DTO**:
  `{ fileName, json }`. No local-only fields (`enabled`, `editable`, `addedAt`,
  `rev`, content-hash id) are exported.

## Versioning

- **Envelope (`@1`)** — bump the suffix only for a breaking envelope change.
- **`character.schemaVersion`** — the migration chain in `src/engine/migrate.ts`
  runs step `N → N+1` on load and import. An older version migrates forward; a
  version **newer** than this build supports is rejected with a clear message
  (never silently coerced).

## What import guarantees

Import (`characterRepo.importFromText` → `importExport`) is validated and
transactional:

1. **Size/shape limits** (`assertJsonWithinLimits`, `assertCharacterExport`,
   `assertCharacterDoc`) reject malformed, oversized, deeply-nested, or
   wrong-typed files **before any write**.
2. **Migration** rejects a future `schemaVersion`; older docs migrate.
3. **Embedded homebrew identity + metadata are recomputed from content**
   (`buildHomebrewRow`) — a file cannot forge an id to overwrite unrelated local
   homebrew, claim `editable`, or misrepresent its counts. Identical content
   (same hash) already present is skipped.
4. **Transactional commit** — the character and its homebrew are written in one
   Dexie transaction; a failure rolls back every related write.
5. **Id collision** — if the character id already exists locally, a fresh id is
   assigned (the import is a copy, never a silent overwrite).

## Compatibility policy

- Older exports (same or lower `schemaVersion`, `@1` envelope) import and
  migrate.
- Newer exports (higher `schemaVersion` or a future envelope) are rejected with
  a message telling the user to update the app — data is never partially
  applied.
- Regression fixtures for the format live alongside the guard/repo unit tests.
