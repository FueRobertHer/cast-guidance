# Cast Guidance — future work

Last reviewed: 2026-07-14

Reviewed revision: `a58f00b` (`origin/main`, merged into this branch)

This is the single planning document for open product and engineering work. It
consolidates the former `FUTURE_WORK.md` mechanics list and the app-review
backlog. Completed work belongs in git history, not in this file.

The review covered the current repository, automated checks, and code paths for
creation, play, persistence, imports, game-data loading, homebrew, search, PWA
behavior, accessibility, and release operations. Browser/device behavior still
needs hands-on validation. The pinned-data audit now covers 48 files and all 936
spells; its 40 existing version `replaceArr` warnings remain tracked below.

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

The current app already has a pure derivation engine, local-first IndexedDB
storage, route-level code splitting, defensive third-party-data parsing,
cryptographic dice rolls, virtualized lists, worker-based search, history,
self-contained character exports, PWA update prompting, inline build choices,
class-aware ability-score suggestions, review-step warnings, edition-correct
descriptions, persistent mobile/desktop navigation, character-scoped serialized
save queues, lifecycle flushing, route-scoped loading, stale-response
protection, and visible save/load recovery.

| Check | Current result |
|---|---|
| Frozen dependency install | Pass — 423 packages |
| Lint/format | Pass — 124 files |
| TypeScript | Pass |
| Unit tests | Pass — 18 files, 229 tests |
| Production/PWA build | Pass |
| Real pinned-dataset audit | Run — 48 files; 936 spells; 53,360 roll variants; 40 version `replaceArr` warnings |
| Browser, E2E, and automated accessibility tests | No harness exists yet |

Priority meanings:

- **P0 — protect user data:** fix before broad release.
- **P1 — release quality:** target the next milestone.
- **P2 — product and engineering depth:** valuable after release risks.
- **P3 — polish and scale:** longer-term work.

## Recommended delivery order

1. Make imports and the remaining persistence boundaries safe and recoverable.
2. Make spellcasting, choices, rules compatibility, errors, and accessibility
   transparent; add CI and browser-level regression coverage.
3. Deepen rules automation, creator/level-up guidance, offline recovery,
   backup/restore, source policy, and homebrew integrity.
4. Measure and improve scale, maintainability, release operations, and optional
   product capabilities.

## P0 — user data and trust boundaries

### IMP-001 — validate and transact character imports

Landed: the import boundary now enforces size/node/depth/string limits
(`assertJsonWithinLimits`) and a structural character-doc shape check
(`assertCharacterDoc`) before anything is trusted; embedded homebrew identity
and metadata are recomputed from content through the shared repository path
(`buildHomebrewRow`), so a file cannot forge an id to overwrite unrelated local
homebrew; and the character plus its homebrew commit through one Dexie
transaction (`characterRepo.importExport`), with the write decision extracted to
a pure, unit-tested `planCharacterImport`. Malformed, future-version, oversized,
and adversarial imports throw before the transaction opens.

Remaining: deep per-field runtime schemas for refs/choices/play/effects (folded
into the P2 "runtime schemas at every owned `unknown` boundary" work) and an
IndexedDB-backed test that a forced mid-transaction failure rolls the import back
(tracked in TEST-002 — no IndexedDB test harness exists yet).

## P1 — release quality

### Persistence and error recovery

| ID | Remaining work | Acceptance signal |
|---|---|---|
| REL-003 | Extend the new session save/load recovery pattern to rename, duplicate, delete, builder saves, data updates, and downloads. | Every mutation has honest pending/success/error UI and a retry path. |
| REL-004 | Dexie transactions now wrap character + history deletion (`characterRepo.delete`) and character + embedded-homebrew import (`characterRepo.importExport`). Remaining: an IndexedDB-backed test proving a forced failure rolls back every related write (TEST-002). | Forced failure rolls back every related write. |
| REL-005 | Done: a `RouteError` recovery element is wired as `errorElement` at the root, section, and sheet route levels, so a render/loader throw (e.g. a malformed character whose derivation throws) is contained to that subtree with reload/back actions — the app shell and other routes keep working. `classSummary` is also hardened so one corrupt class ref cannot crash the whole character list. Browser-verified: a character with a missing class ref showed recovery UI on its sheet and rendered as "Unknown class" in the list while Settings/nav stayed fully functional. Remaining: dedicated decode-error boundaries around the search worker and homebrew JSON editors. | One bad record cannot take down the app. |
| REL-006 | Done: the character list live query now goes through `characterRepo.listSafe`, which crosses every stored record through the migration boundary via the pure, unit-tested `partitionCharacterRows`; one unreadable record is surfaced (list banner) instead of crashing the page. Remaining: apply the same repo-routed read to any future live queries (library/homebrew currently read their own registries). | Stored records cross one tested read boundary. |
| REL-007 | Add optimistic revisions/conflict guidance or a per-character tab lock. | Two tabs cannot silently lose an edit. |
| ERR-001 | Core defect fixed: `useRegistryState`/`useSearchState` now capture failures as an explicit `status: 'error'` with a `retry` instead of `.catch(() => undefined)` swallowing them into permanent loading (`useRegistry`/`useSearchReady` kept as thin wrappers, so existing callers are unchanged). Library global search now distinguishes preparing / ready / empty ("No matches") / error-with-retry. Browser-verified: search ready, results, and empty states render correctly. Remaining: surface search-worker errors through `ensureSearchIndex` (it currently resolves on worker error — overlaps SEARCH-001), and extend explicit error/missing states to the entity-detail view and other live-query pages. | Retry, offline, missing-id, and cache-repair states are testable. |

### Rules guidance and play state

| ID | Remaining work | Acceptance signal |
|---|---|---|
| GAME-001 | Replace automatic lowest-slot/pact-first casting with an explicit slot/pool/upcast choice. Apply slot spend, concentration, and action economy as one decision. | Exhausted-resource and intentional no-slot casts stay possible but cannot masquerade as normal casts or leave partial side effects. |
| GAME-002 | Groundwork done: `classSpellcastingMode` classifies a class as known / prepared / spellbook / pact / none from its 5etools data (pure, unit-tested; verified against the real dataset — wizard→spellbook, cleric/druid/paladin→prepared, sorcerer/bard/ranger→known, warlock→pact). The derived `SpellcastingBlock.mode` is surfaced as an accessible badge + tooltip in the spell manager, and prepared/cantrip counts over the limit are flagged in amber with a non-blocking `role="status"` note ("N over your prepared limit … the extra picks are kept"). Remaining: always-prepared (domain/oath/circle) and granted/innate modes as distinct states, and marking individual unprepared spells. | Normal, unprepared, granted, and over-limit spells are visibly and accessibly distinct without blocking overrides. |
| GAME-003 | Move edition compatibility beyond picker filtering. Classify carry-overs, reprints, and likely conflicts; preview rules-version changes. | Mixed-edition characters retain their selections with provenance and useful compatibility cues. |
| GAME-005 | Extend current feat/version filtering with source policy and prerequisite guidance. Optional features only enforce numeric level today. | Feats and invocations show unmet requirements without turning table-approved selections into dead ends. |
| GAME-006 | Verify edition-specific short/long-rest behavior with rules fixtures or expert review. | Recovery of hit dice, resources, exhaustion, concentration, and other state matches the selected edition or is clearly manual. |
| GAME-007 | Done for play resources: `detectPlayStateOverages`/`clampPlayStateToMax` (pure, unit-tested) find current HP, leveled + pact slots, hit dice, and resource uses above their newly derived maxima; the Play tab shows an explanatory banner and a non-destructive "Bring within limits" action that clamps only the over-limit values. Browser-verified end-to-end. Remaining: spell counts above known/prepared maxima (needs the GAME-002 casting-mode model). | The app explains the mismatch and offers non-destructive normalization. |

### Data loading, updates, and search

| ID | Remaining work | Acceptance signal |
|---|---|---|
| DATA-001 | Done: every network fetch now passes through one global `Semaphore(FETCH_CONCURRENCY)` in `getFile` (no more per-pack worker pools), and `getFile`/`ensurePack` de-dupe concurrent callers via `singleFlight`, so the same pack cannot double-count `addTotal`/`fileDone`. Both primitives are unit-tested; browser-verified end-to-end: 17 spell packs fanned out at once held peak concurrency at 4 (== limit) with progress at 17/17. Remaining: apply the same gate to the `updateToTag` download path (currently sequential; folds into DATA-002). | Measured concurrency stays within the limit and progress never exceeds 100%. |
| DATA-002 | Stage data-tag installs, validate every required index/pack, support resume/cleanup, activate atomically, and retain a rollback tag until successful boot. | Interruption at any phase leaves the old version usable. |
| DATA-003 | Batch registry hydration and search indexing instead of rebuilding after every downloaded file. | Background download causes bounded rebuilds with accurate readiness. |
| DATA-004 | Done: `isCompatibleTag`/`parseTagVersion` (pure, unit-tested) gate data versions to the app's schema major. `listAvailableTags` filters incompatible tags out of the offered list (Settings shows a "no compatible versions" note when all are filtered), and `updateToTag` hard-rejects an incompatible/malformed tag before any download. Browser-verified: `updateToTag('v3.0.0')`/`'nightly'` throw with the active tag untouched. Remaining: richer post-download index/pack validation folds into DATA-002. | An incompatible tag cannot be activated. |
| SEARCH-001 | Editable-homebrew content revisions now feed the registry/search signature: `HomebrewFileRow.rev` bumps on every `saveEditable`, and the pure `computeRegistrySignature` includes `id@rev`, so an edit to a same-id file changes the search-index cache key and rebuilds. Browser-verified: renaming a homebrew spell drops the old name from search and surfaces the new one without reload. Remaining: search worker request ids/supersession, worker-error surfacing, and query timeouts. | Homebrew edits update results without reload and stale worker responses cannot win. |
| PWA-001 | Test cold/offline launch for every route with essential, partial, and full caches. | “Not downloaded,” “not found,” offline, and corrupted-cache states have distinct recovery actions. |
| PWA-002 | Validate install/update behavior on iOS and Android; add tested 192/512 and maskable assets rather than relying only on SVG icons. | Install, offline reload, deferred update, failed update, and recovery pass on target devices. |

### Security, privacy, and imports

| ID | Remaining work | Acceptance signal |
|---|---|---|
| SEC-001 | Done for content-driven `{@link}` URLs: `safeExternalHref` allow-lists http(s) only and strips control/zero-width obfuscation, rendering unsafe targets as inert text (`renderEntries`). Remaining: add CSP, Referrer-Policy, X-Content-Type-Options, and Permissions-Policy in deployment (no deployment config lives in the repo yet). | `javascript:`, `data:`, malformed, and control-character URLs cannot execute or navigate. |
| SEC-002 | Stored payload bounds landed: `assertJsonWithinLimits` (nodes/depth/string) now gates all homebrew ingestion (`buildHomebrewRow` — file, URL, and embedded) and character imports, plus a max embedded-file count and export text-size cap. Remaining: bound the raw remote-response byte stream before parse, and cap regex work and worker processing. | Adversarial payload tests fail safely before storage/indexing. |
| IMP-002 | Done for export scoping/DTO: `homebrewForExport` (pure, unit-tested) walks the character's refs to include only the homebrew files it depends on, mapped to a minimal `{ fileName, json }` public DTO — no more shipping all enabled homebrew or local-only fields (`enabled`/`editable`/`addedAt`/`rev`). Browser-verified: a character using 1 of 2 enabled files exported only that one. Remaining: an import *preview* UI that explains dependencies, duplicates, winner policy, and source/entity collisions before commit. | Import preview explains dependencies, duplicates, winner policy, and conflicts before commit. |
| PRIV-001 | Add an in-app local-data/privacy explanation and full reset/export controls. | Users can see what is stored/requested, back it up, and delete IndexedDB plus app caches deliberately. |
| LEGAL-001 | Obtain content/licensing review and add license, third-party notices, mirror attribution/terms, and trademark disclaimer. | Release documentation records the approved content and attribution policy. |

### Accessibility and inclusive design

| ID | Remaining work | Acceptance signal |
|---|---|---|
| A11Y-001 | Focus visibility done: one unlayered global `:focus-visible` rule in `app.css` gives every interactive element a high-contrast 2px `--color-ink` outline on keyboard/programmatic focus, overriding the ~20 `outline-none` utilities without editing each call site. Browser-verified: tabbing to the (`outline-none`) search input shows the ring (`matchesFocusVisible`, near-white outline). Remaining: give icon-only controls real accessible names (not just `title`) and semantic checked/pressed/value states to toggles/pips. | Every route is operable and understandable with keyboard and accessibility APIs. |
| A11Y-002 | Increase undersized touch targets; ensure state is not color-only; add restrained live regions and real progress semantics for saves, data, imports, resources, HP, search, and updates. | Target-size, contrast, and announcement audits pass without over-announcing. |
| A11Y-003 | Run axe plus manual VoiceOver/TalkBack, focus-trap, virtual-list, zoom, large-text, landscape, safe-area, external-keyboard, and reduced-motion testing. | Results and fixes are recorded for every main flow. |

### Creator and navigation

The creator now has class-aware standard-array auto-assignment, point-buy cost
feedback, unresolved-choice warnings, a final review, inline origin choices, and
a “create anyway” path. The remaining work is narrower than the original
review:

| ID | Remaining work | Acceptance signal |
|---|---|---|
| UX-001 | Invalid `?step=` deep links now recover: the step list + a pure, unit-tested `normalizeStep` guard coerce unknown/empty values to the first step instead of rendering a broken wizard (out-of-range index). Remaining: make “standard array” a true assign/swap allocator instead of arbitrary 3–18 steppers; strengthen nonstandard point-buy cues; add explicit resume/restart/discard for the sessionStorage draft. | The normal path is unmistakable, deep links recover, and intentional deviations remain possible. |
| UX-002 | Explain local-first storage, initial/background downloads, eviction risk, backup, offline readiness, and edition choice during onboarding. | A first-time user knows when the app is safe to use offline and how to protect data. |
| UX-003 | Add page titles, focused-flow escape/back behavior, and a useful 404. Persistent top-level navigation is already shipped. | Routes expose useful context to browsers, assistive tech, and users arriving via deep link. |

### Quality gates

| ID | Remaining work | Acceptance signal |
|---|---|---|
| TEST-001 | Done: `.github/workflows/ci.yml` runs frozen install, lint, typecheck, unit tests, and the production/PWA build on every push/PR (Bun pinned to 1.3.14), uploads the `dist` artifact, and writes a bundle-size table to the run summary. Remaining: add coverage thresholds and bundle-budget gating (TEST-002/coverage work). | Every PR runs the current local green baseline. |
| TEST-002 | Extend the new character-session race/write-failure tests with IndexedDB-backed coverage for transactions, migrations, quota behavior, history, lifecycle events, and multiple tabs. | Persistence risks are reproducible without manual timing. |
| TEST-003 | Add component/integration tests for creator review, choices, rules switching, routing, inventory, casting, rests, imports, homebrew edits, and error states. | UI state transitions have regression coverage. |
| TEST-004 | Add browser E2E for first load, offline reload, service-worker updates, character lifecycle, import/export, and failed/resumed data installs. | Release-critical flows pass in supported browsers. |
| TEST-005 | Run `scripts/data-audit.ts` for every data-tag bump and on a schedule. | Core entities, parser warnings, copy/mod behavior, and tag coverage have budgets. |

## P2 — product and engineering depth

### Rules and content automation

These are the remaining mechanics from the former focused future-work list,
plus the broader rules-audit work:

| Area | Remaining work | Acceptance signal |
|---|---|---|
| Warlock invocations | Enforce or clearly warn on Pact Boon, patron, spellcasting, and known-spell prerequisites after resolving the character. Level gates already work. | Every prerequisite is evaluated or explicitly labeled advisory. |
| Battle Master maneuvers | Add the Strength-or-Dexterity maneuver-DC choice and show computed informational DC notes for save-forcing riders rather than fake action buttons. | Disarming/Pushing/Trip show Str saves; Goading/Menacing show Wis saves; the DC uses the chosen ability. |
| Dragonborn/Aasimar/Genasi utilities | Surface Metallic secondary breath, Gem flight/telepathy, Aasimar Celestial Revelation forms, and Genasi elemental utilities as useful, edition-correct chips or notes. | Each trait is discoverable without inventing incorrect action economy or resource use. |
| Background equipment slots | Feed background `startingEquipment` through the concrete slot picker now used for classes. | Supported slots create real items; unsupported entries remain honest notes. |
| Exhaustion automation | Keep the existing speed/death workflow, and either apply or explicitly preserve as advisory the 2014 HP-max/disadvantage effects and 2024 d20 penalty. | Roll/HP behavior and advisory text cannot disagree. |
| Spell guidance | Extend current cantrip/level-1 starter tips into level-up and replacement guidance. | Each casting model gets useful, non-prescriptive guidance beyond level 1. |
| Granted/innate spells | Add casting/use tracking for per-rest innate and granted spells, not only detail links. | Charges, slot use, concentration, and no-slot cases are represented correctly. |
| Equipment and combat audit | Verify attunement, armor requirements, shields/hands, ammunition, weapon properties/mastery, critical damage, riders, improvised attacks, and encumbrance. | Edition-specific golden characters cover each automated rule. |
| Class/rest audit | Verify subclass lists, replacements, Magical Secrets-style picks, feature gating/replacement, multiclass rounding/proficiencies, and edition rest policies. | Representative 2014/2024 single- and multiclass fixtures pass expert-reviewed expectations. |
| Prose automation | Audit curated/prose-scanned actions and resources against the pinned dataset; retain confidence/provenance and allow correction. | False-positive/negative budgets are measured on every data-tag change. |
| Versioned subraces | Apply subrace `_versions` `_mod` operations against merged race+subrace entries where targets live only on the base race. | `removeArr`/`replaceArr` substitutions produce the intended versioned prose without curated fallback. |

### Product experience

| Area | Remaining work |
|---|---|
| Backup and recovery | Full-app backup/restore, reminder, import preview, trash/archive/undo, and recovery documentation. |
| Guided level-up | Preview HP, subclass timing, choices, spell gains/replacements, and resource changes before commit. Multiclassing remains in the free-form Build page unless product scope changes. |
| Character management | Search, sort, last-played, campaign/tags, optional portraits, and safer cross-device handoff. |
| Sheet and casting polish | Unify spell-row and slot-pip casting, add upcast effects/material/ritual reminders and cast history, and support critical/rider rolls. |
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
- Document the export format, forward/backward compatibility, and migration
  policy with fixtures.

### Maintainability and diagnostics

- Put runtime schemas at every owned `unknown` boundary and enforce repository
  access plus the React-free engine boundary with architecture checks.
- Split the largest feature modules around domain commands/state machines;
  consolidate repeated form, drawer, download, entity-label, toggle, and status
  primitives without hiding game behavior.
- Replace lifecycle-sensitive module singletons with resettable/testable
  services. Add typed commands/results for damage, rest, casting, leveling,
  choices, and imports, plus document revisions and meaningful history reasons.
- Queue or explicitly cancel overlapping dialogs; use collision-proof roll ids;
  share a cross-browser download helper; improve history comparison/storage.
- Add privacy-preserving diagnostics for app/data version, storage, warnings,
  errors, and performance without character content unless explicitly opted in.

### Testing, documentation, and release operations

- Add coverage reporting and risk-based thresholds for the engine, owned import
  schemas, persistence, loader, search protocol, and gameplay commands. Add
  property/fuzz coverage for dice, choices, entry rendering, copy/mod,
  migrations, and hostile imports, plus golden 2014/2024 characters.
- Remove or narrowly scope `passWithNoTests: true`; include `tests-fixtures` in
  lint; add repeatable `check`, `data:audit`, coverage, E2E, and bundle-analysis
  scripts.
- Pin supported Bun/Node versions and document architecture, data/export
  formats, persistence/migrations, automation limits, homebrew, troubleshooting,
  deployment headers/fallback/cache policy, and rollback.
- Define semantic app/data/export versions, changelog and support policy,
  release/rollback checklist, issue/PR templates, and smoke tests for iOS,
  Android, Chromium, Firefox, and Safari.
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
  browser smoke tests, backup/recovery guidance, and a consistent `Cast Guidance`
  product name across the app, manifest, exports, and documentation.

An item is complete only when the behavior or product decision is documented,
appropriate regression coverage exists, failure/accessibility states are
handled, existing local data is considered, and the relevant automated and
device checks pass.
