# Cast Guidance — App Review and Improvement Backlog

Review date: 2026-07-13

Reviewed revision: `eec6fb0` (`main`)

Scope: product experience, gameplay correctness, data integrity, security, privacy,
accessibility, performance, PWA/offline behavior, architecture, testing, documentation, and
delivery.

## Purpose and use

This document is the working inventory of improvements found during a static review of the full
repository plus the project's automated checks. It is intentionally broader than a bug report: it
contains confirmed defects, risk-reduction work, product opportunities, and items that need
hands-on validation.

Priority meanings:

- **P0 — protect users and data:** credible data loss, security exposure, or silent data
  corruption. Address before broad release.
- **P1 — release quality:** significant reliability, accessibility, rules, or UX gaps. Plan for the
  next milestone.
- **P2 — product/engineering quality:** worthwhile improvements after the release blockers.
- **P3 — polish/scale:** optimizations and longer-term capabilities.

Finding types:

- **Confirmed:** the behavior follows directly from the current code.
- **Risk:** the design can fail under a realistic condition; reproduce it before closing.
- **Opportunity:** a product or engineering enhancement rather than a current defect.
- **Validate:** requires browser/device, real-dataset, rules-expert, or user testing.

### Product principle — guidance, not gatekeeping

Cast Guidance should explain the rules and make unusual choices easy to recognize without acting
as a rules enforcer. Players and tables may intentionally use house rules, mix compatible 2014 and
2024 material, exceed a published limit, or take an action that is not normally available.

- Show recommended, unusual, over-limit, and unresolved states with accessible text, iconography,
  and color-independent visual treatment.
- Keep the action available. Use a lightweight acknowledgement only when the action has ambiguous
  or surprising state consequences; do not repeatedly interrupt an intentional override.
- Preserve provenance and explain why a warning appears so the player or DM can make the decision.
- Treat 2014/2024 compatibility as a spectrum. In particular, older items and spells may remain
  valid in a 2024 game; mixing editions is not inherently an error.
- Reserve hard rejection for trust and integrity boundaries such as unsafe links, malformed or
  hostile imports, corrupted identifiers, and writes that cannot be represented safely.

## Executive summary

Cast Guidance has a strong foundation: a pure derivation engine, local-first storage, route-level
code splitting, defensive parsing of third-party game data, a bounded cryptographic dice roller,
and an unusually useful set of engine tests for a young app. TypeScript and the production PWA
build are green, and all 145 unit tests pass.

The highest-risk work is concentrated in boundaries around that foundation:

1. Debounced character saves are global, are not flushed on character changes or page exit, and
   ignore persistence failures. A quick character switch followed by an edit can cancel the first
   character's pending save.
2. While a new character route loads, the session continues to expose the previous character, so
   it can briefly be displayed or edited under the new URL.
3. Spell casting can apply concentration before establishing how a slot is being spent, and it
   gives little guidance when a spell is unprepared or resources are exhausted.
4. Character exports and embedded homebrew are weakly validated. Imported homebrew rows bypass the
   normal validation/hash path entirely.
5. Rules-version filtering is largely a picker concern. Mixed-edition choices are not classified
   as compatible carry-overs, updated alternatives, or likely rules conflicts.
6. Stored choice values are trusted by the engine without distinguishing intentional over-limit
   choices from stale, unknown, duplicated, or disabled values.
7. On-demand class/spell downloads create a separate four-request pool per pack, defeating the
   stated global concurrency limit and causing duplicate progress accounting under concurrent
   callers.
8. Editing an in-app homebrew collection does not change the registry/search signature, so the
   worker can continue serving a stale search index.
9. The guided creator lacks a true standard-array allocator and does not clearly warn about
   nonstandard point buy, missing recommended selections, or unresolved choices before creation.
10. Keyboard focus visibility, accessible names/states, target sizes, and live status semantics
    need a deliberate accessibility pass.

## Automated baseline

| Check | Result | Evidence / notes |
|---|---|---|
| Dependency install | Pass | `bun install --frozen-lockfile`; 423 packages installed. |
| TypeScript | Pass | `bun run typecheck`. |
| Unit tests | Pass | 8 files, 145 tests, 0 failures via `bun run test`. |
| Production build | Pass | `bun run build`; Vite and service-worker generation completed. |
| PWA precache | Pass | 44 entries, 725.03 KiB generated by Workbox. |
| Bundle observation | Review | Main entry is 379.48 kB / 121.07 kB gzip; the largest lazy feature chunk is 31.60 kB / 9.47 kB gzip. Establish budgets rather than treating this observation alone as a defect. |
| Lint/format | **Fail** | `bun run lint` reports formatting errors in `src/db/db.ts`, `src/features/creator/CreatorPage.tsx`, and `src/lib/guards.ts`. |
| Real dataset audit | Not run | `scripts/data-audit.ts` depends on configured CDN/raw hosts outside the review environment's available host allowlist. Run it in CI or a normal development network before a data-tag release. |
| Browser/E2E/accessibility | Not available | No browser test harness or E2E suite exists in the repository; UI findings below are code-based and should be validated on real devices. |

## Strengths to preserve

- The engine's `CharacterDoc + EngineContext -> DerivedSheet` boundary is clear, testable, and
  mostly React-free (`src/engine/derive.ts`).
- Derived values keep labeled parts, which makes calculations explainable in the UI.
- Game content is not committed to the repository; progressive packs are cached locally in
  IndexedDB.
- Route-level lazy imports keep large feature pages out of the initial route.
- The dice parser caps terms, dice count, and sides, and the default roller uses unbiased
  cryptographic randomness.
- React renders third-party entry text without `dangerouslySetInnerHTML`.
- `_copy`/`_mod` processing is tolerant and emits audit warnings instead of crashing on schema
  drift.
- Destructive character and homebrew actions already use confirmation dialogs.
- Long lists use virtualization, and search indexing runs in a worker.
- The app already has useful offline update prompting, version history, and self-contained
  character exports; the backlog should harden these rather than replace them.

## Recommended delivery sequence

### Milestone A — data safety and trustworthy rules guidance

Complete `REL-001`, `REL-002`, `IMP-001`, `IMP-002`, `GAME-001`, `GAME-002`, `GAME-003`,
`GAME-004`, `DATA-001`, `DATA-002`, and `SEC-001`. Add regression tests with each fix.

### Milestone B — accessible release quality

Complete `A11Y-001` through `A11Y-008`, `ERR-001`, `ERR-002`, `PWA-001`, `PWA-002`,
`TEST-001` through `TEST-005`, and clear the lint baseline.

### Milestone C — rules depth and product completeness

Address spell-selection guidance, rest/version differences, source policy, homebrew dependencies,
backup/restore, guided level-up, custom equipment, print/export, and the real-dataset compatibility
gate.

### Milestone D — scale and maintainability

Batch registry/search rebuilds, enforce global fetching concurrency, split oversized feature
components, add bundle budgets and observability, and formalize releases/legal documentation.

## Detailed high-priority findings

### REL-001 — Make autosave durable and character-scoped (P0, Confirmed)

**Evidence:** `src/stores/characterSession.ts:8-15,34-55,69-73`. A single module-level timer is
shared by every character. `load()` neither flushes nor cancels the current document before loading
another. Editing character B clears character A's pending timer. `close()` is never called by the
application, page lifecycle events are not handled, and both writes are fire-and-forget.

**Work:** introduce a serialized save coordinator keyed by character id; flush before route changes,
on `pagehide`/visibility changes where feasible, and before replacing session state. Await or queue
the character and history writes, expose `saving/saved/error`, and retry safely without allowing an
older write to overwrite a newer one.

**Done when:** a test that edits A, immediately navigates to and edits B, then reloads proves both
documents persisted; forced IndexedDB failure is visible and recoverable; no unhandled promise
rejections occur.

### REL-002 — Never render one character under another character's route (P0, Confirmed)

**Evidence:** `src/features/sheet/useCharacterSheet.ts:22-28` and
`src/stores/characterSession.ts:34-44`. The previous `doc` stays in the store until the asynchronous
`get(id)` resolves. `missing` is also not reset at the start of a new load.

**Work:** model `idle/loading/ready/missing/error` with the requested id; clear or hide stale data as
soon as the id changes; ignore late responses for superseded ids; disable edits unless the loaded
document id matches the route.

**Done when:** rapid A -> B -> C navigation never displays or updates the wrong document, including
with deliberately delayed reads and a missing id.

### IMP-001 — Validate the complete import/export boundary (P0, Confirmed)

**Evidence:** `src/lib/guards.ts:93-119` only checks that `character` is an object and casts
`homebrew`; `src/engine/migrate.ts:11-28` then casts almost any object to `CharacterDoc`.
`src/features/characters/CharacterListPage.tsx:31-44` writes embedded `HomebrewFileRow` values
directly to IndexedDB, bypassing `homebrewRepo.importJson()` and trusting ids, flags, counts, and
timestamps supplied by the file.

**Work:** define versioned runtime schemas and size/count limits for the export DTO, character
document, entity refs, play state, effects, and embedded homebrew. Recompute homebrew hashes and
metadata through the repository import path. Reject or repair non-finite/out-of-range numbers,
unknown enum values, duplicate ids, and oversized/nested payloads. Import transactionally and show
a preview/conflict summary.

**Done when:** malformed, future-version, oversized, adversarial, and partial imports fail without
changing the database; valid older exports migrate; imported embedded homebrew cannot overwrite a
different local file by supplying its id.

### GAME-001 — Make casting state transparent and user-directed (P1, Confirmed)

**Evidence:** `src/features/sheet/SpellManager.tsx:44-74`. Concentration is set before slot search.
If no qualifying pact or shared slot exists, the function returns after applying that side effect.
The UI gives no clear warning when resources are exhausted and always spends the lowest slot,
preferring pact slots without asking the player.

**Work:** show the recommended slot levels and pact/shared pools, then let the player choose how the
cast should be recorded. Keep casting available when no normal slot exists, but mark it clearly as
an override and use a lightweight acknowledgement if its state effects are ambiguous. Apply slot
spend and concentration from one explicit decision, return a typed result, announce the outcome,
and support upcasting without silently pushing spent counters beyond their displayed capacity.

**Done when:** normal casts spend the selected resource; no-slot and other off-rules casts remain
available but are unmistakably labeled and do not pretend a slot was spent. Tests cover cantrips,
upcasting, pact/shared pools, multiclass casters, concentration replacement, exhausted resources,
and intentional overrides.

### GAME-002 — Model known/prepared semantics and flag deviations (P1, Confirmed)

**Evidence:** `src/features/sheet/SpellManager.tsx:108-175,219-259` and
`src/features/sheet/tabs/PlayTab.tsx:817-866`. Casting is offered for `(known || prepared)` in the
manager and for every `known` spell on the play sheet. `preparedMax` and `cantripsKnown` are display
counters only. Keeping the action available is intentional; the gap is that the UI does not
distinguish an ordinary cast from an intentional departure from the selected rules.

**Work:** model each class's spell acquisition mode explicitly (known, prepared from full list,
spellbook, always prepared, pact, granted). Visually distinguish normally castable, unprepared,
over-limit, and granted spells in Play. Keep selection and casting available, explain the rule being
departed from, and preserve edition/class-specific exceptions and intentional table overrides.

**Done when:** an unprepared or over-limit cast is possible but carries an unmistakable accessible
warning; known casters receive no false prepared warning; always-prepared/granted spells work; and
normal plus override paths have unit and UI tests.

### GAME-003 — Make rules-version compatibility visible without forbidding mixing (P1, Confirmed)

**Evidence:** `filterByRulesVersion()` is used in UI pickers, but `engineContextFor()` exposes the
entire registry and collectors resolve stored refs without edition checks
(`src/data5e/engineAdapter.ts:5-9`, `src/engine/effects/class.ts:252-405`,
`src/engine/effects/race.ts:111-132`). Build-page switching only changes a string
(`src/features/sheet/BuildPage.tsx:244-260`). The guided switch clears some selections but leaves
equipment and spellcasting (`src/features/creator/CreatorPage.tsx:165-176`). Mixed-edition use is
intentional; the gap is the lack of compatibility and provenance information.

**Work:** classify edition compatibility inside the engine or its context, not only in pickers.
Default pickers to the selected rules version while offering “show all.” Treat 2014 items and
spells as potentially valid carry-overs in 2024, and distinguish unchanged carry-overs, updated or
reprinted alternatives, and likely incompatible mechanics. When switching versions, preview the
impact and offer keep/remap/remove choices for class, subclass, species, background, feat, spell,
equipment, and choice refs; never remove them automatically.

**Done when:** mixed-edition characters remain supported, every cross-edition selection has clear
provenance and an appropriate compatibility cue, compatible carry-overs are not presented as
errors, and likely conflicts cannot be overlooked accidentally.

### GAME-004 — Validate stored choices and surface rule deviations (P1, Confirmed)

**Evidence:** `src/engine/effects/base.ts:47-61` applies every stored value and considers any array at
least `count` long resolved. It does not check option membership, disabled options, maximum count,
or duplicate rules. The generic ability stepper also allows stacking for every multi-ability prompt
(`src/features/creator/ChoicePromptRenderer.tsx:45-63`), although only some prompts normally allow
that. Intentional overrides and stale/corrupted values therefore look identical to the engine.

**Work:** add per-prompt guidance (`min`, `max`, unique/repeatable, ordered slots), validate
structure and identifiers, and distinguish ASI stacking from normally distinct racial/background
choices. Allow a player to retain deliberate over-count or repeated selections with a visible
manual-override state; do not silently apply unknown, corrupted, or unavailable identifiers.

**Done when:** intentional rule deviations can apply with a clear warning and provenance, while
malformed or unknown imported/stale choices cannot silently grant effects. Tests cover over-count,
unknown ids, deliberate duplicates, disabled options, and recovery from stale data.

### DATA-001 — Enforce one global pack fetch coordinator (P1, Confirmed)

**Evidence:** `ensureTypePacks()` calls `Promise.all()` across every class or spell pack while each
`ensurePack()` creates up to four workers (`src/data5e/loader.ts:107-117,193-205`). Concurrent
`ensurePack()` callers can also count the same missing file more than once and each calls
`fileDone()` after awaiting the same de-duplicated promise.

**Work:** de-duplicate at pack and `(tag,path)` level, put all requests behind one global limiter,
and derive progress from unique requested/completed keys. Reset or scope counters per operation.

**Done when:** measured concurrency never exceeds the configured limit, progress never exceeds
100%, and concurrent background/UI requests share one operation.

### DATA-002 — Make data-version installation recoverable (P1, Risk)

**Evidence:** update downloads are sequential, progress totals include already cached retry files,
failed new-tag rows are retained, validation checks only a non-empty race array, and the swap spans
separate settings/meta writes before old-tag deletion (`src/data5e/loader.ts:228-289`).

**Work:** use a staged install record, bounded concurrent downloads, schema/count checks for all
required indexes/packs, accurate retry progress, cleanup/resume controls, an atomic activation
transaction, and a retained rollback tag until the new version has booted successfully.

**Done when:** interruption at every phase leaves the old version usable and a retry or rollback is
available without leaked partial caches.

### SEARCH-001 — Version search indexes by content and serialize rebuilds (P1, Confirmed)

**Evidence:** registry/search signatures contain cached path names and homebrew ids but not editable
homebrew content (`src/data5e/registry.ts:25-39`). Editable files keep a UUID while their content
changes (`src/db/homebrewRepo.ts:47-71`). `invalidateRegistry()` does not reset the search client's
`indexedSignature`, so `ensureSearchIndex()` can reuse the old promise/index
(`src/data5e/search/client.ts:79-117`). Multiple builds also attach generic `ready` listeners to one
worker, and worker errors resolve as apparent readiness.

**Work:** include a content revision/hash in signatures, use request ids for build/load responses,
cancel/supersede old builds, reject on worker failure, clear pending queries, and rebuild once per
settled registry version.

**Done when:** editing, enabling, disabling, deleting, or importing homebrew changes search results
without reload; stale worker responses cannot win; failures show a retryable state.

### UX-001 — Make the creator guide without blocking player choices (P1, Confirmed)

**Evidence:** “standard” mode exposes arbitrary 3-18 steppers instead of helping the player assign
the six standard-array values. Point buy can exceed 27 or leave the usual 8-15 range without a
strong visual distinction, and creation provides no consolidated warning for missing recommended
class/species/background selections or unresolved choices (`src/features/creator/CreatorPage.tsx`).
An unrecognized `?step=` value is cast to `Step`, yielding index `-1`.

**Work:** add an assign/swap standard-array tool, live point-buy calculation, and strong accessible
warnings when scores are outside the usual range or budget. Define recommended fields by edition
and show unresolved choices inline and on a final review step. Keep Next/Create available; where
useful, ask once for acknowledgement that the character is intentionally nonstandard. Normalize
invalid step params and offer restart/discard/resume for the single saved draft.

**Done when:** the recommended path is obvious, every deviation is visible before creation and on
the resulting character, the player can still create intentionally nonstandard characters, invalid
deep links recover, and backtracking explains any dependent state that became unusual or stale.

### SEC-001 — Constrain content-driven links and add browser security policy (P1, Confirmed/Risk)

**Evidence:** imported/remote homebrew can supply `{@link}` destinations rendered directly as
`href` (`src/data5e/entries/renderEntries.tsx:142-151`). `index.html` defines no CSP or other policy;
hosting headers are undocumented.

**Work:** parse links and allow only approved protocols (normally `https:`, optionally `http:` for
local development and explicit `mailto:`); render everything else as inert text. Add and test CSP,
`Referrer-Policy`, `X-Content-Type-Options`, and an appropriate `Permissions-Policy` in the hosting
layer. Keep `noopener/noreferrer` behavior for new tabs.

**Done when:** `javascript:`, `data:`, malformed, and control-character URLs cannot execute or
navigate; CSP works with Vite/PWA assets and required data hosts.

## Full improvement backlog

The detailed items above are repeated here by id only when further scope is useful.

### Reliability, persistence, and error handling

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| REL-001 | P0 | Confirmed | Durable, serialized, character-scoped autosave with flush/error state; see detailed finding. |
| REL-002 | P0 | Confirmed | Route-id-scoped loading that never exposes a stale document; see detailed finding. |
| REL-003 | P1 | Confirmed | Stop swallowing repository/history errors. Every mutate action (rename, duplicate, delete, import, builder save, restore, update) reports success/failure and supports retry. |
| REL-004 | P1 | Risk | Put character deletion plus history deletion, and character import plus embedded-homebrew import, in Dexie transactions so partial operations roll back. |
| REL-005 | P1 | Confirmed | Add route and component error boundaries. A malformed character/entity or decode error should show recovery actions instead of taking down the app. No router `errorElement` exists today. |
| REL-006 | P1 | Confirmed | Use repositories consistently. `CharacterListPage` reads `db.characters` directly, bypassing `migrateCharacter()` and future validation; provide live-query repository adapters and architecture lint rules. |
| REL-007 | P1 | Risk | Add optimistic revision/conflict handling or a per-character tab lock. Two tabs currently use last-write-wins with no conflict notice. |
| REL-008 | P2 | Confirmed | Make history status honest while a debounce is pending; do not label the newest persisted row “current” when the in-memory document has newer edits. |
| REL-009 | P2 | Risk | Replace `JSON.stringify` full-document history comparisons with a stable revision/hash and avoid querying/sorting all 50 snapshots on every save. |
| REL-010 | P2 | Confirmed | Queue dialogs or explicitly cancel/resolve the previous request. A second `ask*()` call overwrites the store and can leave the first promise unresolved. |
| REL-011 | P2 | Confirmed | Give rolls unique ids. Timestamp-based removal can delete multiple same-millisecond rolls, and the rendered key can collide. |
| REL-012 | P2 | Risk | Append temporary download anchors to the document and revoke object URLs after the click lifecycle for cross-browser reliability. Share one tested download helper. |
| ERR-001 | P1 | Confirmed | Expose registry/data-hook errors instead of returning `null` forever from swallowed rejections (`src/data5e/hooks.ts`). Include Retry and offline/cache-repair actions. |
| ERR-002 | P1 | Confirmed | Add loading, empty, missing, and error distinctions to `useLiveQuery` pages. The homebrew builder currently shows “Loading…” forever for a missing id. |
| ERR-003 | P2 | Confirmed | Report service-worker update failures and offline-ready status; the update toast currently assumes success. |
| ERR-004 | P2 | Opportunity | Add a privacy-preserving diagnostics export (app/data version, storage estimate, warnings, recent errors; no character content unless opted in). |

### Imports, homebrew, and data integrity

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| IMP-001 | P0 | Confirmed | Complete runtime validation and transactional import; see detailed finding. |
| IMP-002 | P1 | Confirmed | Separate public export DTOs from `HomebrewFileRow`. Do not export local fields such as editable/enabled/addedAt as part of the interchange contract. |
| IMP-003 | P1 | Confirmed | Export only exact homebrew dependencies, not every enabled collection. Populate and maintain `homebrewDeps`; preview missing/colliding dependencies on import. |
| IMP-004 | P1 | Risk | Enforce file/URL response size, entity count, nesting, and processing-time limits before parsing/indexing untrusted JSON. Validate content type where useful. |
| IMP-005 | P1 | Confirmed | Detect duplicate `name|source` entities and source-id collisions across official and homebrew content. Explain which entity wins and offer rename/disable resolution; the registry silently indexes the first. |
| IMP-006 | P2 | Confirmed | Canonicalize JSON before hashing imported homebrew so equivalent key order does not create duplicate collections. Clarify that editable rows use stable UUIDs, not content hashes. |
| IMP-007 | P2 | Confirmed | Re-importing an existing disabled hash should explain “already present” and optionally re-enable/update provenance rather than reporting a fresh import. |
| IMP-008 | P2 | Confirmed | Validate/normalize homebrew abbreviations and filenames, reserve official source ids, and prevent blank/duplicate ids. |
| IMP-009 | P2 | Risk | Await builder saves/deletes before closing the form, disable repeated actions while saving, and retain edits on failure. |
| IMP-010 | P2 | Opportunity | Add raw JSON view/edit/validation and schema-specific editors for races, backgrounds, classes, and subclasses; show unsupported fields preserved by the form. |
| IMP-011 | P2 | Opportunity | Add import preview: source, entity counts, duplicates, `_copy` warnings, file size, and affected characters before commit. |
| IMP-012 | P3 | Opportunity | Add explicit export-format version documentation, compatibility fixtures, and downgrade/forward-compatibility policy. |

### Gameplay and rules correctness

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| GAME-001 | P1 | Confirmed | User-directed casting with clear slot/pool guidance and visible override states; see detailed finding. |
| GAME-002 | P1 | Confirmed | Correct known/prepared/always-prepared guidance without blocking intentional deviations; see detailed finding. |
| GAME-003 | P1 | Confirmed | Classify and explain rules-version compatibility while supporting mixed-edition play; see detailed finding. |
| GAME-004 | P1 | Confirmed | Validate choice structure and identifiers while visually marking deliberate limit/repeat deviations; see detailed finding. |
| GAME-005 | P1 | Confirmed | Default ASI feat and optional-feature options to the selected rules version and source, with “show all” and clear provenance. Show prerequisite warnings while allowing intentional or DM-approved selections. |
| GAME-006 | P1 | Validate | Build an edition-specific rest policy. Current long/short rest logic is shared for 2014 and 2024; verify hit-dice, resource, exhaustion, concentration, and other recovery differences with a rules expert. |
| GAME-007 | P1 | Confirmed | After level/class changes, flag slots, pact slots, hit dice, or resource uses that exceed newly derived maxima; offer a one-click normalization but preserve intentional values and an audit trail. |
| GAME-008 | P1 | Confirmed | Turn cantrip, spells-known, prepared, and spellbook capacities into class-specific guidance: show strong over-limit cues while permitting deliberate overrides. |
| GAME-009 | P1 | Validate | Expand spell-list resolution for subclass lists, always-prepared lists, replacements, Magical Secrets-style picks, and homebrew class/source variations; add real-data fixtures. |
| GAME-010 | P1 | Validate | Audit the prose scanner against the pinned dataset. Regex-derived uses/actions can create false positives/negatives; persist confidence/source and let users correct automation. |
| GAME-011 | P2 | Confirmed | Make exhaustion/death-save tracking semantically complete or clearly label it manual. Six exhaustion/death-save marks currently have no terminal-state workflow, and “past 6 clears” is surprising. |
| GAME-012 | P2 | Opportunity | Add casting/use tracking for granted and innate spells, including per-rest charges and concentration, instead of detail-only links. |
| GAME-013 | P2 | Opportunity | Support critical damage from attack rows and damage riders in the UI; the roller has a `critical` option but no surfaced control. |
| GAME-014 | P2 | Validate | Audit equipment math: attunement requirements/limit, armor proficiency and Strength/stealth effects, shields/hand use, ammunition, versatile/two-handed choice, improvised attacks, and 2024 weapon mastery behavior. |
| GAME-015 | P2 | Validate | Audit class/subclass feature gating, duplicate/replacement features, multiclass spell-slot rounding, and first-class vs multiclass proficiencies against both editions. |
| GAME-016 | P2 | Confirmed | Replace hardcoded language fallbacks and other incomplete enumerations with registry-driven, rules-version-aware options. |
| GAME-017 | P2 | Opportunity | Allow table-rule overrides for rest recovery, level cap, point-buy budget, attunement cap, encumbrance, HP method, and source policy. |
| GAME-018 | P3 | Opportunity | Add a rules-conformance matrix showing automated, partially automated, prose-only, and manual mechanics per source/version. |

### Data download, offline, search, and performance

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| DATA-001 | P1 | Confirmed | One global, de-duplicated fetch coordinator with accurate progress; see detailed finding. |
| DATA-002 | P1 | Risk | Recoverable staged data-version installation and rollback; see detailed finding. |
| DATA-003 | P1 | Confirmed | Do not rebuild the entire registry on every downloaded file. Publish pack-level revisions or debounce/batch hydration; active hooks currently refresh on every `filesDone`. |
| DATA-004 | P1 | Confirmed | Do not repeatedly build/persist search indexes for each growing background-file set. Build after required scopes settle or incrementally update one versioned index. |
| DATA-005 | P1 | Risk | Validate GitHub tag names/compatibility before installation. A non-compatible recent tag should never be offered solely because it appears in the tags API. |
| DATA-006 | P2 | Confirmed | Record real byte sizes and per-pack storage use; `DataFileRow.bytes` is always zero. Use this for quota forecasting and cleanup. |
| DATA-007 | P2 | Opportunity | Respect data-saver/offline/battery context and ask before automatically downloading the full compendium. Offer essentials-only, selected sources, Wi-Fi-only, pause, and resume. |
| DATA-008 | P2 | Confirmed | Surface whether persistent storage was actually granted. Provide backup guidance and a cache reset/redownload action when quota or corruption occurs. |
| DATA-009 | P2 | Confirmed | Add cleanup for failed tags, obsolete search indexes, orphaned metadata, and old app caches; show reclaimable space before deletion. |
| DATA-010 | P2 | Risk | Add integrity/sanity checks beyond a non-empty race array: indexes, expected keys, representative entities, duplicate rates, copy/mod warning budgets, and checksum/provenance where available. |
| DATA-011 | P3 | Opportunity | Make endpoints injectable/configurable for tests, self-hosting, mirrors, enterprise policy, and deterministic failure simulation. |
| SEARCH-001 | P1 | Confirmed | Content-versioned, serialized search worker lifecycle; see detailed finding. |
| SEARCH-002 | P2 | Confirmed | Reject search readiness on worker errors, add worker `onerror`/timeouts, and resolve/reject every pending query when restarting. |
| SEARCH-003 | P2 | Opportunity | Search aliases, descriptions/tags, source, and type; add keyboard navigation, explicit no-results, recent searches, and source/version filters. |
| PERF-001 | P1 | Confirmed | Benchmark boot, initial essentials, registry rebuild, search build, derive, and large-character history on representative low-end mobile hardware. Establish budgets. |
| PERF-002 | P2 | Review | Set an initial-JS budget and inspect the 379.48 kB main entry. Keep route splitting; consider isolating loader/normalizer/DB work after measuring. |
| PERF-003 | P2 | Confirmed | Memoize or cache expensive normalized/derived results by stable revisions; avoid deriving every character and rebuilding registries repeatedly during background progress. |
| PERF-004 | P3 | Opportunity | Add performance marks and an opt-in local diagnostics panel for download, normalization, search, derivation, save, and render timings. |

### PWA and offline experience

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| PWA-001 | P1 | Validate | Test true offline behavior from a cold launch and on every main route with essentials-only, partial, and full data. Make unavailable content distinguish “not downloaded” from “not found” and provide a retry/download action. |
| PWA-002 | P1 | Validate | Validate installability and updates on iOS and Android. Add tested 192/512 PNG icons, a purpose-built maskable icon, Apple touch metadata, consistent brand/name/theme, and screenshots/shortcuts only if they improve install UX. SVG-only manifest icons are not a sufficient cross-device test strategy. |
| PWA-003 | P2 | Risk | Define service-worker cache/version policy and recovery: failed activation, stale chunk after deployment, cache corruption, update deferral, and rollback must not strand the app. Keep navigation fallback/SPA hosting in the deployment smoke test. |
| PWA-004 | P2 | Opportunity | Show online/offline, app-shell readiness, essentials readiness, and full-compendium readiness separately. Offer explicit pause/resume/cache repair rather than one global phase. |
| PWA-005 | P2 | Opportunity | Respect background/data-saver preferences and avoid competing downloads while a user is actively editing or playing; resume safely when idle/online. |

### Security, privacy, legal, and supply chain

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| SEC-001 | P1 | Confirmed/Risk | Safe content-link protocols plus CSP/security headers; see detailed finding. |
| SEC-002 | P1 | Risk | Treat every remote dataset/homebrew field as untrusted at storage, render, regex, and worker boundaries; add adversarial tests for deep nesting, huge strings, pathological regex inputs, and malformed URLs. |
| SEC-003 | P1 | Opportunity | Add dependency vulnerability/license scanning and automated update PRs in CI; document triage and patch SLAs. |
| SEC-004 | P2 | Opportunity | Publish a security policy and private vulnerability-reporting route; document supported versions and local-data threat model. |
| PRIV-001 | P1 | Opportunity | Add an in-app privacy/data page explaining IndexedDB/session storage, automatic mirror/GitHub requests, URL imports, deletion, storage eviction, and what never leaves the device. |
| PRIV-002 | P2 | Opportunity | Provide “export all data” and “delete/reset all local data” controls with previews and confirmation. Verify that service-worker caches and IndexedDB are both covered. |
| LEGAL-001 | P1 | Validate | Obtain a content/licensing review for automatically downloading the full third-party dataset, source selection, attribution, and redistribution through self-contained exports. This is a review request, not a conclusion about legality. |
| LEGAL-002 | P1 | Opportunity | Add repository/app license, third-party notices, dataset/mirror attribution and terms links, and an appropriate D&D/Wizards trademark disclaimer. |
| SUPPLY-001 | P2 | Risk | Define trust/provenance for the pinned mirror tag and update tags; consider verified release metadata/checksums and a tested emergency pin/rollback process. |

### Accessibility and inclusive design

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| A11Y-001 | P1 | Confirmed | Restore a consistent, high-contrast `:focus-visible` treatment. Many controls use `outline-none` with no replacement. Test keyboard-only navigation on every route. |
| A11Y-002 | P1 | Confirmed | Give icon-only links/buttons and placeholder-only search fields explicit accessible names. Do not rely on `title` or placeholder text. |
| A11Y-003 | P1 | Confirmed | Add semantic states: `aria-pressed`/radio groups for mode toggles and checked/value semantics for pips, death saves, equipment, attunement, and conditions; verify route links expose correct `aria-current`. |
| A11Y-004 | P1 | Confirmed | Increase small interactive targets or spacing. Numerous 14-32 px icon/pip/stepper targets are difficult on mobile and for motor impairments. |
| A11Y-005 | P1 | Confirmed | Add `role=status`, `aria-live`, and real progress semantics for downloads, saves, imports, updates, errors, HP/resource changes, and search readiness without over-announcing. |
| A11Y-006 | P1 | Risk | Ensure state is not conveyed only by color (proficiency dots, used slots/resources, advantage, attunement, HP). Add text/shape/icon semantics and test contrast. |
| A11Y-007 | P1 | Validate | Run axe plus manual screen-reader testing (VoiceOver iOS/macOS, TalkBack Android) across drawers, virtual lists, fixed navigation, dialogs, and live updates. |
| A11Y-008 | P1 | Validate | Test 200-400% zoom, large dynamic text, landscape, narrow screens, safe areas, external keyboards, and reduced motion; remove clipping/overlap and respect `prefers-reduced-motion`. |
| A11Y-009 | P2 | Opportunity | Add skip navigation and stable page focus/title management after route changes and drawer closure. |
| A11Y-010 | P2 | Opportunity | Review plain-language copy, abbreviations, D&D jargon, and error messages; give new players explanations without slowing expert workflows. |

### Product and user experience

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| UX-001 | P1 | Confirmed | Guided creator with true generation tools, strong deviation warnings, and no hard rules gate; see detailed finding. |
| UX-002 | P1 | Opportunity | Add explicit local-first onboarding: expected initial download, offline behavior, persistence/eviction risk, backup recommendation, rules-version choice, and optional full-data download. |
| UX-003 | P1 | Opportunity | Provide full-app backup/restore and an automatic backup reminder. Character-only export is insufficient protection for a local-first app. |
| UX-004 | P1 | Confirmed | When class/race/background/rules version changes, show which choices, spells, equipment, and play resources become unusual or stale; offer keep/remap/reset and never discard them without consent. |
| UX-005 | P1 | Opportunity | Add a focused level-up flow that previews gains, HP choice/roll, subclass timing, new choices/spells, and resource changes before commit. |
| UX-006 | P2 | Confirmed | Add saved/error indicators for auto-save and homebrew editing. “Everything instantly usable” should not be claimed until the write succeeds. |
| UX-007 | P2 | Opportunity | Improve character management with search, sort, archive/trash/undo, last played, tags/campaigns, and optional character portraits. |
| UX-008 | P2 | Opportunity | Add print-friendly and accessible PDF/standard-sheet export, plus share/hand-off options that do not require sharing unrelated homebrew. |
| UX-009 | P2 | Opportunity | Expand custom equipment editing (notes, weight, location, AC, attack, damage, quantity), carrying capacity/encumbrance, containers, and currency transactions. The type model supports fields the UI cannot edit. |
| UX-010 | P2 | Opportunity | Add a spell-casting chooser with upcast effects, slot/pool selection, ritual/no-slot cases, material/concentration reminders, and cast history. |
| UX-011 | P2 | Opportunity | Add source filters and source-management UI. `allowedSources` exists in `CharacterDoc` but is currently unused. |
| UX-012 | P2 | Opportunity | Improve global navigation and route context: direct access among characters/library/homebrew/settings, meaningful document titles, breadcrumbs/back fallbacks, and a 404 page. |
| UX-013 | P2 | Opportunity | Add install guidance and an optional install prompt; provide offline-ready and update/reload explanations appropriate to a PWA. |
| UX-014 | P2 | Validate | Conduct task-based usability tests with first-time and experienced players: create a character, level up, take damage/rest, prepare/cast, import homebrew, recover history, and use offline. |
| UX-015 | P3 | Opportunity | Theme controls (light/high contrast/system), density preferences, dice defaults, unit formatting, and localization-ready copy. |
| UX-016 | P3 | Opportunity | Reconcile branding strings (`Cast Guidance`, `DnD Sheet`, `D&D Character Sheet`) across title, manifest, README, export format, and UI. |

### Architecture and maintainability

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| ARCH-001 | P1 | Confirmed | Put runtime schemas at every `unknown` boundary (IndexedDB, network, import, worker) and derive TypeScript types where practical. Tolerant third-party entity parsing can remain scoped. |
| ARCH-002 | P1 | Confirmed | Give `rulesVersion` and `allowedSources` real filtering, provenance, and warning behavior, and make `dataTag`/`homebrewDeps` integrity metadata meaningful; otherwise remove or defer the write-only fields. |
| ARCH-003 | P1 | Opportunity | Add architecture rules preventing feature code from bypassing repositories and preventing browser/storage imports in the pure engine. Existing React-boundary linting is a good start. |
| ARCH-004 | P2 | Confirmed | Split very large feature modules: `PlayTab` (899 lines), `BuildPage` (858), `CreatorPage` (764), and `BuilderPage` (521). Extract state machines/domain actions before visual components. |
| ARCH-005 | P2 | Confirmed | Consolidate repeated helpers and primitives (`nameOf/sourceOf`, download helper, drawer shell, form controls, status messages, toggle groups) without hiding domain behavior. |
| ARCH-006 | P2 | Opportunity | Replace module-level mutable singletons where lifecycle matters (session timer/baseline, loader flags, search worker) with explicit services that can be reset and tested. |
| ARCH-007 | P2 | Opportunity | Define typed domain commands/results for damage, rests, casting, leveling, choice changes, and imports. UI handlers should not each mutate nested state and reconstruct rules. |
| ARCH-008 | P2 | Opportunity | Track document revision and event reason in persistence/history; use it for conflict detection, idempotency, diagnostics, and meaningful undo labels. |
| ARCH-009 | P3 | Opportunity | Make curated/prose automation coverage data-driven and auditable rather than growing one central hand-maintained table indefinitely. |

### Testing and quality engineering

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| TEST-001 | P1 | Confirmed | Add CI for frozen install, lint, typecheck, unit tests, production/PWA build, and artifact/bundle reporting on every PR. No CI configuration exists. |
| TEST-002 | P1 | Confirmed | Add IndexedDB repository/session tests (for example with a browser or fake IndexedDB) covering autosave races, transactions, migrations, quota/write failures, history, and multi-tab conflicts. |
| TEST-003 | P1 | Confirmed | Add component/integration tests for creator validation, rules switching, choices, character routing, inventory, spell prep/casting, rests, imports, homebrew edits, and errors. Current tests do not render UI. |
| TEST-004 | P1 | Confirmed | Add Playwright-style E2E tests for first load, offline reload, service-worker update, full character lifecycle, import/export round trip, and data-version failure/retry. |
| TEST-005 | P1 | Confirmed | Add automated accessibility checks plus the manual matrix described in `A11Y-007/008`; fail CI on new serious violations. |
| TEST-006 | P1 | Confirmed | Run `scripts/data-audit.ts` for every `DATA_TAG` bump and on a schedule; fail on missing core entities or warning/tag-coverage regressions. Add a package script. |
| TEST-007 | P2 | Confirmed | Add coverage reporting and risk-based thresholds for engine, import validators, persistence, data loader, search protocol, and gameplay actions. |
| TEST-008 | P2 | Confirmed | Add property/fuzz tests for dice parsing, choice validation, entry tokenization/rendering, copy/mod resolution, migrations, and untrusted imports. |
| TEST-009 | P2 | Opportunity | Maintain golden fixtures for representative 2014/2024 single-class, multiclass, caster, martial, homebrew, and migrated characters with expected derived sheets. |
| TEST-010 | P2 | Opportunity | Add performance/bundle budgets and regression tests on representative data sizes and low-end mobile emulation. |
| TEST-011 | P2 | Confirmed | Remove `passWithNoTests: true` or limit it to intentional packages so accidental test discovery failure is not green. |
| TEST-012 | P2 | Confirmed | Make lint cover `tests-fixtures` as configured in `biome.json`; the package script currently checks only `src scripts`. |

### Developer experience, documentation, and release operations

| ID | Pri | Type | Improvement / acceptance signal |
|---|---:|---|---|
| DEV-001 | P1 | Confirmed | Clear the current three-file formatting failure and require a clean lint baseline in CI. |
| DEV-002 | P1 | Opportunity | Pin/document the supported Bun and Node versions with `packageManager`/engines and a reproducible setup check. |
| DEV-003 | P1 | Opportunity | Add deployment documentation: required SPA fallback, HTTPS, security headers, cache policy, service-worker scope, rollback, and environment-specific data endpoints. |
| DEV-004 | P2 | Confirmed | Add scripts for `check` (lint/typecheck/test/build), `data:audit`, coverage, E2E, and bundle analysis so release steps are repeatable. |
| DEV-005 | P2 | Opportunity | Add architecture, data model/export format, persistence/migration, rules-automation limits, homebrew schema, and troubleshooting docs. |
| DEV-006 | P2 | Opportunity | Define semantic app/data/export versions, changelog/release notes, migration policy, support window, and rollback checklist; package version is currently `0.0.0`. |
| DEV-007 | P2 | Opportunity | Add issue/PR templates with repro, rules edition/source, character export (redacted), browser/device, online/offline, and data-tag fields. |
| OPS-001 | P1 | Opportunity | Establish release smoke tests on iOS Safari/PWA, Android Chrome/PWA, desktop Chromium, Firefox, and Safari, including offline/update/storage scenarios. |
| OPS-002 | P2 | Opportunity | Decide on observability explicitly. If telemetry stays absent, support diagnostics/export must be strong; if added, make it opt-in, minimal, documented, and content-free by default. |
| OPS-003 | P2 | Opportunity | Add a tested rollback mechanism for both app/service-worker releases and data-tag activation. Publish incident and data-corruption recovery steps. |

## Suggested issue bundles

To keep pull requests reviewable, group work by behavior rather than by file:

1. **Character-session safety:** `REL-001`, `REL-002`, `REL-007`, repository tests.
2. **Import trust boundary:** `IMP-001` through `IMP-005`, schema/fuzz/transaction tests.
3. **Spellcasting guidance and state:** `GAME-001`, `GAME-002`, `GAME-008`, `UX-010`.
4. **Rules/source compatibility guidance:** `GAME-003` through `GAME-006`, `ARCH-002`, golden
   fixtures.
5. **Data coordinator:** `DATA-001` through `DATA-004`, `SEARCH-001/002`, performance marks.
6. **Accessible control system:** `A11Y-001` through `A11Y-006`, shared form/toggle/pip
   primitives, automated accessibility tests.
7. **Guided creator:** `UX-001`, `UX-004/005`, creator integration/E2E tests.
8. **Release foundation:** `TEST-001`, `DEV-001` through `DEV-004`, `OPS-001/003`.

## Verification matrix for closing the review

Before calling the app broadly release-ready, record evidence for each row:

| Area | Required evidence |
|---|---|
| Data safety | Autosave race, page exit, write failure, history restore, import rollback, and two-tab conflict tests. |
| Gameplay | Golden 2014/2024 and intentionally mixed-edition characters; rules-expert review; visible-warning and manual-override tests for casting, preparation, choices, rests, and level-up. |
| Dataset | Real pinned-tag audit with warning budgets; successful cold and resumed downloads; incompatible-tag rejection. |
| Offline/PWA | Fresh install, offline reload for every main route, partial-data state, update prompt, failed update, storage eviction, and rollback on target devices. |
| Security | Adversarial imports/links, CSP report, dependency audit, size/depth limits, security-policy review. |
| Accessibility | Automated scan plus keyboard, screen-reader, zoom/text-size, contrast, target-size, and reduced-motion results. |
| Performance | Cold/warm boot, essentials ready, full download, registry/search build, sheet derive/render, autosave, and bundle budgets on low-end mobile. |
| Operations | CI evidence, versioned release notes, deployment/rollback runbook, supported-browser smoke matrix, backup/recovery documentation. |

## Review limitations

- This was a code and automated-check review, not a live moderated usability study.
- No browser automation or device lab is configured, so visual layout, touch behavior, screen-reader
  output, installability, and service-worker behavior still require hands-on validation.
- The real pinned 5etools dataset audit was not executed in this environment. Findings about parser
  coverage are therefore framed as validation work unless directly evident from code.
- Rules automation is broad and domain-sensitive. The implementation was reviewed for internal
  consistency, but a qualified 2014/2024 rules review should approve the conformance matrix.
- Legal/compliance items request professional review and do not make legal conclusions.

## Definition of done for backlog items

An item is not complete merely because code was changed. Completion should include:

1. A reproducible before/after case or documented product decision.
2. Automated regression coverage appropriate to the risk.
3. Accessible loading, success, empty, and failure states.
4. Migration/backward-compatibility consideration for existing local data.
5. Updated user/developer documentation where behavior or contracts changed.
6. Passing lint, typecheck, tests, production build, and relevant E2E/device checks.
7. Measured confirmation for performance, accessibility, security-policy, and offline claims.
