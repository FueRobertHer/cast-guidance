import type { Ability, CharacterDoc, DerivedAbility, DerivedResource, EffectInput } from '../types';
import { effectsOf } from './core';

export function calcResources(
  doc: CharacterDoc,
  effects: readonly EffectInput[],
  abilities: Record<Ability, DerivedAbility>,
  profBonus: number,
): DerivedResource[] {
  const out: DerivedResource[] = [];
  const idxByKey = new Map<string, number>();
  for (const e of effectsOf(effects, 'resource')) {
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
    const existingIdx = idxByKey.get(e.key);
    if (existingIdx === undefined) {
      idxByKey.set(e.key, out.length);
      out.push({ key: e.key, label: e.label, max, resetOn: e.resetOn, origin: e.origin.label });
    } else if (e.stack === true) {
      // Stackable sources add to the shared pool (superiority dice, etc.).
      const row = out[existingIdx];
      if (row !== undefined) row.max += max;
    }
    // Otherwise first wins: curated entries emit before prose-scanned duplicates.
  }
  return out;
}
