# ADR-002: One Workshop, building the redesign

- **Status:** Accepted, 2026-11-18, by the owner. Built in full (24 phases in six waves, the last merged 2026-11-21 as #404).
- **Full record:** <https://claude.ai/artifact/Qj9uPFtr1nDdZJcCyj12wf> (the owner's design artifact, private to them), with the file ownership list it was checked against. Its mocks are on the One Workshop canvas, <https://claude.ai/artifact/1C5EoxPmkG3QDC6UQDTm2T> (13 boards).
- **Builds on** [ADR-001](ADR-001-homebrew-workshop.md), and replaces three of its choices: the Homebrew page as the way in, the Builder, and table rules in Settings.

This file is a stub so that the code's citations ("ADR-002 D7", "ADR-002 U11") resolve inside the repository. The artifact holds the context read from the code at 6531429, where each of the canvas's bugs went, the size estimates and what was left out. The summary below is enough to read the code by.

## Decision

- **D1. One tab, and the old pages go last.** The Homebrew tab became Workshop. Its home has three shelves under one search: Yours, Collections and Rules. A collection page replaced the Builder and the file cards, one Import sheet takes a file, a link or pasted text, table rules moved to the Rules shelf, and Content sources became The books. The old pages were deleted in the last phase; `/homebrew` redirects to `/workshop`.
- **D2. Change for your table is an entry in the book entry's place.** A change is an entry with the book entry's own identity, stored as changes only (`_copy`, `_mod`, `basedOn` and a fingerprint). The registry puts it in the book entry's place, so every character holding the book entry gets it. Only the Changes to the books collection (a role the app sets on its row, never one a file can claim) and a rule pack's own list of replaced entries may replace a book entry.
- **D3. Each character has its own collection switches** (`CharacterDoc.sourceSwitches`), over the device's choice and meaning "everything except these", so a book added later still shows. With Changes to the books off for one character, that character's view of the registry (`data5e/registryView`) picks the book's version.
- **D4. A collection keeps its identity through an update.** Each stored file has a key that survives a new content hash (its link, else its first source and file name); importing a file with the same key updates that collection in place, keeping its switch, its place, its pack settings and the changes on top. A pack's Apply to and order live on the stored row, not in the file's JSON.
- **D5. Moving or renaming an entry keeps it on every sheet.** In the same transaction, a walker (`db/repoint`) rewrites every character's references and choice keys from the old identity to the new.
- **D6. Effect cards by file.** `EffectCards.tsx` was split into `workshop/cards/`, one file per group, found by file name like the editors.
- **D7. The engine reads what the editors write:** backgrounds' effects through `mechanicsOf`, moments on backgrounds and homebrew conditions, a stored form for `spellListAdd`, and an item's attack, damage, spell attack and spell DC bonuses, Strength requirement and Stealth disadvantage.

Owner answers, 2026-11-18: Changes to the books can be off for one character (so E4 was built), and a phase that measured over a bundle budget line raised that line in its own commit and said so in its PR.

## Build plan

Within a wave every file belonged to one phase; a file handed on across waves made the later phase need the earlier.

| Phase | What it built | PR |
|---|---|---|
| F1 | Fixes in pages that stayed | #371 |
| F2 | Card fixes and the "ability score is at least" card | #373 |
| E1 | Collection rows and file identity (D4) | #381 |
| E2 | Collection switches per character (D3) | #377 |
| U1 | The Workshop tab and its home | #380 |
| U3 | Effect card files and the sentence face (D6) | #384 |
| E3 | Changes to the books (D2) | #389 |
| E5 | Move and rename keep characters (D5) | #388 |
| F3 | Item editor fixes | #386 |
| U2 | The Make sheet and the editor shell | #390 |
| U4a | New cards: abilities, defenses, movement | #387 |
| E4 | Changes per character: each character's view of the registry (D3) | #393 |
| E6 | Engine reach (D7) | #396 |
| U7 | One Import sheet | #392 |
| U4b | New cards: attacks, spells, rolls, actions, words | #401 |
| U5a | Spell fields | #391 |
| U5b | Species, subrace, feat, optional feature and item fields | #395 |
| U5c | Class, subclass and background fields | #400 |
| U6 | The collection page and The books | #399 |
| U8 | Select, move, export and delete on Yours | #398 |
| U10 | Change for your table and Make one like it | #394 |
| U9 | The Rules shelf | #403 |
| U11 | The Build page's Content row and the Changed badge | #402 |
| U12 | The old pages go | #404 |

Each phase's PR body holds its hand-over: what it built, what it left out, and the sizes it measured.
