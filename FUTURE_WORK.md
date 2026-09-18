# Cast Guidance: future work

Last reviewed: 2026-09-09 (`b335754`)

The planning document for open product and engineering work. It tracks what
**remains**; completed work lives in git history, not here.

**Where things live.** Every P1 item is a GitHub issue, labeled `P1` plus an
area label, and the P1 section below is only an index into them. The reason is
narrow: an item with a stable id and an acceptance signal can be closed by a PR
that references it, so its status stops depending on someone remembering to
edit a file. This document went sixty commits without a review and described a
dozen fixed behaviors as broken; the parts that drifted were exactly the parts
that had issue-shaped items.

What stays here is what an issue tracker holds badly: the product principle,
the measured baseline, the delivery order, the P2 and P3 themes that are
directions rather than tickets, and the release-readiness evidence. Those are
read top to bottom, and sharding them into fifty open issues would lose the
argument they make together.

Browser and device behavior still needs hands-on validation. The pinned-data
audit covers 48 files and all 936 spells; its 40 versioned-subrace `replaceArr`
warnings are tracked under P2. The audit is network-gated and has not been
re-run since 2026-07-15; scheduling it is TEST-005 ([#124](https://github.com/FueRobertHer/cast-guidance/issues/124)).

## Product principle: guidance, not gatekeeping

Cast Guidance should explain normal rules and make unusual choices obvious
without preventing house rules or intentional overrides.

- Keep actions and selections available unless accepting them would cross a
  trust or data-integrity boundary.
- Label recommended, unusual, over-limit, unresolved, and mixed-edition states
  with accessible, color-independent cues.
- Explain the rule and provenance behind a warning. Avoid repeatedly prompting
  after a player has acknowledged an intentional override.
- Treat 2014/2024 compatibility as a spectrum. Older spells and items can be
  valid in a 2024 game; mixing editions is not inherently an error.
- Reject unsafe links, hostile or malformed imports, corrupted identifiers, and
  writes the app cannot represent safely.

## Current baseline

The app has a pure derivation engine, local-first IndexedDB storage behind repo
interfaces, route-level code splitting with per-subtree error recovery,
defensive third-party-data parsing, cryptographic dice rolls, virtualized lists,
worker-based search, history, self-contained scoped character exports, PWA
update prompting, transactional imports with validation, class-aware creation
guidance, edition-correct descriptions, persistent navigation, serialized save
queues with visible recovery, and unit + IndexedDB + component test harnesses in
CI.

| Check | Current result |
|---|---|
| Frozen dependency install | Pass: 555 packages |
| Lint/format | Pass: 223 files |
| TypeScript | Pass |
| Unit + integration tests | Pass: 99 files, 942 tests |
| Coverage report | `bun run test:coverage`: ~59% statements, ~51% branches (engine/guards high, UI improving) |
| Production/PWA build | Pass |
| Real pinned-dataset audit | Last run 2026-07-15: 48 files; 936 spells; 40 versioned `replaceArr` warnings. Not re-run since (network-gated; the mirror CDN is unreachable from CI and from sandboxed sessions). |
| Browser E2E and automated accessibility (axe) | No harness yet |

Priority meanings:

- **P0 (protect user data):** fix before broad release.
- **P1 (release quality):** target the next milestone.
- **P2 (product and engineering depth):** valuable after release risks.
- **P3 (polish and scale):** longer-term work.

## Recommended delivery order

1. Make the remaining persistence boundaries safe and recoverable.
2. Make spellcasting, choices, rules compatibility, errors, and accessibility
   transparent; add browser-level regression coverage.
3. Deepen rules automation, creator/level-up guidance, offline recovery,
   backup/restore, source policy, and homebrew integrity.
4. Measure and improve scale, maintainability, release operations, and optional
   product capabilities.

## P0: user data and trust boundaries

No open items. Import validation and transactional commit (IMP-001) shipped:
size/node/depth/string limits, structural shape checks, recomputed homebrew
identity, a single Dexie transaction, and an IndexedDB-backed rollback test. The
residual per-field runtime schemas are tracked under P2 (maintainability).

## P1: release quality

Every P1 item is a GitHub issue. Each one carries the remaining scope, the
acceptance signal, and the code pointers that were verified when it was filed,
so this table is an index and nothing more: status lives in the issue, and a PR
that says `Closes #N` retires the item without anyone editing this file.

### Persistence and error recovery

| ID | Issue | Remaining work |
|---|---|---|
| REL-003 | [#95](https://github.com/FueRobertHer/cast-guidance/issues/95) | Honest failure UI and a retry path for builder saves, data-tag updates, and downloads. |
| REL-005 | [#96](https://github.com/FueRobertHer/cast-guidance/issues/96) | Decode-error boundaries around the search worker and homebrew JSON editors. |
| REL-006 | [#97](https://github.com/FueRobertHer/cast-guidance/issues/97) | Route library and homebrew registry live queries through the tested repo read boundary. |
| REL-007 | [#98](https://github.com/FueRobertHer/cast-guidance/issues/98) | Optional: per-character save lock or optimistic revision check, if the multi-tab banner proves insufficient. |
| ERR-001 | [#99](https://github.com/FueRobertHer/cast-guidance/issues/99) | Explicit error and missing states for the entity-detail view and remaining live-query pages. |

### Rules guidance and play state

| ID | Issue | Remaining work |
|---|---|---|
| GAME-001 | [#100](https://github.com/FueRobertHer/cast-guidance/issues/100) | Play-tab slot/upcast choice (a choose-then-roll redesign), and non-slot pools as cast sources. |
| GAME-003 | [#101](https://github.com/FueRobertHer/cast-guidance/issues/101) | Edition compatibility beyond picker filtering: carry-overs, reprints, conflicts, change preview. |
| GAME-005 | [#102](https://github.com/FueRobertHer/cast-guidance/issues/102) | Character-scoped `allowedSources` (still declared and read nowhere), and OR-set level gates on the satisfiable minimum. |
| GAME-007 | [#103](https://github.com/FueRobertHer/cast-guidance/issues/103) | Optional, opt-in "trim to limit" action for over-limit spell lists. |

(All FIX-00x derivation/play defects from the 2026-07-14 review have shipped;
see git history. Two residuals live elsewhere: FIX-001's branch-heuristic check
is folded into TEST-005, and a standalone-feat editor is under P2 product
experience.)

### Data loading, updates, and search

| ID | Issue | Remaining work |
|---|---|---|
| DATA-002 | [#104](https://github.com/FueRobertHer/cast-guidance/issues/104) | Validate every required index/pack, retain a rollback tag past the swap, and put `updateToTag` behind the global fetch gate. Staging, resume, and stale-tag cleanup already ship. |
| DATA-003 | [#105](https://github.com/FueRobertHer/cast-guidance/issues/105) | Batch registry hydration and search indexing instead of rebuilding per downloaded file. |
| PWA-001 | [#106](https://github.com/FueRobertHer/cast-guidance/issues/106) | Cold and offline launch for every route across essential, partial, and full caches. |
| PWA-002 | [#107](https://github.com/FueRobertHer/cast-guidance/issues/107) | Validate install and update on iOS and Android; add raster 192/512 and maskable icons. |

### Security, privacy, and imports

| ID | Issue | Remaining work |
|---|---|---|
| SEC-001 | [#108](https://github.com/FueRobertHer/cast-guidance/issues/108) | Promote the shipped CSP from report-only to enforced. |
| SEC-002 | [#109](https://github.com/FueRobertHer/cast-guidance/issues/109) | Bound the raw remote-response byte stream before parse; cap regex and worker work. |
| IMP-002 | [#110](https://github.com/FueRobertHer/cast-guidance/issues/110) | Import preview explaining dependencies, duplicates, winner policy, and collisions before commit. |
| LEGAL-001 | [#111](https://github.com/FueRobertHer/cast-guidance/issues/111) | Content and licensing review, license, third-party notices, mirror attribution, trademark disclaimer. |

(`{@link}` sanitization + report-only deployment headers (SEC-001) and the
local-data/privacy explanation + "Reset app data" control (PRIV-001) have
shipped; a one-click full backup is tracked under P2 product experience.)

### Accessibility and inclusive design

| ID | Issue | Remaining work |
|---|---|---|
| A11Y-001 | [#112](https://github.com/FueRobertHer/cast-guidance/issues/112) | Accessible names for the ~15 icon-only controls that carry only a `title`; semantic states on the remaining toggles. |
| A11Y-002 | [#113](https://github.com/FueRobertHer/cast-guidance/issues/113) | Touch targets below 44px, non-color state, restrained live regions, real progress semantics. |
| A11Y-003 | [#114](https://github.com/FueRobertHer/cast-guidance/issues/114) | Axe plus manual VoiceOver/TalkBack, focus-trap, virtual-list, zoom, landscape, and reduced-motion passes. |

### Creator and navigation

The creator has class-aware standard-array auto-assignment, point-buy cost
feedback, unresolved-choice warnings, a final review, inline origin choices, a
"create anyway" path, and confirm-gated choice drafts that no longer lose picks
to a mis-tap. Remaining:

| ID | Issue | Remaining work |
|---|---|---|
| UX-001 | [#115](https://github.com/FueRobertHer/cast-guidance/issues/115) | A true standard-array allocator, stronger nonstandard point-buy cues, explicit draft resume/restart/discard. |
| UX-002 | [#116](https://github.com/FueRobertHer/cast-guidance/issues/116) | Onboarding covering local-first storage, downloads, eviction risk, backup, offline readiness, and edition choice. |
| UX-003 | [#117](https://github.com/FueRobertHer/cast-guidance/issues/117) | Page titles, focused-flow escape and back behavior, and a useful 404. All three are absent outright. |
| UX-004 | [#118](https://github.com/FueRobertHer/cast-guidance/issues/118) | The still-destructive identity changes (class, species, background), ability-score overwrites, dormant superseded grants, and an undo affordance. |
| UX-005 | [#119](https://github.com/FueRobertHer/cast-guidance/issues/119) | Preview a history snapshot's diff before Restore applies it; coalesce rapid debounced bursts. |

### Quality gates

| ID | Issue | Remaining work |
|---|---|---|
| TEST-001 | [#120](https://github.com/FueRobertHer/cast-guidance/issues/120) | Make CI fail on coverage thresholds and a bundle budget, not just report them. |
| TEST-002 | [#121](https://github.com/FueRobertHer/cast-guidance/issues/121) | IndexedDB coverage for quota exhaustion, lifecycle events, and multi-tab races. |
| TEST-003 | [#122](https://github.com/FueRobertHer/cast-guidance/issues/122) | Component coverage for rules switching, casting, rests, imports, homebrew edits, and the spell-state cues. |
| TEST-004 | [#123](https://github.com/FueRobertHer/cast-guidance/issues/123) | Browser E2E harness. PWA-001 and PWA-002 are effectively blocked on it. |
| TEST-005 | [#124](https://github.com/FueRobertHer/cast-guidance/issues/124) | Find an environment that can run the network-gated data audit, schedule it, and add the branch-heuristic check. |

## P2: product and engineering depth

### Rules and content automation

Remaining mechanics from the former focused list, plus the broader rules-audit
work:

| Area | Remaining work | Acceptance signal |
|---|---|---|
| Warlock invocations | Enforce or clearly warn on Pact Boon, patron, spellcasting, and known-spell prerequisites after resolving the character. Level gates already work. | Every prerequisite is evaluated or explicitly labeled advisory. |
| Battle Master maneuvers | Add the Strength-or-Dexterity maneuver-DC choice and show computed informational DC notes for save-forcing riders rather than fake action buttons. | Disarming/Pushing/Trip show Str saves; Goading/Menacing show Wis saves; the DC uses the chosen ability. |
| Dragonborn/Aasimar/Genasi utilities | Surface Metallic secondary breath, Gem flight/telepathy, Aasimar Celestial Revelation forms, and Genasi elemental utilities as useful, edition-correct chips or notes. | Each trait is discoverable without inventing incorrect action economy or resource use. |
| Draconic ancestry (2014) | 2014 Dragonborn has no color subrace, so the ancestry is never chosen: the breath weapon carries no damage type/area/save and the "choose a resistance" pick floats free of the ancestry (you can pick fire resistance with a cold breath). Offer an ancestry choice (as the 2024 versioned races already do via name) that fixes the breath weapon and pre-answers the matching resistance. | A 2014 Dragonborn picks an ancestry that sets breath-weapon type/area/save and its resistance. |
| Feat sub-choices | Give real pickers to feats whose embedded choices carry little structured data and today surface only as "see the trait text" warnings: Magic Initiate / Ritual Caster (class + cantrips + spell), Skilled (three skills or tools, prose-only), Elemental Adept (damage type; repeatable), and the chosen spell of Fey/Shadow Touched and Telekinetic/Telepathic. Disable options that duplicate a proficiency the origin already fixes. (Ability/skill/tool/language/expertise sub-choices already produce pickers, e.g. Prodigy and Chef.) | Each feat's embedded skill/tool/spell/class/damage-type choice is selectable, or shows an explicit honest note when unsupported. |
| Condition effects | Conditions are advisory labels only: they never grant advantage/disadvantage on the affected rolls, change AC, or apply Paralyzed's melee auto-crit. Exhaustion is the one exception and only partly: `exhaustion.ts` computes reduced speed and flags level-6 death for a *user-triggered* drop to 0 HP, but the 2024 −2 d20 penalty and the 2014 disadvantage/half-HP-max effects are advisory lines that no roll reads. Wire condition and exhaustion state into attack/save/check rolls and speed as guidance the player can still override. (Absorbs the former "Exhaustion automation" row: it was the same gap seen from the other side.) | Applying a condition or exhaustion level changes the affected rolls/speed with a visible, overridable cue, and no advisory line contradicts a roll. |
| Downed and death state | Death saves now roll for real (Durable-aware advantage, nat 1 = two failures, nat 20 = back up on 1 HP) and dropping to 0 breaks concentration. Remaining: 0 HP still never applies Unconscious, overkill and instant death (damage taken ≥ HP max) are discarded, and three successes or failures still only fill pips without reaching a stable or dead state. Model those transitions as guidance without blocking manual override. | The downed sequence and instant death are represented and overridable. |
| Background equipment slots | Feed background `startingEquipment` through the concrete slot picker now used for classes. | Supported slots create real items; unsupported entries remain honest notes. |
| Spell guidance | Extend current cantrip/level-1 starter tips into level-up and replacement guidance. | Each casting model gets useful, non-prescriptive guidance beyond level 1. |
| Granted/innate spells | Add casting/use tracking for per-rest innate and granted spells, not only detail links. | Charges, slot use, concentration, and no-slot cases are represented correctly. |
| Equipment and combat audit | Verify attunement, armor requirements, shields/hands, ammunition, weapon properties/mastery, critical damage, riders, improvised attacks, and encumbrance. | Edition-specific golden characters cover each automated rule. |
| Class/rest audit | Verify subclass lists, replacements, Magical Secrets-style picks, feature gating/replacement, multiclass rounding/proficiencies, and edition rest policies. Short/long-rest recovery is now a tested module (`src/features/sheet/rest.ts`); this audit covers the deeper edition nuances (GAME-006 residual). | Representative 2014/2024 single- and multiclass fixtures pass expert-reviewed expectations. |
| Prose automation | Audit curated/prose-scanned actions and resources against the pinned dataset; retain confidence/provenance and allow correction. | False-positive/negative budgets are measured on every data-tag change. |
| Versioned subraces | Apply subrace `_versions` `_mod` operations against merged race+subrace entries where targets live only on the base race (source of the 40 tracked `replaceArr` warnings). | `removeArr`/`replaceArr` substitutions produce the intended versioned prose without curated fallback. |

### Product experience

| Area | Remaining work |
|---|---|
| Backup and recovery | Full-app backup/restore (one-click export-all beyond per-character export), reminder, trash/archive, and recovery documentation. (Import preview is IMP-002; undo is UX-004/UX-005.) |
| Guided level-up | Preview HP, subclass timing, choices, spell gains/replacements, and resource changes before commit. Multiclassing remains in the free-form Build page unless product scope changes. |
| Character management | Search, sort, last-played, campaign/tags, optional portraits, and safer cross-device handoff (the roster's actions are already grouped behind one row menu, with a loading skeleton for vitals). |
| Sheet and casting polish | Unify spell-row and slot-pip casting, add material/ritual reminders and cast history, and support critical/rider rolls (the dice engine already supports crit doubling, but no UI path passes it, so a natural 20 never doubles damage dice). Persist the roll log per character: `rollLogStore` is a module-level Zustand store capped at 100 entries, shared across every character and lost on reload. (Pools above the pip cap now get ±1/±5 steppers, and pips spend from the right so what is left stays anchored under the label.) |
| Standalone feats | A sheet editor to add/remove feats directly (writing `doc.feats`), for feats gained outside a background or ASI grant (FIX-006 left this as future product scope; the engine already reads `doc.feats`). |
| Inventory | Edit all modeled custom-item fields; add containers, location, currency transactions, carrying capacity, and table-rule encumbrance. |
| Export and sharing | Print-friendly accessible sheet/PDF and dependency-minimal sharing. |
| Source policy | A device-wide browsing `SourcePolicy` ships (allow-all-except / only-these, presets, full book names, homebrew sources named by their own title) and deliberately never touches the registry, so hiding a book cannot break an existing sheet. Remaining: make the character-scoped `allowedSources`, `dataTag`, and `homebrewDeps` meaningful in provenance, exports, and warnings. |
| Table rules | Configurable rest recovery, level cap, point-buy budget, attunement, encumbrance, HP method, and source policy. |
| Usability research | Test create, level-up, damage/rest, prepare/cast, homebrew import, history recovery, and offline use with new and experienced players. |

### Data, performance, and offline recovery

- Cached byte sizes, `navigator.storage.estimate()` usage/quota, a
  `persist()` request on full download, and cleanup of rows stranded by a
  failed or superseded tag all ship. Remaining: report reclaimable space, and
  clean up old indexes, orphaned metadata, and old app caches.
- Add data-saver, battery, offline, pause/resume, Wi-Fi-only, essentials-only,
  and selected-source download policies without competing with active play.
- Add stronger data integrity checks: expected indexes/keys, representative
  entities, duplicate rates, checksums/provenance where available, and warning
  budgets.
- Benchmark cold/warm boot, essentials ready, full download, registry/search
  build, derivation, history, save, and rendering on low-end mobile; establish
  JS, bundle, latency, and memory budgets before optimizing.
- Cache derivations and normalized work by stable revisions; make endpoints
  injectable for tests, mirrors, self-hosting, and deterministic failures.
- Define service-worker cache, activation, stale-chunk, corruption, deferral,
  rollback, and SPA-fallback policy; expose app-shell, essentials, and full-data
  readiness separately.

### Homebrew and import maturity

- Canonicalize JSON before hashing, handle re-import of disabled content, and
  validate/normalize source ids, abbreviations, filenames, and reserved ids.
- Await builder saves/deletes, prevent double submission, retain edits on
  failure, and make editable content revisions invalidate registry/search.
- Add raw JSON validation/editing and schema-specific editors while preserving
  unsupported fields. (The import preview itself, covering counts, duplicates,
  `_copy` warnings, size, and affected characters, is IMP-002; this row is only
  the editing surface behind it.)
- Add regression fixtures that exercise the documented export-format
  compatibility matrix (the format itself is documented in
  `docs/export-format.md`).

### Maintainability and diagnostics

- Add runtime schemas at every owned `unknown` boundary, and a check that
  features reach persistence only through the repositories (the React-free
  engine boundary is already enforced by `src/engine/architecture.test.ts`).
- Split the largest feature modules around domain commands/state machines;
  consolidate repeated form, drawer, download, entity-label, toggle, and status
  primitives without hiding game behavior.
- Replace lifecycle-sensitive module singletons with resettable/testable
  services. Add typed commands/results for damage, rest, casting, leveling,
  choices, and imports, plus document revisions and meaningful history reasons.
- Queue or explicitly cancel overlapping dialogs; improve history
  comparison/storage (a shared cross-browser `downloadJson` helper and
  collision-proof roll ids already shipped).
- Add privacy-preserving diagnostics for app/data version, storage, warnings,
  errors, and performance without character content unless explicitly opted in.

### Testing, documentation, and release operations

- Choose the risk-based threshold *targets* per area (engine, owned import
  schemas, persistence, loader, search protocol, gameplay commands) that
  TEST-001 then enforces in CI; add property/fuzz coverage (dice, choices,
  entry rendering, copy/mod, migrations, hostile imports) and golden 2014/2024
  characters. Coverage reporting (`bun run test:coverage`) is wired.
- Add a bundle-analysis script to sit behind TEST-001's budget, and the E2E
  harness TEST-004 needs (repeatable `bun run check` / `bun run data:audit` and
  coverage reporting are already wired; `tests-fixtures` is linted;
  `passWithNoTests` is off).
- Document architecture, persistence/migrations, automation limits, homebrew,
  troubleshooting, and the deployment fallback/cache policy (Bun/Node versions
  are pinned; the export format and security headers are documented).
- Define semantic app/data/export versions, a changelog and support policy, a
  release/rollback checklist, and cross-browser smoke tests for iOS, Android,
  Chromium, Firefox, and Safari (issue/PR templates exist).
- Add dependency vulnerability/license scanning and automated update triage;
  document mirror/release provenance, checksums where available, emergency pin,
  security reporting, supported versions, and patch expectations.

## P3: later opportunities

- Search descriptions, aliases, tags, sources, and types; add keyboard
  navigation, recent searches, and explicit no-results/filter states.
- Add a rules-conformance matrix showing automated, partially automated,
  prose-only, and manual mechanics by source and edition.
- Add theme, contrast, density, dice, units, and localization preferences.
- Decide whether observability remains local/export-only or becomes explicitly
  opt-in, minimal, documented telemetry.
- Make data endpoints configurable for mirrors/self-hosting and add incremental
  search/registry updates only after measurement shows the need.

## Release-readiness evidence

Before calling the app broadly release-ready, record evidence for:

- autosave races, page exit, write failure, history restore, import rollback,
  and multi-tab conflicts;
- representative 2014, 2024, and intentionally mixed-edition characters,
  including visible override guidance;
- real pinned-dataset audit, cold/resumed download, and incompatible-tag
  rejection;
- offline/install/update/storage-eviction/rollback scenarios on target devices;
- adversarial imports and links, CSP/security headers, dependency/license
  review, and payload limits;
- automated plus manual keyboard, screen-reader, zoom, contrast, target-size,
  safe-area, and reduced-motion accessibility results;
- measured performance/bundle budgets on representative low-end hardware; and
- CI, release notes, version policy, deployment/rollback runbooks, supported
  browser smoke tests, and backup/recovery guidance.

An item is complete only when the behavior or product decision is documented,
appropriate regression coverage exists, failure/accessibility states are
handled, existing local data is considered, and the relevant automated and
device checks pass.

## Keeping this document honest

The P1 index needs no maintenance: closing an issue is the update. What does
drift is everything above and below it.

- Re-run `bun run check` and `bun run test:coverage` and refresh the baseline
  table whenever it is quoted anywhere that matters. It was two months and
  thirteen points of coverage stale at the last review.
- When a P2 or P3 theme grows a stable id and an acceptance signal, it has
  become an issue. File it and leave a one-line pointer, rather than letting
  the theme quietly accumulate specifics that no PR can close.
- Record the reviewed commit at the top so the gap is measurable rather than
  guessed at.
