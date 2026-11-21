/**
 * Short and long rests on the sheet (GAME-006). The maths is the engine's
 * (`engine/rest.ts`), under the rules the sheet was derived with
 * (`DerivedSheet.rules`); this is where the sheet calls it, with the dice to
 * roll an item's dawn charges and the moments the character has.
 */
import { roll } from '@/dice/roll';
import type { RollResult } from '@/dice/types';
import type { Edition } from '@/engine/conditions';
import type { EffectChange } from '@/engine/effectLife';
import { longRestRecovery, type RestDone, shortRestRecovery, takeRest } from '@/engine/rest';
import { sheetRules } from '@/engine/rules';
import type { DerivedResource, DerivedSheet, PlayState } from '@/engine/types';
import { ordinal } from './castResources';
import { andList, hpLimits } from './effectsInPlay';
import { hitDieRoll, slotTables } from './slotCost';

export { giveBack, shortRestWouldRestore } from '@/engine/rest';

/**
 * Spend one hit die of a size, as the HP card's chips and the short rest sheet
 * both do: marks it spent and rolls it plus the Constitution modifier. Says
 * the roll, for the caller to log and heal by; undefined, changing nothing,
 * when none of that size is left.
 */
export function spendHitDie(
  play: PlayState,
  hitDice: DerivedSheet['hitDice'],
  die: string,
  conMod: number,
  rng?: (sides: number) => number,
): RollResult | undefined {
  const spent = play.hitDiceSpent[die] ?? 0;
  if (spent >= (hitDice[die] ?? 0)) return undefined;
  play.hitDiceSpent[die] = spent + 1;
  return roll(hitDieRoll(die, 'rollPlusCon', conMod), {
    label: `Hit die (${die})`,
    kind: 'heal',
    ...(rng === undefined ? {} : { rng }),
  });
}

/** A pool that gives back expended spell slots as a short rest ends, with a use left. */
export interface SlotRecovery {
  key: string;
  label: string;
  /** Slot levels it gives back between them. */
  levels: number;
  /** Each slot it gives back is below this level. */
  below: number;
}

/**
 * The pools a short rest can spend to give back slots (Arcane Recovery,
 * Natural Recovery): those with `recoversSlots` and a use left.
 */
export function slotRecoveries(play: PlayState, sheet: DerivedSheet): SlotRecovery[] {
  return sheet.resources.flatMap((r) => {
    if (r.recoversSlots === undefined || r.recoversSlots.levels <= 0) return [];
    const used = play.resources.find((x) => x.key === r.key)?.used ?? 0;
    if (used >= r.max) return [];
    return [{ key: r.key, label: r.label, ...r.recoversSlots }];
  });
}

/** Each level with slots spent, lowest first: what a recovery can give back. */
export function spentSlots(
  play: PlayState,
  sheet: DerivedSheet,
): Array<{ level: number; spent: number }> {
  const { slots } = slotTables(sheet);
  return slots.flatMap((total, i) => {
    const spent = Math.min(total, play.slotsSpent[i] ?? 0);
    return spent > 0 ? [{ level: i + 1, spent }] : [];
  });
}

/** Slots picked to give back, as count by slot level. */
export type SlotPicks = Readonly<Record<number, number>>;

/** The slot levels picks add up to. */
export function pickedLevels(picks: SlotPicks): number {
  return Object.entries(picks).reduce((sum, [level, n]) => sum + Number(level) * n, 0);
}

/**
 * Give back the slots picked through a recovery pool and spend one of its
 * uses. Says what came back ("Arcane Recovery: 2 1st-level slots"), or
 * undefined, changing nothing, when nothing was picked or the picks break its
 * limits (a use left, the level budget, the cap, slots actually spent).
 */
export function recoverSlots(
  play: PlayState,
  sheet: DerivedSheet,
  key: string,
  picks: SlotPicks,
): string | undefined {
  const pool = slotRecoveries(play, sheet).find((r) => r.key === key);
  const chosen = Object.entries(picks)
    .map(([level, n]) => ({ level: Number(level), n }))
    .filter(({ n }) => n > 0)
    .sort((a, b) => a.level - b.level);
  if (pool === undefined || chosen.length === 0) return undefined;
  if (pickedLevels(picks) > pool.levels) return undefined;
  const spent = new Map(spentSlots(play, sheet).map((s) => [s.level, s.spent]));
  if (chosen.some(({ level, n }) => level >= pool.below || n > (spent.get(level) ?? 0))) {
    return undefined;
  }
  for (const { level, n } of chosen) play.slotsSpent[level - 1] = (spent.get(level) ?? 0) - n;
  const entry = play.resources.find((x) => x.key === key);
  if (entry === undefined) play.resources.push({ key, used: 1 });
  else entry.used += 1;
  const words = chosen.map(
    ({ level, n }) =>
      `${n === 1 ? 'a' : String(n)} ${ordinal(level)}-level slot${n === 1 ? '' : 's'}`,
  );
  return `${pool.label}: ${andList(words)}`;
}

/** When a pool comes back, for its row. */
export function backCaption(
  r: Pick<DerivedResource, 'resetOn' | 'regainOnShort' | 'regainRoll' | 'foretell'>,
): string {
  // Portent's numbers: rolled again on a long rest, those left lost.
  if (r.foretell === true) return 'Foretold anew on a long rest';
  // An item's charges: at dawn, which the sheet counts at a long rest; `0`, never.
  if (r.regainRoll === '0') return 'Never back';
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
    conditionEntry,
  }: {
    before?: EffectChange;
    idle?: readonly DerivedResource[];
    rollTotal?: (dice: string) => number;
    /** Finds a homebrew condition's entry, so one a rest's moment adds settles HP. */
    conditionEntry?: (name: string) => unknown;
  } = {},
): RestDone {
  return takeRest(play, sheet, rest, hpLimits(sheet, edition, conditionEntry), {
    hpOnLongRest: sheetRules(sheet, edition).hpOnLongRest,
    rollTotal,
    idle,
    ...(before === undefined ? {} : { before }),
  });
}
