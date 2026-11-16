# Built-in rule sets

A built-in rule set is data the app ships in place of code: rows of effects
that stand in for the engine's hard-coded mechanics tables. It holds five
parts: `curated`, which stands in for `CURATED`
(`src/engine/curated/curatedEffects.ts`); `standing`, which stands in for
`STANDING` (`src/engine/curated/standingEffects.ts`); `rollAdvantage`, which
holds what was the advantage table, `ROLL_ADVANTAGES`; `rollExtra`, which
stands in for `ROLL_EXTRAS` (`src/engine/curated/rollExtras.ts`); and `spend`,
which holds what were the spend links, `SPEND_LINKS` and `SLOT_LINKS`
(`linkSpend` in `src/engine/curated/spendLinks.ts` reads it). The files live in
`src/rules/`, one a part. (Source of truth: `readRuleSet` and
`mechanicsOf` in `src/engine/effects/mechanics.ts`, `src/data5e/builtInRules.ts`.)

169 rows have moved so far (`src/rules/cast-guidance/curated.json`). Four came
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
prose scan off (2014 Roving and Feral Senses, 2024 Remarkable Athlete).
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
(rule pack port 2h): the Cleric's and the Paladin's Harness Divine Power. The
rows left in `CURATED` need something the format lacks: a pick or an engine
call.

63 `standing` rows have moved (`src/rules/cast-guidance/standing.json`): every
`STANDING` row the format holds, the defenses, senses and speeds a subclass or
optional feature adds beside what its prose scan reads, eight of them split by
printing (Avatar of Battle, Aura of Warding, Aura of Devotion, Second-Story
Work, whose 2014 row adds nothing). The 14 left in `STANDING` need a pick (Bestial Soul,
Fiendish Resilience) or what the character has already (darkvision that grows,
a save it may have, the branch or cantrip it picked).

Every advantage row has moved, under 181 keys (`src/rules/cast-guidance/roll-advantages.json`):
advantage on the character's own d20 tests that a feature, feat, optional
feature or species trait states only in prose, which always holds (Feral
Instinct on initiative), holds while a state the app sees (Bloodied), or holds
only when the player says (`when`, Brave against being Frightened). So has every
free die of `ROLL_EXTRAS`, 26 rows (`src/rules/cast-guidance/roll-extras.json`):
the dragonmarks' d4 that rolls in with a skill's checks. The 75 keys left in
`ROLL_EXTRAS` are paid extras and rerolls: a price the sheet works out from the
feature's Use, and fields (a reroll's die, a number set, a floor, a bonus by
class level) the format does not have.

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

## A file

```jsonc
{
  "type": "ruleSet",
  "v": 1,                      // the Cast Guidance version, as a rule pack's
  "name": "Built-in rules",
  "edition": "both",           // "2014", "2024" or "both"; optional
  "rows": [
    {
      "part": "curated",                // the code table it stands in for
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
    }
  ]
}
```

- **`keys`** are the keys the code table uses, matched without case. A key
  already taken by an earlier row of the same part in the same file is left
  out, and the reader says so.
- **`scan`** (`curated` rows): `replace` turns the prose scan off for the
  entry, as a `CURATED` row does; `keep` runs the scan beside the row. A row
  of any other part has no `scan`: it always runs beside the scan.
- **`level`** (every part but `curated`, optional): the row counts only for the feature
  gained at that level, 1 to 20, which tells apart features of one name (Storm
  Herald's Desert at 3, 6 and 14). A key is taken once per level, so a key may
  have a row at each of several levels and one for every level. The first key
  with a row at any level wins: a feature whose key has rows only at other
  levels gets none, and the walk does not go on to a later key, as `STANDING`
  and `ROLL_EXTRAS` answer today, and the advantage table did.
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
- A row the reader cannot read is left out, and the rest still count. What it
  left out goes to the console once, not the sheet: the files are the app's, so
  a problem in one is a bug its tests catch, not something a player can fix.
- At most 5,000 rows a file and 16 keys a row (`RULE_SET_LIMITS`).
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
printing with no row of its own. Code rows have no printing in their keys: they
test it in code, and a printing's built-in row stands in for the code row under
the key alone.

The first key with a row wins, in the order the call site tried `CURATED`, and
across both tables: while rows are moving, a `CURATED` row under an earlier key
is still the one read (`inCode`). Items have no keys yet, and a subclass has no
row of its own.

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

## Where a row sits

A row is the curated row of the entry it is found for (layer 3 of the seam,
ADR-001), so it keeps every rule a `CURATED` row has:

1. A player's rule pack patch that replaces the entry wins over it; a pack's
   `add` sits beside it.
2. The entry's own `castGuidance` comes first; its `drop` reaches the row's
   effects, and its `replace: true` leaves the row out.
3. The row is emitted in place of `CURATED`, with the entry's own origin
   object, which spend links find actions by. The rest of layer 3 (standing
   rows, roll rows and `ROLL_EXTRAS`, spend links) runs as before.

A `standing` row runs where `STANDING` runs, after the curated row or the prose
scan: beside them, with the entry's origin object, and after the curated row's
`from`, so the entry's `drop` reaches it and an entry or pack that replaces
what it inherits leaves it out, as before. Its formulas read the class's level
the curated row's read.

A roll row runs where the roll tables ran, after the standing rows, with the
origin they had: the feature's, feat's or option's own object, and for a trait
the race's labelled with the trait's name (Brave, not Halfling), so the roll
prompt names the trait.

A spend row runs where the spend links ran, last, with the same origin object.
An entry's `drop` reaches the chips it adds, and an entry that replaces what it
inherits leaves it out.

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
Renaming a pool moves every price that names it, and a pool never takes
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
spend rows are the app's.

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
`BUILT_IN_RULE_SETS`; the tests fail on a file not listed. They also fail on a row the reader leaves anything
out of, and on a key its part's code table (`CURATED`, `STANDING` or
`ROLL_EXTRAS`) still has (the row would never be the one read, or the code row
would be dead).

## Moving a row out of code

1. Write the row with the effects the code row adds, in the code's order: a
   spend link, for one, finds the first action of an origin.
2. With the code row still in place, run `scripts/rules-probe.ts` (below). It
   must find no difference and no row that no build reads. (Until step 3 the
   tests fail on the key both tables hold.)
3. Delete the code row. A section whose rows moved keeps one comment pointing
   at the JSON, not one per row.
4. Compare the whole tree with `scripts/rules-diff.ts` against the base commit:
   zero change.
5. A test that read the row through a code table reads it through the seam
   instead (`emitRow` in `curatedEffects.test.ts`, `emit` in
   `standingEffects.test.ts`, `emitRolls` in `rollRows.test.ts`); a test
   context or registry holds `BUILT_IN_RULE_SETS`, as every registry does.
6. For a row the roll prompt prices (a spend row, a paid extra or a reroll),
   the roll prompt's prices must not change either
   (`scripts/roll-price-census.ts`, below), and the census must be able to see
   the move: run it once with the moved rows doing nothing, and when that
   changes nothing, its zero proves nothing for those keys (for a spend row, no
   paid extra is priced as its action), so the probe is the proof.

The stored effect format is the one rule packs use, so a row that needs a field
the format lacks widens the format for players too: `dcAbility: "strOrDex"` (a
maneuver's DC) came in with Disarming Attack.

A code row that reads a named class's level (`classLevel(col, 'Fighter')`)
moves to a level table or `classLevel`, which read the level its call site
passes: the class being walked for a class feature, the host class for an
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

A code row that names a class's spells (`className: 'Cleric'`, read as the
character's class of that name, else one reskinning it, else one copying it)
moves to `"ownClass": true` on a spell damage bonus. The call site passes the
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

A code row that builds a pool's or an action's words from the class level (a
die in a name, a rest that changes at level 5) moves to a level table of words,
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

A code row that reads the character's rules version (`doc.rulesVersion`, the
2014 or 2024 rules the player picked, not the feature's printing) moves to
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

`scripts/rules-diff.ts` derives about 8,600 builds over the pinned release
(every class and subclass across levels in both editions, every feat, race,
background, optional feature and magic item, and some multiclasses) and
records a hash of each sheet field, about 26,000 sheets in all, in about two
minutes. It makes each build three times: with every
ability 14; with every ability 8 (ids ending `[8s]`), where a minimum such as
`max(1, mod.cha)` shows; and raging at 1 hit point (`[on]`), since an effect
that holds only while raging or bloodied is on no sheet otherwise, so a wrong
one would change nothing. Since a build answers each pick with its first
option, a class build at level 20 in its own edition is also made once for each
later option of each feature pick that is not greyed out (Totem Spirit's Elk,
ids holding `| <pick> = <option>`).
Moving rows out of code must change none:

```bash
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts snapshot --release <cache.json> --out before.json
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts snapshot --release <cache.json> --out after.json
bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts compare before.json after.json --expect-zero
```

`--release` caches the release in that file on the first run, so both sides
read the same data. Take `before.json` in a checkout of the base commit (with
this script copied in when the base has none). `compare` names the builds that
changed, field by field, and with `--expect-zero` exits 1 when any did.

`snapshot --coverage <file>` also writes, for each code table (`CURATED`,
`STANDING`, `ROLL_EXTRAS`) and the built-in rows
(a spend row's links), the keys no build read. A row read is not a row that added something (a code row for one
feature level is read at every level and adds at one; a built-in row at one
level, named with `@` and the level, is read only where it adds), but a row never read is
one zero change says nothing about, so a move of one is
proved another way, before the code row goes.

`scripts/rules-probe.ts` is that proof. It runs while a row is in both places
(a built-in row whose key its part's code table, `CURATED`, `STANDING` or
`ROLL_EXTRAS`, still has) and derives
each build that reads the row twice in one process, once with the code row and
once with the data row, comparing every sheet field and the actions and pools
the build collected, since the sheet drops a price the character cannot pay (a
pool or slots it lacks). On the code side a row drops only its moved keys, so a
key that shares the row and moved earlier, with no code row left, still reads
it; a key new to a row, with no code row, reads it both ways and is never
compared, so `rules-diff` against the base is what shows it. Until 3d it also
linked each moved spend key alone, both ways, in each state a feature may
leave its actions in, which proved a key no build reads; that check went with
the link tables. Its builds go wider than
`rules-diff`'s. Each class and subclass that reads a moved row is built at
every level from 1 to 20 in four states: plain and raging at 1 hit point, each
with five ability arrays (every score 14, 8, 3 or 20, and a mixed one), and in
heavy gear (plate, a shield, a longsword and a longbow) or light gear (leather
and the longsword alone), each with two. It is built again as a multiclass
where the class's level is not the character's (levels 1 to 17 and three of
another class, raging, three arrays). Every feat, optional feature and race
that reads one is built across levels in the four states, a feat on a Fighter
and again on a Wizard, whose slots a slot price needs. So it also catches
what the reader rewrites as it reads (a `false` flag read as absent, a list's
repeats dropped, a skill's case), level table thresholds at levels
`rules-diff` does not build, and a gear condition (`unless`, a ranged or melee
scope, `weaponsOnly`) that differs.

It sees one entity at a time: a class alone, a feat or a race on a bare
Fighter or Wizard. A row that differs only beside another entity's row is beyond it, so
such a row needs a test of its own (the initiative `profBonus` above counts
once across features, and a formula's number would not).

```bash
bun --tsconfig-override=tsconfig.app.json scripts/rules-probe.ts --release <cache.json>
```

A full run takes about 35 minutes (about 50 for the 287 spend keys of 3c);
`--only <text>` probes only the moved keys
that hold the text, in a minute or two, and may be given more than once (a
mutant of several rows in one run). It exits 1 when a sheet differs or a moved
row is read by no build. A build that throws the same way both times compared no sheet, so it
counts for no row, and the summary says how many did.

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
linking nothing changes 729 riders. A move of spend rows must change none,
taken as `rules-diff` takes its snapshots:

```bash
bun --tsconfig-override=tsconfig.app.json scripts/roll-price-census.ts snapshot --release <cache.json> --out before.json
bun --tsconfig-override=tsconfig.app.json scripts/roll-price-census.ts compare before.json after.json --expect-zero
```
