# Built-in rule sets

A built-in rule set is data the app ships in place of code: rows of effects
that hold what were the engine's hard-coded mechanics tables, and the tables
these parts replaced are gone (the rule pack port, below). It holds eight parts: `curated`, which holds
what was `CURATED`; `standing`, which holds what was `STANDING`;
`rollAdvantage`, which holds what was the advantage table, `ROLL_ADVANTAGES`;
`rollExtra`, which holds what was `ROLL_EXTRAS`; `spend`, which holds what
were the spend links, `SPEND_LINKS` and `SLOT_LINKS` (`linkSpend` in
`src/engine/curated/spendLinks.ts` reads it); `wornTags`, which holds what
was `ITEM_TAG_FIXES` (`src/rules/cast-guidance/items.json`, read in
`src/engine/effects/item.ts`); `charges`, which holds what was
`ITEM_CHARGES` (the same file, read in `item.ts`, the cast prompt and the
long rest through `src/engine/curated/itemCharges.ts`); and `spellRest`,
which holds what was `SHORT_REST_SPELLS`
(`src/rules/cast-guidance/spell-rests.json`, read where
`src/engine/effects/additionalSpells.ts` grants a spell pool). The files live in
`src/rules/`, one a part, but for the two item parts, which share one. (Source of truth: `readRuleSet` and `mechanicsOf` in
`src/engine/effects/mechanics.ts`, `src/data5e/builtInRules.ts`.)

218 rows have moved (`src/rules/cast-guidance/curated.json`), every `CURATED` row. Four came
first, one for each kind of call site, to prove the routes: Stunning Strike (a
class feature), Lucky (PHB, a feat), Disarming Attack (PHB, an optional
feature) and Warforged's Integrated Protection (a species trait). The other 111
are every `CURATED` row the stored format held before 2b: fighting styles, feats,
standing numbers (speeds, saves, scores, immunities), riders on every hit or
cast, pools and actions, and subclass features. Nine of them needed a term the
format gained for them (rule pack port 2a): a pool's `die` (Martial Adept and
Superior Technique's d6), Metamagic Adept's `noSlotConversion`, the initiative
bonus `"profBonus": true` (2024 Alert, Hare-Trigger), which counts once however
many features add it, and an AC formula with no `label`, which is named for
what gives it, so a renamed copy shows its own name (Unarmored Defense for the
College of Dance, Draconic Resilience, Immortal Durability). Eighteen more are
the two printings of nine class and subclass features that differ between 2014
and 2024 (rule pack port 2b), each under a key that names its printing
(`roving|ranger|xphb`) beside the key alone, which every other printing reads.
A printing that adds nothing has a row with no effects, which still turns the
prose scan off (Roving in any book but the 2024 one, and 2014 Feral Senses, 2024
Remarkable Athlete). Tasha's Roving is no feature of that name; its row is a
`standing` one, below.
Thirteen more need the level of the class that gives them, in a level table or
`classLevel` (rule pack port 2c): Unarmored Movement, Action Surge, Ki, Monk's
Focus, Font of Magic, both Indomitables, Soul Fragments, Portent, and Rage and
Wild Shape by printing. Two more, under eleven keys, add an ability modifier to
the damage of the spells of the class that gives them, `"ownClass": true` (rule
pack port 2d): Potent Spellcasting (the 2024 Cleric and Druid, seven 2014
domains) and Empowered Evocation in both printings. Nine more, eight with a level
table of words, give a pool's or an action's words by the level of the class
that gives them (rule pack port 2e): Combat Superiority's die and its name,
Psionic Power's in both printings for the Psi Warrior and the Soulknife, Bardic
Inspiration's die, note and rest, Warding Flare's rest and 2024 note (its 2014
row has neither), and Sneak Attack's dice. Six more, for five features, give
a spell to cast without a slot, cast with the spellcasting ability of the class
that gives them (rule pack port 2f): Paladin's Smite, Faithful Steed, Runic
Smite, Contact Patron, and the 2024 Favored Enemy, whose casts go up with the
Ranger's level; the 2014 Favored Enemy's row has no effects. Four more count
some of their effects under one rules version alone (rule pack port 2g): Second
Wind, the Cleric's and the Paladin's Channel Divinity, the Paladin's named for
the class that gives it, and Lay on Hands. Two more name a pool and its action
for the class that gives them only when the character also has the other class
(rule pack port 2h): the Cleric's and the Paladin's Harness Divine Power.
Seven more ask a pick ("Picks", below; rule pack port 4a), one of each kind of
pick a class asks: Primal Knowledge by printing (the Barbarian's skill list),
the Cavalier's Bonus Proficiency (a skill or a language), Master of Intrigue (a
gaming set), both Training in War and Song (a melee weapon; the 2024 one a skill
and weapons by filter) and the Alchemist's Tools of the Trade (a tool in place
of one held). Twenty-two more, under 23 keys, are the plain picks from a list
(rule pack port 4b): the sidekicks' Bonus Proficiencies, Otherworldly Glamour,
Blessings of Knowledge (its FRHoF printing adds a tool), the Samurai's Bonus
Proficiency (a skill or a language), Knightly Envoy, Student of War (its 2024
printing adds a skill from the Fighter's list), Path of the Kensei, the domains'
Acolyte of Nature, Acolyte of Strength, Bonus Proficiencies, Implement of Peace
and Student of Arcana (Arcana and the Cleric's list), the College of Lore's
Bonus Proficiencies, Primal Lore, Awakened Talent, Hermit's Study, Genie's
Splendor and Enchanting Conversationalist, whose skill takes the bonus too.
Twelve more, under 12 keys, give a skill or tool, or a pick of another in its
place when the character has it already (rule pack port 4c): Royal Envoy
(Persuasion doubled either way), Arcane Archer Lore (its AU printing grants
Arcana and Nature, each held one a skill from the giving class's list), the
artificer subclasses' Tool Proficiency and Tools of the Trade (the Armorer's
with heavy armor, the Artillerist's with martial ranged weapons, the
Cartographer's two tools), the Reanimator's Skill Set and the Warrior of Mystic
Brews' Bonus Proficiencies (Performance, or a skill from the giving class's
list). Two more ask a named option or a damage type (rule pack port 4d): the
2014 Dragon Ancestor, a dragon (`ancestor`, which the 2014 Elemental Affinity
reads) and Draconic, and the 2024 Elemental Affinity, a type of five resisted.
Two more are spell picks (4e): the 2024 Agonizing Blast, Charisma on the damage
of a Warlock cantrip, given once over the picks (`givesAll`, `{picks}`), and
Signature Spells, two level 3 Wizard spells, each with a pool of one use a short
rest named from the spell (`{pick.slug}`, `{pick.title}`). Three more ask kinds
of weapon (4f): the 2024 Weapon Mastery of the Barbarian (melee kinds alone),
the Fighter, and in one row the Paladin, Ranger and Rogue (kinds the character
is proficient with), as many as the class table's column says, else two,
asked once the build is in. The last (4h) is the 2014 Elemental Affinity, an
action whose note names the type of the dragon the Dragon Ancestor picked
(`byAnswer`). No row was left in `CURATED`, so the table, its lookups and
the call sites' code fallback went in the cleanup after 4h.

79 `standing` rows have moved (`src/rules/cast-guidance/standing.json`): every
`STANDING` row the format held before phase 4, the defenses, senses and speeds a
subclass or optional feature adds beside what its prose scan reads, eight of
them split by printing (Avatar of Battle, Aura of Warding, Aura of Devotion,
Second-Story Work, whose 2014 row adds nothing), and Bestial Soul, a pick of
three options (4a), Tiger, two skills at level 6 (4b), and Unfettered Mind,
Elegant Courtier and Iron Mind, a save or, when the character has it already, a
pick of one it lacks (4c), and four picks of a named option or a damage type
(4d): Aspect of the Wilds (the owl's darkvision 60 feet, or 60 more than the
character has), Aura of Elemental Shielding and both Fiendish Resiliences, a
damage type resisted. The last seven (4h) need what the character has already:
Nature's Ward and Umbral Sight split by printing, the Warrior of Shadow's
Darkvision and Umbral Sight as darkvision or more (`orMore`; the 2014 Umbral
Sight's 30 more only on a race's, `orMoreFrom`), Elemental Gift and the 2024
Nature's Ward by the branch picked (`byAnswer`), and Dread Allegiance by the
god whose cantrip the subclass granted (`byGrant`). No row was left in
`STANDING`, which went with `CURATED`. One more `standing` row is new rather than
moved: Tasha's Roving, the 2014 Ranger's level 6 Deft Explorer Improvement (5
more feet of walking speed, and a climbing and a swimming speed equal to it), a
`level` row because the level 10 improvement has the same name and keys.

Every advantage row has moved, under 181 keys (`src/rules/cast-guidance/roll-advantages.json`):
advantage on the character's own d20 tests that a feature, feat, optional
feature or species trait states only in prose, which always holds (Feral
Instinct on initiative), holds while a state the app sees (Bloodied), or holds
only when the player says (`when`, Brave against being Frightened). So has every
row of `ROLL_EXTRAS` (`src/rules/cast-guidance/roll-extras.json`): its 26 free
dice (1d), the dragonmarks' d4 that rolls in with a skill's checks, and its 75
keys of paid extras and rerolls (3e), as `rollPaid` and `rollReroll` effects. A
paid extra is a die, the paying pool's die, a flat bonus or advantage the roll
prompt offers at the price of the feature's Use (Precision Attack, Flash of
Genius, Tides of Chaos); a reroll is offered on the result or made as the d20
lands, or sets a number (Reliable Talent's 10) or a floor (Indomitable Might).
A bonus the table wrote as words is a formula (`max(0, mod.int)`,
`max(1, mod.int)`, `prof`), a reroll's bonus by class level is `classLevel` or
a level table of Rage's damage, and Fanatical Focus holds `while` raging. Keys
with the same rows share one, as spend keys do: 101 keys in 68 rows. The table
left some out on purpose, and so do the rows: Portent's foretold rolls (kept in
play) and Curving Shot (another target); 2014 Stroke of Luck's miss into a hit
and Starry Form's Dragon on concentration saves, which roll at once; a price the
player picks (Focused Aim) or a bonus the app cannot count (Saving Face); what
lasts the turn or adds damage (Fighting Spirit, Feinting Attack) and Grappling
Strike, which needs a hit; dice paid with Hit Point Dice or Heroic Inspiration
(Symbiotic Being, Zhentarim Ruffian); and other creatures' rolls and tool
checks, which no roll on the sheet names (`FUTURE_WORK.md` lists the rest).

Fifteen spend links have moved, as 11 rows (`src/rules/cast-guidance/spend.json`,
rule pack port 3b), one for each way a link prices an action: a cost on the
action the prose scan read (Flurry of Blows, 2014) or a built-in row added
(Stunning Strike, 2024), a chip of its own (Quickened Spell), an action's
economy changed (Nature's Sanctuary), a buy-back alone (Warping Implosion), one
on another feature's action (Totems), one for a spell the feature gives
(Telekinetic Master), a Pact Magic slot with dice (Eldritch Smite), a slot
buy-back with a level (Illusory Self), a Hit Point Die (2024 Durable), and a
pool's price beside a slot's labelled chip (2014 Combat Wild Shape, whose key
both tables held). Keys whose links are the same share a row. 3c moved every
other pool price but Divine Reaper's (287 keys), and 3d the spell slot and Hit
Point Die prices with Divine Reaper (52 keys), so `spend.json` holds all 354
keys, in 115 rows, and both link tables are gone.

The 24 `ITEM_TAG_FIXES` keys have moved, as 15 `wornTags` rows
(`src/rules/cast-guidance/items.json`, rule pack port 5a): items whose data
tags name more than wearing gives, or less. Four give nothing worn (two decks,
the Moon Card, Muroosa Balm); others drop a defense switched on for a while or
picked when attuning, take a save bonus that holds only sometimes, or keep it
to the one ability the text names. Keys whose rows are the same share one, and
the table is gone.

The 8 `ITEM_CHARGES` keys have moved too, as 7 `charges` rows in the same file
(rule pack port 5b): the Staff of Healing (both printings, one row) and the
Wands of Magic Missiles, Fireballs and Lightning Bolts, each printing its own
row, since a 2024 wand spends at most 3 charges a cast. The table is gone.

The 3 `SHORT_REST_SPELLS` keys have moved, as 3 `spellRest` rows
(`src/rules/cast-guidance/spell-rests.json`, rule pack port 5c): spell pools
the data writes as daily that the text gives back on a short or long rest,
Fey Teleportation's Misty Step, every pool of Boon of Siberys, and the Mammon
tiefling's Tenser's Floating Disk. The table is gone.

## A file

```jsonc
{
  "type": "ruleSet",
  "v": 1,                      // the Cast Guidance version, as a rule pack's
  "name": "Built-in rules",
  "edition": "both",           // "2014", "2024" or "both"; optional
  "rows": [
    {
      "part": "curated",                // which of the eight parts it is
      "keys": ["stunning strike|monk"], // the keys it is found under
      "scan": "replace",                // or "keep"; "replace" when absent
      "effects": [ /* the stored effects a rule pack's patch holds */ ]
    },
    {
      "part": "standing",
      "keys": ["desert|path of the storm herald"],
      "level": 6,                       // only the feature gained at 6
      "effects": [{ "kind": "resist", "damageType": "fire" }]
    },
    {
      "part": "rollAdvantage",
      "keys": ["brave|phb"],
      "effects": [
        {
          "kind": "rollAdvantage",
          "mode": "adv",
          "on": { "rolls": ["save"] },
          "when": "Only against being Frightened"
        }
      ]
    },
    {
      "part": "spend",
      "keys": ["quickened spell|phb", "quickened spell|xphb"],
      "links": [
        { "cost": { "resource": "sorcery-points", "amount": 2 }, "economy": "none" }
      ]
    },
    {
      "part": "wornTags",
      "keys": ["mace of the black crown (awakened)|egw"],
      "replaces": ["resist"],           // the kinds of the item's data tags it stands in for
      "effects": [{ "kind": "resist", "damageType": "poison" }]
    },
    {
      "part": "charges",
      "keys": ["wand of fireballs|xdmg"],
      "charges": 7,                     // how many it holds
      "regain": "1d6+1",                // back at dawn: dice, a number, "all" or "none"
      "spells": [{ "spell": "fireball", "cost": 1, "upTo": 5 }]
    },
    {
      "part": "spellRest",
      "keys": ["feat:fey teleportation|xge"],
      "spells": ["misty step"]          // or "every"
    }
  ]
}
```

- **`keys`** are the keys its call sites look it up under ("Keys by call
  site", below), matched without case. A key already taken by an earlier row
  of the same part in the same file is left out, and the reader says so.
- **`scan`** (`curated` rows): `replace` turns the prose scan off for the
  entry; `keep` runs the scan beside the row. A row of any other part has no
  `scan`: it always runs beside the scan.
- **`level`** (every part but `curated`, optional): the row counts only for the feature
  gained at that level, 1 to 20, which tells apart features of one name (Storm
  Herald's Desert at 3, 6 and 14). A key is taken once per level, so a key may
  have a row at each of several levels and one for every level. The first key
  with a row at any level wins: a feature whose key has rows only at other
  levels gets none, and the walk does not go on to a later key, as `STANDING`,
  the advantage table and `ROLL_EXTRAS` answered.
- **`effects`** read as a rule pack's (`readStoredEffects`), formulas and
  `while` included, but strictly: a field the reader does not read is a problem
  and that effect is left out, where a player's file reads past it. So a row
  written with a field the format does not have yet (`tools` on a roll
  filter) fails the tests instead of losing half of itself unseen. The
  same goes for a nested field (`save.dc`), a `while` state's and an amount's
  (an amount is `{ "f": ... }` or `{ "byLevel": ... }`, never both) and a level
  table of words' (`{ "byLevel": ... }` alone). An unknown
  field on a row leaves the row out; one on the file is a problem, and its rows
  still count.
- **`links`** (`spend` rows, in place of `effects`, at least one): the prices
  the row puts on the feature's action, in order ("Spend rows", below). A link
  the reader cannot read is a problem and is left out, and the row keeps the
  rest, still standing in for its keys, as a row keeps the effects it can read.
- **`replaces`** (`wornTags` rows, at least one): the kinds of tag the row
  stands in for, of `resist`, `immune`, `vulnerable`, `conditionImmune` and
  `saveBonus` ("Worn tag rows", below). Its `effects` may only be of those
  kinds. A row with a kind it does not know, a kind twice, an effect of a kind
  it does not replace, or an effect it cannot read (which would take that
  tag away unseen) is left out, and its keys stay free for a later row.
- **`charges`, `regain` and `spells`** (`charges` rows, in place of
  `effects`): how many charges the item holds (1 to 99), what comes back at
  dawn, and the spells they cast ("Charges rows", below). `regain` is dice (a
  die first, then dice or whole numbers added, each die of 2 sides or more, so
  a rest never gives back less than nothing), a whole number from 1 to what
  the item holds, `"all"`, or `"none"`, never. A row with
  any problem in them is left out, and its keys stay free: a spell missing or
  misread would offer the charges for less, or not at all, unseen.
- **`spells`** (`spellRest` rows, in place of `effects`): `"every"`, or the
  spells by name whose pools from the origin come back on a short rest ("Spell
  rest rows", below). A row with no spells, an entry that is not a name,
  `"every"` inside the list, or a spell named twice is left out, and its keys
  stay free: a spell misread would leave its pool on a long rest unseen.
- A row the reader cannot read is left out, and the rest still count. What it
  left out goes to the console once, not the sheet: the files are the app's, so
  a problem in one is a bug its tests catch, not something a player can fix.
- At most 5,000 rows a file, 16 keys a row, and 20 spells a `charges` or
  `spellRest` row (`RULE_SET_LIMITS`).
- A later file's row wins over an earlier one's under the same part, key and
  level; its rows at other levels keep theirs.

## Keys by call site

| Call site | Key | Example |
| --- | --- | --- |
| Class or subclass feature | `name\|class\|printing` for each printing, then `name\|class`, for each name and class or subclass label tried | `roving\|ranger\|xphb`, `stunning strike\|monk` |
| Class row | `class:` and the class uid | `class:monk\|phb` |
| Feat | its uid, then the uid of the feat it copies | `alert\|phb` |
| Optional feature | its uid, then the uid of the one it copies | `defense\|phb` |
| Race trait | `trait:` and the trait name | `trait:relentless endurance` |

A class or subclass feature's printings are its own book (the official one's,
for a copy), then its class's or subclass's, so a 2014 subclass kept under a
2024 class reads its own printing's row. A row under the key alone is for every
printing with no row of its own.

The first key with a row wins, in the order the call site tries them. A
subclass has no row of its own. Items have no curated row: their parts are
`wornTags`, under the item's own `name|source` (`rod of alertness|dmg`), the
entity found rather than the ref a character saved, and `charges`, under the
`name|source` the character's equipment entry names (`refUid(entry.ref)`),
which the sheet's pool, the cast prompt and the long rest all read alike. The
two agree for every ref that names its book; starting equipment can write one
that does not, and then no `charges` row is found. A copy of an item is not
reached by the official one's rows: its tags and charges are its author's
(its own `charges` effect, "An item's own charges", below).

A `spellRest` row is found under the `type:uid` of the origin granting the
spells: `feat:fey teleportation|xge`, and for a subrace, whose origin has type
`race`, `race:mammon|mtf`.

A `standing` row is found under the same keys, in the same order, for a class
or subclass feature and for an optional feature; feats, traits and class rows
have none. Its level is the feature's own level for a class or subclass
feature, and the host class's level for an optional feature, so a `level` row
under an optional feature's key would count at that one character level alone
(no such row exists).

The roll parts (`rollAdvantage`, `rollExtra`) have keys of their own, which
name the book, each part walked on its own:

| Call site | Roll key | Example |
| --- | --- | --- |
| Class or subclass feature | `name\|class\|source` for each name, class or subclass label, and book (the feature's, then the official one's a copy is of) | `feral instinct\|barbarian\|phb` |
| Feat | its uid, then the uid of the feat it copies | `war caster\|phb` |
| Optional feature | its uid, then the uid of the one it copies | `eldritch mind\|tce` |
| Race trait | `trait\|race or subrace\|source`, then `trait\|source` (the race's or subrace's book), then the trait it copies as `name\|source` | `lucky\|halfling\|phb`, `brave\|phb` |

A trait's name with its race's tells apart traits of one name in one book
(Deathless Nature: the Reborn's gives advantage, the Dhampir's does not), and
a 2014 halfling's `lucky|halfling|phb` from the Lucky feat's `lucky|phb`.
A roll row's level is a class or subclass feature's own and an optional
feature's host class's; feats and traits pass none, so only rows without a
level count for them.

A `spend` row is found under a class or subclass feature's, a feat's or an
optional feature's roll keys, in the same order; traits have none. The first
key with a row wins.

## Worn tag rows

An item's data tags say what wearing it gives: `resist`, `immune` and
`vulnerable` damage types, `conditionImmune` conditions, and
`bonusSavingThrow`. They are written as search filters, so a few name more
than wearing gives: a deck tagged with what its cards give, a shield with what
it gives for a minute after a bonus action, every save where the text names
one. A `wornTags` row says what the item gives instead.

- The item call site reads the tags kind by kind, in the order above. For a
  kind the row `replaces` it adds the row's effects of that kind, in the row's
  order, where the tags would be; for every other kind, the tags. So a row
  changes only the kinds it names, and nothing moves.
- A row giving nothing of a kind takes that kind away: the "nothing worn" rows
  replace all five, whatever their data has.
- A potion's tags count once it is drunk, so a potion reads neither tags nor
  row while carried. `bonusAc` is not a tag: a row never touches it.
- The row is part of what the item inherits, read while its magic works
  (attuned, where it asks) with the item's own origin, as the tags are: a
  pack's patch that replaces the item's mechanics leaves it out, and the item's
  own `drop` reaches it. A player's item or copy drops and gives tags with its
  own `drop` and `effects`; this part is the app's.

## Charges rows

Some items cast spells with charges: a Staff of Healing's Cure Wounds, a
wand's Fireball. Their data says how many charges and one fixed cost a spell,
not always that: Cure Wounds from the staff is a charge a spell level, up to
4th, and the 2024 staff's data lists it as at will. A `charges` row says it.

- **`spells`**: each spell by name (matched without case, any printing), what
  it `cost`s at its own level (1 to the item's charges), and `upTo`, the
  highest spell level it can be cast at for one more charge a level. Without
  `upTo` it casts at its own level alone. A level whose cost is more than the
  item holds is not offered, so a 2014 wand's `upTo` of 9 on 7 charges is
  allowed. A spell named twice is a problem.
- **What reads it.** The item call site makes a pool of its own for each
  carried item with a row, `item-charges:<entry id>`, labelled `<item>
  charges`, refilled by `regain` on a long rest, while the item's magic works
  (attuned, where it asks). The pool is not part of what the item inherits:
  a pack's patch that replaces the item's mechanics, or the item's own `drop`,
  leaves it standing. The cast prompt offers the item's tiles at each level it
  can pay for (`itemChargeWays`), and a long rest rolls the dawn regain of an
  item put away or not attuned too (`idleChargePools`), whose spent charges
  are kept, not over a limit. All of them find the item's charges through
  `itemChargesOf`, which reads the registry outside a derive, so the Play and
  Spells tabs pass its lookups (`SpellCast.entities`).
- A row prices the spells the character casts anyway. It grants none: some of
  these items cast at a fixed DC, which a grant would not show.

### An item's own charges

A player's item, or a pack's patch of one, says its charges with a `charges`
effect in its `castGuidance` effects, the row's fields and reader:

```jsonc
{
  "kind": "charges",
  "charges": 7,
  "regain": "1d6+1",
  "ability": "wis",                            // optional: what its spells cast with
  "spells": [{ "spell": "Fireball|XPHB", "cost": 1, "upTo": 5 }]
}
```

- **Each spell names its book** (`name|source`), since the item grants it:
  while the item's magic works, each spell is granted on a row of its own,
  paid from that copy's pool, priced by level as a row prices it. Without an
  `ability`, the row shows no attack or DC, as any grant without one.
- **Which counts.** `itemChargesOf` takes the last that says the item's
  charges: its built-in row, its own effect, a pack's `add`, a pack's
  `effects`. A pack whose `effects` replace the item's own replaces its own
  charges too; the row stands outside what the item inherits, so a
  replacement that says none leaves the row.
- **Read apart.** The effect emits nothing; the pool and grants are made from
  it. It holds no `while` or `edition`, is said once a list, and counts only on
  an item: in a moment's list, a pick's `gives` or a built-in row it is a
  problem, and on another kind of entry the sheet says it counts for nothing
  (so a pack's `effects` of charges alone replace nothing there).
  An app before it reads it as a kind it does not know, a problem, and the
  rest of the item still counts.
- **Old files.** The Workshop wrote an item's charges as a `resource` pool
  under the key `charges` and a "Cast a spell" card spending it. They are read
  as they always were: an ordinary pool and grant.

## Spell rest rows

A few origins grant spells their data writes as cast once a day (`daily`)
where the text gives the use back on a short or long rest. A `spellRest` row
says so.

- **`spells`**: the spells by name (matched without case, any printing), or
  `"every"`, each pool the origin grants, a pick's included. A pool comes back
  on a short rest when the row names every spell in it, so a pool shared with
  a spell the row does not name stays on a long rest (Mammon's Arcane Lock is
  once a long rest).
- **What reads it.** Granting an origin's `additionalSpells` makes a resource
  for each pool with a limit; the row turns that pool's rest to short, and its
  casts read `1/rest`. With no rule sets loaded, every such pool follows its
  data.
- Homebrew says it in its own data, with a `rest` bucket in
  `additionalSpells`, or a Workshop pool with `reset: "short"`; this part is
  the app's.

## Where a row sits

A row is the curated row of the entry it is found for (layer 3 of the seam,
ADR-001), so it keeps every rule a `CURATED` row had:

1. A player's rule pack patch that replaces the entry wins over it; a pack's
   `add` sits beside it.
2. The entry's own `castGuidance` comes first; its `drop` reaches the row's
   effects, and its `replace: true` leaves the row out.
3. The row is emitted first in layer 3, with the entry's own origin object,
   which spend links find actions by. The rest of layer 3 (the prose scan
   unless the row replaces it, then standing rows, roll rows, spend rows)
   follows it.

A `standing` row runs after the curated row or the prose scan: beside them,
with the entry's origin object, and after the curated row's `from`, so the
entry's `drop` reaches it and an entry or pack that replaces what it inherits
leaves it out. Its formulas read the class's level the curated row's read.

A roll row runs where the roll tables ran, after the standing rows, with the
origin they had: the feature's, feat's or option's own object, and for a trait
the race's labelled with the trait's name (Brave, not Halfling), so the roll
prompt names the trait.

A spend row runs where the spend links ran, last, with the same origin object.
An entry's `drop` reaches the chips it adds, and an entry that replaces what it
inherits leaves it out. A player's `amend` (below) runs after both, so it
reprices a chip a row priced or added.

## Picks

A `pick` effect asks the player something as the character is built, and gives
effects by the answer (rule pack port phase 4). Built-in rows and a player's
rule pack or homebrew entry write it the same way (source of truth: `readPick`
in `mechanics.ts`, `askPick` in `src/engine/effects/picks.ts`):

```jsonc
{
  "kind": "pick",
  "id": "favoured-tool",
  "ask": "tool",
  "from": ["artisan's tools"],
  "gives": [{ "kind": "toolProf", "name": "{pick}" }]
}
```

- **`id`** is the prompt's id after its origin (`<origin type>:<origin uid>:`),
  which the character's saved answer is filed under. A player's file writes a
  short name (lowercase letters, digits and hyphens, at most 40), filed as
  `pick-<id>`: renaming a copy keeps its answers, and no pick shares an engine
  prompt's id (`ancestor`, `branch`, `cantrip`), whose one answer would then
  apply twice. A built-in row writes, after the origin, the id the code row it
  replaced asked under,
  `skill:{feature}` (the entry's name, lowercased) or a fixed word
  (`CODE_PICK_IDS`), so the answers characters saved keep reading. A feat's
  `pick-` ids file under its copy (`feat:<uid>:<instance>:pick-<id>`), so each
  copy of a repeatable feat asks its own and removing the feat clears its
  answers. An entry's effects asking one id twice are refused, unless each
  counts under its own rules version (`edition`); a pick asked twice under one
  id in one build (a pack's patch and the entry's own effects) asks once and
  warns.
- **`ask`** sets the prompt and its options:
  - `skill`: every skill, or `from`. `classSkills: true` adds the skill list of
    the class that gives the feature (as a level table reads that class's
    level), and `orLanguage: true` offers languages too: a language picked is
    spoken, whatever `gives` says.
  - `tool`: every tool, or `from`, where a group stands for its tools
    (`"artisan's tools"`, `"gaming set"`). A tool held so far is offered greyed
    out ("You already have Smith's Tools"), and an answer is given by the name
    the sheet shows.
  - `weapon`: the weapons `from` names, or the base weapons of any kind
    `weapons.filter` names (`type=` and `simple`, `martial`, `melee` or
    `ranged weapon`, joined with `;`), less those with a property in
    `weapons.without`; one of `from` and `weapons`.
  - `weaponMastery`: weapon masteries; `melee: true` for melee weapons alone,
    `proficient: true` for those the character is proficient with.
  - `save`: the abilities, or `from`, less the saves held so far (ids
    lowercase, labels capitals). With none left it asks nothing.
  - `damage`: the 13 damage types, or `from`.
  - `option`: `options`, at most 20, each `{ "id", "label", "gives" }`: what
    an option gives is its own, given as it is picked.
  - `spell`: the spells `spells` finds (`levels`, `classes`); an answer is a
    spell's `name|source`.
- **`count`**: a number (1 when absent), `{ "byLevel": { "1": 1, "10": 2 } }`
  by the level of the class that gives it, or
  `{ "tableColumn": "Weapon Mastery", "else": 2 }` from its class table.
- **`label`**: the prompt's words, with `{feature}` (the entry's name) and
  `{held}`; each ask has its own words when absent.
- **`gives`**: the effects each answer gives, with `{pick}` filled in (a
  spell's `name|source`, and `{pick.slug}` and `{pick.title}` for its name as a
  key and as a title). **`givesAll`** is given once for all the answers, where a
  whole value `"{picks}"` is the list of them (spells by name, lowercased,
  tools by the names the sheet shows: Agonizing Blast's one bonus); `{picks}`
  means nothing in `gives`. A `$` in a name or an answer is kept as written.
  The reader checks `gives` with an answer of the
  ask filled in, and with each option's id and each `inPlaceOf` name; an answer
  that still does not read (a homebrew spell whose name is too long for a key)
  is a warning on the sheet, and that effect is left out.
- **`inPlaceOf`** (`skill`, `tool`, `save`): names. Each not held so far is
  given as an answer would be; each held turns into one pick of the options
  (the count is how many are held), and `{held}` names them. **`always`**,
  with it alone, is given either way, after those and before the pick (Royal
  Envoy's expertise in Persuasion).
- **`afterBuild: true`**: asked once the whole build is in, since its options
  read all of it (Weapon Mastery, which reads every proficiency).

A pick is refused in play (a condition, a spell cast or a buff: no one is
building a character there), inside another pick's `gives`, with `while`, and
with a field its `ask` does not read (`from` on an `option`, `weaponMastery` or
`spell` pick). Option ids that differ only in case are one, as saved answers
match without case. A pick's prompt shows on the creator step
its origin routes to, as every prompt does.

Four more terms came with picks, for the rows that move with them:
`weaponMastery` (a mastery by weapon name), `weaponProfFilter` (proficiency
with the weapons filter words find; the app's own rule sets only, as the
filter is not a word a player writes), `grantSpell`'s `slotsOnly` (a spell cast
with slots alone, never free), and a `sense`'s `orMore`: the best range of that
sense held so far (any origin's, or a race's alone with `orMoreFrom: "race"`)
plus `orMore`, or `range` when none is, which takes a plain range and is refused
in play. What is held so far is what came before it in the build (a later
feat's or item's sense does not count), and a held range written as a formula
counts as none, since a formula's number is known only once the sheet is
folded.

The Workshop's Pick card (4g) writes a pick on any entry whose effects are not
in play: what it asks for, how many, from what (chips for skills, saving throws
and damage types, names for tools, weapons of a kind or named, a spell's levels
and class lists), in place of what is held (a skill, tool or save), the
prompt's words (the box suggests the sheet's own), and what each pick gives,
built with the effect cards. There a box that takes the answer (a skill, an
ability, a damage type) offers "The pick", and a name box takes `{pick}`; a
card's words say "the one picked". A named option's pick lists its options,
each with what it gives. A new pick's id is `choice`, else `choice-2` and on,
one no pick of the entry has or had in a version the editor knows (as it
opened, each save while it is open, and a copy's original; a class's features
file their picks under the class, so the whole entry counts), and it never
changes, since the answers are filed under it. A new option likewise takes an
id its pick's options never had there, and so do the two a pick turned to
options starts with. An Id box shows when the reader refuses the id a file
gives or two picks share one, and stays while it is typed. Turning a pick to
another ask takes away what only the old ask reads, and turns what it gives too
while that is still what the old ask started with. What it gives holds no pick,
pool or action (a pool there would be named for the one picked, which the cards
that follow a pool's name do not reach): one a file gives is shown as written.
A pool of the entry renamed is followed into what its picks give (`gives`,
`givesAll`, `always`, each option's). What no box
edits is kept and said so: a count by level or by the class table (a number
typed replaces it), `givesAll`, `always`, a weapon pick's `without`,
`afterBuild`, and a Weapon Mastery pick, a class's, in words alone, with what
the reader refuses in what it gives. Its Weapon card gives a weapon proficiency
by name. A rule pack's review says what each pick a patch adds asks for ("Asks
for 2 skills from Arcana or History"), and does not count it as an effect.

Two value shapes came with the last rows (4h), for words chosen by another
answer of the entry. `{ "byAnswer": "<pick id>", "values": { "<answer>":
"<words>" } }` reads the first answer saved for one of the entry's picks, named
by that pick's `id` and filed as it is (a repeatable feat's under each copy), so
a player's file names a pick its own effects ask, and a built-in row may also
name an engine prompt asked elsewhere: `ancestor`, or `branch`, the spell option
a class's or subclass's `additionalSpells` asks. `{ "byGrant": { "<spell>":
"<words>" } }` reads which of those spells the entry granted so far, the first
in the order they were collected. Answers and spell names match trimmed and
without case. A defense's `damageType` (`resist`, `immune`, `vulnerable`) and an
action's `note` take one. The effect holds the first row's words until it is
emitted; with none of the table's then, a defense is not given and a note is
left out, the action kept (the 2014 Elemental Affinity before a dragon is
picked). A table has at most 30 rows, each read as the field's own words, and
is refused in play, where no entry answers. One naming a pick its list does not
ask is refused, inside what a pick gives too, where `{pick}` is the answer
already. The Workshop shows one as "By the answer to kind, as written" or "By
the spell granted, as written", and a value picked takes its place.

## Roll fields

Three stored fields came in with the roll parts, and a fourth after them, for rule packs too:

- **`when`** on `rollAdvantage`: the advantage holds only then, which the app
  cannot see, so the roll prompt offers it to claim ("Only against being
  Frightened"). With `"mode": "adv"` alone: the prompt offers no disadvantage.
  The app's rows word it from "Only", as the prompt and the Defenses sheet read
  it. A concentration save rolls at once, with no prompt, so one there is read
  but never offered (Extended Spell), and the Workshop's card does not ask.
- **`initiative: true`** on a roll filter: initiative rolls alone, not other
  Dexterity checks (Feral Instinct). Its `rolls` is `check` alone, it takes no
  `skills`, `skilled` or `proficient`, and any `abilities` list `dex`.
- **`proficient: true`** on a roll filter: checks with a skill the character is
  proficient in, or has expertise in (Reliable Talent). Like `skills`, it
  narrows checks alone, so its `rolls` lists `check`; any other rolls it lists
  stay whole.
- **`save: "death"`** or **`"concentration"`** on a roll filter: one kind of
  save alone (2024 Durable, War Caster). Its `rolls` is `save` alone. A death save
  has no ability, so a row for some abilities' saves never reaches one, and an
  advantage to claim (`when`) or a paid extra reaches one only when it names it.
  So `"death"` takes no `abilities`, and with `"concentration"` any `abilities`
  list `con`.

A paid extra (`rollPaid`, 3e) names one of `dice`, `poolDie`, `bonus` or
`advantage`. A bonus is added once the d20 shows (`after`), advantage is claimed
before it, so it waits on no failure (`ifFailed`), and a use given back on a
roll that still failed (`spentOnSuccess`) needs `ifFailed`. A reroll
(`rollReroll`, 3e) rerolls a `die` (`one` with `atMost`), or sets the d20 (`to`)
or a floor (`floorScore`), which take no die and no `bonus`. One made as the d20
lands (`auto`) is `free`, waits on nothing and never makes the roll worse: a 1,
the lower die of advantage, a number set or a floor, and a floor and the lower
die are made only so. Inspiration pays alone: never beside a reaction, a pool's
die or `free`. Each refusal is one the roll prompt would otherwise drop or
misread. The Workshop's Paid extra and Reroll cards (3f) write only what these
rules take: a box that would break one is not offered, and a choice that would
(a reroll of every die made as the d20 lands) takes the field away.

The reader refuses a filter that could reach no roll, and `when` with
disadvantage. A pack written before these fields, when the reader passed over
them, now loses such an effect, with the problem shown.

## An action's price

An `action` takes every price the engine has (rule pack port 3a), ahead of the
spend and slot links moving out of code. Its `cost` is what using it spends,
`resource` and `amount` always given (`amount` is 1 for a slot or a die):

- a pool's uses, by the pool's key, `amount` a whole number or `"varies"` (the
  player's call, so nothing spends by itself); `optional` makes the base use
  free and the pool pay for more (2024 Patient Defense), and counts only for a
  pool; `ownUseToo` spends a use of the pool sharing the action's name as well
  (Hand of Ultimate Mercy);
- a spell slot, `"resource": "spell-slot"`, which the player picks by level as
  they pay: `minLevel` (the lowest level that pays), `pactOnly` (only a Pact
  Magic slot), `slotDice` (dice by the slot's level: `base` plus one a level,
  of `die`, up to `maxDice`, with `heals` or `plain` when the roll is not
  damage, and `plus` for what the line under it adds) and `slotRefills` (the
  pool that gets as many points back as the slot's level, Font of Magic);
- a Hit Point Die, `"resource": "hit-die"`, which heals as it is spent:
  `hitDieHeals` `"roll"` (the default) or `"rollPlusCon"`, and `hitDieAtLeast`.

Its `buyBack` is what buys a use back once none are left: a pool's uses
(`amount` 1 or more) or a spell slot (with `minLevel` and `pactOnly`, `amount`
1), and `own`, the key of the use it gives back. Without `own` it gives back a
use of the pool sharing the action's name, and nothing when none does. A field for one way of paying on another is refused, by name
("`cost.minLevel` is for a price paid with a spell slot"). The sheet offers a
price only when the character can pay it: a pool it has (under either name, ki
or Focus), a slot of the level, or a Hit Point Die.

The Workshop's Action card sets most of this: "Takes" offers no action (a
rider), "Spends" a pool, a spell slot or a Hit Point Die, with how many, a free
base use, which slots and how the die heals, and "Buys back a use with" a pool
or a slot, with "Restores" for the use it gives back (at first the pool the
action spends). A slot's dice, the points it gives back and `ownUseToo` are
kept as a file writes them, and a value no box offers shows as written.
Renaming a pool moves every price that names it as the rename starts (and a
spell cast with its uses, and the same pool for the other rules version), so a
pool whose key passes through another's while its name is typed (`ki` on the
way to "Kindle") leaves what spends that one alone. A pool never takes
`spell-slot` or `hit-die` as its key.

## Spend rows

A `spend` row prices the action of the feature it is found for, as the link
tables did (rule pack port 3b to 3d, `linkPrice` in `spendLinks.ts`). Its `links` run
in order, each a price as an action takes it ("An action's price", above):

- **`cost`**, with `economy`, `label` and `note`. A pool's cost goes on the
  feature's first action, replacing any cost it had, and `economy` replaces its
  economy. A slot's or a Hit Point Die's fills only an action with no cost yet.
  With no such action, or with a `label`, the link adds an action of its own,
  named `label` or as the call site names the feature, taking `economy` or no
  action. `note` is set only on an action that has none.
- **`buyBack`**, with `onAction`, `ownSpell` and `uses`. It goes on the
  feature's first action, or with `onAction` on the first action of exactly
  that label, whatever gave it (Totems on the Primal Knowledge Totem). A slot's
  buy-back passes over an action that has one already. With no such action, a
  pool's buy-back adds an action of its own, named `onAction` or as the feature;
  a slot's adds one only without `onAction`. `ownSpell` gives back a cast of
  that spell the feature grants, by its name in any case (`own` becomes its
  pool's key, which lowercases and hyphenates the name), so a link takes
  `ownSpell` or `buyBack.own`, not both. `uses` (`key`, `max`, `resetOn`) adds a
  pool named for the feature first.

A link with both a `cost` and a `buyBack`, or neither, is refused, as is an
`economy` on a buy-back. A row's links may mix the two (Divine Reaper spends
Channel Divinity and buys it back with a slot).

What a link names is matched by label, so a homebrew copy keeps it only in
part: an action it adds takes the copy's own name (roll prices look an action
up by its source's name first), but a target renamed in a copy, or named for
its class, is missed, and the link adds its own action or nothing as above.
A player's file prices an action itself (an action's `cost` and `buyBack`);
spend rows are the app's. To reprice an action an entry inherits, a player
writes an `amend` instead.

## A player's price on an inherited action

`amend` (rule pack port 3g) changes the price of an action an entry inherits,
such as an official feature's scanned chip, without rewriting the entry: "Flurry of
Blows costs 2 Focus". It is a list on an entry's own `castGuidance` (a Workshop
copy) and on a rule pack's patch, next to `effects` and `add`:

```json
{ "target": "Flurry of Blows|Monk", "amend": [{ "cost": { "amount": 2 } }] }
```

Each item takes `label`, `cost` and `buyBack`, with a `cost` or a `buyBack` or
both, and nothing else: a misspelt `label` would price another action, so an
item with a field it does not read is refused, with the problem shown.

- Without `label` it prices the first action the entry inherits, where a spend
  row puts its price. With one it prices each inherited action of exactly that
  name in any case, as the sheet shows it (after the class naming, "Channel
  Divinity (Paladin)").
- `cost` replaces what using it spends, as an action's `cost` reads ("An
  action's price", above). A `cost` with no `resource` takes `amount` alone and
  changes how many uses it spends of the pool it spends now, so it works
  without knowing the pool's key (ki or Focus). On an action with no pool
  price (one that spends a spell slot or a Hit Point Die, or a scanned chip
  that spends only its own use), that changes nothing, and the sheet says so.
- `buyBack` replaces what buys a use back. Another feature's spend row that
  buys a use of this action back (`onAction`, Totems on the Primal Knowledge
  Totem) leaves a buy-back a player set alone.

It runs last for the entry: after what it inherits (the curated row or the
scan, then its standing, roll and spend rows) and after its `drop`, the entry's
own `amend` first, then each pack's in the player's order, so the later price
wins. It reaches only what the entry inherits, never an action its author wrote
or a pack's `effects` or `add` gave. An entry that replaces what it inherits
(`replace: true`, or a pack's `effects`) has nothing for it to price, and an
`amend` that finds no action says so on the sheet; a patch with both `effects`
and `amend` says so once, as the pack is read. One whose `effects` are an
item's charges alone keeps its `amend`, since on another kind of entry they
replace nothing: the sheet prices that entry, or says on an item that the price
finds nothing. It reaches what `drop` reaches:
class and subclass features, feats, optional features and species traits. Items
add their charges after it, and backgrounds price nothing themselves.

The Workshop's "Change its price" card makes one on a copy of any of those that
still does what the original does: Action (empty for its first), then the
Action card's price boxes, where an empty box keeps what the action has and
"Same pool" changes how many uses of its pool it spends. Renaming one of the
copy's own pools moves its prices too, and starting from nothing clears them.

Every price is a row in `spend.json`: the pool prices since 3b and 3c, the
spell slot and Hit Point Die prices and Divine Reaper's since 3d, so no spend
link is left in code. JSON holds no comments, so the reasons the tables gave
beside their rows are kept here:

- Monk prices name `focus`, the 2024 pool; `costOnSheet` finds a 2014 monk's
  ki (`SAME_POOL`).
- Radiant Sun Bolt's row prices the bonus attacks: the bolt alone is part of
  the Attack action and spends nothing.
- Lunar Phenomenon is once per benefit, with three benefits. The sheet does not
  track which was used, so repeating one while another is left is a manual pip
  tap.
- Telekinetic Master's chip is the bonus attack, and the use it buys back is the
  granted spell's (`ownSpell`).
- The Death Knight's `death-coil` d8s stand where a paladin has Lay on Hands.
- 2024 Turn Undead and Divine Spark are options of the parent feature and never
  name the pool, nor do Divine Sense, Champion Challenge and Dreadful Aspect;
  their rows say which Channel Divinity they spend.

The curated tables' comments gave these reasons beside their rows:

- Stunning Strike states its effect but leaves the DC to the ki save DC of the
  Ki (Monk's Focus) feature, which the prose scan cannot read from another
  feature, so its row pins it: a Constitution save against 8 + proficiency +
  Wisdom modifier. It rides on a hit, so it takes no action of its own; its
  cost is a spend row.
- The Paladin's Channel Divinity pool has a key of its own, not the Cleric's:
  the 2024 text says "each time you use this class's Channel Divinity", and a
  shared key made the uses depend on the class added first.
- Tasha's Harness Divine Power has uses of its own by class level. The scan
  read one pool for both spells, and nothing in the 2024 printing.
- The 2014 Dragon Ancestor's doubled proficiency with dragons stays in the
  feature's card.
- Most limited-use species traits (Relentless Endurance, Breath Weapon, Fey
  Step, Stone's Endurance) are left to the prose scan, which reads each
  printing's own wording. A trait has a curated row only for what prose cannot
  show: a standing number with no usage phrasing.

## Loading

Each file is a dynamic `import()` listed in `src/data5e/builtInRules.ts`, so the
build gives it a chunk of its own, `assets/rule-set-*.js` (`chunkFileNames` in
`vite.config.ts`). The service worker precaches it like any other chunk, so it
works offline, and the bundle budget measures it on a line of its own
(`rulesBytes`, `rulesGzipBytes`). The registry loads them beside the release
and hands them to every engine context (`byType('ruleSet')`).

If a file fails to load, none counts and every sheet says so ("The built-in
rules did not load ... Reload to try again"). A reload always tries again; the
next registry build in the same page does too, though a browser may keep the
failed chunk until the page reloads.

A built-in formula never spends the player's per-derive formula budget, so the
rows the app ships cannot crowd out a player's pack.

Anything that builds a registry outside the app needs the sets too, or it reads
the moved entries as prose: `scripts/data-audit.ts` and `scripts/data-judge.ts`
call `requireBuiltInRules()`, which throws when they did not load, and the audit
counts an entry curated when a built-in row replaces its scan. Tests get them
from `BUILT_IN_RULE_SETS` in `tests-fixtures/testWorld.ts`, which a test keeps
equal to what the loader loads.

## Adding a file

Add it under `src/rules/`, list it in `FILES` in `builtInRules.ts` and in
`BUILT_IN_RULE_SETS`; the tests fail on a file not listed. They also fail on a
row the reader leaves anything out of.

## Adding or changing a row

1. Write the row with its effects in the order they should be added: a spend
   link, for one, finds the first action of an origin.
2. Test it through the seam (`emitRow` in `curatedRows.test.ts`, `emit` in
   `standingRows.test.ts`, `emitRolls` in `rollRows.test.ts`, `emit` in
   `paidRolls.test.ts`); a test context or registry holds
   `BUILT_IN_RULE_SETS`, as every registry does.
3. Compare the whole tree with `scripts/rules-diff.ts` against the base commit,
   at both answer ends (below): only the builds the row is meant to change may
   change, and a row rewritten to the same effect changes none. A row no build
   reads (`--coverage`) needs a test of its own, since a zero change says
   nothing about it.
4. For a row the roll prompt prices (a spend row, a paid extra or a reroll),
   check the roll prompt's prices too (`scripts/roll-price-census.ts`, below),
   and that the census can see the change: run it once with the rows doing
   nothing, and when that changes nothing, its zero proves nothing for those
   keys (for a spend row, no paid extra is priced as its action).

Every row but the few written new (Tasha's Roving, above) came out of a code
table (rule pack port phases 0 to 4), proved by the tools under "Proving a
move out of code", below, and the tables, their lookups and the call sites'
fallback to them are gone.

The stored effect format is the one rule packs use, so a row that needs a field
the format lacks widens the format for players too: `dcAbility: "strOrDex"` (a
maneuver's DC) came in with Disarming Attack.

A row that needs a class's level takes a level table or `classLevel` (where
its code row read a named class's level, `classLevel(col, 'Fighter')`), which
read the level its call site passes: the class being walked for a class feature, the host class for an
optional feature, and the character's level for a feat or a trait. That is the
level of the class that gives the feature, which the owner chose (2026-11-14)
over the first class that is or stands for the named one. The two differ
where the class walked is not the one the code named:

- Two classes stand for one (a Fighter and a Warrior, which reskins it). Each
  gives the feature at its own level. A pool of one key keeps the first class's
  unless it stacks, so a Warrior 2 taken before a Fighter 17 has one Action
  Surge, while a Sorcerer 5 and an Evoker 3 (WoW) add their own 5 and 3 sorcery
  points, where the code gave 5 twice.
- A subclass row, found under the subclass's name, under another class: a
  homebrew Diviner for a Bard 14 has Portent's three rolls at Bard 14, where the
  code read the character's Wizard level (none).

A row that adds to a class's spells takes `"ownClass": true` on a spell damage
bonus (where its code row named the class, `className: 'Cleric'`, read as the
character's class of that name, else one reskinning it, else one copying it). The call site passes the
class that gives the feature beside its level (`MechanicsSubject.className`):
the class walked for a class's or subclass's feature, the host class for an
optional feature it offers. `emit()` writes that class's name into `className`,
so a reskin's spells are its own (a Mage's Empowered Evocation adds to the
Mage's evocations). A feat, a species trait or an item has no class that gives
it, so its row with `ownClass` adds nothing. The two differ in the same places
as the level: a Cleric beside a class reskinning it has each one's Potent
Spellcasting for its own cantrips, a Light Domain taken under a Bard adds to the
Bard's, and a subclass taken under two classes adds to each.

A spell grant takes `"ownClass": true` as well: it is cast with the
spellcasting ability of the class that gives it, read from that class's data
when the effect is emitted, in place of an `ability` of its own (naming both is
a problem). A feat's, or one a class that casts no spells gives, has no ability.
When that class's own data counts casts of the spell at any level (a Death
Knight's Rune Strike, in its `additionalSpells`), the class's row gives them, so
the grant is left out rather than shown twice, with the pool its `resourceKey`
names from the same list, unless another effect kept there names that pool too.
The code found the class by the feature's card, which is the class's only for a
class's own feature: from a subclass's or an optional feature's card it found
none, so such a grant had no ability and was never left out. It now reads the
class that gives it, as a level does. The Workshop's "Cast a spell" card shows a
file's `ownClass` as "The class that gives it", and picking an ability there
puts the ability in its place.

A row whose pool or action words change with the class level (a die in a name,
a rest that changes at level 5) takes a level table of words,
`{ "byLevel": { "1": "1d8", "10": "1d10" } }`, read the way an amount's table is:
the words at the highest level reached, at the level its call site passes. A
pool's `label`, `die` and `reset` take one, an action's `label`, `roll` and
`note`, and a spell grant's `usage` (the 2024 Favored Enemy's "2/day" to
"6/day"). They are filled in when the effect is emitted, before an entry's `drop`
looks at its label. Below a table's first level the field is left out (the
2024 Warding Flare's note from Cleric 6), so a table for a field the effect
needs (a `label`, a `reset`) starts at level 1. A player's file takes the same
tables; the Workshop shows one as "By level, as written" and puts a single
value in its place when the box is changed, as it does for an amount's table.

A row that differs by the character's rules version (`doc.rulesVersion`, the
2014 or 2024 rules the player picked, not the feature's printing) takes
effects that say `"edition": "2014"` or `"edition": "2024"`: any stored effect
may name one, and it counts only under that version, as though it were not
there under the other (it keeps no pool another effect names). An effect
without one counts under both. A character with no rules version, or one the
app does not know, plays 2014, as the sheet reads it everywhere. Second Wind's and both Channel Divinities' pools
differ by version this way, and Lay on Hands' action; a 2014 Fighter under 2024
rules has the 2024 uses, as the code gave. An effect in play (a condition, a
moment's effect, a spell's on a target) holds under the rules of the sheet it is
on, so one naming an edition is a problem there and does not count. Every
Workshop card has a "Rules" box ("Either rules" takes the version away), but a
card in play (a condition's, a spell's on its target) shows it only while a file
sets one, to take it away. A value that is not a version shows as written, so
"Either rules" can take it away too. A pool given once for each version under
one key is one pool there: an action lists it once to spend, and renaming one
renames both. The class editor's pools have the same box, and a pool of one
version gets an "Add its 2024 rules version" button (or 2014) that copies it
under its key, unless a pool of that version already has its key or its name:
two halves of one pool, each its own column in the class table ("Vigil (2014
rules)"), named and renamed as one. Two pools there may share a name only when
they count under different versions.

A pool takes `"ownClass": true` too: the sheet names it for the class that
gives it, after its words by level, "Channel Divinity (Paladin)", so the
Paladin's and the Cleric's pools of one name show apart. With no class giving
it, it has its own name alone (the code named a Paladin's pool for the
character's Paladin, or "Paladin"). The Workshop's line for the pool says it is
named for the class, and its "Class in the name" box sets it.

An action takes `"ownClass": true` as well, so an action sharing such a pool's
name still spends a use of it. A pool or an action may instead take
`"ownClassBeside"`, a list of class names: it is named for the class that gives
it only when the character has another class of one of those names, or one
reskinning or copying it, as a curated row finds a class. Harness Divine Power
is "Channel Divinity: Harness Divine Power" alone and "Channel Divinity:
Harness Divine Power (Cleric)" beside a Paladin, its pool and its action alike.
An effect takes one of the two, not both. The code named both for "Cleric" and
"Paladin"; the row names them for the class that gives them, so a Workshop copy
of the 2014 Paladin beside a Cleric has its own name there. No reskin in the data
has the feature (each reskins a 2024 class). A Paladin, a copy of it and a Cleric
keep the first class's pool, as any two pools of one key do, so the copy's action
finds no pool of its name and spends only Channel Divinity. The Workshop's lines
say which, and a pool's or an action's "Class in the name" box picks its own name
alone, the class that gives it, or the class beside the classes typed in.

## Checking a change on real data

`scripts/rules-diff.ts` derives about 10,800 builds over the pinned release
(every class and subclass across levels in both editions, every feat, race,
background, optional feature and magic item, every mundane item whose tags
give something while worn, and some multiclasses) and
records a hash of each sheet field, about 32,500 sheets in all, in about six
minutes. It makes each build three times: with every
ability 14; with every ability 8 (ids ending `[8s]`), where a minimum such as
`max(1, mod.cha)` shows; and raging at 1 hit point (`[on]`), since an effect
that holds only while raging or bloodied is on no sheet otherwise, so a wrong
one would change nothing. Since a build answers each pick with its first
option, a class build at level 20 in its own edition is also made once for each
later option of each feature pick that is not greyed out (Totem Spirit's Elk,
ids holding `| <pick> = <option>`).

Picks need more (rule pack port 4a). A spell pick has no options to take, so
it is answered with the spells its query fits, sorted by `name|source` (by
level and school, not by class list). An "in place of" pick opens only on what
is held, so each subclass is built again at levels 3, 7 and 20 with a
background giving the skills and tools those picks name (ids starting
`held`), and after a first level of Wizard, whose saves (INT, WIS) they name
(`saves`). `--answers last` answers every prompt with its last usable options
instead, so take both snapshots both ways. Beside the hashes, `prompts` keeps
each build's prompts in words (id, count, label, open ones marked), and
`compare` prints the lines one side lacks, so a moved id shows by name. With
`choices` hashed too, a build whose sheet and choices match on both trees
reads the base tree's saved answers on the new one unchanged: no saved answer
is lost or asked again.

A change meant to move no sheet (a refactor, a row rewritten to the same
effect) must change none:

```bash
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts snapshot --release <cache.json> --out before.json
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts snapshot --release <cache.json> --out after.json
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts compare before.json after.json --expect-zero
```

`--release` caches the release in that file on the first run, so both sides
read the same data. Take `before.json` in a checkout of the base commit (with
this script copied in when the base has none). `compare` names the builds that
changed, field by field, and with `--expect-zero` exits 1 when any did.

`snapshot --coverage <file>` also writes the built-in rows no build read (by
what the call site reads: a spend row's links, a charges row's numbers, a
spell rest row's spells, any other row's effects), by part, first key and level. A row read is not a row
that added something, but a row at one level, named with `@` and the level, is
read only where it adds, and a row never read is one a zero change says
nothing about, so a change to one is proved another way: a test of its own.

`scripts/roll-price-census.ts` records what the roll prompt offers for every
paid die or bonus and every reroll (`pricedRollEffects`), with what paying
takes, on about 3,300 builds: every class and subclass at 20 in both rules
versions and with the optional class features, each later option of each
feature pick, every optional feature in up to two hosts, every feat on a
Fighter 4 and a Wizard 20, and every race and subrace. A paid extra is priced
as its feature's action, whose cost a spend row often sets, and the price is
worked out in the prompt, not on the sheet. It sees a spend row only through a
paid extra priced as that row's action, with no use spent, so a buy-back, and
a slot or Hit Point Die price (which the prompt never offers), never shows: the
15 keys of 3b changed nothing when they linked nothing, while every link
linking nothing changes 729 riders. A change to spend rows meant to move no
price must change none, taken as `rules-diff` takes its snapshots:

```bash
bun --tsconfig-override=tsconfig.app.json scripts/roll-price-census.ts snapshot --release <cache.json> --out before.json
bun --tsconfig-override=tsconfig.app.json scripts/roll-price-census.ts compare before.json after.json --expect-zero
```

### Proving a move out of code

Two tools proved each row against the code row it replaced while both were in
the tree, and went with the last tables, since with no code row they compare
nothing. To move a mechanic out of code again, restore them from 65e79a2
(`git show 65e79a2:scripts/rules-probe.ts`, and `pick-census.ts`) beside the
code table, with a call site fallback for them to hide.

- `scripts/rules-probe.ts` derived each build that read a moved row twice in
  one process, once with the code row and once with the data row, comparing
  every sheet field and the actions and pools the build collected. Its builds
  went wider than `rules-diff`'s: every level from 1 to 20, five ability arrays
  (every score 14, 8, 3 or 20, and a mixed one), raging at 1 hit point, heavy
  and light gear, and multiclasses where the class's level is not the
  character's. So it also caught what the reader rewrites as it reads (a
  `false` flag read as absent, a list's repeats dropped, a skill's case), level
  table thresholds at levels `rules-diff` does not build, and a gear condition
  (`unless`, a ranged or melee scope, `weaponsOnly`) that differs. A change to
  a row now has only `rules-diff`'s builds and the row's tests to show those.
- `scripts/pick-census.ts` checked a pick row against its code row for every
  answer (every option, every spell the query fits), where `rules-diff` sees
  only the first and last, with some and with all of what an "in place of" row
  names held. A pick row's other answers now have only its tests.
