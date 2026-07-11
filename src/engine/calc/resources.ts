import type { Ability, CharacterDoc, DerivedAbility, DerivedResource, EffectInput } from '../types';
import { effectsOf } from './core';

export function calcResources(
  doc: CharacterDoc,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): DerivedResource[] {
  const out: DerivedResource[] = [];
  const seen = new Set<string>();
  for (const e of effectsOf(effects, 'resource')) {
    // First wins: curated entries emit before prose-scanned duplicates.
    if (seen.has(e.key)) continue;
    seen.add(e.key);
    let max: number;
    if (typeof e.max === 'number') {
      max = e.max;
    } else if (e.max === 'profBonus') {
      max = profBonus;
    } else if (e.max.startsWith('abilityMod:')) {
      const ability = e.max.slice('abilityMod:'.length) as Ability;
      max = Math.max(1, abilities[ability]?.mod ?? 1);
    } else if (e.max.startsWith('level:')) {
      const className = e.max.slice('level:'.length);
      max =
        doc.classes.find((c) => c.ref.name.toLowerCase() === className.toLowerCase())?.levels ?? 0;
    } else {
      max = 0;
    }
    if (max <= 0) continue;
    out.push({ key: e.key, label: e.label, max, resetOn: e.resetOn, origin: e.origin.label });
  }
  return out;
}
