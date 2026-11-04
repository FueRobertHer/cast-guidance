/**
 * Short/long rest recovery (GAME-006). Pure functions that mutate the given
 * `PlayState` in place and return a human-readable summary of what was restored.
 * Kept out of the React tab so the rules are unit-testable in isolation.
 *
 * Recovery is edition-agnostic where 2014 and 2024 agree (they do for the state
 * modeled here): a long rest restores all HP, spent spell/pact slots, Mystic
 * Arcanum, per-rest resources, death saves, and removes one exhaustion level; a
 * short rest restores short-rest resources and Warlock pact slots, not arcana. Hit-dice recovery follows the rule
 * common to both editions — regain up to half your TOTAL Hit Dice (minimum one).
 *
 * Not modeled here (left to the player, by design): spending Hit Dice to heal on
 * a short rest, and choosing exactly which Hit Dice to regain on a long rest.
 */
import { conditionMaxHp, type Edition } from '@/engine/conditions';
import type { DerivedSheet, PlayState } from '@/engine/types';

/** Faces of a "d10"-style hit-die key (0 when unparseable, so it sorts last). */
function dieFaces(die: string): number {
  const n = Number.parseInt(die.replace(/^d/i, ''), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** Reset short-rest state and return a human summary of what was restored. */
export function shortRest(play: PlayState, sheet: DerivedSheet): string[] {
  const restored: string[] = [];
  for (const r of sheet.resources) {
    if (r.resetOn === 'short' && play.resources.some((x) => x.key === r.key && x.used > 0)) {
      restored.push(r.label);
    }
  }
  for (const r of sheet.resources) {
    if (r.resetOn === 'short') {
      play.resources = play.resources.filter((x) => x.key !== r.key);
    }
  }
  if (play.pactSlotsSpent > 0) {
    restored.push('pact slots');
    play.pactSlotsSpent = 0;
  }
  return restored;
}

/** Reset long-rest state and return a human summary of what was restored. */
export function longRest(play: PlayState, sheet: DerivedSheet, edition: Edition): string[] {
  const restored: string[] = [];

  // A long rest removes one level of exhaustion (both editions), and the hit
  // points come back to the maximum after that: the rest that takes 2014's
  // exhaustion from 4 to 3 lifts the halved maximum it heals up to.
  const exh = play.conditions.find((c) => c.id === 'Exhaustion');
  const exhaustionLifted = exh?.level !== undefined && exh.level > 0;
  if (exh?.level !== undefined && exh.level > 0) {
    if (exh.level <= 1) play.conditions = play.conditions.filter((c) => c.id !== 'Exhaustion');
    else exh.level -= 1;
  }
  const maxHp = conditionMaxHp(sheet.maxHp.value, play.conditions, edition).value;

  const hpHealed = maxHp - play.currentHp;
  if (hpHealed > 0) restored.push(`+${hpHealed} HP`);
  if (play.slotsSpent.some((n) => n > 0)) restored.push('spell slots');
  if (play.pactSlotsSpent > 0) restored.push('pact slots');
  if ((play.arcanumUsed?.length ?? 0) > 0) restored.push('Mystic Arcanum');
  if (play.resources.some((r) => r.used > 0)) restored.push('resources');
  if (play.deathSaves.success > 0 || play.deathSaves.fail > 0) restored.push('death saves');
  if (exhaustionLifted) restored.push('1 exhaustion level');

  play.currentHp = maxHp;
  play.tempHp = 0;
  play.slotsSpent = play.slotsSpent.map(() => 0);
  play.pactSlotsSpent = 0;
  // Absent rather than empty, as `setArcanumUsed` leaves it.
  delete play.arcanumUsed;
  play.resources = [];
  play.deathSaves = { success: 0, fail: 0 };

  // Regain spent Hit Dice up to half your TOTAL number of them (minimum 1) —
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
  return restored;
}
