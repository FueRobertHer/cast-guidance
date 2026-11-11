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
audit covers 48 files and all 936 spells. It runs on GitHub runners
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
| Bundle budget | `bun run bundle:budget` against `scripts/bundle-budget.json` (about 20% headroom). Total JS was 1,869,499 B and the precache 2,075,468 B on main after #316, 100.0% and 99.8% of their budgets of 1,870,000 and 2,080,000, and the rerolls on the character's own d20 tests (data function pass item 11c) add about 6.5 KB to each; the owner raised them to 2,244,000 and 2,491,000, about 20% over main's measurement. Before that, total JS was 1,435,302 B on main after #273, 99.8% of its budget of 1,438,000, and the World of Warcraft curated rows add 3,553 B; the owner raised that budget to 1,723,000, about 20% over main's measurement. The service worker precache was 1,674,792 B on main after #278, 99.7% of its budget of 1,679,000, and Fight Club's granted spells (#279) and choices read from prose (#280) each take it over; that budget came up to 2,010,000, about 20% over main's measurement, by the owner's rule for these budgets. The other budgets stand on the measurement that follows. Entry chunk 410,656 B raw, 130,353 B gzip (budget 493,000 / 157,000); initial JS 578,487 B raw, 186,685 B gzip (695,000 / 225,000); total JS 1,197,629 B (1,438,000); largest chunk 410,656 B (493,000); CSS 77,812 B (94,000); precache 1,398,487 B (1,679,000), measured on main after #243. Every budget was rebaselined to about 20% over this measurement, the owner's decision: main used 95% to 99% of each (initial JS gzip 99.3%), and the features still coming, buffs on the sheet first, would otherwise each need a raise. The measurement before that was entry chunk 410,656 B raw, 130,363 B gzip (budget 420,000 / 132,000); initial JS 578,487 B raw, 186,695 B gzip (586,000 / 188,000); total JS 1,180,007 B (1,224,000); largest chunk 410,656 B (420,000); CSS 77,812 B (79,000); precache 1,380,865 B (1,475,000), measured with condition effects on every roll and stat they reach. Their stylesheet took the CSS and the precache over the budgets of 63,000 and 1,341,000. The CSS budget came up to about 10% over this measurement. The precache budget is the owner's decision: 1,475,000, about 8.6% over this measurement, so that the updates they expect next do not each need a raise. The measurement before that was entry chunk 407,316 B raw, 129,167 B gzip; initial JS 569,620 B raw, 183,696 B gzip; total JS 1,112,936 B; largest chunk 407,316 B; CSS 57,193 B; precache 1,219,098 B (budget 1,331,000), after DS-001's temporary colour aliases were removed. With that cleanup the CSS budget came back down from 66,000 to about 10% over this measurement. The precache budget stayed at 1,331,000 then, 9.2% over this measurement, by an owner decision: the 10% rule would have raised it to 1,341,000, because the screens' restyles onto the design system added about 8 KB since the DS-001 measurement (CSS 60,314 B, precache 1,211,044 B). It rose to 1,341,000 with the spell picker follow-ups: main had reached 1,329,357 B, 99.9% of the old budget, and their feat picks, chosen spells and granted spell tracking took it to 1,337,216 B, about 7.9 KB of engine code. That is a small raise rather than a rebaseline to about 10% over, which would be 1,471,000. With DS-001 itself, the CSS and precache budgets were rebaselined to about 10% over that measurement (an owner decision): the design system's tokens for two themes and its new utilities took the CSS from 45,591 B, and its self-hosted fonts (59,360 B of woff2) and that CSS took the precache from 1,109,912 B. The total JS budget was rebaselined to about 10% over its measurement with the HP sheet: main had reached 1,107,972 B, 28 B under the old 1,108,000, and the sheet adds about 5 KB to the Play tab chunk while the entry chunk shrinks. Earlier, the total JS budget was rebaselined the same way with PWA-001: total JS grew about 40 KB since the last baseline (IMP-002's import preview, A11Y-002's announcer and PWA-001), reaching 99.9% of the old 1,008,000, while the entry and initial budgets still have headroom. The precache budget was rebaselined the same way with PWA-002, when the raster icons added 41,411 B. |
| Real pinned-dataset audit | `bun run data:audit`, run 2026-11-09 against v2.41.0: 58 files; 8,798 entities, 1,038 spells; 40 versioned `replaceArr` warnings; 0 unresolved `_copy`; 478 spells with dice, every generated roll parses; all 53 `{@tag}`s rendered; 27 multi-name `additionalSpells` blocks, 9 of them without choice wording and allowed by verdict; all 3,306 scanned traits and features judged, with 40 scanner misses, at the ceiling of 40. Every check is within the `scripts/data-audit-budget.json` entry. Since then, data function pass item 12d builds subrace versions against their race's traits: the 40 warnings are gone on every pinned tag, and the colour versions' own Breath Weapon and Damage Resistance add 11 scanned traits with no saved judgment yet. The v2.39.1, v2.39.0 and v2.32.0 entries stay, so `--tag v2.39.1`, `--tag v2.39.0` and `--tag v2.32.0` still pass for devices that keep those releases. The `Data audit` workflow re-runs it weekly and on data-pipeline PRs. |
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
| Which pool a feature spends | The actions in `src/engine/curated/spendLinks.ts` spend their pool on the Play tab; `bun run data:judge -- --report spend` lists the rest, and `SPEND_SKIPPED` gives a reason for each one that was read and left out. A feature that spends a pool to restore its own use shows Restore once no uses are left. A cost or buy-back in spell slots or Hit Point Dice (`src/engine/curated/slotLinks.ts`) opens the roll prompt on a tile per slot level or die size. Left: Hit Point Dice or a slot added to a spell's roll or a save (the Adept feats, Crown of Spellfire, Aberrant Dragonmark), a race trait's cost (Healing Machine), Magic Item Tinker, Wild Companion's slot option, Death's Master and a second Fortified Position cannon. Font of Inspiration and Wild Resurgence offer the slot only once no uses are left, the slot heal of Combat Wild Shape is rolled but not applied to Hit Points, Bloodlust's Powerful Recovery (a 1 or 2 counts as 3) is not applied, and a waiting slot prompt is not rebuilt when a slot is spent behind it (paying checks the slot is still there). Pools refilled by a trigger (Persistent Rage on Initiative, Absorb Spells on a failed save) and 2024 Sorcerous Restoration, a level-scaled choice once per long rest, stay a pip tap for the player. | Each counted spender spends from the sheet, and a report row explains the rest. |
| Battle Master maneuvers | The maneuvers that force a save (Disarming, Goading, Menacing, Pushing and Trip Attack in both printings, and Heroic Leap) show the save and its DC on their chip: 8 + proficiency + the higher of Strength and Dexterity (`dcAbility: 'strOrDex'`), from Combat Superiority, Martial Adept or Superior Technique alike. Remaining: a player who wants the lower ability cannot choose it, and homebrew mechanics cannot name `strOrDex` yet. | A homebrew maneuver can state the maneuver DC, and a player can choose the ability. |
| Uses, dice and DCs only class prose states | Curated rows give Indomitable 1, 2 and 3 uses by Fighter level (the Warrior sidekick's 1, and 2 from 18), Portent 2 rolls and 3 from Wizard 14, the 2024 Improved Warding Flare's short rest, a Signature Spells pick of two level 3 Wizard spells each free once a short rest, Harness Divine Power's own uses (its chip spends one beside the Channel Divinity), and the Bardic Inspiration die on its chip. Remaining: the 2024 Indomitable's bonus to the reroll (the Fighter level) is not shown; the Signature Spells pick lists every level 3 Wizard spell, not only the spellbook's; Improved Warding Flare's temporary hit points and the Bardic Inspiration die are notes, not rolls. | Each remaining number is on a chip or a roll. |
| Dragonborn/Aasimar/Genasi utilities | Surface Metallic secondary breath, Gem flight/telepathy, Aasimar Celestial Revelation forms, and Genasi elemental utilities as useful, edition-correct chips or notes. | Each trait is discoverable without inventing incorrect action economy or resource use. |
| Draconic ancestry | A Dragonborn whose race or subrace names no dragon (the bare race of either Player's Handbook or Fizban's, a Draconblood or Ravenite with no color) is asked for its Draconic Ancestry in place of the free resistance pick; the dragon fixes the resistance and types the breath weapon (area and save too for 2014). A resistance picked before that pick existed stays until the ancestry is picked. Fizban's Chromatic versions, whose data offers a free pick, get their own type. The 2014 Draconic Bloodline asks for its Dragon Ancestor (with Draconic), whose type its Elemental Affinity chip names; the 2024 Elemental Affinity picks a type and resists it. Remaining: Elemental Affinity's Charisma modifier on a spell of the type is in the 2014 chip's note and the 2024 card's text, waiting on a damage-type filter for `spellDamageBonus` (#303); the Dragon Ancestor's doubled proficiency for Charisma checks with dragons stays in the card. | The Charisma rider reaches the cast chips of spells of the type. |
| Feat sub-choices | A feat's chosen spell now has a real picker, drawn from the filter its data writes, and reaches the sheet (`src/engine/spellQuery.ts`, `src/features/creator/spellPrompt.ts`). Races, subclasses, a class's own list and a picked optional feature share it (a class's picks take a place in its spells known). Skilled, Elemental Adept (repeatable, a different damage type each time), and the optional feature picks of Eldritch Adept, Martial Adept, Fighting Initiate and Metamagic Adept now prompt, as does Weapon Master XPHB's weapon mastery (`src/engine/effects/featPicks.ts`). Elemental Adept's type and Eldritch Adept's spellcasting ability are recorded and shown on the feat's card, and change no number; Weapon Master's kind lets that kind's attacks use its mastery, as a class's Weapon Mastery pick does. Remaining: Rune Shaper, left unsupported: it grants every rune spell at 1/day and offers no pick, since the runes number half the proficiency bonus and can be swapped, which takes feat-specific spell handling. The same `skillToolLanguageProficiencies` field is read for races and subraces (three subraces, Githyanki among them, pick skills and tools in any mix) and for the Custom Background (two languages or tools in any mix). One kind of chosen spell stays outside the picker: the 2024 Wizard savants' `known` spell, which says only "see the trait text" (it is written in the spellbook, so it does not fit a granted spell). Book of Ancient Secrets' ritual pick is a note too when a Warlock picks it, as a leveled spell with no limit; through Eldritch Adept it is offered, and its rituals cast with the invocation's own Charisma rather than the feat's pick. Disable options that duplicate a proficiency the origin already fixes. (Ability/skill/tool/language/expertise sub-choices already produce pickers, e.g. Prodigy and Chef.) `bun run data:judge -- --report featchoice` lists the feats still to cover. | Each feat's embedded skill/tool/spell/class/damage-type choice is selectable, or shows an explicit honest note when unsupported. |
| Condition effects | Rolls, speed and 2014 exhaustion's halved hit point maximum now follow the character's own conditions (`src/engine/conditions.ts`), with a cue where each roll starts, an "Ignore once" per roll and a per-condition switch. Attack chips, a casting dice chip, Cast, saves, ability tiles, the Skills card, Initiative and Speed also wear what reaches them (`src/ui/ChipFace.tsx`, `src/ui/chipFace.css`): a named design system exception, in each condition's own hue, with a looping signature that "Animate condition effects" in Settings stops. Death and concentration saves keep the text cue alone. Remaining: effects that depend on the attacker or the target are information only (attacks against you with advantage, Paralyzed and Unconscious critical hits within 5 ft, 2024 Grappled's disadvantage against anyone but the grappler, Frightened only while the source is in sight, Charmed's ban on attacking the charmer); checks that need sight or hearing are noted, not failed; Incapacitated never ends concentration on its own; the 2024 concentration DC is not capped at 30; 2024 Incapacitated does not block Verbal components (`CANT_SPEAK` in `conditionEffects.ts` is the 2014 list); only walking speed is shown. | Attacker- and target-dependent effects can be applied to a single roll (or are deliberately kept as notes), and concentration and speech follow the edition. |
| Downed and death state | Death saves now roll for real (Durable-aware advantage, nat 1 = two failures, nat 20 = back up on 1 HP) and dropping to 0 breaks concentration. Remaining: 0 HP still never applies Unconscious, overkill and instant death (damage taken ≥ HP max) are discarded, and three successes or failures still only fill pips without reaching a stable or dead state. Model those transitions as guidance without blocking manual override. | The downed sequence and instant death are represented and overridable. |
| Background equipment slots | Backgrounds' `startingEquipment` goes through the creator's kit rows and slot picker as classes' does (`src/features/creator/startingEquipment.ts`), with the coins a pouch holds added to currency and a spellcasting focus slot offering its foci. Remaining: a background's own name for an item ("prayer book") shows in the creator, but the inventory names the item it stands for (Book); an item group a kit names outright (a holy symbol) is granted as the group, with no pick of which one. | Each kit item reaches the inventory under the background's name for it. |
| Spell guidance | Extend current cantrip/level-1 starter tips into level-up and replacement guidance. | Each casting model gets useful, non-prescriptive guidance beyond level 1. |
| Granted/innate spells | Per-rest innate and granted spells open a pool of uses and show it on the Spells tab. A class's own `additionalSpells` is read in full (the 2024 Ranger's Hunter's Mark, Paladin's Divine Smite and Find Steed, Druid's Speak with Animals, Warlock's Contact Other Plane, always prepared), and so is a picked optional feature's (invocations, pacts, Blessed and Druidic Warrior), cast with the host class's ability or Eldritch Adept's pick. An option whose prose spends a slot on its once-a-rest cast (2014 Bewitching Whispers) is read as cast with the class's slots, and its prose tracker counts the rest (`asSlotCasts`). Favored Enemy (2024), Paladin's Smite, Faithful Steed and Contact Patron tie their free casts to their spells (`freeCast` in `src/engine/curated/curatedEffects.ts`). Remaining: a `resource` bucket (spells bought with Ki or another pool) is left off an optional feature, whose action spends the points, but a subclass's (Way of Shadow, Sun Soul, Warrior of Shadow) is still granted with no cost; the 2024 Druid's Find Familiar is read as always prepared, as the data writes it, though Wild Companion casts it by spending Wild Shape; an optional feature's spells name no class (`className`), unlike a class's or subclass's, so a bonus kept to one class's spells (Innate Sorcery's) misses them; the 2014 Chains of Carceri is written as Hold Monster once a day while its prose says at will, once per creature a long rest, so it shows both the data's pool and the prose's. | Charges, slot use, concentration, and no-slot cases are represented correctly. |
| Equipment and combat audit | Verify attunement, armor requirements, shields/hands, ammunition, weapon properties/mastery, critical damage, riders, improvised attacks, and encumbrance. A weapon's mastery shows on its attack only for a kind the 2024 Weapon Mastery pick or Weapon Master names, on a weapon the character is proficient with (or one any wielder can use, as Psychic Blade's Vex); a staff or focus counts as a Quarterstaff. The DMG's firearms are not offered as kinds, so their masteries show for no one. Tactical Master's swap and the features that ride on a mastery in use (Battering Roots, Spiritual Protectors, Rot and Violence, Shalamayne) are not modeled. | Edition-specific golden characters cover each automated rule. |
| Class/rest audit | Verify subclass lists, replacements, Magical Secrets-style picks, feature gating/replacement, multiclass rounding/proficiencies, and edition rest policies. Short/long-rest recovery is now a tested module (`src/features/sheet/rest.ts`); this audit covers the deeper edition nuances (GAME-006 residual). | Representative 2014/2024 single- and multiclass fixtures pass expert-reviewed expectations. |
| Prose automation | The comparison ships: `bun run data:judge` saves Jev's yes/no answers about every prose-scanned trait and feature to `scripts/data-judgments.json`, and the data audit counts the scanner's confident disagreements against a per-tag `prose` ceiling, each settled by a scanner fix or a `prose.allow` verdict. A limit the sheet already tracks from `additionalSpells` is not counted, by asking the engine about every owner of the prose, unless the pool refills on a rest the saved short-rest answer contradicts. Remaining: the first real run and its recorded ceiling, then working the disagreements down; the same comparison for curated entries; confidence/provenance on the sheet, and correction there. | False-positive/negative budgets are measured on every data-tag change. |
| Check and initiative bonuses in prose | `proseScanFeature` now reads the standing bonuses the curated entries state (half proficiency, initiative, named checks, passive Perception), so homebrew worded the same way gets them; `curatedEffects.ts` stays the override. Remaining: bonuses that need a trigger (Frost Rune, Emissary of Peace, Mantle of Whispers) stay out until rolls can take a toggled bonus, and a bonus on a skill the player picks (Enchanting Conversationalist) needs the scan to see that pick. Advantage has no number on the sheet and Expertise-style doubling is a proficiency level, so neither belongs here. `bun run data:judge -- --report bonus` lists the cases by type. | Rolls take a toggled bonus for the triggered features, and a bonus on a chosen skill reaches that skill. |
| Check and initiative bonuses in prose | `proseScanFeature` now reads the standing bonuses the curated entries state (half proficiency, initiative, named checks, passive Perception), so homebrew worded the same way gets them; `curatedEffects.ts` stays the override. Every uncurated hit on v2.39.1 was read by hand on 2026-11-07 and none is a standing bonus the sheet misses, so the report's flat and proficiency counts are not a to-do list. Remaining: bonuses that need a trigger (Frost Rune, Emissary of Peace, Mantle of Whispers, Hide in Plain Sight, Hearth of Moonlight and Shadow, Armor of Magical Strength, Improved Abjuration, Spell Breaker) stay out until rolls can take a toggled bonus, and Enchanting Conversationalist's bonus on the skill it picks comes from its curated entry, with the pick. Advantage has no number on the sheet and Expertise-style doubling is a proficiency level, so neither belongs here. `bun run data:judge -- --report bonus` lists the cases by type. | Rolls take a toggled bonus for the triggered features. |
| Advantage on the character's own rolls | `src/engine/curated/rollAdvantages.ts` gives the advantage that class and subclass features, feats, optional features and species traits state in prose. Always-on ones set it on the roll: Feral Instinct on initiative, 2024 Danger Sense, Gnomish Cunning, War Caster and Eldritch Mind on concentration saves, 2024 Durable on death saves. One held while Bloodied (Purple Dragon Commandant) holds only then. Situational ones (Brave, Fey Ancestry, Magic Resistance, Grappler, Steady Aim) are offered in the roll prompt to claim, with when they hold, as flanking is; a death save takes only those that name it. The Defenses sheet lists the ones on saves. Advantage paid for at the roll is in the row below. Remaining: a concentration save rolls at once, so a situational one there (Extended Spell, Tokens of the Departed's Constitution saves) is never offered; 2024 Danger Sense still holds while Incapacitated (Paralyzed, Stunned and Unconscious fail the save anyway); homebrew mechanics cannot name initiative alone, a death or concentration save, or a `when`; WoW class reskins read no row; Cloak of Flies (advantage beside disadvantage) and the Dhampir's bite are left out; tool checks (the Fisher's tackle) name no roll on the sheet; save advantages show only in the HP chip's Defenses sheet, so a character with no damage defense (a Halfling's Brave alone) sees them nowhere outside the roll. | A concentration save offers what may hold, and save advantages show without a damage defense. |
| Dice, bonuses and advantage the character's features add to their own rolls | `src/engine/curated/rollExtras.ts` lists what class and subclass features, feats, optional features and species traits add to the character's own d20 tests. Free dice roll in (the dragonmark intuitions' d4, the EFA Mark feats). Paid ones are offered as the feature's Use is priced (`src/features/sheet/rollPrice.ts`): a pool's die in the prompt or on the result (maneuvers, Peerless Skill, Psi-Bolstered Knack, Homing Strikes), a die (Tactical Mind, Lucky Footwork, Knowledge from a Past Life, Built for Success), a flat bonus once the d20 shows (Guided Strike, Feat of Strength, Flash of Genius, Arcane Deflection, Survivor), or advantage to claim (Tides of Chaos, 2024 Lucky, Kenku Recall). Adding one pays its uses and reaction; taking it off gives them back; what the character cannot pay is not offered. Rerolls (`src/dice/reroll.ts`): Halfling, Kor and Kithkin Luck reroll a natural 1 as the d20 lands, and Elven Accuracy advantage's lower die, since neither can make the roll worse; the result offers the rest, paid as their Use (Indomitable, the 2024 one with the Fighter level; Diamond Soul; Disciplined Survivor; Magical Guidance; Seeking Spell; 2014 Lucky's extra d20, the best kept) or free with their limit in words (Fanatical Focus while raging, Unerring Accuracy, Boon of Fortune's Favor, Khenra Twins, Survivor's initiative), Living Legend and Draconic Disciple for the reaction alone. Sets in place of a reroll (`Reroll.to`): Reliable Talent (skill checks the character is proficient in) and Silver Tongue count a d20 of 9 or lower as a 10 as it lands; the result offers Ear for Deceit's 8, Trance of Order's and Starry Form Dragon's 10 free with their limit in words, Adept of the Red Robes' 10 for a use, and Stroke of Luck's 20 on a failure for its use (a d20 set to 20 on an attack crits, though no natural 20 is named for it). The sets made as the d20 lands, and the free ones claimed on the result, set a reroll after them again; a paid one goes with the die it set. Indomitable Might holds a Strength check's total (and in 2024 a Strength save's) at the Strength score, which dice added after still count from the roll itself. Portent's d20s are rolled on a long rest and kept in play (`PlayState.foretold`): the character's own d20 tests offer each in place of the d20, as a roll of it (a foretold 20 crits, advantage counts for nothing), paying the use and the number, and the Play tab's row uses one on another creature's roll. Inspiration is spent on rolls: 2024 Heroic Inspiration rerolls one die of an attack, check or save on the result, and 2014 Inspiration is claimed as advantage before it. Remaining: Portent's once a turn is the player's to keep; Heroic Inspiration on damage and other dice, and on death and concentration saves, which roll at once; what grants Heroic Inspiration (Human Resourceful, Heroic Warrior, Musician) is the player's toggle to set; 2014 Stroke of Luck's miss turned into a hit; Starry Form Dragon on concentration saves, which roll at once; Reliable Talent on tool checks and the 2014 one on other checks that add the proficiency bonus (no roll on the sheet says so); sets from spells and items (Glibness, Moment of Prescience, Zone of Amicability, Harp of Gilded Plenty, Scholar's Anchoring Bangle); a d20 set after the roll landed sets off no natural 20 or 1 moment, and a natural 1 set into a hit offers no damage, as a reroll's does not; rerolls of damage and healing dice (Great Weapon Fighting, Savage Attacker, Piercer, Empowered Spell) and of other creatures' rolls (Bountiful Luck, Chronal Shift, Bend Luck); Curving Shot, which rerolls against another target; Draconic Disciple's use, spent only once it turns a failure into a success, is the player's to mark; the limits of the free rerolls (once a Rage, once a turn) are the player's to keep; a reroll rerolls the d20 alone, never an effect's die (Bless) with it; a reroll after the roll landed sets off no natural 20 or 1 moment, and a missed attack rerolled into a hit offers no damage, which its chip still rolls, nor the dice its natural 1 took off (Bardic Inspiration); a reroll that lands an attack on a natural 1, 20 or crit takes off what is not added yet, as the roll itself would; death and concentration saves are settled at once, so they are offered no reroll after (Luck still rolls on them); Focused Aim's 1 to 3 points and Saving Face's count of allies; Fighting Spirit and Feinting Attack, which last the turn or add damage; Grappling Strike, which needs a hit first; Symbiotic Being (Hit Point Dice) and Zhentarim Ruffian (Heroic Inspiration), which no pool counts; Vedalken Tireless Precision, whose die goes with proficiencies it picks; a use kept on a failure (Tactical Mind, Psi-Bolstered Knack) comes back only when the player takes the die off; taking off a reaction-paid extra after a New turn and another reaction gives that newer reaction back too, since the turn keeps no count; Arcane Deflection's AC part and its cantrip-only turn after; 2024 Lucky's disadvantage on attacks against the character; the intuitions' tool checks; a concentration save rolls at once, so it is offered none of these; Tides of Chaos's refill on casting a spell is a pip tap; homebrew mechanics cannot name a paid extra or a reroll. | Each extra and reroll left out has a price and a moment the sheet can count. |
| Skills granted only in class and subclass prose | Curated entries in `curatedEffects.ts` now give the skills of every class and subclass printing on v2.39.1 that grants a lasting skill proficiency in prose alone. The list was rebuilt on 2026-11-07 from two sweeps of the text and a level 20 derive of every class and subclass. Survivalist, Royal Envoy and Blessings of Knowledge put theirs at expertise. The rest are fixed grants (Arcane Initiate, Implements of Mercy, the Drunken Master's and TCE Bladesinging's Performance), picks from a printed list or from every skill, picks from a class's level 1 list as the class data has it (Primal Knowledge, which picks again at barbarian 10 in the TCE printing, Student of War, Student of Arcana), Arcane Archer Lore AU, whose skills already held turn into picks, and Cavalier's and Samurai's pick of a skill or a language. Tiger (Totem Warrior, SCAG) picks two skills at level 6 through a standing row in `standingEffects.ts`, which tells its three features apart by the level each comes at and adds to what the scan reads, so the level 14 bonus attack stays. Grants that last only until a rest or for one use are left out on purpose: Whispers of the Dead, the Mystic's Breadth of Knowledge, Knowledge of the Ages and the Kalashtar's Severed from Dreams. Seven race traits grant a lasting skill in prose: three carry `skillToolLanguageProficiencies`, which the race reader reads as the Skilled feat's pick of skills and tools (the Tajuru Nation's Skill Versatility, Decadent Mastery and the Nephalia's Breadth of Knowledge), and four exist only in prose and show nothing (Ancestral Legacy for the Dhampir and the Reborn, the Khoravar's Skill Versatility and the half-elf's Aquatic Elf Descent variant). No feat is missing one. The languages and cantrips beside these grants stay in the card's prose, as do the 2014 Blessings of Knowledge's languages; the armor, weapons and tools beside them, and Genie's Splendor's unarmored AC, are in the next row. A pick that replaces a skill already held (Royal Envoy, Arcane Archer Lore AU) reads only what is collected before it. Every feat from the same class's ability score improvements is collected first, so a skill from a feat taken at a later level (Skilled, say) counts as held. A later class's pick shows the "already proficient" cue, a later fixed grant shows nothing, and neither opens the pick. A class's Expertise is asked once the class and its subclass are collected, so it can take a subclass skill, and it also offers skills from the class's later levels (a feat taken at level 4 shows in the level 1 pick). It still offers a skill another feature already doubles (a Scout's Survivalist skills, another Expertise's picks) with no cue: the "already proficient" cue covers skill picks only, and Expertise options render as chips, which would not show one. A feat's Expertise taken at an ability score improvement is still asked before the subclass. Deft Explorer and Scholar (2024 wizard) give expertise in prose and show no pick. | The four race traits in prose alone show their skills, or this row says why each is left out. |
| Armor, weapons and tools granted only in class and subclass prose | Curated entries in `curatedEffects.ts` now give the armor, weapon and tool proficiencies of every class and subclass printing on v2.39.1 that grants them in prose alone, and the five unarmored AC formulas (Genie's Splendor, both Draconic Resilience printings, the College of Dance's Unarmored Defense, the UA Mystic's Immortal Durability). The list was rebuilt on 2026-11-07 from sweeps of the text and a level 20 derive of every class and subclass, with every branch of a pick-one feature taken; before it, none of them reached the sheet, so a War Domain cleric's longsword had no proficiency. They name armor and weapons as the class lists do ("heavy", "martial"). Picks: an artisan's tool (Student of War in both printings, the FRHoF Blessings of Knowledge), the Mastermind's gaming set, the Kensei's calligrapher's or painter's supplies, and the TCE Bladesinging's one-handed melee weapon, offered from the base items. The artificer subclasses' tools turn each one already held into a pick of another artisan's tool, reading only what is collected before (like Royal Envoy): the artificer class's own "one type of artisan's tools of your choice" is words in the class data, so it never counts. Every feat from the artificer's own ability score improvements is collected before the subclass, so a tool from one taken at a later level (Skilled, say) counts as held and opens the pick, while a tool from a later class opens nothing. Two grants no category or weapon name can say, the EFA Artillerist's Martial Ranged weapons and the FRHoF Bladesinger's Melee Martial weapons without Two-Handed or Heavy, go through a weapon filter, which now needs every clause to hold and reads a property after `!` as one that must be absent. Remaining: the Kensei's weapons, which grow in number at monk 6, 11 and 17 and become monk weapons that attack math would have to follow; the sidekicks' simple and martial weapons, shields and the Expert's two tools, which depend on the creature's stat block (their armor is given); the languages in the same sentences (the Rune Knight's Giant, the Mastermind's two), the hit points of the 2024 Draconic Resilience and of Immortal Durability, and the College of Spirits' Guidance cantrip. An unarmored AC is offered whatever is worn, and a shield adds to it, as for the class Unarmored Defense rows, so College of Dance and Immortal Durability, which allow no shield, read high with one. The TCE Bladesinging pick offers a weapon already held with no cue, and its list, from the shared one-handed melee weapon options, includes Staff and Wooden Staff, arcane foci that carry a weapon category. Left out on purpose: grants that last until a rest or for a minute (Whispers of the Dead, Breadth of Knowledge, Knowledge of the Ages), the DM's optional firearm proficiency, and the AC of a form, a cannon, a vessel or an echo. | The Kensei's weapons show as picks by monk level, and an unarmored AC drops out while armor or a disallowed shield is worn. |
| Speeds, saves, scores and defenses granted only in class prose | Curated entries in `curatedEffects.ts` now give the core classes' standing numbers that only prose states: Fast Movement, Unarmored Movement by Monk level and the 2024 Roving (a walking speed bonus whose `unless` leaves it out in heavy armor, or in any armor or with a shield, read from the equipped gear; Roving's climb and swim speeds), Aura of Protection on the paladin's own saves, Slippery Mind, Diamond Soul and Disciplined Survivor's save proficiencies, Primal Champion and Body and Mind (an ability bonus with a `max` that raises the cap of 20), Divine Health, Purity of Body and Aura of Courage's immunities, the 2024 Feral Senses' blindsight, and the Warforged's Integrated Protection. The subclass and optional feature ones are rows in `standingEffects.ts`, which add to the prose scan rather than replace it: about 60 resistances, immunities, senses, speeds and save proficiencies (Avatar of Battle, Heart of the Storm, Thought Shield, Umbral Sight and Iron Mind, Devil's Sight, Beguiling Influence and the rest), a paladin's own place in its aura, picks where the feature asks one (Fiendish Resilience, Aspect of the Wilds, Bestial Soul, Aura of Elemental Shielding, Iron Mind's Intelligence or Charisma when Wisdom is had), a subclass branch's type (Elemental Gift, the 2024 Nature's Ward, Dread Allegiance's god read from its cantrip), and Rage's (Mindless Rage, the Totem Bear, Elk and Eagle, Primordial Bond) held while Rage is in play. A sense shows once, at its longest. Remaining: forms, reactions and features for a minute or an hour (Starry Form, Umbral Form, Form of Dread, Swarming Dispersal, Invincible Conqueror and the like); the 2024 Wild Heart's Rage of the Wilds and Power of the Wilds, chosen each Rage; Drakewarden's resistance while the drake is summoned; Soul of the Forge's +1 AC in heavy armor and Stormborn's flight outdoors (no state for either); the 2014 Second-Story Work; the 2014 Nature's Ward's charm and fright immunity against elementals and fey alone, a cue (an immunity would hold off every charm and fright); Lunar Empowerment's Crescent Moon resistances (no lunar phase state); Superior Mobility's +10 on a climb or swim speed of its own number; the WoW Shaman's Rage action starts no Rage effect, so its Rage-held rows (Mindless Rage, Primordial Bond) never switch on; Devil's Sight shows as a sense of its own; Tasha's Roving, a part of Deft Explorer Improvement, which shares its name with the level 10 feature; an ally's Aura of Protection in play adds to the paladin's own instead of the higher counting; the 2014 Monk's level 9 Unarmored Movement and the 2014 Feral Senses stay prose. | Every standing speed, save proficiency, score, sense and defense in official class and subclass prose reaches the sheet, and same-named auras do not stack. |
| Damage riders granted only in class prose | Curated entries in `curatedEffects.ts` now give the always-on damage core class and subclass features state only in prose: the 2014 Improved Divine Smite's 1d8 radiant on hits with a carried melee weapon (a `damageDie` with `weaponsOnly`) and the 2024 Radiant Strikes' on unarmed strikes too; Agonizing Blast (Eldritch Blast in 2014, a picked Warlock cantrip in 2024), Potent Spellcasting (the seven 2014 domains, the 2024 Cleric and Druid) and Empowered Evocation through `spellDamageBonus`, which a spell row's damage chips add, Empowered Evocation to the first damage roll alone; Brutal Critical's extra dice on a melee weapon crit, one per card and stacking with Savage Attacks, at the roll site. The Champion's Improved and Superior Critical were already read there. Remaining: the 2024 Agonizing Blast is repeatable, but the invocation picker takes an option once, so one cantrip gets it; its pick lists every Warlock cantrip, since a spell query cannot ask for one that deals damage, and the label says so; Empowered Evocation always takes the first damage roll (Ice Storm's bludgeoning, not its cold); Brutal Critical and Savage Attacks skip an unarmed strike's die (a monk's, Tavern Brawler's) and a natural weapon's (Horns, Claws), whose rows carry no weapon; a cantrip a feat gives (Magic Initiate's) is no class's, so Potent Spellcasting skips it; a spell chip shows the bonus in its dice but not what adds it; once-a-turn riders (Divine Strike, Primal Strike, Tasha's Blessed Strikes, Divine Fury) wait for roll offers. | Every always-on damage rider in official class and subclass prose reaches the attack and spell chips, and the once-a-turn ones are offered at the roll. |
| Upcast dice in higher-level text | A spell's cast rolls grow with the slot by its upcast tags. Where a spell has none, the step its text states ("the damage increases by 1d8 for each slot level above 1st") is read as the converter reads it (`src/data5e/entries/upcast.ts`), growing only the first roll when the text says the initial damage grows, and dice a sentence sets outright ("increases to 3d8" with a 3rd- or 4th-level slot) replace the roll at the slots it names (Shadow Blade, both Elemental Weapons). Remaining: 11 levelled spells still roll their printed dice at every slot, since their text has two rolls of the step's die (Enervation, Festering Blast and Negative Energy Flood in AU, Emberstorm and Rune Strike in WoW), two steps (Leeching Strike, Moonfire, Sigil of Flame), a cap (Throw Glaive), extra healing a target regains (Tranquility) or a step per size (Animate Objects, 2024); Holy Nova grows its damage but not its healing. | Every levelled spell whose text grows its dice rolls the grown dice at each slot. |

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
- Fight Club 5e imports working like official data. Copies of official
  entries name the entry they print (`printingOf`), so curated rows, spend
  links and prose picks reach them without the official data, and granted
  spells and the choices a race, feat or background states are read from the
  text. Remaining: spell captions (mostly Fight Club's own omissions) and
  language oddities; `<class>` and subclass conversion. A race whose text
  Fight Club takes from another book (Monsters of the Multiverse's Tabaxi
  climb under Volo's citation, its Aarakocra flight under Elemental Evil's)
  reads that text's speed. A trait offered in place of
  another ("Variant: Aquatic", "in place of Skill Versatility") gives no
  speed, since the race lists both. `printingOf` does not
  reach `spellRests.ts` (keyed by the granting origin) or `itemTags.ts`, and
  a name Fight Club words its own way beyond what `officialName` undoes
  names no official entry (about 45% of marked items resolve, mostly magic
  variants such as `Battleaxe +1`). Granted spells left as text: picks a
  table decides (Strixhaven Initiate, the Adept feats' slot-level tables), a
  count that grows with the proficiency bonus (Ritual Caster), a list another
  feat chose, and a spell cast without "can cast" (`drop to 1 Hit Point and
  cast Gaseous Form`). The engine reads a `pb` count (`daily: { pb: [...] }`,
  written by the official 2024 Forest Gnome and by the converter alike) as
  unlimited casts, since `additionalSpells.ts` parses the count as a number.
  Choices read from prose leave out a grant
  a condition or a table decides (Githyanki's pick each long rest, the
  lineages' "if you don't keep" skills, Crafter's Fast Crafting table, House
  Agent's house table), a race that splits Draconic Ancestry into one race
  per colour with its own `<resist>` (the colour's type gives way to the
  pick), a second trait's weapons when an earlier trait grants some, and two
  engine gaps official data shares: a background's `feats` entries are each
  granted, so "Survivor or a Dark Gift feat" grants both, and an
  `anyFromCategory` category written as a list (as the data writes it)
  offers every feat.
  Items read what their text states for good while you wear, hold or are
  attuned to them; left out: a bonus a `<modifier>` understates (Fight Club's
  own tag, as on Sunsword), a 2024 weapon's mastery when its text has no
  Mastery line (Thunderous Greatclub), firearms' Reload (read as Loading), and
  a bonus or defense in a list that a state or a choice heads (a vestige's
  Dormant State).

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
