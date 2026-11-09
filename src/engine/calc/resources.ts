import type { Ability, CharacterDoc, DerivedAbility, DerivedResource, EffectInput } from '../types';
import { effectsOf } from './core';

/**
 * One pool under two names. A 2014 subclass kept under a 2024 monk says "ki" and
 * spends the Focus that class has, and the other way round.
 */
const SAME_POOL: Readonly<Record<string, string>> = { ki: 'focus', focus: 'ki' };

/**
 * A cost or a buy-back as this sheet can pay it: on the pool it has under either
 * name, or none at all when it has neither (Stunning Strike with no Focus to spend
 * yet).
 */
export function costOnSheet<T extends { resource: string }>(
  cost: T | undefined,
  resources: readonly DerivedResource[],
): T | undefined {
  if (cost === undefined) return undefined;
  const has = (key: string) => resources.some((r) => r.key === key);
  if (has(cost.resource)) return cost;
  const other = SAME_POOL[cost.resource];
  return other !== undefined && has(other) ? { ...cost, resource: other } : undefined;
}

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
    } else if (e.max === 'twiceProfBonus') {
      max = 2 * profBonus;
    } else if (e.max.startsWith('abilityMod:')) {
      const ability = e.max.slice('abilityMod:'.length) as Ability;
      max = Math.max(1, abilities[ability]?.mod ?? 1);
    } else if (e.max.startsWith('abilityModPlus1:')) {
      // "1 + your Charisma modifier" (Divine Sense). No stated minimum, so a
      // negative modifier can zero it out, which drops the resource below.
      const ability = e.max.slice('abilityModPlus1:'.length) as Ability;
      max = 1 + (abilities[ability]?.mod ?? 0);
    } else if (e.max.startsWith('level:')) {
      const className = e.max.slice('level:'.length);
      max =
        doc.classes.find((c) => c.ref.name.toLowerCase() === className.toLowerCase())?.levels ?? 0;
    } else {
      max = 0;
    }
    if (e.min !== undefined) max = Math.max(e.min, max);
    if (max <= 0) continue;
    const existingIdx = idxByKey.get(e.key);
    if (existingIdx === undefined) {
      idxByKey.set(e.key, out.length);
      out.push({
        key: e.key,
        label: e.label,
        max,
        resetOn: e.resetOn,
        origin: e.origin.label,
        ...(e.noSlotConversion !== undefined ? { noSlotConversion: e.noSlotConversion } : {}),
        ...(e.regainOnShort !== undefined ? { regainOnShort: e.regainOnShort } : {}),
      });
    } else if (e.stack === true) {
      // Stackable sources add to the shared pool (superiority dice, etc.).
      const row = out[existingIdx];
      if (row !== undefined) {
        row.max += max;
        if (e.noSlotConversion !== undefined) {
          row.noSlotConversion = (row.noSlotConversion ?? 0) + e.noSlotConversion;
        }
      }
    }
    // Otherwise first wins: curated entries emit before prose-scanned duplicates.
  }
  for (const e of effectsOf(effects, 'resourceRegain')) {
    const row = out.find((r) => r.key === e.key);
    if (row !== undefined) row.regainOnShort = (row.regainOnShort ?? 0) + e.amount;
  }
  return out;
}
