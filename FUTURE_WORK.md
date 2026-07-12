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

- **FTD Chromatic/Metallic/Gem Dragonborn** — different breath mechanics
  (Metallic gets a second breath, Gem gets telepathy; areas differ). Extend
  the `DRACONIC_ANCESTRY` table + `linkDraconicAncestry` branch.
- **Warlock** — pact choice should gate invocation options; invocations with
  prerequisites should disable with reasons.
- **Cleric domains / Druid circles / Sorcerer origins** — domain spells are
  granted (additionalSpells) but "always prepared" isn't surfaced as such in
  the spell manager.
- **Class-wide save DCs (Monk ki, Battle Master maneuvers, etc.)** — these
  features reference a DC *defined in a separate feature* ("your ki save DC"),
  so the prose scanner can't resolve them inline. Needs cross-feature DC
  inference: find the class's key ability and compute 8 + prof + mod. The
  scanner already handles features that restate the formula themselves.
- **Aasimar revelations, Genasi, Tortle shell** — verify prose scanner output
  and curate where the text defeats it.

Approach: keep the prose scanner as the long tail, add curated entries only
where a printing's mechanics can't be extracted from its own text (the
`_versions` template substitution problem that hit Dragonborn).

## Creation wizard

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

Remaining: a "use it" button for resources with no dice (spend without a roll);
spell-slot tap-to-cast polish.

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
