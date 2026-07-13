# Future work

Open gaps and planned improvements, ordered roughly by player impact. Completed
work lives in git history — this doc tracks only what's **left**. Each item says
why it's deferred and what "done" looks like.

## Content curation (the "Dragonborn treatment" long tail)

The engine types actions (damage / area / save DC), scales dice for both
editions, and pre-answers choice prompts; the prose scanner handles most
features, with a curated table for printings whose mechanics aren't in their own
text. Still open:

- **Warlock invocation enforcement** — prerequisites (level, Pact Boon, patron,
  known spell) are shown and unmet **level** gates are enforced, but the
  pact / patron / known-spell gates aren't. Needs a second pass over the resolved
  Pact Boon and spell list at option-build time.
- **Battle Master maneuver save DC** — the DC is "8 + prof + Strength *or*
  Dexterity (your choice)", so it needs a DC-ability prompt before it can be
  auto-computed. Monk Stunning Strike (a fixed Wis DC) is already curated.
- **FTD Metallic 2nd breath / Gem flight & telepathy** — the breath weapons work;
  Metallic's second breath option (enervating / repulsion) and Gem's flight and
  telepathy utility aren't surfaced as their own chips.
- **Aasimar revelations, Genasi, Tortle shell** — verify prose-scanner output and
  curate where the text defeats it.

## Creation / build

- **Rules-version filter for the ASI feat list** — race/class/background/spell
  lists are `filterByRulesVersion`-filtered, but the ASI feat options come from
  `ctx.byType('feat')` unfiltered, so a 2014 character sees XPHB/UA feats mixed
  in. The feat *descriptions* are already edition-correct (they use the option's
  own source); only the list needs filtering.
- **Equipment gold alternative** — 2024's "gold instead of gear" isn't offered;
  the wizard grants gear bundles (gold entries become note items).
- **Background equipment slots** — class `equipmentType` slots get concrete
  pickers; backgrounds occasionally have them too (currently a labeled note item).
- **Racial-bonus-aware auto-assign** — deferred: fixed bonuses don't change the
  optimal base-array assignment and choice bonuses are a separate prompt, so the
  payoff is marginal.
- **Spell guidance beyond level 1** — starter picks are curated for cantrips and
  1st level; "what to pick as you level up" is still open.
- **Multiclass in the wizard** — deliberate; the Build page handles multiclassing.

## Sheet & play

- **Exhaustion — HP-max & disadvantage stay advisory.** The stepper applies the
  speed reduction, lists every level's effects, death is a manual button, and a
  long rest now removes one level. Still advisory (shown as summary lines, not
  auto-applied to the HP cap or rolls): the 2014 level-4 "HP maximum halved" and
  the disadvantage / 2024 −2-per-level d20 penalties.
- **Spell-slot tap-to-cast polish** — casting from the slot pips vs. the spell
  row could be unified.

## Accessibility (lower priority)

- Picker and choice controls carry accessible names, and proficiency dots encode
  state by shape + screen-reader text. A full screen-reader pass — focus order,
  drawer focus traps, live regions for roll results — hasn't been done.

## Data / engine

- **`_versions` `_mod` against merged race+subrace entries** — subrace version
  mods that target base-race entries (`removeArr` / `replaceArr`) silently no-op,
  because the subrace template has no entries of its own. Fixing it in
  `copyMod.ts` would give every versioned subrace its substituted prose. **Low
  priority:** the curated fallbacks already produce correct output, and the FTD
  Dragonborn work confirmed the `_versions` expansion itself is sound — so this
  is cleanup, not a bug fix.
