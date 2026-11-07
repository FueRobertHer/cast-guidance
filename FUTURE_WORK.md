# Cast Guidance: future work

Last reviewed: 2026-10-25 (`f1ba8fe`)

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
warnings are tracked under P2. It runs on GitHub runners
(`.github/workflows/data-audit.yml`) weekly and on PRs that touch the data
pipeline, against per-tag budgets in `scripts/data-audit-budget.json` (TEST-005,
[#124](https://github.com/FueRobertHer/cast-guidance/issues/124)).

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
CI, gated on coverage floors and a bundle budget.

| Check | Current result |
|---|---|
| Frozen dependency install | Pass: 556 packages |
| Lint/format | Pass: 292 files |
| TypeScript | Pass (app, `vite.config.ts`, the bundle budget scripts, and the E2E harness) |
| Unit + integration tests | Pass: 194 files, 2,134 tests |
| Coverage gate | `bun run test:coverage`: 81.09% statements, 71.82% branches, 72.65% functions, 82.92% lines. CI fails below the `vite.config.ts` floors of 80 / 70 / 71 / 81. |
| Production/PWA build | Pass: 58 unique precache entries |
| Bundle budget | `bun run bundle:budget` against `scripts/bundle-budget.json` (about 10% headroom). Entry chunk 410,656 B raw, 130,364 B gzip (budget 420,000 / 132,000); initial JS 578,487 B raw, 186,696 B gzip (586,000 / 188,000); total JS 1,162,955 B (1,224,000); largest chunk 410,656 B (420,000); CSS 72,288 B (79,000); precache 1,358,289 B (1,475,000), measured with condition effects on attack chips. Their stylesheet took the CSS and the precache over the budgets of 63,000 and 1,341,000. The CSS budget came up to about 10% over this measurement. The precache budget is the owner's decision: 1,475,000, about 8.6% over this measurement, so that the updates they expect next do not each need a raise. The measurement before that was entry chunk 407,316 B raw, 129,167 B gzip; initial JS 569,620 B raw, 183,696 B gzip; total JS 1,112,936 B; largest chunk 407,316 B; CSS 57,193 B; precache 1,219,098 B (budget 1,331,000), after DS-001's temporary colour aliases were removed. With that cleanup the CSS budget came back down from 66,000 to about 10% over this measurement. The precache budget stayed at 1,331,000 then, 9.2% over this measurement, by an owner decision: the 10% rule would have raised it to 1,341,000, because the screens' restyles onto the design system added about 8 KB since the DS-001 measurement (CSS 60,314 B, precache 1,211,044 B). It rose to 1,341,000 with the spell picker follow-ups: main had reached 1,329,357 B, 99.9% of the old budget, and their feat picks, chosen spells and granted spell tracking took it to 1,337,216 B, about 7.9 KB of engine code. That is a small raise rather than a rebaseline to about 10% over, which would be 1,471,000. With DS-001 itself, the CSS and precache budgets were rebaselined to about 10% over that measurement (an owner decision): the design system's tokens for two themes and its new utilities took the CSS from 45,591 B, and its self-hosted fonts (59,360 B of woff2) and that CSS took the precache from 1,109,912 B. The total JS budget was rebaselined to about 10% over its measurement with the HP sheet: main had reached 1,107,972 B, 28 B under the old 1,108,000, and the sheet adds about 5 KB to the Play tab chunk while the entry chunk shrinks. Earlier, the total JS budget was rebaselined the same way with PWA-001: total JS grew about 40 KB since the last baseline (IMP-002's import preview, A11Y-002's announcer and PWA-001), reaching 99.9% of the old 1,008,000, while the entry and initial budgets still have headroom. The precache budget was rebaselined the same way with PWA-002, when the raster icons added 41,411 B. |
| Real pinned-dataset audit | `bun run data:audit`, run 2026-11-04 against v2.39.1: 49 files; 8,407 entities, 969 spells; 40 versioned `replaceArr` warnings; 0 unresolved `_copy`; 420 spells with dice, every generated roll parses; all 53 `{@tag}`s rendered; 20 multi-name `additionalSpells` blocks, 5 of them without choice wording and allowed by verdict. Every check is within the `scripts/data-audit-budget.json` entry. The v2.39.0 and v2.32.0 entries stay, so `--tag v2.39.0` and `--tag v2.32.0` still pass for devices that keep those releases. The `Data audit` workflow re-runs it weekly and on data-pipeline PRs. |
| Browser E2E | Chromium, in the `e2e` CI job: 17 spec files and a setup file, 193 tests (42 of them the accessibility specs in `e2e/a11y`, 107 the PWA-001 offline route matrix), all passing. The reload data loss the suite found is fixed by the save journal (#123), and data installs, updates, rollback and their failures have specs of their own (`data-install`). |
| Automated accessibility (axe) | `e2e/a11y`, in the `e2e` job: 47 states (every main route, the sheet's tabs, dialogs, drawers, info sheets, banners and toasts, four at desktop size), WCAG 2.x A and AA, held to `e2e/a11y/axe-baseline.json` by a one-sided ratchet that also fails a baseline state no longer scanned. The baseline is empty: the 16 serious nodes found are fixed; 22 nodes axe cannot decide are listed, not gated. Reduced motion is checked too, and touch target sizes are measured (44 by 44 for the inventoried controls, 24 by 24 for every other control), and so are keyboard operation (focus trap and return on every dialog and drawer, Tab and Enter through the roster, library and sheet tabs, a 150-row list) and layout (320 px reflow, 200% text, landscape with focus never hidden behind the bars). See `docs/a11y-audit.md`. |

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
| ERR-001 | [#99](https://github.com/FueRobertHer/cast-guidance/issues/99) | Explicit error and missing states for the entity-detail view and remaining live-query pages. |

### Rules guidance and play state

| ID | Issue | Remaining work |
|---|---|---|
| GAME-001 | [#100](https://github.com/FueRobertHer/cast-guidance/issues/100) | Play-tab slot/upcast choice (a choose-then-roll redesign), and non-slot pools as cast sources. |
| GAME-003 | [#101](https://github.com/FueRobertHer/cast-guidance/issues/101) | Edition compatibility beyond picker filtering: carry-overs, reprints, conflicts, change preview. Groundwork: the data audit labels 2014/2024 reprint pairs (`reprint@1`); no real answers saved yet, and nothing reaches the app. |
| GAME-005 | [#102](https://github.com/FueRobertHer/cast-guidance/issues/102) | Creator wiring: edit a new character's own sources in the wizard and pass the draft's list to its card pickers. The Build page editor, every Build and sheet picker, and the OR-set level gate have shipped. |
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
| PWA-001 | [#106](https://github.com/FueRobertHer/cast-guidance/issues/106) | The Chromium route matrix ships (`e2e/specs/offline-routes.spec.ts`: every route, cold and offline, at none, essential, partial and full caches, each landing on content, an offline state with Retry, or not found with a link, plus online failed-download and corrupted-section cells). A caster who knows Fireball covers the sheet's spell list and spell info sheet, which now say why the spell files are missing, with Retry, instead of a bare `void` download that left a short list or "Loading spell…" up for good. Remaining: the same matrix on WebKit. |
| PWA-002 | [#107](https://github.com/FueRobertHer/cast-guidance/issues/107) | Validate install and update on real iOS and Android devices with the checklist in `docs/pwa-device-validation.md`. The raster 192/512, maskable and Apple touch icons, the corrected manifest and their checks already ship. |

### Security, privacy, and imports

| ID | Issue | Remaining work |
|---|---|---|
| SEC-001 | [#108](https://github.com/FueRobertHer/cast-guidance/issues/108) | The CSP is enforced through `vercel.json`; confirm the live header and a clean console on the production deployment, then close. |
| SEC-002 | [#109](https://github.com/FueRobertHer/cast-guidance/issues/109) | Bound the raw remote-response byte stream before parse; cap regex and worker work. |
| IMP-002 | [#110](https://github.com/FueRobertHer/cast-guidance/issues/110) | Import preview explaining dependencies, duplicates, winner policy, and collisions before commit. |
| LEGAL-001 | [#111](https://github.com/FueRobertHer/cast-guidance/issues/111) | License, generated notices and draft notice shipped; legal review open. The MIT `LICENSE`, the generated `THIRD_PARTY_NOTICES.md` (checked in CI) and the DRAFT `docs/content-notice.md` with a trademark disclaimer draft are in. Remaining, for the owner: the legal review, the choice between the Fan Content Policy, SRD only or the mirror as it is, the shipped book titles and curated mechanics, and the Settings privacy copy versus Vercel Analytics (the checklist in `docs/content-notice.md`). |

(`{@link}` sanitization + enforced deployment headers (SEC-001) and the
local-data/privacy explanation + "Reset app data" control (PRIV-001) have
shipped; a one-click full backup is tracked under P2 product experience.)

### Accessibility and inclusive design

| ID | Issue | Remaining work |
|---|---|---|
| A11Y-001 | [#112](https://github.com/FueRobertHer/cast-guidance/issues/112) | Accessible names for the ~15 icon-only controls that carry only a `title`; semantic states on the remaining toggles. |
| A11Y-002 | [#113](https://github.com/FueRobertHer/cast-guidance/issues/113) | Touch targets below 44px, non-color state, restrained live regions, real progress semantics. |
| A11Y-003 | [#114](https://github.com/FueRobertHer/cast-guidance/issues/114) | The axe gate, reduced-motion handling and the automated keyboard (focus trap and return, tab order) and layout (reflow, 200% text, landscape) specs have shipped. Remaining: the manual VoiceOver, TalkBack, Dynamic Type, safe-area, keyboard and virtual-list passes recorded in `docs/a11y-audit.md`, and its open findings (no arrow keys in the library list). |

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
| TEST-004 | [#123](https://github.com/FueRobertHer/cast-guidance/issues/123) | Every flow the issue lists has a Chromium spec in `e2e/`: first load, offline reload, SW updates, lifecycle, import/export, and data installs (a first install failing mid-drain or interrupted by a reload, an update from Settings and from the boot toast, a failed and an interrupted update, and the rollback of a release that keeps failing to start, with its launch counter seeded; the immediate rollback of a build that throws is covered by unit tests only, since no release the installer accepts is known to make it throw). Remaining: browsers beyond Chromium, as an opt-in WebKit smoke project. |
| TEST-005 | [#124](https://github.com/FueRobertHer/cast-guidance/issues/124) | The audit, its per-tag budgets, the branch-heuristic check and the workflow exist. Left: make the `Data audit` check required in branch protection, and close once the workflow's first run is green. |

## P2: product and engineering depth

### Rules and content automation

Remaining mechanics from the former focused list, plus the broader rules-audit
work:

| Area | Remaining work | Acceptance signal |
|---|---|---|
| Warlock invocations | Enforce or clearly warn on Pact Boon, patron, spellcasting, and known-spell prerequisites after resolving the character. Level gates already work. | Every prerequisite is evaluated or explicitly labeled advisory. |
| Which pool a feature spends | The actions in `src/engine/curated/spendLinks.ts` spend their pool on the Play tab; `bun run data:judge -- --report spend` lists the rest. Left: a cost in spell slots or Hit Point Dice, where using one means choosing a slot's level or a die's size, so no action can spend them yet. Features that spend a pool to restore their own use, which is a recharge and no cost on them. 2024 pools that regain one on a short rest reset in full (Wild Shape, Second Wind) or only on a long rest (Psionic Energy Dice), since `resetOn` cannot say "one". | Each counted spender spends from the sheet, and a report row explains the rest. |
| Battle Master maneuvers | Add the Strength-or-Dexterity maneuver-DC choice and show computed informational DC notes for save-forcing riders rather than fake action buttons. | Disarming/Pushing/Trip show Str saves; Goading/Menacing show Wis saves; the DC uses the chosen ability. |
| Dragonborn/Aasimar/Genasi utilities | Surface Metallic secondary breath, Gem flight/telepathy, Aasimar Celestial Revelation forms, and Genasi elemental utilities as useful, edition-correct chips or notes. | Each trait is discoverable without inventing incorrect action economy or resource use. |
| Draconic ancestry (2014) | 2014 Dragonborn has no color subrace, so the ancestry is never chosen: the breath weapon carries no damage type/area/save and the "choose a resistance" pick floats free of the ancestry (you can pick fire resistance with a cold breath). Offer an ancestry choice (as the 2024 versioned races already do via name) that fixes the breath weapon and pre-answers the matching resistance. | A 2014 Dragonborn picks an ancestry that sets breath-weapon type/area/save and its resistance. |
| Feat sub-choices | A feat's chosen spell now has a real picker, drawn from the filter its data writes, and reaches the sheet (`src/engine/spellQuery.ts`, `src/features/creator/spellPrompt.ts`). Races, subclasses and a class's own list share it (a class is read for its picks alone, and those take a place in its spells known). Skilled, Elemental Adept (repeatable, a different damage type each time), and the optional feature picks of Eldritch Adept, Martial Adept, Fighting Initiate and Metamagic Adept now prompt, as does Weapon Master XPHB's weapon mastery (`src/engine/effects/featPicks.ts`). Elemental Adept's type, the mastery and Eldritch Adept's spellcasting ability are recorded and shown on the feat's card, and change no number. Remaining: Rune Shaper, left unsupported: it grants every rune spell at 1/day and offers no pick, since the runes number half the proficiency bonus and can be swapped, which takes feat-specific spell handling. Three subraces (Githyanki among them) and the Custom Background carry the same `skillToolLanguageProficiencies` field and do not read it yet. Martial Adept's save DC ability is not modeled. Two kinds of chosen spell stay outside the picker: the 2024 Wizard savants' `known` spell, which says only "see the trait text" (it is written in the spellbook, so it does not fit a granted spell), and five optional features (Pact of the Tome, Blessed Warrior and others), whose `additionalSpells` the engine does not read at all. The spells a class's own `additionalSpells` names are not read either. Disable options that duplicate a proficiency the origin already fixes. (Ability/skill/tool/language/expertise sub-choices already produce pickers, e.g. Prodigy and Chef.) `bun run data:judge -- --report featchoice` lists the feats still to cover. | Each feat's embedded skill/tool/spell/class/damage-type choice is selectable, or shows an explicit honest note when unsupported. |
| Condition effects | Rolls, speed and 2014 exhaustion's halved hit point maximum now follow the character's own conditions (`src/engine/conditions.ts`), with a cue where each roll starts, an "Ignore once" per roll and a per-condition switch. Attack chips also wear what reaches their roll (`src/ui/ChipFace.tsx`, `src/ui/chipFace.css`): a named design system exception, in each condition's own hue, with a looping signature that "Animate condition effects" in Settings stops. Checks, saves and initiative are not drawn as chips, so they keep the text cue alone. Remaining: effects that depend on the attacker or the target are information only (attacks against you with advantage, Paralyzed and Unconscious critical hits within 5 ft, 2024 Grappled's disadvantage against anyone but the grappler, Frightened only while the source is in sight, Charmed's ban on attacking the charmer); checks that need sight or hearing are noted, not failed; Incapacitated never ends concentration on its own; the 2024 concentration DC is not capped at 30; 2024 Incapacitated does not block Verbal components (`CANT_SPEAK` in `conditionEffects.ts` is the 2014 list); only walking speed is shown. | Attacker- and target-dependent effects can be applied to a single roll (or are deliberately kept as notes), and concentration and speech follow the edition. |
| Downed and death state | Death saves now roll for real (Durable-aware advantage, nat 1 = two failures, nat 20 = back up on 1 HP) and dropping to 0 breaks concentration. Remaining: 0 HP still never applies Unconscious, overkill and instant death (damage taken ≥ HP max) are discarded, and three successes or failures still only fill pips without reaching a stable or dead state. Model those transitions as guidance without blocking manual override. | The downed sequence and instant death are represented and overridable. |
| Background equipment slots | Feed background `startingEquipment` through the concrete slot picker now used for classes. | Supported slots create real items; unsupported entries remain honest notes. |
| Spell guidance | Extend current cantrip/level-1 starter tips into level-up and replacement guidance. | Each casting model gets useful, non-prescriptive guidance beyond level 1. |
| Granted/innate spells | Add casting/use tracking for per-rest innate and granted spells, not only detail links. | Charges, slot use, concentration, and no-slot cases are represented correctly. |
| Equipment and combat audit | Verify attunement, armor requirements, shields/hands, ammunition, weapon properties/mastery, critical damage, riders, improvised attacks, and encumbrance. | Edition-specific golden characters cover each automated rule. |
| Class/rest audit | Verify subclass lists, replacements, Magical Secrets-style picks, feature gating/replacement, multiclass rounding/proficiencies, and edition rest policies. Short/long-rest recovery is now a tested module (`src/features/sheet/rest.ts`); this audit covers the deeper edition nuances (GAME-006 residual). | Representative 2014/2024 single- and multiclass fixtures pass expert-reviewed expectations. |
| Prose automation | The comparison ships: `bun run data:judge` saves Jev's yes/no answers about every prose-scanned trait and feature to `scripts/data-judgments.json`, and the data audit counts the scanner's confident disagreements against a per-tag `prose` ceiling, each settled by a scanner fix or a `prose.allow` verdict. A limit the sheet already tracks from `additionalSpells` is not counted, by asking the engine about every owner of the prose, unless the pool refills on a rest the saved short-rest answer contradicts. Remaining: the first real run and its recorded ceiling, then working the disagreements down; the same comparison for curated entries; confidence/provenance on the sheet, and correction there. | False-positive/negative budgets are measured on every data-tag change. |
| Check and initiative bonuses in prose | `proseScanFeature` now reads the standing bonuses the curated entries state (half proficiency, initiative, named checks, passive Perception), so homebrew worded the same way gets them; `curatedEffects.ts` stays the override. Remaining: bonuses that need a trigger (Frost Rune, Emissary of Peace, Mantle of Whispers) stay out until rolls can take a toggled bonus, and a bonus on a skill the player picks (Enchanting Conversationalist) needs the scan to see that pick. Advantage has no number on the sheet and Expertise-style doubling is a proficiency level, so neither belongs here. `bun run data:judge -- --report bonus` lists the cases by type. | Rolls take a toggled bonus for the triggered features, and a bonus on a chosen skill reaches that skill. |
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
| Source policy | A device-wide browsing `SourcePolicy` ships (allow-all-except / only-these, presets, full book names, homebrew sources named by their own title) and deliberately never touches the registry, so hiding a book cannot break an existing sheet. A character's own `allowedSources` (edited on its Build page) replaces the device policy in that character's pickers and labels earlier picks from other books without removing them. Remaining: make `dataTag` and `homebrewDeps` meaningful in provenance, exports, and warnings. |
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
- The save journal keeps one entry per character, shared by every tab: a
  second tab that goes away holding unsaved edits to the same character
  replaces the first tab's entry before the next boot can replay it, and the
  first tab's snapshot then rests on its own `pagehide` save landing. The
  replay itself is checked (REL-007, #98). Key entries by tab, with a sweep of
  abandoned ones, if this proves to lose edits.

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

- Choose risk-based threshold *targets* per area (engine, owned import
  schemas, persistence, loader, search protocol, gameplay commands) on top of
  the global coverage floors CI already enforces; add property/fuzz coverage
  (dice, choices, entry rendering, copy/mod, migrations, hostile imports) and
  golden 2014/2024 characters.
- Add a bundle-analysis view (what is in each chunk) to explain a bundle budget
  failure (`bun run ci` mirrors the CI gates locally, `bun run e2e:ci` the E2E
  job; `bun run data:audit` is wired; `tests-fixtures` is linted;
  `passWithNoTests` is off).
- Document architecture, persistence/migrations, automation limits, homebrew,
  troubleshooting, and the deployment fallback/cache policy (Bun/Node versions
  are pinned; the export format and security headers are documented).
- Define semantic app/data/export versions, a changelog and support policy, a
  release/rollback checklist, and cross-browser smoke tests for iOS, Android,
  Chromium, Firefox, and Safari (issue/PR templates exist).
- Add dependency vulnerability scanning and automated update triage (shipped
  code already has a license allowlist, enforced by `bun run notices:check`);
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

- Re-run `bun run ci` and refresh the baseline table whenever it is quoted
  anywhere that matters. When coverage or bundle size improves, ratchet the
  floors in `vite.config.ts` and the budgets in `scripts/bundle-budget.json`.
  Before CI enforced them, the table drifted about 22 points of coverage out
  of date between reviews.
- When a P2 or P3 theme grows a stable id and an acceptance signal, it has
  become an issue. File it and leave a one-line pointer, rather than letting
  the theme quietly accumulate specifics that no PR can close.
- Record the reviewed commit at the top so the gap is measurable rather than
  guessed at.
