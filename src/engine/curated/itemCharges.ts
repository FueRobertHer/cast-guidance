/**
 * Items with charges, and those whose charges cast spells (the rolls canvas,
 * "Every way to cast"): how many charges each holds, what comes back at dawn,
 * and what each spell costs. Every item's own data fields count its charges
 * (`fieldChargesOf`). The data's `attachedSpells.charges` says only one fixed
 * cost per spell, and not always that: a Staff of Healing's Cure Wounds is one
 * charge a spell level, up to 4th, and the 2024 staff's data lists it as at
 * will. So the spells an official item's charges cast are a built-in `charges`
 * row (`src/rules/cast-guidance/items.json`), read from the item's own text,
 * and a homebrew item says its own in a `charges` effect (`StoredItemCharges`),
 * which a pack's patch can say too. Each is found under the `name|source` its
 * equipment entry names (`refUid(entry.ref)`), as every reader here and the
 * item call site look it up.
 */
import { RULE_PACK_TYPE, RULE_SET_TYPE } from '../castGuidance';
import { lookupItem } from '../effects/item';
import {
  builtInRuleIn,
  type ItemCharges,
  packChargesOf,
  readItemCharges,
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

/** The charges an item casts spells with, by its equipment entry's ref, from the built-in rows alone. */
export function itemChargesIn(
  ruleSets: readonly DataEntity[],
  ref: EntityRef,
): ItemCharges | undefined {
  return builtInRuleIn(ruleSets, 'charges', [refUid(ref)])?.charges;
}

/**
 * `recharge` values whose charges come back with a long rest, in lower case:
 * at dawn, at dusk, at midnight, or on the rest itself.
 */
const LONG_REST_RECHARGE: ReadonlySet<string> = new Set(['dawn', 'dusk', 'midnight', 'restlong']);

/** What `rechargeAmount` says comes back: a dice tag's dice, a number, or a number written as text. */
function amountOf(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const tag = /^\{@dice ([^}|]+)(?:\|[^}]*)?\}$/.exec(v.trim());
  const said = (tag?.[1] ?? v).replace(/\s+/g, '');
  return /^\d+$/.test(said) ? Number(said) : said;
}

/** Each item's `fieldChargesOf`, read once (`null`: its fields count none). */
const fromFields = new WeakMap<DataEntity, ItemCharges | null>();

/**
 * The charges an item's own data fields say (`charges`, `recharge`,
 * `rechargeAmount`), read as its own `charges` effect would be: a long rest
 * (dawn, dusk, midnight) gives back the amount, or all of them when none is
 * said; an amount with no `recharge` comes back at dawn too (a Robe of Stars),
 * and any other recharge (none, an empty one, `special`) gives nothing back.
 * They cast no spells here. Absent when the fields do not read as a whole
 * (a dice count of charges, an amount the roller cannot roll).
 */
export function fieldChargesOf(entry: DataEntity): ItemCharges | undefined {
  const known = fromFields.get(entry);
  if (known !== undefined) return known ?? undefined;
  const read = entry.charges === undefined ? undefined : readFields(entry);
  fromFields.set(entry, read ?? null);
  return read;
}

function readFields(entry: DataEntity): ItemCharges | undefined {
  const recharge = typeof entry.recharge === 'string' ? entry.recharge.toLowerCase() : undefined;
  const amount = entry.rechargeAmount;
  const back = recharge === undefined ? amount !== undefined : LONG_REST_RECHARGE.has(recharge);
  const regain = !back ? 'none' : amount === undefined ? 'all' : amountOf(amount);
  return readItemCharges({ charges: entry.charges, regain, spells: [] });
}

/**
 * The charges a carried item holds: the last of its own fields
 * (`fieldChargesOf`), its built-in row, its own `charges` effect and the packs
 * applied to the character (`packChargesOf`) that says them. A pack that
 * replaces the item's effects replaces its own charges and its fields too, as
 * it does everything the item inherits; the row stands outside that, so only a
 * pack's charges or the item's own come before it.
 */
export function itemChargesOf(
  lookup: ChargeLookup,
  characterId: string,
  ref: EntityRef,
): ItemCharges | undefined {
  const uid = refUid(ref);
  const packs = packChargesOf(lookup.byType(RULE_PACK_TYPE), characterId, uid);
  if (packs.charges !== undefined) return packs.charges;
  const entry = packs.replaced ? undefined : lookupItem({ ctx: lookup }, ref.name, ref.source);
  const raw = entry === undefined ? undefined : entry.castGuidance;
  const mine = raw === undefined ? undefined : readMechanics(raw);
  if (mine?.readable === true && mine.charges !== undefined) return mine.charges;
  return (
    itemChargesIn(lookup.byType(RULE_SET_TYPE), ref) ??
    (entry === undefined ? undefined : fieldChargesOf(entry))
  );
}

/**
 * The roll a long rest makes for an item's charges (`DerivedResource.regainRoll`):
 * none when all of them come back, as any pool's do, and `0` when none ever do.
 */
export function regainRollOf(c: ItemCharges): string | undefined {
  if (c.regain === 'all') return undefined;
  return c.regain === 'none' ? '0' : c.regain;
}

/**
 * The key an item's own actions (and a pack's on it) spend its charges by: the
 * sheet spends the carried copy's pool (`itemChargeKey`) in its place.
 */
export const ITEM_CHARGES = 'charges';

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
    const held = itemChargesOf(lookup, doc.id, entry.ref);
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
