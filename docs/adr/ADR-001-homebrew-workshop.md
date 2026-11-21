# ADR-001: A workshop for homebrew content, table rules and rule packs

- **Status:** Accepted, 2026-11-09, by the owner. Built in full (phases 1 to 10, merged 2026-11-10).
- **Full record:** <https://claude.ai/artifact/9f7dAks3Re8bbNmexTrzqp> (the owner's design artifact, private to them). Its mocks are on the Homebrew Workshop canvas, <https://claude.ai/artifact/QJzgKc9zqA8LGtXRgrjSNP>.
- **Superseded in part by** [ADR-002](ADR-002-one-workshop.md): the Homebrew page as the way in, the Builder, and table rules in Settings.

This file is a stub so that the code's citations ("ADR-001 D3", "hook H9", "option C") resolve inside the repository. The artifact holds the context, the options weighed, the review that argued against them, and the owner's answers. The summary below is enough to read the code by.

## Decision

- **D1. One format.** Everything authored is a homebrew file in the format the app already stores, imports and converts. Standard fields are written wherever they exist; one namespaced, versioned field, `castGuidance`, holds mechanics no standard field can.
- **D2. One place decides an entry's mechanics.** `mechanicsOf` (`src/engine/effects/mechanics.ts`) replaced five "curated row, else prose scan" call sites. Its order: a rule pack's patch for the entry, the entry's own `castGuidance.effects`, the curated row for its key or for the official entry it was copied from (`basedOn`), then the prose scan.
- **D3. A copy saves only its changes** by default: `_copy` with `_mod` and `basedOn`, so it keeps the original's curated mechanics and carries no book text. A full copy is on request.
- **D4. Table rules are a closed, typed list.** Each rule point has named values, an as-written default per edition, and one engine function that reads it. It is set app-wide, per character, or by a rule pack applied to the character (`rulesFor`, `src/engine/rules.ts`). A rule the app cannot count becomes a cue.
- **D5. Plugins are rule packs, with small formulas, and no user code.** A pack carries table rules, patches, moments and cues as data. Numbers may be formulas in a strict subset of JavaScript expressions that the app parses itself (`src/engine/formula.ts`; this was option C, with option A, data packs). Running user code (options B, D and E) is not chosen and needs its own ADR.
- **D6. Built in lazy chunks, named for players.** Every editor is its own chunk; no screen names the upstream data project.

## Hook points

| Hook | What it is | Where |
|---|---|---|
| H1 | Mechanics of an entry | `engine/effects/mechanics.ts` |
| H2 | Table rules into derive | `EngineContext.rules`; readers in `calc/hp.ts`, `calc/speed.ts`, `conditions.ts`, `effectLife.ts`, `engine/rest.ts` |
| H3 | Table-wide riders and cues | `derive.ts`, `playRules.rollEffects` |
| H4 | Rolling (critical damage) | `dice/roll.ts` |
| H5 | Homebrew conditions | `conditions.ts` through `countingEffects` in `activeEffects.ts` |
| H6 | + Effect's search over homebrew | `curated/effectCatalog.ts` |
| H7 | Spending a feature's own cost | `curated/spendLinks.ts` |
| H8 | Import preview of a pack | the import preview |
| H9 | Moments (0 HP, a condition added or ended, turn start, casting at a level, a rest) | `engine/moments.ts` and where each moment happens |
| H10 | `while` states (bloodied, raging, no armor) | `derive.ts` filters effects before folding |

## Build plan

Every file belonged to exactly one phase, so phases whose needs were met ran in parallel.

| Phase | What it built | PR |
|---|---|---|
| 1 | Mechanics seam, formulas, `while` states, the `castGuidance` contracts | #286 |
| 2 | Moments (H9) | #289 |
| 3 | Workshop shell, Edit a copy, the feat, background, species and optional feature editors | #290 |
| 4 | Table rules engine: the resolver, rest maths in the engine | #295 |
| 5 | Spell and item editors | #296 |
| 6 | Subclass editor | #297 |
| 7 | Homebrew conditions on the sheet, homebrew spells in + Effect | #294 |
| 8 | Table rules screens | #299 |
| 9 | Class editor | #300 |
| 10 | Rule packs: review, Apply to, clashes and order | #301 |
