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
| `<spell>` | `spell` | Time, range (a 2024 cone or emanation as 5etools writes it), components, duration, classes, saves, attacks, damage dice, cantrip and upcast dice (from `<roll>`s, run to 9th level unless the text names a cap such as "maximum 6d10", or from text such as "increases by 1d6 for each slot level above 1st") |
| `<item>` | `item` | Type, weapon and armor fields (every staff a quarterstaff, as both Dungeon Master's Guides say), rarity, attunement, value, bonuses (and a bonus to AC or to attack and damage rolls its text states for good, when no `<modifier>` gives one), speed, the resistances and immunities its text states while you wear or are attuned to it |
| `<feat>` | `feat` | Category, prerequisite, ability increases, proficiencies and the picks its text offers (skills, tools, languages, weapons, Skilled's skills or tools, expertise), resistances its text states or offers, spells it grants |
| `<background>` | `background` | `<tools>` and `<languages>`; 2024 trait names (`Ability Scores:`, `Feat:`, `Tool Proficiency:`) become fields; skill and tool lines that pick from a list; a feat of a category picked (`A Dark Gift feat of your choice`); spells it grants, and a guild or college table of spells added to a class's list |
| `<race>` | `race` | Size, speed (the tags, and a trait's "you have a swimming speed of 30 feet" in any sentence, unless the trait sets terms on it, passes or is an option), ability, darkvision, resistances and condition immunities (tags and text), a resistance picked from a list or the ancestry table, languages, proficiencies and the picks any trait sentence offers, spells it grants |
| `<class>` | `class`, `classFeature`, `subclass`, `subclassFeature` | Hit die, saving throws, skills to pick, armor, weapons (martial ones of a property as a filter), tools, starting gold, every fixed feature by level as a `classFeature` with an Ability Score Improvement at each `scoreImprovement` level, spellcasting, and subclasses (see below). Options and counters are not converted yet; a `<class>` with no `<hd>` adds its subclasses to a class of that name |
| `<monster>` | (left out) | The app does not use creatures |

On items, feats, race traits and background traits, a labeled `<roll>` the
text never shows as dice becomes a line of roll tags at the end, so the sheet
can roll it.

Fight Club has no field for the spells a race, feat or background grants, so
they are read from its text into 5etools `additionalSpells`
(`src/convert/fc5/spellGrants.ts`): a named spell or cantrip (`You know the
thaumaturgy cantrip`, or `can cast jump` when the file or the installed data
has a spell of that name), one of a list, the level a trait gates it at, how
often it is cast without a slot (at will, per short or long rest, a number of
times equal to the proficiency bonus), a pick by level, class list, school or
ritual tag, the spellcasting ability, a lineage's table of spells by
character level (`Level 3 | Command`), and a table of spells by spell level
added to a class's list. A table of options (the 2024 Elf's lineages) grants
nothing on its own. "Always prepared" is `prepared` on a feat or background and
`innate` on a race, as the data writes each. Magic Initiate's "the same list"
becomes a block per class. A pick a table decides (Strixhaven Initiate), a
list another feat chose (Magic Connoisseur), a swap or a fallback is not read,
and the report says so. A background's `Feat:` trait is the feat's text, so its
spells come from the feat.

A class's spellcasting comes from its own `<slots>` rows (not the optional
ones, which are a subclass's): the caster progression they follow (full, half
rounding up or down, third, or pact magic for the warlock's own table when
slots reset on a short rest), its cantrips by level, and the rows themselves
as a spell slot table, so a table no progression explains still gives the
sheet its slots; the report says how it counts with another class, and that
other slots coming back on a short rest are kept as text. How many spells it knows or prepares
is read from its spellcasting feature: a `Spells Known` or `Spells Prepared`
column in a table anywhere in the class, a formula ("your Wisdom modifier +
your cleric level"), a spellbook ("a spellbook containing six 1st-level
wizard spells", two more each level), or a 2014 count in words ("You know
four 1st-level spells", one more "at each level except 12th, 16th"). A spell
whose `<classes>` names a class the file converts (`Witch (Valda)`, by its
whole name) is on that class's list; one the rules have by that name
(`Wizard`) stays the rules' class. Valda's auxiliary levels, one-level
classes taken in place of a class level, convert as classes, and the report
says nothing stops a second level.

A class's subclasses are its choices (`optional="YES"`) named `Label: Name`
(`Martial Archetype: Champion`, `Fighter Subclass: Champion`) where more
than half the choices of that label have features ending in the name
(`Improved Critical (Champion)`, `Level 3: Protector (Bogatyr (HB) [5.5e])`),
or in its last words where the class has a feature named for the label
(`(Ghostslayer)` for `Blood Hunter Order: Order of the Ghostslayer`). Each
becomes a `subclass` whose first feature, at the level it is picked, is the
pick's own text, then one `subclassFeature` per feature. Two picks of one
name whose `Source:` lines cite two books are two subclasses, each with the
features that cite its book; one left with no features of its own is a repeat
of the other. The label is the class's `subclassTitle`, and
the class's feature of that name (or one added where no such feature exists)
opens the choice on the sheet. A subclass is placed by its own `Source:`
line, else by the first of its features that has one, else by the class's
place, in the edition its pick's name marks. Two choices of one label at one
level within a subclass (`Fighting Style: Dueling (College of Swords)`) are
options, except a Channel Divinity (or another `Channel` label), which a
subclass gains all of unless its name still names a group to choose by
(`Channel Arcana: Guided Strike (War Domain)`). A subclass with a spellcasting feature (named for
spellcasting or pact magic, or one ending in `Magic` or `casting` that names
a spellcasting ability) casts by the class's optional slot rows, as the
Eldritch Knight does, and they come back on a short rest when the class's
do. A subclass goes on its class when the class is kept, and on the
installed class when the class is left out as installed (the game data's
own book for that class), so a file of official classes still adds its
homebrew subclasses to them; a subclass the installed data has on that
class is left out like any entry. A `<class>` with no `<hd>` adds its
subclasses to the class of its name in the file, wherever that is, else to
the installed or rules class of that name; what else it holds is listed in
the report. Counters named for a subclass are reported on it.

Every converted entry keeps its full text. What the converter could not read
as rules stays in that text and is listed in the report, so the sheet never
silently drops it.

A choice the text states becomes the pick the official data writes: a skill,
tool, language or weapon "of your choice" or from "the following", in any
sentence of a race trait or a feat ("You therefore have proficiency in one of
the following skills of your choice: …") but an option among others, a table
row, or one after a sentence that sets terms ("Choose one of the following
legacy options"), a resistance from a list or from a
Dragonborn's ancestry table, Skilled's "any combination of three skills or
tools", expertise in a skill already proficient, and a background's
"History, plus your choice of one from among …" line. Where a tag holds
Fight Club's own pick beside such a choice (`<proficiency>History,
Arcana</proficiency>`, a `<resist>` type, a race's `<languages>` without the
trait's "one extra language of your choice"), the choice is read instead; a
skill only the tag names is Fight Club's pick of "one skill of your choice"
when there are no more of them than the text lets you pick. A grant that
hangs on a condition or a time ("Whenever you finish a long rest, you gain
proficiency …", "As a bonus action, you gain") stays text: only the books'
own lead-ins ("Thanks to your memory, you have", "As a forest gnome, you
have") are read past.

Entries the installed game data already has (same kind, name and rules
edition) are left out: the installed copy carries the app's curated mechanics.
Other apps have no subraces, so a race also matches an official subrace or
2024 lineage under the names they give it: `Dwarf, Hill`, `Dwarf (Hill)` or
`Hill Dwarf` for the Hill subrace of the Dwarf, `Elf, Drow` for the 2024 Elf's
Drow Lineage (`src/convert/official.ts`).
Spell entries that only add class lists merge into a spell the same file
defines; ones for spells elsewhere are counted in a warning.

An entry kept from a book the app knows names the official entry it prints
in `printingOf` (`["Lucky|PHB"]`), the way a 5etools class names the class it
reskins in `reskinOf`. When the installed data lacks that book, or the app
has no official data at all, the curated mechanics, spend links and prose
picks written for the official entry reach the copy through it
(`tableUids` in `src/engine/effects/reskin.ts`). An entry from a free rules
text names the book that text takes it from, by the edition its name marks,
else the text's: `PHB` or `XPHB`, `DMG` or `XDMG` for a magic item. An entry
whose name marks another edition than its book's (`Lucky [5.5e]` from the
2014 Player's Handbook) names none, where the book's edition is known: a core
book's always is, a later book's (Heroes of Faerûn) only once official data
is installed, so without it the book is named whatever the mark.
The name is Fight Club's, except where `officialName` (`renames.ts`) undoes
a known rewording: `Fist of Unbroken Air` is `Unbroken Air`, and an
infusion's `(Level 10)` is Fight Club's addition. When a kept class names
an official one, each of its features names the official feature of its
name too (`["Second Wind|PHB"]`); an installed class is left out with its
features.

The converted file declares one source named after the file
(`spells.xml` becomes `FCSpells`, "spells (Fight Club 5e)") and records where
it came from:

```jsonc
{
  "_meta": {
    "sources": [{ "json": "FCSpells", "abbreviation": "FCSpells", "full": "spells (Fight Club 5e)" }],
    "convertedFrom": { "format": "fc5-compendium", "converterVersion": 12, "fileName": "spells.xml" }
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
