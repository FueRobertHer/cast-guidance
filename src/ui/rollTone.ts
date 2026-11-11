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
 * which is not a natural 20 to celebrate, nor a natural 1, nor on a d20 a
 * feature set to a number (Stroke of Luck's 20), which was not rolled.
 */
export function naturalOf(result: RollResult): number | undefined {
  if (result.meta?.autoFail === true) return undefined;
  if (result.kind !== undefined && result.kind !== 'd20') return undefined;
  if (result.meta?.d20?.set === true) return undefined;
  return result.meta?.d20?.natural;
}

/**
 * An attack that crit with no natural 20 to name: inside a crit range a
 * feature or effect lowered (Hexblade's Curse's 19), or set to a number that
 * crits (Stroke of Luck's 20).
 */
export function critWithoutNatural20(result: RollResult): boolean {
  if (result.meta?.attack?.crit !== true || result.meta.autoFail === true) return false;
  const nat = naturalOf(result);
  return nat !== undefined ? nat !== 20 : result.meta.d20?.set === true;
}

export function rollTone(result: RollResult): RollTone {
  // A save a condition fails outright (Stunned, say) is a failure whatever
  // the die shows, a natural 20 included.
  if (result.meta?.autoFail === true) return 'fumble';
  const nat = naturalOf(result);
  // An attack that crits below 20 (Hexblade's Curse's 19), or on a d20 set to 20, is a crit to spot too.
  if (nat === 20 || critWithoutNatural20(result)) return 'crit';
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
