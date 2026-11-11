import {
  type Ability,
  type CharacterDoc,
  type DerivedAbility,
  type DerivedResource,
  type EffectInput,
  HIT_DIE_COST,
  SLOT_COST,
  type SlotPrice,
  type SpellcastingBlock,
} from '../types';
import { effectsOf } from './core';

/**
 * One pool under two names. A 2014 subclass kept under a 2024 monk says "ki" and
 * spends the Focus that class has, and the other way round.
 */
const SAME_POOL: Readonly<Record<string, string>> = { ki: 'focus', focus: 'ki' };

/** A die's sides ("1d10" is 10), 0 for anything else. */
const sides = (die: string) => Number(/^\d*d(\d+)$/.exec(die)?.[1] ?? 0);

/** What a sheet has to pay a spell slot or Hit Point Die cost with. */
export interface SlotsAndDice {
  /** The highest level of spell slot any class gives, 0 with none. */
  slotTop: number;
  /** The Pact Magic slots' level, when the character has them. */
  pactLevel?: number | undefined;
  /** How many Hit Point Dice the character has, of every size. */
  hitDice: number;
}

/** The slots every casting class gives (the same shared table on each) and the Hit Point Dice. */
export function slotsAndDice(
  spellcasting: readonly SpellcastingBlock[],
  hitDice: Readonly<Record<string, number>>,
): SlotsAndDice {
  let slotTop = 0;
  let pactLevel: number | undefined;
  for (const block of spellcasting) {
    block.slots.forEach((count, i) => {
      if (count > 0) slotTop = Math.max(slotTop, i + 1);
    });
    if (block.pactSlots !== undefined && block.pactSlots.count > 0) {
      pactLevel = Math.max(pactLevel ?? 0, block.pactSlots.level);
    }
  }
  const dice = Object.values(hitDice).reduce((sum, n) => sum + n, 0);
  return { slotTop, pactLevel, hitDice: dice };
}

/** Does the character have a slot that pays this price, spent or not? */
export function slotsPay(price: SlotPrice, has: SlotsAndDice): boolean {
  const min = price.minLevel ?? 1;
  const pact = has.pactLevel !== undefined && has.pactLevel >= min;
  return price.pactOnly === true ? pact : pact || has.slotTop >= min;
}

/**
 * A cost or a buy-back as this sheet can pay it: on the pool it has under either
 * name, or none at all when it has neither (Stunning Strike with no Focus to spend
 * yet). A spell slot price needs a slot of its level or higher, of the kind it
 * names, and the pool it turns into when it names one; a Hit Point Die price
 * needs a die.
 */
export function costOnSheet<T extends { resource: string; slotRefills?: string } & SlotPrice>(
  cost: T | undefined,
  resources: readonly DerivedResource[],
  pays: SlotsAndDice = { slotTop: 0, hitDice: 0 },
): T | undefined {
  if (cost === undefined) return undefined;
  if (cost.resource === SLOT_COST) {
    if (!slotsPay(cost, pays)) return undefined;
    if (cost.slotRefills === undefined) return cost;
    // A slot turned into points needs those points (Focus, or ki in 2014).
    const pool = poolOnSheet(cost.slotRefills, resources);
    return pool === undefined ? undefined : { ...cost, slotRefills: pool };
  }
  if (cost.resource === HIT_DIE_COST) return pays.hitDice > 0 ? cost : undefined;
  const pool = poolOnSheet(cost.resource, resources);
  return pool === undefined
    ? undefined
    : pool === cost.resource
      ? cost
      : { ...cost, resource: pool };
}

/** The sheet's pool for `key`: under that name, else its other name, else none. */
function poolOnSheet(key: string, resources: readonly DerivedResource[]): string | undefined {
  const has = (k: string) => resources.some((r) => r.key === k);
  if (has(key)) return key;
  const other = SAME_POOL[key];
  return other !== undefined && has(other) ? other : undefined;
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
        // None back on a short rest at this level (a pool that turns short later) is none.
        ...(e.regainOnShort !== undefined && e.regainOnShort > 0
          ? { regainOnShort: e.regainOnShort }
          : {}),
        ...(e.regainRoll !== undefined ? { regainRoll: e.regainRoll } : {}),
        ...(e.die !== undefined ? { die: e.die } : {}),
        ...(e.foretell === true ? { foretell: true } : {}),
      });
    } else if (e.stack === true) {
      // Stackable sources add to the shared pool (superiority dice, etc.).
      const row = out[existingIdx];
      if (row !== undefined) {
        row.max += max;
        // A Battle Master's d10s beside Martial Adept's d6: the pool rolls its largest.
        if (e.die !== undefined && (row.die === undefined || sides(e.die) > sides(row.die))) {
          row.die = e.die;
        }
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
