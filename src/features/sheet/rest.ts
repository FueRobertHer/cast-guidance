/**
 * Short and long rests on the sheet (GAME-006). The maths is the engine's
 * (`engine/rest.ts`), under the rules the sheet was derived with
 * (`DerivedSheet.rules`); this is where the sheet calls it, with the dice to
 * roll an item's dawn charges and the moments the character has.
 */
import { roll } from '@/dice/roll';
import type { Edition } from '@/engine/conditions';
import type { EffectChange } from '@/engine/effectLife';
import { longRestRecovery, type RestDone, shortRestRecovery, takeRest } from '@/engine/rest';
import { sheetRules } from '@/engine/rules';
import type { DerivedResource, DerivedSheet, PlayState } from '@/engine/types';
import { hpLimits } from './effectsInPlay';

export { giveBack } from '@/engine/rest';

/** When a pool comes back, for its row. */
export function backCaption(
  r: Pick<DerivedResource, 'resetOn' | 'regainOnShort' | 'regainRoll' | 'foretell'>,
): string {
  // Portent's numbers: rolled again on a long rest, those left lost.
  if (r.foretell === true) return 'Foretold anew on a long rest';
  // An item's charges: at dawn, which the sheet counts at a long rest.
  if (r.regainRoll !== undefined) return `${r.regainRoll} back at dawn (a long rest)`;
  if (r.resetOn === 'short' || r.regainOnShort === undefined) return `Back on a ${r.resetOn} rest`;
  const count = r.regainOnShort === 1 ? 'One' : String(r.regainOnShort);
  return `${count} back on a short rest, all on a long rest`;
}

/** Reset short-rest state and return a human summary of what was restored. Fires no moments. */
export function shortRest(play: PlayState, sheet: DerivedSheet): string[] {
  return shortRestRecovery(play, sheet);
}

/**
 * Reset long-rest state and return a human summary of what was restored,
 * under the sheet's HP on a long rest rule. Fires no moments (`restWith`
 * does). `maxHpChange` is what the effects the rest ended took off the
 * maximum (Aid's +5 gone is -5), so the hit points refill to what is left.
 */
export function longRest(
  play: PlayState,
  sheet: DerivedSheet,
  edition: Edition,
  maxHpChange = 0,
  /** Rolls a pool's `regainRoll` (an item's charges back at dawn). */
  rollTotal: (dice: string) => number = (dice) => roll(dice).total,
  /** Charge pools the sheet leaves out while their item's magic is off (`idleChargePools`). */
  idle: readonly DerivedResource[] = [],
): string[] {
  return longRestRecovery(
    play,
    sheet,
    { maxHp: sheet.maxHp.value, edition, immune: sheet.conditionImmunities },
    { hpOnLongRest: sheetRules(sheet, edition).hpOnLongRest, maxHpChange, rollTotal, idle },
  ).restored;
}

/**
 * Take a rest as the Play tab does, after ending the effects it ends
 * (`before`): the recovery under the sheet's rules, then the character's
 * moments for it (a long rest's Exhaustion coming off, then the rest's own).
 * Say `done.change.moments` with the rest's notice (`withMoments`).
 */
export function restWith(
  play: PlayState,
  sheet: DerivedSheet,
  rest: 'short' | 'long',
  edition: Edition,
  {
    before,
    idle = [],
    rollTotal = (dice) => roll(dice).total,
  }: {
    before?: EffectChange;
    idle?: readonly DerivedResource[];
    rollTotal?: (dice: string) => number;
  } = {},
): RestDone {
  return takeRest(play, sheet, rest, hpLimits(sheet, edition), {
    hpOnLongRest: sheetRules(sheet, edition).hpOnLongRest,
    rollTotal,
    idle,
    ...(before === undefined ? {} : { before }),
  });
}
