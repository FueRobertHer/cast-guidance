/**
 * Short and long rests (GAME-006): what each gives back, under the table's
 * rules (`rules.ts`), and the moments a rest sets off. Like `effectLife.ts`,
 * each function changes the play state it is given (a draft) and says what it
 * gave back, so the sheet can show it.
 *
 * As written, and alike in 2014 and 2024 for what is modeled here: a long rest
 * gives back every hit point, spent spell and pact slots, Mystic Arcanum,
 * per-rest pools (an item's charges by its dawn roll) and death saves, takes
 * off one level of exhaustion, and gives back up to half the character's
 * TOTAL hit dice (at least one). A short rest gives back short-rest pools,
 * what `regainOnShort` says of the others, and pact slots, not arcana. The
 * table's HP on a long rest rule may give back half the maximum or none.
 *
 * Not modeled (left to the player, by design): spending hit dice to heal, and
 * choosing which hit dice come back on a long rest.
 */
import type { TableRuleChoices } from './castGuidance';
import { conditionMaxHp } from './conditions';
import { type EffectChange, type HpLimits, restTaken } from './effectLife';
import type { DerivedResource, DerivedSheet, PlayState } from './types';

/** What the rest maths reads of the sheet. */
export type RestSheet = Pick<DerivedSheet, 'maxHp' | 'hitDice' | 'resources'>;

/** Faces of a "d10"-style hit-die key (0 when unparseable, so it sorts last). */
function dieFaces(die: string): number {
  const n = Number.parseInt(die.replace(/^d/i, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Give back up to `amount` of a pool and say how many came back. Uses can sit past
 * the maximum after a character loses a level, which counts as all of them spent.
 */
export function giveBack(
  entry: PlayState['resources'][number],
  max: number,
  amount: number,
): number {
  const spent = Math.min(entry.used, max);
  const back = Math.min(spent, amount);
  entry.used = spent - back;
  return back;
}

/** A short rest's recovery, and what it gave back, in words. */
export function shortRestRecovery(play: PlayState, sheet: RestSheet): string[] {
  const restored: string[] = [];
  for (const r of sheet.resources) {
    const entry = play.resources.find((x) => x.key === r.key);
    if (r.resetOn === 'short') {
      if (entry !== undefined && entry.used > 0) restored.push(r.label);
      play.resources = play.resources.filter((x) => x.key !== r.key);
    } else if (entry !== undefined && r.regainOnShort !== undefined) {
      const back = giveBack(entry, r.max, r.regainOnShort);
      if (back > 0) restored.push(`${back} ${r.label}`);
    }
  }
  if (play.pactSlotsSpent > 0) {
    restored.push('pact slots');
    play.pactSlotsSpent = 0;
  }
  return restored;
}

export interface LongRestOptions {
  /** The table's HP on a long rest rule; absent is as written (all of them). */
  hpOnLongRest?: TableRuleChoices['hpOnLongRest'];
  /**
   * What the effects the rest ended took off the maximum (Aid's +5 gone is
   * -5), so the hit points refill to what is left.
   */
  maxHpChange?: number;
  /** Rolls a pool's `regainRoll` (an item's charges back at dawn). */
  rollTotal: (dice: string) => number;
  /** Charge pools the sheet leaves out while their item's magic is off (`idleChargePools`). */
  idle?: readonly DerivedResource[];
}

/**
 * A long rest's recovery: what it gave back, in words, and whether it took
 * the last level of exhaustion off. `hp` gives the maximum before the rest
 * ended anything, the edition and what the character is immune to.
 */
export function longRestRecovery(
  play: PlayState,
  sheet: RestSheet,
  hp: Pick<HpLimits, 'maxHp' | 'edition' | 'immune'>,
  { hpOnLongRest = 'all', maxHpChange = 0, rollTotal, idle = [] }: LongRestOptions,
): { restored: string[]; exhaustionOff: boolean } {
  const restored: string[] = [];

  // A long rest removes one level of exhaustion (both editions), and the hit
  // points come back after that: the rest that takes 2014's exhaustion from 4
  // to 3 lifts the halved maximum it heals up to.
  const exh = play.conditions.find((c) => c.id === 'Exhaustion');
  const exhaustionLifted = exh?.level !== undefined && exh.level > 0;
  let exhaustionOff = false;
  if (exh?.level !== undefined && exh.level > 0) {
    if (exh.level <= 1) {
      play.conditions = play.conditions.filter((c) => c.id !== 'Exhaustion');
      exhaustionOff = true;
    } else exh.level -= 1;
  }
  const maxHp = conditionMaxHp(hp.maxHp + maxHpChange, play.conditions, hp.edition, {
    immune: hp.immune,
  }).value;
  // As written all of it; the table may give back half the maximum, or none
  // (hit dice spent heal instead). Never past the maximum, never taken away.
  const healTo =
    hpOnLongRest === 'all'
      ? maxHp
      : Math.min(
          maxHp,
          Math.max(0, play.currentHp) + (hpOnLongRest === 'half' ? Math.floor(maxHp / 2) : 0),
        );

  const hpHealed = healTo - play.currentHp;
  if (hpHealed > 0) restored.push(`+${hpHealed} HP`);
  if (play.slotsSpent.some((n) => n > 0)) restored.push('spell slots');
  if (play.pactSlotsSpent > 0) restored.push('pact slots');
  if ((play.arcanumUsed?.length ?? 0) > 0) restored.push('Mystic Arcanum');
  // An item's charges come back by a roll, not all at once, so its spent
  // ones outlast the rest less what the roll gives back: an item put away
  // too, whose pool the sheet leaves out until its magic works again.
  const pools = [...sheet.resources, ...idle];
  const kept: PlayState['resources'] = [];
  for (const r of pools) {
    const entry = play.resources.find((x) => x.key === r.key);
    if (r.regainRoll === undefined || entry === undefined || entry.used <= 0) continue;
    const left = { ...entry };
    const back = giveBack(left, r.max, rollTotal(r.regainRoll));
    if (back > 0) restored.push(`${back} ${r.label}`);
    if (left.used > 0) kept.push(left);
  }
  const charged = new Set(pools.flatMap((r) => (r.regainRoll === undefined ? [] : [r.key])));
  if (play.resources.some((r) => r.used > 0 && !charged.has(r.key))) restored.push('resources');
  if (play.deathSaves.success > 0 || play.deathSaves.fail > 0) restored.push('death saves');
  if (exhaustionLifted) restored.push('1 exhaustion level');

  play.currentHp = healTo;
  play.tempHp = 0;
  delete play.tempHpFrom;
  play.slotsSpent = play.slotsSpent.map(() => 0);
  play.pactSlotsSpent = 0;
  // Absent rather than empty, as `setArcanumUsed` leaves it.
  delete play.arcanumUsed;
  play.resources = kept;
  play.deathSaves = { success: 0, fail: 0 };
  // A foretelling pool's d20s are rolled again, one a use, and those not used
  // are lost (Portent): "Portent (17 and 4)".
  const foretold: Record<string, number[]> = {};
  for (const r of sheet.resources) {
    if (r.foretell !== true) continue;
    const rolls = Array.from({ length: r.max }, () => rollTotal('1d20'));
    foretold[r.key] = rolls;
    const last = rolls.at(-1);
    restored.push(
      `${r.label} (${rolls.length > 1 ? `${rolls.slice(0, -1).join(', ')} and ${last}` : last})`,
    );
  }
  // Absent rather than empty, as `PlayState.foretold` says.
  if (Object.keys(foretold).length > 0) play.foretold = foretold;
  else delete play.foretold;

  // Regain spent Hit Dice up to half your TOTAL number of them (minimum 1),
  // not half of *each* die type, which over-counts the minimum and under-counts
  // the half for a multiclass character. The player chooses which dice; we
  // auto-regain the largest first (the usual optimal pick) until the pool runs
  // out. A per-die picker is future scope.
  const totalDice = Object.values(sheet.hitDice).reduce((sum, n) => sum + n, 0);
  let budget = Math.max(1, Math.floor(totalDice / 2));
  let hitDiceBack = 0;
  const byLargest = Object.keys(sheet.hitDice).sort((a, b) => dieFaces(b) - dieFaces(a));
  for (const die of byLargest) {
    if (budget <= 0) break;
    const spent = play.hitDiceSpent[die] ?? 0;
    const back = Math.min(spent, budget);
    if (back > 0) {
      play.hitDiceSpent[die] = spent - back;
      hitDiceBack += back;
      budget -= back;
    }
  }
  if (hitDiceBack > 0) restored.push(`${hitDiceBack} hit ${hitDiceBack === 1 ? 'die' : 'dice'}`);
  return { restored, exhaustionOff };
}

/** What a rest did: what it gave back, in words, and the change its moments made. */
export interface RestDone {
  restored: string[];
  /** The effects the rest ended (`before`) and what its moments did. */
  change: EffectChange;
}

/**
 * Take a rest: its recovery under the table's HP on a long rest rule, then
 * its moments (`effectLife.restTaken`), which fire only when `hp.moments` is
 * given. `before` is what the rest already ended (the effects ticked on the
 * rest sheet): the refill counts the maximum they took with them.
 */
export function takeRest(
  play: PlayState,
  sheet: RestSheet,
  rest: 'short' | 'long',
  hp: HpLimits,
  options: Omit<LongRestOptions, 'maxHpChange'> & { before?: EffectChange },
): RestDone {
  const before = options.before ?? { ended: [], maxHpChange: 0 };
  if (rest === 'short') {
    const restored = shortRestRecovery(play, sheet);
    return { restored, change: restTaken(play, 'short', hp, before) };
  }
  const { restored, exhaustionOff } = longRestRecovery(play, sheet, hp, {
    ...options,
    maxHpChange: before.maxHpChange,
  });
  return {
    restored,
    change: restTaken(play, 'long', hp, before, exhaustionOff ? ['Exhaustion'] : []),
  };
}
