/**
 * What a change to hit points says, for the HP card's cues (HpCues.tsx). It is
 * worked out from the before and after alone, so HP gets the same cue however
 * it moved: the card's buttons, the HP sheet, a hit die, a rest, an effect's
 * temp HP, an undo, another tab.
 */

/** Hit points as the card shows them. */
export interface HpPoint {
  readonly currentHp: number;
  readonly tempHp: number;
}

/** The bar's colour: `heal` over half, `meter-mid` over a quarter, `danger` below. */
export type HpBand = 'high' | 'mid' | 'low';

export function hpBand(currentHp: number, maxHp: number): HpBand {
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, currentHp / maxHp)) : 0;
  return ratio > 0.5 ? 'high' : ratio > 0.25 ? 'mid' : 'low';
}

/** The smallest hit that recoils, as a share of max HP. */
export const BIG_HIT = 0.25;

/** One change to hit points, as the cues read it. */
export interface HpChange {
  /** Current HP lost. */
  readonly lost: number;
  /** Temp HP lost: it took a hit first, or ran out. Never red: current HP held. */
  readonly soaked: number;
  /** Current HP gained. */
  readonly gained: number;
  /** Temp HP went up: gained, or replaced by more. */
  readonly warded: boolean;
  /** The last temp HP went. */
  readonly shieldBroke: boolean;
  /** Dropped to 0 from above it. */
  readonly down: boolean;
  /** Back above 0 from 0. */
  readonly up: boolean;
  /** A hit worth the recoil: a quarter of max HP or more, or one that drops to 0. */
  readonly big: boolean;
  /** The bar changed colour. */
  readonly bandChanged: boolean;
}

/**
 * What changed between two readings, or null when nothing a cue shows did:
 * healing at full, damage at 0 with no temp HP, the same temp HP again.
 */
export function hpChange(before: HpPoint, after: HpPoint, maxHp: number): HpChange | null {
  const lost = Math.max(0, before.currentHp - after.currentHp);
  const gained = Math.max(0, after.currentHp - before.currentHp);
  const soaked = Math.max(0, before.tempHp - after.tempHp);
  const warded = after.tempHp > before.tempHp;
  if (lost === 0 && gained === 0 && soaked === 0 && !warded) return null;
  const down = before.currentHp > 0 && after.currentHp <= 0;
  return {
    lost,
    soaked,
    gained,
    warded,
    shieldBroke: before.tempHp > 0 && after.tempHp <= 0,
    down,
    up: before.currentHp <= 0 && after.currentHp > 0,
    big: down || (lost > 0 && maxHp > 0 && lost >= maxHp * BIG_HIT),
    bandChanged:
      lost + gained > 0 && hpBand(before.currentHp, maxHp) !== hpBand(after.currentHp, maxHp),
  };
}
