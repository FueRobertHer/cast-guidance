/**
 * Items with charges, and those whose charges cast spells (the rolls canvas,
 * "Every way to cast"): how many charges each holds, what comes back at dawn,
 * and what each spell costs. Every item's own data fields count its charges
 * and the spells they cast (`fieldChargesOf`). The data's
 * `attachedSpells.charges` says only one fixed cost per spell, and not always
 * that: a Staff of Healing's Cure Wounds is one charge a spell level, up to
 * 4th, and the 2024 staff's data lists it as at will. So where the fields
 * misstate them, the spells an official item's charges cast are a built-in
 * `charges` row (`src/rules/cast-guidance/items.json`), read from the item's
 * own text, and a homebrew item says its own in a `charges` effect
 * (`StoredItemCharges`), which a pack's patch can say too. The save DC and
 * attack bonus an item's text fixes for its spells are an `itemDc` row. Each
 * is found under the `name|source` its equipment entry names
 * (`refUid(entry.ref)`), as every reader here and the item call site look it up;
 * an `itemDc` row, and an `itemSpells` row at the item call site, under the
 * official item a Workshop copy is `basedOn` after it (`itemRowKeys`).
 */
import { isRecord, RULE_PACK_TYPE, RULE_SET_LIMITS, RULE_SET_TYPE } from '../castGuidance';
import { parseSpellRef } from '../effects/additionalSpells';
import { lookupItem } from '../effects/item';
import {
  basedOn,
  builtInRuleIn,
  type ChargeSpell,
  type FixedCast,
  type ItemCharges,
  packChargesOf,
  readItemCharges,
  readMechanics,
  readOwnEffects,
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
 * The keys an item's `itemDc` and `itemSpells` rows are found under: its own
 * `name|source`, then that of the official item a Workshop copy (`entry`) is
 * `basedOn`, so a copy casts as the item it copies.
 */
export function itemRowKeys(ref: EntityRef, entry: DataEntity | undefined): string[] {
  const own = refUid(ref);
  const based = basedOn(entry);
  const copied = based === undefined ? own : refUid(based);
  return copied === own ? [own] : [own, copied];
}

/**
 * The save DC and attack bonus an item's text fixes for its spells (`itemDc`
 * rows), by its equipment entry's ref, or the item a copy of it (`entry`)
 * copies (`itemRowKeys`).
 */
export function itemDcIn(
  ruleSets: readonly DataEntity[],
  ref: EntityRef,
  entry?: DataEntity,
): FixedCast | undefined {
  return builtInRuleIn(ruleSets, 'itemDc', itemRowKeys(ref, entry))?.itemDc;
}

/**
 * `recharge` values whose charges come back with a long rest, in lower case:
 * at dawn, at dusk, at midnight, or on the rest itself.
 */
const LONG_REST_RECHARGE: ReadonlySet<string> = new Set(['dawn', 'dusk', 'midnight', 'restlong']);

/**
 * The rest an item's `recharge` field gives its charges back on: `long` for a
 * time a long rest covers (`LONG_REST_RECHARGE`), `short` for `restShort`, in
 * any case; none for no recharge, an empty one or one the text tells
 * (`special`).
 */
export function rechargeRest(recharge: unknown): 'long' | 'short' | undefined {
  if (typeof recharge !== 'string') return undefined;
  const time = recharge.toLowerCase();
  if (LONG_REST_RECHARGE.has(time)) return 'long';
  return time === 'restshort' ? 'short' : undefined;
}

/** A `rechargeAmount` as words: a number's digits, or the text with each dice tag's dice in its place. */
export function rechargeWords(amount: unknown): string | undefined {
  if (typeof amount === 'number') return String(amount);
  if (typeof amount !== 'string') return undefined;
  return amount.replace(/\{@dice ([^{}|]+)(?:\|[^{}]*)?\}/g, '$1');
}

/**
 * What comes back, as an item's `charges` effect says it, from its standard
 * fields: nothing unless `recharge` names a rest (`rechargeRest`: none, an
 * empty one or `special` give nothing back, even beside an amount); then all
 * of them with no amount, else its number or its dice, spaces taken out
 * (words the effect cannot take are kept, and say so, as dice on a short rest
 * do). With `restShort` it is what a short rest gives back, which the effect
 * says with `rest: "short"`. The sheet reads an item's fields by it
 * (`fieldChargesOf`) and the Workshop writes them out by it, so the two say
 * the same.
 */
export function regainOf(recharge: unknown, amount: unknown): string | number {
  if (rechargeRest(recharge) === undefined) return 'none';
  const words = (rechargeWords(amount) ?? '').replace(/\s+/g, '');
  if (words === '') return 'all';
  return /^\d+$/.test(words) ? Number(words) : words;
}

/** Each item's `fieldChargesOf`, read once (`null`: its fields count none). */
const fromFields = new WeakMap<DataEntity, ItemCharges | null>();

/**
 * Whether an item's own `castGuidance` leaves its fields' charges out: it
 * starts from nothing (`replace`), so inherits none, or it counts them its own
 * way, with a `charges` effect (one that does not read yet too, which says
 * why) or the Workshop's older pool, a `resource` keyed `charges`, whose cards
 * spend it (an item `upgradeOlderCharges` could not convert without loss). Its
 * effects are looked at as stored, so a guidance that does not
 * read as a whole says the same; its `replace` counts only where it reads, as
 * everything else it would leave out (`mechanicsOf`).
 */
function ownChargesStand(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  if (readMechanics(raw).replace) return true;
  const g = raw as Record<string, unknown>;
  const effects = Array.isArray(g.effects) ? (g.effects as unknown[]) : [];
  return effects.some((e) => {
    if (typeof e !== 'object' || e === null) return false;
    const { kind, key } = e as Record<string, unknown>;
    return kind === 'charges' || (kind === 'resource' && key === ITEM_CHARGES);
  });
}

/**
 * What an item's fields give back, as `fieldChargesOf` reads them: what
 * `regainOf` says, on a short rest with `restShort`. An amount a short rest
 * cannot give back (dice, or words) gives none, as every short rest did
 * before one counted, so the item keeps its pool.
 */
function fieldRegainOf(entry: DataEntity): { regain: string | number; rest?: 'short' } {
  const regain = regainOf(entry.recharge, entry.rechargeAmount);
  if (rechargeRest(entry.recharge) !== 'short') return { regain };
  return regain === 'all' || typeof regain === 'number'
    ? { regain, rest: 'short' }
    : { regain: 'none' };
}

/**
 * The charges an item's own data fields say (`charges`, `recharge`,
 * `rechargeAmount`), read as its own `charges` effect would be, with what
 * comes back as `regainOf` says it (`fieldRegainOf`), and the spells they cast
 * (`fieldChargeSpells`). Absent when the count and regain do not read as a
 * whole (a dice count of charges, an amount the roller cannot roll), and when
 * the item's own guidance leaves them out (`ownChargesStand`).
 */
export function fieldChargesOf(entry: DataEntity): ItemCharges | undefined {
  const known = fromFields.get(entry);
  if (known !== undefined) return known ?? undefined;
  const counted =
    entry.charges === undefined || ownChargesStand(entry.castGuidance)
      ? undefined
      : readItemCharges({ charges: entry.charges, ...fieldRegainOf(entry), spells: [] });
  const read =
    counted === undefined
      ? undefined
      : { ...counted, spells: fieldChargeSpells(entry.attachedSpells, counted.charges) };
  fromFields.set(entry, read ?? null);
  return read;
}

/** A spell level an `attachedSpells` name says it casts at (`fireball#5`, `cure wounds|xphb#9`). */
const CAST_AT = /#([1-9])(?![\d])/;

/**
 * The spells an item's `attachedSpells.charges` casts, each read on its own, so
 * one the effect could not take is left out alone and the item keeps the rest
 * and its pool: a cost of 1 to the item's charges (a cost of 0 is at will, so
 * granted as one, `attachedInnate`), a name and its book when it names one
 * (none is found in the character's rules version), and `#N` as the one level
 * it casts at (`at`). A name the list repeats keeps its first cost; past
 * `RULE_SET_LIMITS.chargeSpells`, the rest are left out.
 */
export function fieldChargeSpells(attached: unknown, charges: number): ChargeSpell[] {
  if (!isRecord(attached) || !isRecord(attached.charges)) return [];
  const out: ChargeSpell[] = [];
  for (const [key, names] of Object.entries(attached.charges)) {
    const cost = Number(key);
    if (!Number.isInteger(cost) || cost < 1 || cost > charges || !Array.isArray(names)) continue;
    for (const written of names) {
      if (typeof written !== 'string' || out.length >= RULE_SET_LIMITS.chargeSpells) continue;
      const { name, source } = parseSpellRef(written);
      const spell = name.toLowerCase();
      if (spell === '' || out.some((s) => s.spell === spell)) continue;
      const level = CAST_AT.exec(written)?.[1];
      out.push({
        spell,
        cost,
        ...(level === undefined ? {} : { at: Number(level) }),
        ref: { name: spell, source: source.toLowerCase() },
      });
    }
  }
  return out;
}

/** The fields the Workshop wrote on its older pool card. */
const OLDER_POOL_FIELDS: ReadonlySet<string> = new Set(['kind', 'key', 'label', 'max', 'reset']);
/** The fields the Workshop wrote on a Cast a spell card that spent the older pool. */
const OLDER_GRANT_FIELDS: ReadonlySet<string> = new Set([
  'kind',
  'spell',
  'ability',
  'usage',
  'resourceKey',
]);

const onlyFields = (o: Record<string, unknown>, fields: ReadonlySet<string>): boolean =>
  Object.keys(o).every((k) => fields.has(k));

/**
 * Where an item's action names its charges (`ITEM_CHARGES`) and the sheet
 * moves it to the carried copy's pool: its cost, a slot turned into them, the
 * use a buy-back restores, a regain. As `[part, field]`. The Workshop offers
 * them there as its charges (`PriceFields`); a spell card's or a buy-back's
 * price under that key it offers as a Uses card of the item's own, so the
 * sheet leaves those as written.
 */
export const ACTION_CHARGE_PLACES: ReadonlyArray<readonly [string, string]> = [
  ['cost', 'resource'],
  ['cost', 'slotRefills'],
  ['buyBack', 'own'],
  ['regains', 'resource'],
];

/**
 * Whether a value may name a pool among `names`, at any depth: words that are
 * one as the sheet finds a pool (ends trimmed, and in any case, as a moment
 * finds one by key or name), or that a pick's answer fills in (`{pick}`).
 */
function namesPool(v: unknown, names: ReadonlySet<string>): boolean {
  if (typeof v === 'string') return names.has(v.trim().toLowerCase()) || v.includes('{pick');
  if (Array.isArray(v)) return v.some((x) => namesPool(x, names));
  return isRecord(v) && Object.values(v).some((x) => namesPool(x, names));
}

/** An effect less the places an action's charges move from (`ACTION_CHARGE_PLACES`), read trimmed. */
function movedOut(e: Record<string, unknown>): Record<string, unknown> {
  if (e.kind !== 'action') return e;
  const out: Record<string, unknown> = { ...e };
  for (const [part, field] of ACTION_CHARGE_PLACES) {
    const at = out[part];
    if (isRecord(at) && typeof at[field] === 'string' && at[field].trim() === ITEM_CHARGES) {
      const { [field]: _moved, ...rest } = at;
      out[part] = rest;
    }
  }
  return out;
}

/** Every action in a value, at any depth (a pick's options give theirs). */
function actionsIn(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.flatMap(actionsIn);
  if (!isRecord(v)) return [];
  const inner = Object.values(v).flatMap(actionsIn);
  return v.kind === 'action' ? [v, ...inner] : inner;
}

/** Each item's `upgradeOlderCharges`, made once. */
const upgraded = new WeakMap<DataEntity, DataEntity>();

/**
 * An item the Workshop wrote before its Charges section counted them: a pool
 * card keyed `charges`, all back on a long rest, and Cast a spell cards that
 * each spend one of it. It reads as the `charges` effect the section writes
 * now, in the card's place: each card's spell at a cost of one, cast at its
 * own level, with the cards' ability. What comes back is what its recharge
 * fields say when they name a time a long rest covers, else all of them, as
 * the card gave. The item's actions spend the new pool as they spent the card
 * (the item call site re-keys them).
 *
 * Only an item that converts without loss: one card, as the Workshop wrote it
 * (a long rest, the item's own count); spell cards as the Workshop wrote them,
 * agreeing on one ability; no other effect, and nothing outside the effects,
 * naming the pool by its key or the card's name (an action only where the
 * sheet moves it, never paying a buy-back), nor filled in by a pick; no action
 * named by level; no recharge the effect cannot say (a short rest,
 * `special`); and an effect that reads (each card's spell as a spell's name
 * and book). Any other item is itself, keeping its older pool, which its
 * fields stand aside for (`ownChargesStand`). The item given is never changed,
 * and one item gives one answer.
 */
export function upgradeOlderCharges(entry: DataEntity): DataEntity {
  const known = upgraded.get(entry);
  if (known !== undefined) return known;
  const made = olderChargesUpgrade(entry) ?? entry;
  upgraded.set(entry, made);
  return made;
}

function olderChargesUpgrade(entry: DataEntity): DataEntity | undefined {
  const g = entry.castGuidance;
  if (!isRecord(g) || !Array.isArray(g.effects)) return undefined;
  const effects = (g.effects as unknown[]).filter(isRecord);
  if (effects.length !== g.effects.length) return undefined;
  const pools = effects.filter((e) => e.kind === 'resource' && e.key === ITEM_CHARGES);
  const [pool] = pools;
  if (pool === undefined || pools.length > 1) return undefined;
  if (!onlyFields(pool, OLDER_POOL_FIELDS) || pool.reset !== 'long') return undefined;
  const charges = entry.charges ?? pool.max;
  if (charges !== pool.max) return undefined;
  const spends = (e: Record<string, unknown>) =>
    e.kind === 'grantSpell' && e.resourceKey === ITEM_CHARGES;
  const grants = effects.filter(spends);
  if (grants.some((e) => !onlyFields(e, OLDER_GRANT_FIELDS))) return undefined;
  const abilities = new Set(grants.map((e) => e.ability));
  if (abilities.size > 1) return undefined;
  const [ability] = abilities;
  // Nothing else may name the pool, by its key or the card's name, which the
  // new one does not stand in for: a `charges` effect already there names it
  // by its kind, a use with no price spends the pool sharing its name, and a
  // moment finds one by key or name. Nor the new pool by its name ("<item>
  // charges", as `collectItems` names it), which nothing found before. An
  // action may where the sheet moves it to the new pool (`movedOut`). Nor may
  // an action be named by level, in words no check here reads.
  if (typeof pool.label !== 'string' || typeof entry.name !== 'string') return undefined;
  const names = new Set([
    ITEM_CHARGES,
    pool.label.trim().toLowerCase(),
    `${entry.name} charges`.trim().toLowerCase(),
  ]);
  const { effects: _effects, ...outside } = g;
  const others = effects.filter((e) => e !== pool && !spends(e)).map(movedOut);
  if (others.some((e) => namesPool(e, names)) || namesPool(outside, names)) return undefined;
  if (actionsIn(effects).some((e) => typeof e.label !== 'string')) return undefined;
  const recharge = typeof entry.recharge === 'string' ? entry.recharge : '';
  if (recharge !== '' && !LONG_REST_RECHARGE.has(recharge.toLowerCase())) return undefined;
  const effect = {
    kind: 'charges',
    charges,
    regain: recharge === '' ? 'all' : regainOf(recharge, entry.rechargeAmount),
    ...(typeof ability === 'string' ? { ability } : {}),
    ...(grants.length > 0 ? { spells: grants.map((e) => ({ spell: e.spell, cost: 1 })) } : {}),
  };
  const read = readOwnEffects([effect], 'effects');
  if (read.problems.length > 0 || read.charges === undefined) return undefined;
  const now = effects.flatMap((e) => (e === pool ? [effect] : spends(e) ? [] : [e]));
  return { ...entry, castGuidance: { ...g, effects: now } };
}

/**
 * The charges a carried item holds: the last of its own fields
 * (`fieldChargesOf`), its built-in row, its own `charges` effect and the packs
 * applied to the character (`packChargesOf`) that says them. A pack that
 * replaces the item's effects replaces its own charges and its fields too, as
 * it does everything the item inherits, and the item's own guidance can leave
 * the fields out (`fieldChargesOf`); the row stands outside both, so only a
 * pack's charges or the item's own come before it. A pack's or the item's own
 * effect says the DC its spells cast with; the row's and the fields' take the
 * item's `itemDc` row's (or, for a Workshop copy, the row of the item it
 * copies: `itemRowKeys`).
 */
export function itemChargesOf(
  lookup: ChargeLookup,
  characterId: string,
  ref: EntityRef,
): ItemCharges | undefined {
  return itemChargesFrom(lookup, characterId, ref)?.charges;
}

/** Where `itemChargesOf` found an item's charges: a pack's effect, its own, its built-in row, its fields. */
export type ChargesFrom = 'pack' | 'own' | 'row' | 'fields';

/** `itemChargesOf`, and where it found them (`ChargesFrom`). */
export function itemChargesFrom(
  lookup: ChargeLookup,
  characterId: string,
  ref: EntityRef,
): { charges: ItemCharges; from: ChargesFrom } | undefined {
  const uid = refUid(ref);
  const packs = packChargesOf(lookup.byType(RULE_PACK_TYPE), characterId, uid);
  if (packs.charges !== undefined) return { charges: packs.charges, from: 'pack' };
  const entry = packs.replaced ? undefined : lookupItem({ ctx: lookup }, ref.name, ref.source);
  const raw = entry === undefined ? undefined : entry.castGuidance;
  const mine = raw === undefined ? undefined : readMechanics(raw);
  if (mine?.readable === true && mine.charges !== undefined) {
    return { charges: mine.charges, from: 'own' };
  }
  const sets = lookup.byType(RULE_SET_TYPE);
  const row = itemChargesIn(sets, ref);
  const held = row ?? (entry === undefined ? undefined : fieldChargesOf(entry));
  if (held === undefined) return undefined;
  const fixed = itemDcIn(sets, ref, entry);
  return {
    charges: fixed === undefined ? held : { ...held, ...fixed },
    from: row === undefined ? 'fields' : 'row',
  };
}

/**
 * The roll a long rest makes for an item's charges (`DerivedResource.regainRoll`):
 * none when all of them come back, as any pool's do, and `0` when none ever do.
 * Charges back on a short rest (`rest`) all come back on a long one too.
 */
export function regainRollOf(c: ItemCharges): string | undefined {
  if (c.regain === 'none') return '0';
  return c.regain === 'all' || c.rest === 'short' ? undefined : c.regain;
}

/**
 * When a carried item's charge pool comes back, as the rests read a pool
 * (`engine/rest.ts`): at dawn, a long rest, by its roll (`regainRollOf`); on a
 * short rest all of them (`resetOn: 'short'`, a long rest too), or a number
 * (`regainOnShort`, and all of them on a long rest). The live pool and an idle
 * one (`idleChargePools`) are each made by it, so the two say the same.
 */
export function chargePoolRest(
  c: ItemCharges,
): Pick<DerivedResource, 'resetOn' | 'regainOnShort' | 'regainRoll'> {
  const roll = regainRollOf(c);
  if (c.rest === 'short' && c.regain === 'all') return { resetOn: 'short' };
  if (c.rest === 'short' && /^\d+$/.test(c.regain)) {
    return { resetOn: 'long', regainOnShort: Number(c.regain) };
  }
  return { resetOn: 'long', ...(roll === undefined ? {} : { regainRoll: roll }) };
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
 * at dawn, so a long rest gives back their roll too, and all of those a short
 * rest gives back (`chargePoolRest`). A short rest reads the sheet's pools
 * alone, so an idle one's come back at the next long rest.
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
    return [
      {
        key,
        label: `${entry.ref.name} charges`,
        max: held.charges,
        origin: entry.ref.name,
        ...chargePoolRest(held),
      },
    ];
  });
}

/**
 * What casting `spellName` from an item of this row costs at each level it
 * can, from the spell's own level up, while the cost fits in the item's
 * charges; or at the one level it casts at (`at`), never below the spell's
 * own. Empty when the item does not cast that spell.
 */
export function chargeCosts(
  row: ItemCharges,
  spellName: string,
  spellLevel: number,
): Array<{ level: number; cost: number }> {
  const spell = row.spells.find((s) => s.spell === spellName.trim().toLowerCase());
  if (spell === undefined) return [];
  if (spell.at !== undefined) {
    return spell.at >= spellLevel && spell.cost <= row.charges
      ? [{ level: spell.at, cost: spell.cost }]
      : [];
  }
  const out: Array<{ level: number; cost: number }> = [];
  const top = Math.min(9, spell.upTo ?? spellLevel);
  for (let level = spellLevel; level <= top; level++) {
    const cost = spell.cost + (level - spellLevel);
    if (cost > row.charges) break;
    out.push({ level, cost });
  }
  return out;
}
