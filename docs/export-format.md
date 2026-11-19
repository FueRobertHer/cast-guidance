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
  results. Carries its own `schemaVersion` (currently `1`). Never the stored
  row's `revision`: that is a per-write token the save check between tabs
  uses (REL-007, #98), stripped from every read, so no export carries it. One
  in an imported file (from a build that leaked it) is dropped, and the import
  gets a revision of its own.
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

## The character's source list (`allowedSources`)

`character.allowedSources` is the list of books this character's table allows,
set on its Build page. It travels inside `character`, so the envelope and
`schemaVersion` are unchanged.

- **Empty, missing, or no usable strings** means no restriction. Exports made
  before the list was editable read this way.
- **Entries that are not strings are ignored** (the guards only check that the
  field is an array), as are blank strings. A list with at least one usable
  string still restricts.
- **A non-empty list** narrows this character's pickers (classes, species,
  backgrounds, feats, optional features, spells to learn, item search) to those
  books. It replaces the importing device's own source settings for this
  character rather than combining with them, so an imported character shows its
  own table's options. The library and search keep using the device settings.
- **Ids are 5etools source ids** ("PHB", "XGE"). They are respelled to the
  dataset's casing when read, so `"phb"` works; an id the device does not know
  is kept as written and shown as "Not on this device" instead of being dropped.
- **A list is fixed.** Books added to the dataset later, and homebrew imported
  afterwards, are not on it until someone adds them.
- **It is a permission, not a dependency.** Listing a homebrew source does not
  pull that homebrew into an export; only the homebrew the character's picks
  actually use is embedded.
- **It never removes anything.** Picks already on the character from books
  outside the list stay and derive as before; the Build page names them.
- **Import never touches the importing device's source settings.**

## The character's collection switches (`sourceSwitches`)

`character.sourceSwitches` turns a collection on or off for this character,
over the device's choice. It travels inside `character` beside
`allowedSources`, so the envelope and `schemaVersion` are unchanged.

```jsonc
"sourceSwitches": { "on": ["KIB"], "off": ["MyHomebrew"] }
```

- **Missing, or both lists empty**, switches nothing: the character's pickers
  are exactly what they were without the field. Exports made before it existed
  read this way.
- **Keyed by source id**, like `allowedSources`, and cleaned the same way when
  read: respelled to the dataset's casing, blanks and non-strings ignored, ids
  this device does not know kept. A collection's switch is the switch of the
  sources its file declares (`_meta.sources[].json`), so a file with three
  books is three ids.
- **`off`** drops that source from this character's pickers, even where the
  device shows it. **`on`** shows it, even where the device's source settings
  hide it. A source on both lists reads as off.
- **Everything except these.** A source on neither list follows the device's
  settings, or the character's `allowedSources` when that list is set, so a
  book or file added later shows. The switches go over the list: an `off`
  source is hidden even when listed, an `on` one shown even when not.
- **Pickers only, as for the list.** Picks already on the character from a
  source switched off stay and derive as before; the Build page names them.
  The library and search keep using the device settings.
- **`on` cannot bring back a file switched off on this device.** A homebrew
  file the device has turned off is not loaded at all, so `on` only lifts the
  device's source settings.
- **It is a permission, not a dependency.** Switching a homebrew source on does
  not pull that homebrew into an export.
- **The guards check the shape only**: `sourceSwitches` must be an object and
  `on` and `off`, when present, arrays. Anything inside them is read
  tolerantly, as above.

## Compatibility policy

- Older exports (same or lower `schemaVersion`, `@1` envelope) import and
  migrate.
- Newer exports (higher `schemaVersion` or a future envelope) are rejected with
  a message telling the user to update the app — data is never partially
  applied.
- Regression fixtures for the format live alongside the guard/repo unit tests.
