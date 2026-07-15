# Cast Guidance — future work

Last reviewed: 2026-07-14 (`a128202`)

The single planning document for open product and engineering work. It tracks
what **remains**; completed work lives in git history, not here. Each item keeps
its stable id and an acceptance signal, and notes in parentheses what already
shipped so the remaining scope is clear.

Browser and device behavior still needs hands-on validation. The pinned-data
audit covers 48 files and all 936 spells; its 40 versioned-subrace `replaceArr`
warnings are tracked under P2.

A 2026-07-14 game-mechanics and UX review added the FIX-00x derivation/play
correctness defects (P1), the reversible-choice and history-clarity items
(UX-004/UX-005), and new rules-automation rows under P2 (feat sub-choices, 2014
draconic ancestry, condition effects, and the downed/death sequence).

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
| Frozen dependency install | Pass — 555 packages |
| Lint/format | Pass — 189 files |
| TypeScript | Pass |
| Unit + integration tests | Pass — 73 files, 545 tests |
| Coverage report | `bun run test:coverage` — ~46% statements (engine/guards high, UI low) |
| Production/PWA build | Pass |
| Real pinned-dataset audit | Run — 48 files; 936 spells; 40 versioned `replaceArr` warnings |
| Browser E2E and automated accessibility (axe) | No harness yet |

Priority meanings:

- **P0 — protect user data:** fix before broad release.
- **P1 — release quality:** target the next milestone.
- **P2 — product and engineering depth:** valuable after release risks.
- **P3 — polish and scale:** longer-term work.

## Recommended delivery order

1. Make the remaining persistence boundaries safe and recoverable.
2. Make spellcasting, choices, rules compatibility, errors, and accessibility
   transparent; add browser-level regression coverage.
3. Deepen rules automation, creator/level-up guidance, offline recovery,
   backup/restore, source policy, and homebrew integrity.
4. Measure and improve scale, maintainability, release operations, and optional
   product capabilities.

## P0 — user data and trust boundaries

No open items. Import validation and transactional commit (IMP-001) shipped —
size/node/depth/string limits, structural shape checks, recomputed homebrew
identity, a single Dexie transaction, and an IndexedDB-backed rollback test. The
residual per-field runtime schemas are tracked under P2 (maintainability).

## P1 — release quality

### Persistence and error recovery

| ID | Remaining work | Acceptance signal |
|---|---|---|
| REL-003 | Extend honest failure UI + a retry affordance to builder saves, data-tag updates, and downloads (character-list mutations already surface failure notices). | Every mutation has honest pending/success/error UI and a retry path. |
| REL-005 | Add dedicated decode-error boundaries around the search worker and homebrew JSON editors (route-level `errorElement` recovery + hardened `classSummary` already shipped). | One bad record cannot take down the app. |
| REL-006 | Route the remaining live queries (library/homebrew registries) through the tested repo read boundary (`listSafe`/`partitionCharacterRows` already cover the character list). | Stored records cross one tested read boundary. |
| REL-007 | Optional: a hard per-character lock or optimistic revision check on save, if the multi-tab guidance banner proves insufficient. | Two tabs cannot silently lose an edit. |
| ERR-001 | Extend explicit error/missing states to the entity-detail view and other live-query pages (registry/search `status: 'error'` + retry and worker-failure handling already shipped). | Retry, offline, missing-id, and cache-repair states are testable. |

### Rules guidance and play state

| ID | Remaining work | Acceptance signal |
|---|---|---|
| GAME-001 | Replace automatic lowest-slot/pact-first casting with an explicit slot/pool/upcast choice. Apply slot spend, concentration, and action economy as one decision. | Exhausted-resource and intentional no-slot casts stay possible but cannot masquerade as normal casts or leave partial side effects. |
| GAME-002 | Effectively satisfied: the mode badge (Known/Prepared/Spellbook/Pact), the per-spell prepare/prepared toggle (the unprepared distinction), the separate "Innate & granted spells" section with an "Always prepared" badge for domain/oath/circle grants, and the over-limit cues (cantrips/prepared/known) make normal, unprepared, granted, and over-limit spells visibly and accessibly distinct without blocking overrides. Residual (low): add UI regression coverage for these distinctions and any deeper per-spell mode nuance. | The four spell states have UI regression coverage. |
| GAME-003 | Move edition compatibility beyond picker filtering. Classify carry-overs, reprints, and likely conflicts; preview rules-version changes. | Mixed-edition characters retain their selections with provenance and useful compatibility cues. |
| GAME-005 | Feat and optional-feature (invocation) pickers now flag unmet prerequisites with a non-blocking `advisory` cue: `meetsPrerequisite` evaluates ability/level/race/feat/background/proficiency/spellcasting and OR-of-requirement sets against the character built so far, and the option stays selectable (a spell-less Fighter still *sees* Elemental Adept flagged, not disabled). Remaining: make source policy (`allowedSources`) meaningful in filtering, and revisit `requiredLevel` (still the max level across sets) so an optional feature gated by an OR of alternative sets disables on the satisfiable *minimum* rather than over-disabling. | Source policy filters pick options, and OR-set level gates disable on the satisfiable minimum. |
| GAME-006 | Short/long-rest recovery is now a pure, unit-tested module (`src/features/sheet/rest.ts`) with golden fixtures for HP, spell/pact slots, per-rest resources, death saves, exhaustion (−1/long rest, both editions), and hit dice — and the long-rest hit-dice math is fixed to regain half your *total* Hit Dice (was halving per die type, wrong for multiclass; auto-regains largest die first, a per-die picker being future scope). Remaining: expert-reviewed audit of the deeper edition nuances (2024 exhaustion d20 penalty is tracked under P2 Exhaustion; concentration is unaffected by rest) and golden 2014/2024 rest characters (P2 Class/rest audit). | Deeper edition rest nuances are expert-reviewed against golden characters. |
| GAME-007 | Over-limit spell counts are now flagged for all three maxima — cantrips, prepared, and (new) leveled spells known for known/pact casters (`spellsKnownMax` from `spellsKnownProgression`), each a non-blocking amber cue since exceeding a limit is allowed. Play-resource overage detection + non-destructive clamping already shipped. Remaining (optional): an explicit "trim to limit" affordance for spell lists — deliberately not automatic, since over-limit is a valid house-rule/feature state. | An explicit, opt-in normalization action trims an over-limit spell list without surprising the player. |

### Mechanics correctness (defects found in the 2026-07-14 review)

All FIX-00x derivation/interaction defects from the 2026-07-14 review have
shipped; the details live in git history. The most recent:

- **FIX-001** — named `additionalSpells` branches surface a pick-one choice, and
  a `{choose}` spellcasting ability now prompts an ability picker (the grant
  waits on the pick rather than defaulting to the first option). Residual: verify
  the "distinct `name` = mutually-exclusive branch" heuristic against the real
  pinned dataset — folded into TEST-005.
- **FIX-006** — a background that grants a *free* origin feat ("any" /
  "anyFromCategory") now surfaces a real feat picker that persists to
  `doc.choices` and collects the chosen feat (category-filtered when the data
  names one), instead of a note pointing at a nonexistent "Feats step." No UI
  references a missing step. A dedicated standalone-feat editor on the sheet
  (writing `doc.feats` directly, outside a background/ASI grant) remains future
  product scope.

### Data loading, updates, and search

| ID | Remaining work | Acceptance signal |
|---|---|---|
| DATA-002 | Stage data-tag installs, validate every required index/pack, support resume/cleanup, activate atomically, and retain a rollback tag until successful boot; apply the global fetch gate to the `updateToTag` download path. | Interruption at any phase leaves the old version usable. |
| DATA-003 | Batch registry hydration and search indexing instead of rebuilding after every downloaded file. | Background download causes bounded rebuilds with accurate readiness. |
| PWA-001 | Test cold/offline launch for every route with essential, partial, and full caches. | "Not downloaded," "not found," offline, and corrupted-cache states have distinct recovery actions. |
| PWA-002 | Validate install/update behavior on iOS and Android; add tested 192/512 and maskable assets rather than relying only on SVG icons. | Install, offline reload, deferred update, failed update, and recovery pass on target devices. |

(Concurrency-limited fetching + de-dup (DATA-001), incompatible-tag rejection
(DATA-004), and homebrew-revision-aware search with query supersession
(SEARCH-001) have shipped.)

### Security, privacy, and imports

| ID | Remaining work | Acceptance signal |
|---|---|---|
| SEC-001 | Promote the shipped CSP (`public/_headers`) from report-only to enforced once production reports show no violations. | The CSP blocks disallowed connect/script sources in production. |
| SEC-002 | Bound the raw remote-response byte stream before parse, and cap regex work and worker processing (node/depth/string limits + embedded-file-count and export-size caps already gate stored payloads). | Adversarial payload tests fail safely before storage/indexing. |
| IMP-002 | Add an import *preview* UI that explains dependencies, duplicates, winner policy, and source/entity collisions before commit (dependency-scoped export DTO already shipped). | Import preview explains dependencies, duplicates, winner policy, and conflicts before commit. |
| LEGAL-001 | Obtain content/licensing review and add a license, third-party notices, mirror attribution/terms, and trademark disclaimer. *(License choice is a product/owner decision.)* | Release documentation records the approved content and attribution policy. |

(`{@link}` sanitization + report-only deployment headers (SEC-001) and the
local-data/privacy explanation + "Reset app data" control (PRIV-001) have
shipped; a one-click full backup is tracked under P2 product experience.)

### Accessibility and inclusive design

| ID | Remaining work | Acceptance signal |
|---|---|---|
| A11Y-001 | Give icon-only controls real accessible names (not just `title`) and semantic checked/pressed/value states to toggles and pips (a global high-contrast `:focus-visible` ring already shipped). | Every route is operable and understandable with keyboard and accessibility APIs. |
| A11Y-002 | Increase undersized touch targets; ensure state is not color-only; add restrained live regions and real progress semantics for saves, data, imports, resources, HP, search, and updates. | Target-size, contrast, and announcement audits pass without over-announcing. |
| A11Y-003 | Run axe plus manual VoiceOver/TalkBack, focus-trap, virtual-list, zoom, large-text, landscape, safe-area, external-keyboard, and reduced-motion testing. | Results and fixes are recorded for every main flow. |

### Creator and navigation

The creator has class-aware standard-array auto-assignment, point-buy cost
feedback, unresolved-choice warnings, a final review, inline origin choices, and
a "create anyway" path. Remaining:

| ID | Remaining work | Acceptance signal |
|---|---|---|
| UX-001 | Make "standard array" a true assign/swap allocator instead of arbitrary 3–18 steppers; strengthen nonstandard point-buy cues; add explicit resume/restart/discard for the sessionStorage draft (invalid `?step=` deep links already recover). | The normal path is unmistakable, deep links recover, and intentional deviations remain possible. |
| UX-002 | Explain local-first storage, initial/background downloads, eviction risk, backup, offline readiness, and edition choice during onboarding. | A first-time user knows when the app is safe to use offline and how to protect data. |
| UX-003 | Add page titles, focused-flow escape/back behavior, and a useful 404 (persistent top-level navigation already shipped). | Routes expose useful context to browsers, assistive tech, and users arriving via deep link. |
| UX-004 | Make identity and choice changes non-destructive and reversible. Re-tapping the current option is now a no-op (`EntityCardList` no longer re-fires `onSelect` for the selected card; the Basics rules-version and ability-score-method toggles guard against re-selecting the current value), so an accidental re-tap no longer wipes picks, re-zeroes allocated scores, or discards the whole in-progress build. Remaining, still destructive with no confirmation and no wizard undo: picking a *different* class clears all choices doc-wide and drops the subclass (should scope to class choices); the "change" control on a resolved pick deletes it and every dependent sub-pick; changing species/subrace/background prunes their choices; removing a level-1 *secondary* multiclass skips the confirm single-class removal has; Standard array / Roll 4d6 overwrite all six scores; and superseded race/class spells/equipment linger in the doc keyed to the old origin (dormant, silently re-applied if you switch back). Confirm or non-destructively re-scope these, and add an undo affordance (the notices store has no action slot yet). | Every destructive change is confirmed, reversible, or scoped to only the affected picks; a mis-tap is recoverable in both the wizard and the sheet. |
| UX-005 | Make restoring a history snapshot predictable — the enabler for UX-004's undo. Entry labels are now specific and verb-led (gear added/removed, spells prepared/learned, conditions added/removed, plus HP/level/subclass/race/background before→after) instead of generic tokens. Remaining: preview the diff between a snapshot and the current state before Restore applies it, and coalesce rapid debounced bursts into meaningful entries. | Restoring previews its differences from the current state before applying, and rapid edits don't bury meaningful snapshots. |

### Quality gates

| ID | Remaining work | Acceptance signal |
|---|---|---|
| TEST-001 | Add coverage thresholds and bundle-budget gating to CI (frozen install, lint, typecheck, tests, and the PWA build already run on every push/PR with a bundle-size summary). | Every PR runs the current local green baseline. |
| TEST-002 | Extend IndexedDB coverage to quota-exhaustion behavior, history/lifecycle events, and multi-tab races (import transaction, rollback, and character+history delete already covered via `fake-indexeddb`; multi-tab has a pure-tested basis in `multiTab`). | Persistence risks are reproducible without manual timing. |
| TEST-003 | Extend component/integration coverage to creator review/choices, rules switching, inventory, casting, rests, import flows, and homebrew edits (`@testing-library/react` + jsdom harness in place; routing error states and entry rendering covered). | UI state transitions have regression coverage. |
| TEST-004 | Add browser E2E for first load, offline reload, service-worker updates, character lifecycle, import/export, and failed/resumed data installs. | Release-critical flows pass in supported browsers. |
| TEST-005 | Run `scripts/data-audit.ts` for every data-tag bump and on a schedule; include a check that no `additionalSpells` block relies on the "distinct `name` = mutually-exclusive branch" heuristic in a grant-all context (FIX-001's residual). | Core entities, parser warnings, copy/mod behavior, tag coverage, and the branch-heuristic assumption have budgets. |

## P2 — product and engineering depth

### Rules and content automation

Remaining mechanics from the former focused list, plus the broader rules-audit
work:

| Area | Remaining work | Acceptance signal |
|---|---|---|
| Warlock invocations | Enforce or clearly warn on Pact Boon, patron, spellcasting, and known-spell prerequisites after resolving the character. Level gates already work. | Every prerequisite is evaluated or explicitly labeled advisory. |
| Battle Master maneuvers | Add the Strength-or-Dexterity maneuver-DC choice and show computed informational DC notes for save-forcing riders rather than fake action buttons. | Disarming/Pushing/Trip show Str saves; Goading/Menacing show Wis saves; the DC uses the chosen ability. |
| Dragonborn/Aasimar/Genasi utilities | Surface Metallic secondary breath, Gem flight/telepathy, Aasimar Celestial Revelation forms, and Genasi elemental utilities as useful, edition-correct chips or notes. | Each trait is discoverable without inventing incorrect action economy or resource use. |
| Draconic ancestry (2014) | 2014 Dragonborn has no color subrace, so the ancestry is never chosen: the breath weapon carries no damage type/area/save and the "choose a resistance" pick floats free of the ancestry (you can pick fire resistance with a cold breath). Offer an ancestry choice — as the 2024 versioned races already do via name — that fixes the breath weapon and pre-answers the matching resistance. | A 2014 Dragonborn picks an ancestry that sets breath-weapon type/area/save and its resistance. |
| Feat sub-choices | Give real pickers to feats whose embedded choices carry little structured data and today surface only as "see the trait text" warnings: Magic Initiate / Ritual Caster (class + cantrips + spell), Skilled (three skills or tools, prose-only), Elemental Adept (damage type; repeatable), and the chosen spell of Fey/Shadow Touched and Telekinetic/Telepathic. Disable options that duplicate a proficiency the origin already fixes. (Ability/skill/tool/language/expertise sub-choices already produce pickers — e.g. Prodigy, Chef.) | Each feat's embedded skill/tool/spell/class/damage-type choice is selectable, or shows an explicit honest note when unsupported. |
| Condition effects | Conditions are advisory labels only — they never grant advantage/disadvantage on the affected rolls, change speed (only Exhaustion does) or AC, or apply Paralyzed's melee auto-crit. Wire condition state into attack/save/check advantage and speed as guidance the player can still override. | Applying a condition changes the affected rolls/speed with a visible, overridable cue. |
| Downed and death state | Dropping to 0 HP never applies Unconscious, overkill and instant death (damage taken ≥ HP max) are discarded, and death saves never reach a stable or dead state (three successes/failures only fill pips). Model the 0-HP → Unconscious → stable/dead transitions and instant death as guidance without blocking manual override. | The downed sequence and instant death are represented and overridable. |
| Background equipment slots | Feed background `startingEquipment` through the concrete slot picker now used for classes. | Supported slots create real items; unsupported entries remain honest notes. |
| Exhaustion automation | Keep the existing speed/death workflow, and either apply or explicitly preserve as advisory the 2014 HP-max/disadvantage effects and 2024 d20 penalty. | Roll/HP behavior and advisory text cannot disagree. |
| Spell guidance | Extend current cantrip/level-1 starter tips into level-up and replacement guidance. | Each casting model gets useful, non-prescriptive guidance beyond level 1. |
| Granted/innate spells | Add casting/use tracking for per-rest innate and granted spells, not only detail links. | Charges, slot use, concentration, and no-slot cases are represented correctly. |
| Equipment and combat audit | Verify attunement, armor requirements, shields/hands, ammunition, weapon properties/mastery, critical damage, riders, improvised attacks, and encumbrance. | Edition-specific golden characters cover each automated rule. |
| Class/rest audit | Verify subclass lists, replacements, Magical Secrets-style picks, feature gating/replacement, multiclass rounding/proficiencies, and edition rest policies. | Representative 2014/2024 single- and multiclass fixtures pass expert-reviewed expectations. |
| Prose automation | Audit curated/prose-scanned actions and resources against the pinned dataset; retain confidence/provenance and allow correction. | False-positive/negative budgets are measured on every data-tag change. |
| Versioned subraces | Apply subrace `_versions` `_mod` operations against merged race+subrace entries where targets live only on the base race (source of the 40 tracked `replaceArr` warnings). | `removeArr`/`replaceArr` substitutions produce the intended versioned prose without curated fallback. |

### Product experience

| Area | Remaining work |
|---|---|
| Backup and recovery | Full-app backup/restore (one-click export-all beyond per-character export), reminder, import preview, trash/archive/undo, and recovery documentation. |
| Guided level-up | Preview HP, subclass timing, choices, spell gains/replacements, and resource changes before commit. Multiclassing remains in the free-form Build page unless product scope changes. |
| Character management | Search, sort, last-played, campaign/tags, optional portraits, and safer cross-device handoff. |
| Sheet and casting polish | Unify spell-row and slot-pip casting, add upcast effects/material/ritual reminders and cast history, and support critical/rider rolls (the dice engine already supports crit doubling — no UI path passes it, so a natural 20 never doubles damage dice). Persist the roll log per character (it is in-memory and shared across all characters today, lost on reload) and give resource pools above the pip cap (>12, e.g. high-level sorcery points) real increment/decrement controls instead of read-only text. |
| Inventory | Edit all modeled custom-item fields; add containers, location, currency transactions, carrying capacity, and table-rule encumbrance. |
| Export and sharing | Print-friendly accessible sheet/PDF and dependency-minimal sharing. |
| Source policy | Make `allowedSources`, `dataTag`, and `homebrewDeps` meaningful in filtering, provenance, exports, and warnings. |
| Table rules | Configurable rest recovery, level cap, point-buy budget, attunement, encumbrance, HP method, and source policy. |
| Usability research | Test create, level-up, damage/rest, prepare/cast, homebrew import, history recovery, and offline use with new and experienced players. |

### Data, performance, and offline recovery

- Record real cached byte sizes, quota/persistent-storage status, reclaimable
  space, and cleanup for failed tags, old indexes, orphaned metadata, and old
  app caches.
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
  unsupported fields; preview counts, duplicates, `_copy` warnings, size, and
  affected characters before import.
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

- Add risk-based coverage thresholds (engine, owned import schemas, persistence,
  loader, search protocol, gameplay commands), property/fuzz coverage (dice,
  choices, entry rendering, copy/mod, migrations, hostile imports), and golden
  2014/2024 characters. Coverage reporting (`bun run test:coverage`) is wired.
- Add E2E and bundle-analysis scripts (repeatable `bun run check` /
  `bun run data:audit` and coverage reporting are already wired; `tests-fixtures`
  is linted; `passWithNoTests` is off).
- Document architecture, persistence/migrations, automation limits, homebrew,
  troubleshooting, and the deployment fallback/cache policy (Bun/Node versions
  are pinned; the export format and security headers are documented).
- Define semantic app/data/export versions, a changelog and support policy, a
  release/rollback checklist, and cross-browser smoke tests for iOS, Android,
  Chromium, Firefox, and Safari (issue/PR templates exist).
- Add dependency vulnerability/license scanning and automated update triage;
  document mirror/release provenance, checksums where available, emergency pin,
  security reporting, supported versions, and patch expectations.

## P3 — later opportunities

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
