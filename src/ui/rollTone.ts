import type { RollResult } from '@/dice/types';

/**
 * What kind of result a roll is, for its colour (DS-001). A d20 roll is the
 * roll blue, damage red and healing green, as the roll's `kind` says. A roll
 * with no kind (one made before kinds existed, or dice typed into the tray)
 * is told by its dice: a d20 is a d20 roll, and any other dice are damage,
 * since on a sheet they nearly always are. Nat 20 and nat 1 are the two
 * results worth spotting from across the table, so they take a colour of
 * their own, `heal` and `danger`, and always their words too. An automatic
 * failure is `danger` too, and says so in words.
 *
 * A module of its own, shared by the roll toast and the dice tray's history:
 * the tray importing it from RollToast, an entry module, made Rolldown fold
 * the 145 KB data registry chunk into the entry.
 */
export type RollTone = 'crit' | 'fumble' | 'd20' | 'damage' | 'heal';

/**
 * The d20's natural face, when it is one worth naming: on a d20 roll (or one
 * with no kind that leads with a d20), and never on an automatic failure,
 * which is not a natural 20 to celebrate, nor a natural 1.
 */
export function naturalOf(result: RollResult): number | undefined {
  if (result.meta?.autoFail === true) return undefined;
  if (result.kind !== undefined && result.kind !== 'd20') return undefined;
  return result.meta?.d20?.natural;
}

export function rollTone(result: RollResult): RollTone {
  // A save a condition fails outright (Stunned, say) is a failure whatever
  // the die shows, a natural 20 included.
  if (result.meta?.autoFail === true) return 'fumble';
  const nat = naturalOf(result);
  // An attack that crits below 20 (Hexblade's Curse's 19) is a crit to spot too.
  if (nat === 20 || (nat !== undefined && result.meta?.attack?.crit === true)) return 'crit';
  if (nat === 1) return 'fumble';
  if (result.kind !== undefined) return result.kind;
  return result.meta?.d20 !== undefined ? 'd20' : 'damage';
}

/** A result's colour as text. */
export const ROLL_INK: Record<RollTone, string> = {
  d20: 'text-roll',
  damage: 'text-danger',
  heal: 'text-heal',
  crit: 'text-heal',
  fumble: 'text-danger',
};
