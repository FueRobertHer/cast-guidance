# Import formats

The Homebrew page imports 5etools homebrew JSON, and converts files from other
apps into that same JSON as they come in. The app stores and reads only the
5etools shape, so a converted file is homebrew like any other: it can be turned
off, deleted and downloaded. (Source of truth: `src/convert/`,
`src/features/homebrew/importText.ts`, `src/features/homebrew/convertImport.ts`.)

## How a file is recognized

By its text, not its name or content type (`src/convert/sniff.ts`): text that
starts with `<` is XML, anything else is parsed as JSON. XML is dispatched on
its root element (`convertXmlText` in `src/convert/index.ts`):

| Root | What it is | Result |
| --- | --- | --- |
| `<compendium>` | Fight Club 5e compendium (also Game Master 5e, Encounter+) | Converted |
| `<source>`, `<collection>` | Fight Club collection list (names other files) | Refused, with advice |
| `<elements>` | Aurora Builder content | Refused: not yet |
| `<pc>`, `<character>`, `<characters>` | Another app's character | Refused: not yet |
| anything else | Unknown | Refused |

The XML reader (`src/convert/xml.ts`) refuses any DOCTYPE or entity
declaration, and caps size, element count and depth with the same limits as a
JSON import. It recovers from a file that is cut off or has mismatched tags,
and says so in the report, since entries near a break can be missing. A web
page (an HTML listing or a page that links to the file) is named as one.

## Fight Club 5e compendiums

| Element | Converted to | Notes |
| --- | --- | --- |
| `<spell>` | `spell` | Time, range, components, duration, classes, saves, attacks, cantrip and upcast dice |
| `<item>` | `item` | Type, weapon and armor fields, rarity, attunement, value, bonuses |
| `<feat>` | `feat` | Category, prerequisite, ability increases |
| `<background>` | `background` | 2024 trait names (`Ability Scores:`, `Feat:`, `Tool Proficiency:`) become fields |
| `<race>` | `race` | Size, speed, ability, darkvision, resistances, languages |
| `<class>` | (left out) | Not converted yet |
| `<monster>` | (left out) | The app does not use creatures |

Every converted entry keeps its full text. What the converter could not read
as rules stays in that text and is listed in the report, so the sheet never
silently drops it.

Entries the installed game data already has (same kind, name and rules
edition) are left out: the installed copy carries the app's curated mechanics.
Other apps have no subraces, so a race also matches an official subrace or
2024 lineage under the names they give it: `Dwarf, Hill`, `Dwarf (Hill)` or
`Hill Dwarf` for the Hill subrace of the Dwarf, `Elf, Drow` for the 2024 Elf's
Drow Lineage (`src/convert/official.ts`).
Spell entries that only add class lists merge into a spell the same file
defines; ones for spells elsewhere are counted in a warning.

The converted file declares one source named after the file
(`spells.xml` becomes `FCSpells`, "spells (Fight Club 5e)") and records where
it came from:

```jsonc
{
  "_meta": {
    "sources": [{ "json": "FCSpells", "abbreviation": "FCSpells", "full": "spells (Fight Club 5e)" }],
    "convertedFrom": { "format": "fc5-compendium", "converterVersion": 1, "fileName": "spells.xml" }
  },
  "spell": [ /* … */ ]
}
```

Conversion is deterministic (no timestamps), so importing the same file twice
is caught as a duplicate.

## The report

`convertXmlText` returns `{ json, report }`. The preview shows the report in a
"Converted from Fight Club 5e" section: entries converted, entries left out
(already installed, or twice in the file), file warnings, and up to ten
entries that converted only in part, with why. A file with nothing to add is
refused before the preview, with the reason.

## Checking a converter against real files

```bash
bun scripts/convert-fc5.ts path/to/file.xml --notes
```

It prints the counts, the grouped reasons and the warnings; `--out dir` writes
the converted JSON. Real files stay outside the repo.

```bash
bun scripts/convert-fc5.ts path/to/srd/*.xml --compare
```

`--compare` fetches a 5etools release (the pinned one, or `--tag`) and sets
each converted entry beside the official entry of the same kind, name and
edition, matched as the import's installed check matches them
(`src/convert/compareOfficial.ts`). A subrace is set beside it merged into
its race, as the 5etools site shows "Dwarf (Hill)". Fight Club's SRD files hold
entries 5etools has too, so this is an answer key for the converter, free and
exact. Per field it counts entries that agree, differ, are missing the field
(the official entry has it, the converted one does not: a rule left as text)
or have it extra. A list that differs is also counted by value, so one class
missing from 70 spells reads as one line.

Read alike before comparing: key order and the order of plain lists do not
count, nor does case in text with a space in it; a code or a single word keeps
its case (`V` is not `v`). A value that would agree but for the book a
reference names, or for naming none (`M` against `M|XPHB`), counts as
`source`, apart from both agreeing and differing, since the engine reads some
references with their book. Higher-level text is compared by presence only.

Not compared: fields about the printing or the 5etools site (pages, sources,
loot tables, sound, cross-links, display flags), the text itself (`entries`,
`additionalEntries`, `sizeEntry`), and a race's lore (`age`,
`heightAndWeight`). 5etools' search tags (`miscTags`, a spell's
`damageInflict` and so on) are tallied apart, since the app reads none of
them.

A difference is not always the converter's: the Fight Club SRD files have
their own errors (Flail marked simple, Divine Smite as transmutation), so check
the raw entry before changing a reader. 5etools builds specific magic items
(`Battleaxe +1`) from generic variants, which the app does not expand, so
those find no match.

```bash
bun --tsconfig-override=tsconfig.app.json scripts/fc5-sheet-compare.ts --set srd=path/to/srd/a.xml,path/to/srd/b.xml --out dir
```

`fc5-sheet-compare.ts` checks the sheet rather than the JSON. It converts each
set, gives every converted entry a source of its own so it sits beside the
official one, then swaps it into an otherwise official character at levels 1,
5, 11 and 20 and derives both characters through the engine the sheet uses. A
race, background, feat or equipped item goes on a Fighter; a class option goes
on the class or subclass whose data offers it, compared only at the levels
where either side was offered it. It tallies, field by field, where the two
sheets part: scores, saves, skills, AC, HP, speed, senses, defenses, languages,
proficiencies, attacks, spellcasting, resources, actions, features, choices and
warnings. Spells are compared as the Spells tab reads them (caption, save,
attack, rolls at each slot, class lists). Races, backgrounds, feats, items and
spells with no official counterpart are read alone, to show they work at all;
class options without one are not. The header lists the options; `--release`
and `--lookup` name files that cache the fetched data, so later runs stay
offline.
