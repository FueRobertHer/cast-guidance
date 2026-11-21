# ADR-002: One Workshop, building the redesign

- **Status:** Accepted, 2026-11-18, by the owner. Built in full (24 phases in six waves, the last merged 2026-11-21 as #404).
- **Full record:** <https://claude.ai/artifact/Qj9uPFtr1nDdZJcCyj12wf> (the owner's design artifact, private to them), with the file ownership list it was checked against. Its mocks are on the One Workshop canvas, <https://claude.ai/artifact/1C5EoxPmkG3QDC6UQDTm2T>.
- **Builds on** [ADR-001](ADR-001-homebrew-workshop.md), and replaces three of its choices: the Homebrew page as the way in, the Builder, and table rules in Settings.

This file is a stub so that the code's citations ("ADR-002 D7", "ADR-002 U11") resolve inside the repository. The artifact holds the context read from the code at 6531429, where each of the canvas's bugs went, the size estimates and what was left out. The summary below is enough to read the code by.

## Decision

- **D1. One tab, and the old pages go last.** The Homebrew tab became Workshop. Its home has three shelves under one search: Yours, Collections and Rules. A collection page replaced the Builder and the file cards, one Import sheet takes a file, a link or pasted text, table rules moved to the Rules shelf, and Content sources became The books. The old pages were deleted in the last phase; an old `/homebrew/edit/<id>` address opens that collection's page, and anything else under `/homebrew` the Collections shelf (`app/OldAddress.tsx`).
- **D2. Change for your table is an entry in the book entry's place.** A change is an entry with the book entry's own identity, stored as changes only (`_copy`, `_mod`, `basedOn` and a fingerprint). The registry puts it in the book entry's place, so every character holding the book entry gets it. Only the Changes to the books collection (a role the app sets on its row, never one a file can claim) and a rule pack's own list of replaced entries may replace a book entry.
- **D3. Each character has its own collection switches** (`CharacterDoc.sourceSwitches`), over the device's choice and meaning "everything except these", so a book added later still shows. With Changes to the books off for one character, that character's view of the registry (`data5e/registryView`) picks the book's version.
- **D4. A collection keeps its identity through an update.** Each stored file has a key that survives a new content hash (its link, else its first source and file name); importing a file with the same key updates that collection in place, keeping its switch, its place, its pack settings and the changes on top. A pack's Apply to and order live on the stored row, not in the file's JSON.
- **D5. Moving or renaming an entry keeps it on every sheet.** In the same transaction, a walker (`db/repoint`) rewrites every character's references and choice keys from the old identity to the new.
- **D6. Effect cards by file.** `EffectCards.tsx` was split into `workshop/cards/`, one file per group, found by file name like the editors.
- **D7. The engine reads what the editors write:** backgrounds' effects through `mechanicsOf`, moments on backgrounds and homebrew conditions, a stored form for `spellListAdd`, and an item's attack, damage, spell attack and spell DC bonuses, Strength requirement and Stealth disadvantage.

## Questions, answered 2026-11-18

- **Question 1:** can Changes to the books be off for one character? Yes, so E4 was built.
- **Question 2:** how do budget raises work? A phase that measured over a bundle budget line raised that one line to about 20% over its measurement, in its own commit, and said so in its PR. (On 2026-11-21 the owner set a new rule for later PRs: measured size plus 10%.)

## Canvas boards

Code cites the canvas by board number: Main (five places become one tab), Fixes (the bugs below), 1 Home, 2 Make, 3 Editor, 4 Effects (every effect kind and its card), 5 Types (fields no editor showed), 6 Change for your table (C picked), 7 Import, 8 Collections, 9 Manage (select, move, export, delete), 10 Rules (B picked), 11 Character (the Build page's Content row).

## Bugs from the Fixes board

"Bug N" and "suspected bug N" in the code are this board's numbers, and the phase that took each.

| Bug | | Phase |
|---|---|---|
| 1 | The Builder said classes must be imported as JSON | U12 |
| 2 | "Open in the Workshop" landed on the Workshop home | U12, tested in U6 |
| 3 | Cancelling the second question still made the collection | F1 |
| 4 | The Builder's view link looked in the wrong place | U12, tested in U6 |
| 5 | The Library offered Edit on book entries it cannot edit | F1 |
| 6 | The Builder deleted with no confirm and no undo | F1 |
| 7 | No card wrote one bonus for every attack | F2 |
| 8 | Tapping a species size dropped the big ones | F1 |
| 9 | (struck: the Workshop home's add buttons are named) | F1 |
| 10 | The item editor's Name box had no label | F3 |
| 11 | The homebrew file row cut off at phone width | U12, tested in U6 |
| 12 | "source: MyHomebrew" was shown to players | U12 |
| 13 | Turning off "Also does what" kept the old changes | F3 |
| 14 | The Saving throws card could not pick saves | F2 |

| Suspected | | Phase |
|---|---|---|
| 1 | A spell's target effects offered kinds play refuses | U5a |
| 2 | An equipped homebrew potion counted all the time | E6 |
| 3 | Card selects might misread values outside their list | F2 |
| 4 | One bare spell name broke an item's charges | F3 |
| 5 | Yours rows forgot which file an entry is in | F1 |
| 6 | A class's Start from dropped the file | F1 |
| 7 | A broken Workshop link showed a bare Not found | F1 |
| 8 | Two collections named HB were ambiguous | E1 |
| 9 | A changed file landed beside the old one | E1 |
| 10 | Pack review wrote into imported files | E1 |
| 11 | The condition editor offered Hit points | F2 |
| 12 | A line in the future work notes was out of date | F1 |

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
