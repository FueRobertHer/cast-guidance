/**
 * Items whose charges cast spells (the rolls canvas, "Every way to cast"): how
 * many charges each holds, what comes back at dawn, and what each spell costs.
 * The data's `attachedSpells.charges` says only one fixed cost per spell, and
 * not always that: a Staff of Healing's Cure Wounds is one charge a spell
 * level, up to 4th, and the 2024 staff's data lists it as at will. So an
 * official item's is a built-in `charges` row (`src/rules/cast-guidance/items.json`),
 * read from the item's own text, and a homebrew item says its own in a
 * `charges` effect (`StoredItemCharges`), which a pack's patch can say too.
 * Each is found under the `name|source` its equipment entry names
 * (`refUid(entry.ref)`), as every reader here and the item call site look it up.
 */
import { RULE_PACK_TYPE, RULE_SET_TYPE } from '../castGuidance';
import { lookupItem } from '../effects/item';
import {
  builtInRuleIn,
  type ItemCharges,
  packChargesOf,
  readMechanics,
} from '../effects/mechanics';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedResource,
  type EngineContext,
  type EntityRef,
  refUid,
} from '../types';

/** What the resolver reads: a derive's context, or the registry outside one. */
export type ChargeLookup = Pick<EngineContext, 'get' | 'byType'>;

/** Where an item's charges are said: a built-in row, its own effect, or a pack's patch. */
export type ChargeSource = 'row' | 'own' | 'pack';

/** The charges an item casts spells with, by its equipment entry's ref, from the built-in rows alone. */
export function itemChargesIn(
  ruleSets: readonly DataEntity[],
  ref: EntityRef,
): ItemCharges | undefined {
  return builtInRuleIn(ruleSets, 'charges', [refUid(ref)])?.charges;
}

/**
 * The charges a carried item casts spells with, and where they are said: the
 * last of its built-in row, its own `charges` effect and the packs applied to
 * the character (`packChargesOf`) that says them. A pack that replaces the
 * item's effects replaces its own charges too; the row stands outside what
 * the item inherits, so only a pack's charges or the item's own come before it.
 */
export function itemChargesOf(
  lookup: ChargeLookup,
  characterId: string,
  ref: EntityRef,
): { charges: ItemCharges; from: ChargeSource } | undefined {
  const uid = refUid(ref);
  const packs = packChargesOf(lookup.byType(RULE_PACK_TYPE), characterId, uid);
  if (packs.charges !== undefined) return { charges: packs.charges, from: 'pack' };
  if (!packs.replaced) {
    const entry = lookupItem({ ctx: lookup }, ref.name, ref.source);
    const raw = entry === undefined ? undefined : entry.castGuidance;
    const mine = raw === undefined ? undefined : readMechanics(raw);
    if (mine?.readable === true && mine.charges !== undefined) {
      return { charges: mine.charges, from: 'own' };
    }
  }
  const row = itemChargesIn(lookup.byType(RULE_SET_TYPE), ref);
  return row === undefined ? undefined : { charges: row, from: 'row' };
}

/**
 * The roll a long rest makes for an item's charges (`DerivedResource.regainRoll`):
 * none when all of them come back, as any pool's do, and `0` when none ever do.
 */
export function regainRollOf(c: ItemCharges): string | undefined {
  if (c.regain === 'all') return undefined;
  return c.regain === 'none' ? '0' : c.regain;
}

/** The pool holding one carried item's charges, by its equipment entry: two staves are two pools. */
export function itemChargeKey(entryId: string): string {
  return `item-charges:${entryId}`;
}

/** Whether a pool is a carried item's charges (`itemChargeKey`). */
export function isItemChargeKey(key: string): boolean {
  return key.startsWith('item-charges:');
}

/**
 * The charge pools of carried items whose magic is not working now (put away,
 * or not attuned), which the sheet leaves out: their charges still come back
 * at dawn, so a long rest gives back their roll too.
 */
export function idleChargePools(
  doc: Pick<CharacterDoc, 'id' | 'equipment'>,
  resources: readonly DerivedResource[],
  lookup: ChargeLookup,
): DerivedResource[] {
  return doc.equipment.flatMap((entry) => {
    const key = itemChargeKey(entry.id);
    if (entry.ref === undefined || resources.some((r) => r.key === key)) return [];
    const held = itemChargesOf(lookup, doc.id, entry.ref)?.charges;
    if (held === undefined) return [];
    const roll = regainRollOf(held);
    return [
      {
        key,
        label: `${entry.ref.name} charges`,
        max: held.charges,
        resetOn: 'long' as const,
        origin: entry.ref.name,
        ...(roll === undefined ? {} : { regainRoll: roll }),
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
