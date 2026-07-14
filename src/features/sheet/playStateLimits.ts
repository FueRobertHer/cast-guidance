/**
 * Detect play-state values that exceed the character's newly derived maxima
 * (GAME-007). After a build change lowers a limit — fewer spell slots, a
 * smaller resource pool, less HP — the stored play state can hold spent/current
 * values above the new max. This surfaces those mismatches and offers a
 * non-destructive clamp (only over-limit values change).
 */
import type { DerivedSheet, PlayState } from '@/engine/types';

export interface PlayStateOverage {
  kind: 'hp' | 'slots' | 'pactSlots' | 'hitDice' | 'resource';
  /** Human-readable label for the mismatched value. */
  label: string;
  /** The stored value that is over the limit. */
  current: number;
  /** The newly derived maximum it should not exceed. */
  max: number;
}

/** Character-wide leveled slot maxima (the pool is shared across caster blocks). */
function leveledSlotMax(sheet: DerivedSheet): number[] {
  const max: number[] = [];
  for (const block of sheet.spellcasting) {
    block.slots.forEach((n, i) => {
      max[i] = Math.max(max[i] ?? 0, n);
    });
  }
  return max;
}

function pactSlotMax(sheet: DerivedSheet): number {
  let m = 0;
  for (const b of sheet.spellcasting) if (b.pactSlots) m = Math.max(m, b.pactSlots.count);
  return m;
}

function resourceMax(sheet: DerivedSheet, key: string): number {
  return sheet.resources.find((x) => x.key === key)?.max ?? 0;
}

/** List every play-state value currently above its derived maximum. */
export function detectPlayStateOverages(play: PlayState, sheet: DerivedSheet): PlayStateOverage[] {
  const out: PlayStateOverage[] = [];

  if (play.currentHp > sheet.maxHp.value) {
    out.push({ kind: 'hp', label: 'Current HP', current: play.currentHp, max: sheet.maxHp.value });
  }

  const slotMax = leveledSlotMax(sheet);
  play.slotsSpent.forEach((spent, i) => {
    const m = slotMax[i] ?? 0;
    if (spent > m) {
      out.push({
        kind: 'slots',
        label: `Level ${i + 1} spell slots spent`,
        current: spent,
        max: m,
      });
    }
  });

  const pactMax = pactSlotMax(sheet);
  if (play.pactSlotsSpent > pactMax) {
    out.push({
      kind: 'pactSlots',
      label: 'Pact slots spent',
      current: play.pactSlotsSpent,
      max: pactMax,
    });
  }

  for (const [die, spent] of Object.entries(play.hitDiceSpent)) {
    const m = sheet.hitDice[die] ?? 0;
    if (spent > m) {
      out.push({ kind: 'hitDice', label: `${die} hit dice spent`, current: spent, max: m });
    }
  }

  for (const r of play.resources) {
    const m = resourceMax(sheet, r.key);
    if (r.used > m) {
      const label = sheet.resources.find((x) => x.key === r.key)?.label ?? r.key;
      out.push({ kind: 'resource', label: `${label} used`, current: r.used, max: m });
    }
  }

  return out;
}

/**
 * Clamp only the over-limit values to their maxima; everything within range is
 * left exactly as-is. Mutates the given play state (call inside a draft update).
 */
export function clampPlayStateToMax(play: PlayState, sheet: DerivedSheet): void {
  if (play.currentHp > sheet.maxHp.value) play.currentHp = sheet.maxHp.value;

  const slotMax = leveledSlotMax(sheet);
  play.slotsSpent = play.slotsSpent.map((spent, i) => Math.min(spent, slotMax[i] ?? 0));

  const pactMax = pactSlotMax(sheet);
  if (play.pactSlotsSpent > pactMax) play.pactSlotsSpent = pactMax;

  for (const die of Object.keys(play.hitDiceSpent)) {
    const m = sheet.hitDice[die] ?? 0;
    if ((play.hitDiceSpent[die] ?? 0) > m) play.hitDiceSpent[die] = m;
  }

  play.resources = play.resources.map((r) => ({
    ...r,
    used: Math.min(r.used, resourceMax(sheet, r.key)),
  }));
}
