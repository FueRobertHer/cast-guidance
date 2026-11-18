/**
 * Items whose charges cast spells (the rolls canvas, "Every way to cast"): how
 * many charges each holds, what comes back at dawn, and what each spell costs.
 * The data's `attachedSpells.charges` says only one fixed cost per spell, and
 * not always that: a Staff of Healing's Cure Wounds is one charge a spell
 * level, up to 4th, and the 2024 staff's data lists it as at will. Each is a
 * built-in `charges` row (`src/rules/cast-guidance/items.json`), read from the
 * item's own text and found under the `name|source` its equipment entry names
 * (`refUid(entry.ref)`), as every reader here and the item call site look it up.
 */
import { builtInRuleIn, type ItemCharges } from '../effects/mechanics';
import {
  type DataEntity,
  type DerivedResource,
  type EntityRef,
  type EquipmentEntry,
  refUid,
} from '../types';

export interface ChargeSpell {
  /** The spell, by name in lower case: any printing of it casts from the item. */
  name: string;
  /** Charges it costs at its own level. */
  cost: number;
  /** One more charge for each level above its own, up to this spell level. Absent: its own level only. */
  upTo?: number;
}

export interface ItemChargeRow {
  charges: number;
  /** The charges that come back at dawn, as dice. */
  regain: string;
  spells: readonly ChargeSpell[];
}

const STAFF_OF_HEALING: ItemChargeRow = {
  charges: 10,
  regain: '1d6+4',
  spells: [
    { name: 'cure wounds', cost: 1, upTo: 4 },
    { name: 'lesser restoration', cost: 2 },
    { name: 'mass cure wounds', cost: 5 },
  ],
};

/** A 2014 wand: one charge at the spell's level, one more a level, as far as its charges go. */
const wand2014 = (spell: string): ItemChargeRow => ({
  charges: 7,
  regain: '1d6+1',
  spells: [{ name: spell, cost: 1, upTo: 9 }],
});

/** A 2024 wand: the same, but "no more than 3 charges" a cast. */
const wand2024 = (spell: string, level: number): ItemChargeRow => ({
  charges: 7,
  regain: '1d6+1',
  spells: [{ name: spell, cost: 1, upTo: level + 2 }],
});

/** The table the `charges` rows came from, kept while a test compares the two. */
export const ITEM_CHARGES: Readonly<Record<string, ItemChargeRow>> = {
  'staff of healing|dmg': STAFF_OF_HEALING,
  'staff of healing|xdmg': STAFF_OF_HEALING,
  'wand of magic missiles|dmg': wand2014('magic missile'),
  'wand of magic missiles|xdmg': wand2024('magic missile', 1),
  'wand of fireballs|dmg': wand2014('fireball'),
  'wand of fireballs|xdmg': wand2024('fireball', 3),
  'wand of lightning bolts|dmg': wand2014('lightning bolt'),
  'wand of lightning bolts|xdmg': wand2024('lightning bolt', 3),
};

/** The charges an item casts spells with, by its equipment entry's ref, from the built-in rows. */
export function itemChargesIn(
  ruleSets: readonly DataEntity[],
  ref: EntityRef,
): ItemCharges | undefined {
  return builtInRuleIn(ruleSets, 'charges', [refUid(ref)])?.charges;
}

/** The pool holding one carried item's charges, by its equipment entry: two staves are two pools. */
export function itemChargeKey(entryId: string): string {
  return `item-charges:${entryId}`;
}

/**
 * The charge pools of carried items whose magic is not working now (put away,
 * or not attuned), which the sheet leaves out: their charges still come back
 * at dawn, so a long rest gives back their roll too.
 */
export function idleChargePools(
  equipment: readonly EquipmentEntry[],
  resources: readonly DerivedResource[],
  ruleSets: readonly DataEntity[],
): DerivedResource[] {
  return equipment.flatMap((entry) => {
    const row = entry.ref === undefined ? undefined : itemChargesIn(ruleSets, entry.ref);
    const key = itemChargeKey(entry.id);
    if (entry.ref === undefined || row === undefined || resources.some((r) => r.key === key)) {
      return [];
    }
    return [
      {
        key,
        label: `${entry.ref.name} charges`,
        max: row.charges,
        resetOn: 'long' as const,
        origin: entry.ref.name,
        regainRoll: row.regain,
      },
    ];
  });
}

/**
 * What casting `spellName` from an item of this row costs at each level it
 * can, from the spell's own level up, while the cost fits in the item's
 * charges. Empty when the item does not cast that spell.
 */
export function chargeCosts(
  row: ItemCharges,
  spellName: string,
  spellLevel: number,
): Array<{ level: number; cost: number }> {
  const spell = row.spells.find((s) => s.spell === spellName.trim().toLowerCase());
  if (spell === undefined) return [];
  const out: Array<{ level: number; cost: number }> = [];
  const top = Math.min(9, spell.upTo ?? spellLevel);
  for (let level = spellLevel; level <= top; level++) {
    const cost = spell.cost + (level - spellLevel);
    if (cost > row.charges) break;
    out.push({ level, cost });
  }
  return out;
}
