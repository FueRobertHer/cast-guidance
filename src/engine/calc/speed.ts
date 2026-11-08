import type { Collector } from '../effects/base';
import { num } from '../effects/base';
import type { CharacterDoc, DerivedSheet, DerivedValue, EffectInput } from '../types';
import { atLeast, dv, effectsOf, inPlay, onTop, withOverride } from './core';

export function calcWalkSpeed(
  doc: CharacterDoc,
  col: Collector,
  effects: readonly EffectInput[],
): DerivedValue {
  let raceSpeed = 30;
  let label = 'Base';
  const race = doc.race ? col.ctx.get('race', doc.race.name, doc.race.source) : undefined;
  const subrace = doc.subrace
    ? col.ctx.get('subrace', doc.subrace.name, doc.subrace.source)
    : undefined;
  for (const e of [race, subrace]) {
    if (e === undefined) continue;
    const speed = e.speed;
    const walk = typeof speed === 'number' ? speed : num((speed as { walk?: unknown })?.walk);
    if (walk !== undefined) {
      raceSpeed = walk;
      label = String(e.name ?? 'Species');
    }
  }
  const parts = [{ label, amount: raceSpeed }];
  const bonuses = effectsOf(effects, 'speedBonus');
  for (const b of bonuses) {
    if (!inPlay(b)) parts.push({ label: b.origin.label, amount: b.amount });
  }
  const played = bonuses.filter(inPlay).map((b) => ({ label: b.origin.label, amount: b.amount }));
  const walk = onTop(withOverride(dv(parts), doc.overrides['speed.walk']), played);
  // A slow in play can stop you; it never takes speed under 0.
  return played.length > 0 ? atLeast(walk, 0, 'Minimum (0)') : walk;
}

/**
 * What walking speed is multiplied by, once conditions have taken their share:
 * Haste doubles a speed exhaustion has already cut. Two multipliers do not
 * multiply each other; the largest counts, and every source that gives it is named.
 */
export function calcSpeedMultiplier(effects: readonly EffectInput[]): {
  factor: number;
  sources: string[];
} {
  let factor = 1;
  let sources: string[] = [];
  for (const m of effectsOf(effects, 'speedMultiplier')) {
    if (m.factor > factor) {
      factor = m.factor;
      sources = [m.origin.label];
    } else if (m.factor === factor && factor !== 1 && !sources.includes(m.origin.label)) {
      sources.push(m.origin.label);
    }
  }
  return { factor, sources };
}

const MODES = ['fly', 'climb', 'swim'] as const;

/** The best speed of each other way to move, a number or the walking speed `walk`. */
export function calcOtherSpeeds(
  effects: readonly EffectInput[],
  walk: number,
): DerivedSheet['otherSpeeds'] {
  const best = new Map<string, { value: number; origin: string }>();
  for (const m of effectsOf(effects, 'moveSpeed')) {
    const value = m.speed === 'walk' ? walk : m.speed;
    const cur = best.get(m.mode);
    if (cur === undefined || value > cur.value) best.set(m.mode, { value, origin: m.origin.label });
  }
  return MODES.flatMap((mode) => {
    const b = best.get(mode);
    return b === undefined ? [] : [{ mode, value: b.value, origin: b.origin }];
  });
}
