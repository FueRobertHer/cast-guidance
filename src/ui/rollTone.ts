import type { RollResult } from '@/dice/types';

/**
 * What kind of result a roll is, for its colour (DS-001). A d20 roll is the
 * roll blue. Any other dice are damage red: a result does not say what its
 * dice were for, and on a sheet they nearly always are damage. Nat 20 and nat
 * 1 are the two results worth spotting from across the table, so they take a
 * colour of their own, `heal` and `danger`, and always their words too.
 *
 * A module of its own, shared by the roll toast and the dice tray's history:
 * the tray importing it from RollToast, an entry module, made Rolldown fold
 * the 145 KB data registry chunk into the entry.
 */
export type RollTone = 'crit' | 'fumble' | 'd20' | 'damage';

export function rollTone(result: RollResult): RollTone {
  const nat = result.meta?.d20?.natural;
  if (nat === 20) return 'crit';
  if (nat === 1) return 'fumble';
  return result.meta?.d20 !== undefined ? 'd20' : 'damage';
}

/** A result's colour as text. */
export const ROLL_INK: Record<RollTone, string> = {
  d20: 'text-roll',
  damage: 'text-danger',
  crit: 'text-heal',
  fumble: 'text-danger',
};
