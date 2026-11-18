/**
 * Curated mechanics for high-frequency features whose numbers exist only in
 * prose (verified against the dataset: e.g. Alert's +5 initiative has no
 * structured field). Keys:
 *   - feats / optional features: `name|source` (entity uid, lowercased)
 *   - class/subclass features:   `featureName|classLabel` (lowercased)
 * These are facts of the game rules — fine to commit.
 */
import type { Collector } from '../effects/base';
import type { EffectOrigin } from '../types';

/**
 * `from` is the printing of the feature itself, lowercase, where it can differ from
 * the card's: a class or subclass feature. No row left here reads it; a printing
 * is a row of its own in the data (`printingKeys`).
 */
type CuratedFn = (col: Collector, origin: EffectOrigin, from?: string) => void;

export const CURATED: Record<string, CuratedFn> = {
  // --- Feats ---------------------------------------------------------------
  // Every row of this section is data, in `src/rules/cast-guidance/curated.json`.
  // --- Fighting styles (2014 optional features; 2024 feats share names) ----
  // Every row of this section is data, in `src/rules/cast-guidance/curated.json`.
  // --- Class features ------------------------------------------------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`.
  // --- Standing numbers: speeds, saves, scores and defenses ----------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`.
  // The 2024 Weapon Mastery (Barbarian, Fighter, Paladin, Ranger and Rogue) is a
  // pick in the data (rule pack port 4f): kinds of weapon, as many as the class
  // table's Weapon Mastery column says, else two, asked once the build is in
  // (`afterBuild`), since a later class or feat can add the proficiency a kind
  // needs. The Barbarian's are melee kinds alone; the Paladin's, Ranger's and
  // Rogue's, kinds the character is proficient with.
  // --- Always-on riders: damage every hit or every cast adds -----------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`.
  // The 2024 Agonizing Blast, Charisma on the damage of a Warlock cantrip the
  // player picks, is a spell pick in the data (rule pack port 4e), its bonus
  // given once over the picks (`givesAll`, `{picks}`).
  // Stunning Strike states its effect but leaves the DC to the "ki save DC"
  // defined in the Ki/Monk's Focus feature. The prose scanner can't resolve a
  // cross-feature DC, so its row pins it: Con save vs 8 + prof + Wis mod. It rides
  // on a hit, so it takes no slot of its own. Its cost is a `spend` row in
  // `src/rules/cast-guidance/spend.json`. The row is in
  // `src/rules/cast-guidance/curated.json`.
  // Second Wind, both Channel Divinities and Lay on Hands are data, by rules
  // version (`edition`). The Paladin's pool has a key of its own, not the
  // Cleric's: the 2024 text says "each time you use this class's Channel
  // Divinity", and a shared key made the uses depend on the class added first.
  // Tasha's Harness Divine Power is data too: uses of its own by class level, a
  // pool and chip named for their class beside the other class (`ownClassBeside`).
  // The scan read one pool for both spells, and nothing in the 2024 printing.
  // Signature Spells, two level 3 Wizard spells each with a pool of one use a
  // short rest and two grants (always prepared; cast once from the pool), is a
  // spell pick in the data too (4e), its pool named from the spell
  // (`{pick.slug}`, `{pick.title}`).
  // Primal Knowledge and the sidekick classes' Bonus Proficiencies, picks, are
  // data too.
  // --- Subclass features (keyed by the subclass's full name) ---------------
  // More of this section's rows are data, in `src/rules/cast-guidance/curated.json`:
  // the plain picks from a list (rule pack port 4b), and the skills and tools given
  // or, held already, a pick of another in their place (4c): Royal Envoy, Arcane
  // Archer Lore, the artificer subclasses' tools, the Reanimator's Skill Set and
  // the Warrior of Mystic Brews' Bonus Proficiencies.
  // The 2014 Dragon Ancestor (a dragon, `ancestor`, and Draconic) and the 2024
  // Elemental Affinity (a type of five, resisted) are picks in the data too (4d),
  // of a named option and of a damage type. The Dragon Ancestor's doubled
  // proficiency with dragons stays in the card.
  // The 2014 Elemental Affinity, by the Dragon Ancestor's type (a sorcery point,
  // its spend link, for an hour's resistance, and a Charisma rider on spells), is
  // data too (4h): an action whose note is by the dragon picked (`byAnswer`).
  // --- Racial traits (keyed `trait:<traitName>`) ---------------------------
  // Most limited-use traits (Relentless Endurance, Breath Weapon, Fey Step,
  // Stone's Endurance, …) are handled per-source by the prose scanner, which
  // reads each printing's actual wording. Curated traits are what prose can't
  // see (passive numbers with no usage phrasing); every one is now data, in
  // `src/rules/cast-guidance/curated.json`, so none is left here.
};

/**
 * Racial traits live in `race.entries` by name — key them `trait:<name>`.
 * Returns whether a curated entry handled it (callers fall back to prose scan).
 */
export function emitCuratedTrait(col: Collector, traitName: string, origin: EffectOrigin): boolean {
  const fn = CURATED[`trait:${traitName.toLowerCase()}`];
  fn?.(col, origin);
  return fn !== undefined;
}

/** Whether `CURATED` has a row under a key, as `emitCuratedEffects` looks it up. */
export function hasCuratedRow(key: string): boolean {
  return CURATED[key] !== undefined;
}

/** Returns whether a curated entry handled the key (callers fall back to prose scan). */
export function emitCuratedEffects(
  col: Collector,
  key: string,
  origin: EffectOrigin,
  from?: string,
): boolean {
  const fn = CURATED[key];
  fn?.(col, origin, from);
  return fn !== undefined;
}
