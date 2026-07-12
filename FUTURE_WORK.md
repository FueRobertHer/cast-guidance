# Future work

Known gaps and planned improvements, ordered roughly by player impact. Items
here were consciously deferred — each lists why and what "done" looks like.

## Curated content linkages (the Dragonborn treatment, applied everywhere)

The engine now supports typed actions (damage type, area, save DC) and
pre-answered choice prompts. PHB Dragonborn ancestry is fully linked
(subrace → resistance auto-resolved → breath weapon typed with computed DC in
`src/engine/effects/race.ts`). The same treatment is still needed for:

- **2024 (XPHB) Dragonborn** — ancestry is a choice prompt in data rather than
  a subrace; the chosen ancestry should type the breath weapon the same way.
- **FTD Chromatic/Metallic/Gem Dragonborn** — different breath mechanics
  (Metallic gets a second breath, Gem gets telepathy; areas differ).
- **Warlock** — pact choice should gate invocation options; invocations with
  prerequisites should disable with reasons.
- **Cleric domains / Druid circles / Sorcerer origins** — domain spells are
  granted (additionalSpells) but "always prepared" isn't surfaced as such in
  the spell manager.
- **Paladin auras, Monk ki save DCs, Battle Master maneuver DCs** — the new
  `save` field on action effects can carry these; curated entries needed.
- **Aasimar revelations, Genasi, Tortle shell** — verify prose scanner output
  and curate where the text defeats it.

Approach: keep the prose scanner as the long tail, add curated entries only
where a printing's mechanics can't be extracted from its own text (the
`_versions` template substitution problem that hit Dragonborn).

## Creation wizard

- **Point-buy assistant** — auto-assign exists for the standard array; a
  "spend my 27 points for a <class>" preset would serve optimizers.
- **Racial ability-bonus awareness in auto-assign** — the priority tables are
  class-only; a Half-Elf Paladin should be nudged differently than a
  Dragonborn Paladin.
- **Equipment gold alternative** — 2024 rules offer "gold instead of gear";
  the wizard only grants the gear bundles (gold entries become note items).
- **Background equipment slots** — class `equipmentType` slots get concrete
  pickers; backgrounds occasionally have them too (rare; currently a labeled
  note item).
- **Multiclass in the wizard** — deliberate: the wizard is single-class; the
  Build page handles multiclassing. Revisit if new players ask for it.
- **Spell picking guidance** — the Spells step lists everything castable;
  "recommended starter spells" per class would complete the decision support.

## Sheet & play

- **Attacks tap-to-explain** — actions and resources open their rules text;
  weapon attack rows should open the item card the same way.
- **More tab deep filter** — the filter matches card names; racial traits
  live nested inside the race card ("breath" doesn't find Breath Weapon).
  Fix: index nested entry names, or split race cards into per-trait cards.
- **Consumed-resource ↔ action link** — rolling Breath Weapon's dice doesn't
  tick the resource pip; a "use it" affordance that rolls AND spends would
  close the loop.
- **Conditions explainers** — condition chips should tap-to-explain like
  actions do (data exists in the `condition` entity type).
- **Death saves UI** at 0 HP.

## Accessibility

- Picker buttons and choice chips now carry accessible names; a full
  screen-reader pass (focus order, drawer focus traps, live regions for roll
  results) hasn't been done.
- Color-only proficiency dots on the Stats tab need a non-color signal.

## Data / engine

- **`_versions` `_mod` against merged race+subrace entries** — subrace
  version mods that target base-race entries (removeArr/replaceArr) silently
  no-op because the subrace template has no entries of its own. Fixing this
  in `copyMod.ts` would give every versioned subrace its substituted prose
  (and would let the curated Dragonborn table shrink).
- **Choice descriptions for tools/instruments** — skills have curated
  one-liners; tool proficiencies are still bare names.
- **Stale choice garbage collection** — removing a race/background leaves
  orphaned `doc.choices` keys (harmless but untidy); class removal cleans up
  after itself, the others should too.
