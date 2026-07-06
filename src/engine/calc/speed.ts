import type { Collector } from '../effects/base';
import { num } from '../effects/base';
import type { CharacterDoc, DerivedValue, EffectInput } from '../types';
import { effectsOf, withOverride } from './core';

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
  for (const b of effectsOf(effects, 'speedBonus')) {
    parts.push({ label: b.origin.label, amount: b.amount });
  }
  const base = parts.reduce((s, p) => s + p.amount, 0);
  return withOverride({ value: base, base, overridden: false, parts }, doc.overrides['speed.walk']);
}
