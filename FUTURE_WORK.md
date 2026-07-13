# Future work

Known gaps and planned improvements, ordered roughly by player impact. Items
here were consciously deferred — each lists why and what "done" looks like.

## Curated content linkages (the Dragonborn treatment, applied everywhere)

The engine supports typed actions (damage type, area, save DC), level-scaled
dice (both 2014 "3d6 at 6th level" and 2024 "levels 5 (2d10)" phrasings), and
pre-answered choice prompts. **Done:** PHB *and* 2024 (XPHB) Dragonborn
ancestry are fully linked in `src/engine/effects/race.ts` — the ancestry
(subrace name for 2014, race name for 2024) resolves the resistance and types
the breath weapon with a computed DC. The scanner's save-DC matcher now
accepts both rules editions' wording. Still needed:

- **FTD Chromatic/Metallic/Gem Dragonborn** — *done* (breath weapon). Their
  `_versions` substitute the real damage type into the breath-weapon prose, so
  the scanner types them directly (chromatic = 30-ft line, gem/metallic = 15-ft
  cone, all DEX saves) — no curated entries needed. The fix was making
  `linkDraconicAncestry` *gap-filling* instead of clobbering: the PHB-based
  table listed e.g. green as a cone/CON save, which was overwriting the correct
  chromatic line/DEX. The scanner also learned the FTD "5th level (2d10)"
  scaling phrasing. Still not surfaced as distinct chips: Metallic's second
  breath option (enervating/repulsion) and Gem's flight/telepathy utility.
- **Warlock invocations** — *partially done*: every optional-feature pick
  (invocations, metamagic, maneuvers, fighting styles) now shows its
  prerequisite text (level, Pact Boon, patron, known spell) in the option
  description, and options with an unmet **level** prerequisite are disabled
  with a reason. Still deferred: enforcing pact/patron/known-spell gates, which
  depend on *other* picks the class collector doesn't resolve at option-build
  time (they'd need a second pass over the resolved Pact Boon / spell list).
- **Cleric domains / Druid circles / Paladin oaths** — *done*: subclass
  `additionalSpells` are now collected (they live on the subclass entity, not
  its features, and were previously dropped entirely), the `prepared` key is
  granted as always-prepared with the class's spellcasting ability, and the
  sheet tags them "Always prepared" (`src/engine/effects/additionalSpells.ts`,
  `class.ts`, PlayTab). Warlock `expanded` lists surface as a note since we
  have no learn-a-spell picker yet.
- **Class-wide save DCs** — *partially done*. Monk **Stunning Strike** is now
  curated (Con save vs 8 + prof + Wis) because its DC lives in a separate
  feature the prose scanner can't reach. **Battle Master maneuvers stay
  deferred**: the maneuver DC is "8 + prof + your Strength *or* Dexterity
  modifier (your choice)" — an unresolved player choice, so auto-picking one
  ability would print a wrong DC. Revisit once maneuvers get a DC-ability
  prompt. The scanner already handles features that restate the formula.
- **Aasimar revelations, Genasi, Tortle shell** — verify prose scanner output
  and curate where the text defeats it.

Approach: keep the prose scanner as the long tail, add curated entries only
where a printing's mechanics can't be extracted from its own text (the
`_versions` template substitution problem that hit Dragonborn).

## Creation wizard

- **Picker descriptions** — *done*: class/race/background pickers carry curated +
  data-derived one-liners, and the **subclass** picker (both the wizard and the
  Build editor) now summarizes each subclass's identity feature via a shared
  `makeSubclassBlurb(registry)` — answering "what makes these different" without
  curating hundreds of subclasses.
- **Point-buy assistant** — *done*: a per-class "focus 15/15/15" preset is
  offered in point-buy mode (standard-array auto-assign already existed).
- **Racial ability-bonus awareness in auto-assign** — deferred. Analysis:
  fixed racial bonuses (2014) don't change the optimal base-array assignment,
  and choice bonuses (Half-Elf) are a separate prompt — so the payoff is
  marginal and the "priority vs boosted" interaction is subjective. Revisit
  only if players ask for a smarter dump-stat placement.
- **Equipment gold alternative** — 2024 rules offer "gold instead of gear";
  the wizard only grants the gear bundles (gold entries become note items).
- **Background equipment slots** — class `equipmentType` slots get concrete
  pickers; backgrounds occasionally have them too (rare; currently a labeled
  note item).
- **Multiclass in the wizard** — deliberate: the wizard is single-class; the
  Build page handles multiclassing. Revisit if new players ask for it.
- **Spell picking guidance** — the Spells step lists everything castable;
  "recommended starter spells" per class would complete the decision support.

## Sheet & play — mostly done

- ~~Attacks tap-to-explain~~ — *done*: weapon rows open the item's prose plus
  a plain-English gloss of each property (`src/features/sheet/weaponInfo.ts`).
- ~~More tab deep filter~~ — *done*: matches nested trait names and full body
  text via `flattenEntries`.
- ~~Consumed-resource ↔ action link~~ — *done*: rolling a limited-use action
  spends its resource pip (`RollChip.onRolled`), and each action shows
  "N/max left".
- ~~Conditions explainers~~ — *done*: active conditions get a "what these do"
  strip that opens the rules text.
- ~~Death saves UI~~ — already present (nat-1/nat-20 handling, Durable feat).

Spending a use without a roll already works: tap the next resource pip (a
max-1 resource is a single tappable pip), so no separate "use it" button is
needed.

- **Recommended starter spells** — *done*: the spell picker now shows a curated
  "New to {Class}? Solid first picks: …" shortlist plus a ★ on recommended
  cantrip/1st-level rows (`src/features/sheet/spellHints.ts`), for all nine
  spellcasting classes. The full list stays fully selectable — this is guidance,
  not a gate. Higher-level "what to pick as you level" guidance is still open.

Remaining: spell-slot tap-to-cast polish.

## Accessibility

- ~~Color-only proficiency dots~~ — *done*: `ProfDot` distinguishes by shape
  (ring / filled / ringed) and carries the state as screen-reader text.
- Picker buttons and choice chips carry accessible names; a full screen-reader
  pass (focus order, drawer focus traps, live regions for roll results) still
  hasn't been done.

## Data / engine

- **`_versions` `_mod` against merged race+subrace entries** — subrace
  version mods that target base-race entries (removeArr/replaceArr) silently
  no-op because the subrace template has no entries of its own. Fixing this
  in `copyMod.ts` would give every versioned subrace its substituted prose
  (and would let the curated Dragonborn table shrink).
- ~~Choice descriptions for tools/instruments~~ — *done*: `toolOptions` adds a
  use hint per tool (falls back to a category label).
- ~~Stale choice garbage collection~~ — *done*: `pruneChoicesFor` sweeps
  orphaned picks when race, subrace, background, or class change.
