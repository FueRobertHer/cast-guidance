/**
 * Standing defenses, senses and speeds that subclass features and optional
 * features state only in prose. Unlike a curated row (`CURATED`), a
 * row here adds to what the prose scan reads from the same feature: the scan keeps
 * its actions and pools (Wind Soul's flight for others, Guarded Mind's die), and
 * this adds the resistance or speed the scan does not read. Keys as in `CURATED`:
 *   - subclass features: `featureName|subclassName` (lowercased)
 *   - optional features: `name|source` (lowercased)
 * `level` is the level the feature is gained at, which tells apart option features
 * of one name (Storm Herald's Desert at 3, 6 and 14).
 */
import type { Collector } from '../effects/base';
import type { EffectOrigin } from '../types';

type StandingFn = (
  col: Collector,
  origin: EffectOrigin,
  from: string | undefined,
  level: number,
) => void;

export const STANDING: Record<string, StandingFn> = {
  // Every row is data, in `src/rules/cast-guidance/standing.json`: none is left
  // here. The picks moved in rule pack port 4a to 4d: Bestial Soul and Tiger; Unfettered
  // Mind, Elegant Courtier and Iron Mind; Aspect of the Wilds, Aura of Elemental
  // Shielding and both Fiendish Resiliences. The last rows, which test the
  // printing, the subclass branch picked or what the character has already,
  // moved in 4h: Nature's Ward and Umbral Sight by printing (a row under
  // `|xphb`), the Warrior of Shadow's Darkvision and Umbral Sight as darkvision
  // or more (`orMore`, `orMoreFrom`), Elemental Gift and the 2024 Nature's Ward
  // by the branch picked (`byAnswer`), and Dread Allegiance by the cantrip
  // granted (`byGrant`).
};

/** Whether `STANDING` has a row under a key, as `emitStandingEffects` looks it up. */
export function hasStandingRow(key: string): boolean {
  return STANDING[key] !== undefined;
}

/**
 * Adds a feature's standing row, if it has one, beside the prose scan. Returns
 * whether it had one, so the caller stops at the first of its keys that does.
 */
export function emitStandingEffects(
  col: Collector,
  key: string,
  origin: EffectOrigin,
  from: string | undefined,
  level: number,
): boolean {
  const fn = STANDING[key];
  fn?.(col, origin, from, level);
  return fn !== undefined;
}
