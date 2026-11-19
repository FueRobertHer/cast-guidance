import { isRecord, RULE_SET_TYPE, WORN_TAG_KINDS } from '../castGuidance';
import {
  ACTION_CHARGE_PLACES,
  type ChargesFrom,
  ITEM_CHARGES,
  itemChargeKey,
  itemChargesFrom,
  itemDcIn,
  itemRowKeys,
  regainRollOf,
  upgradeOlderCharges,
} from '../curated/itemCharges';
import type {
  Ability,
  ArmorPenalty,
  ArmorWeight,
  DataEntity,
  EffectInput,
  EffectOrigin,
  EntityRef,
} from '../types';
import { ABILITIES, refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { type Collector, str } from './base';
import {
  builtInRowsFor,
  builtInRuleFor,
  emitRuleRows,
  entryKeys,
  type FixedCast,
  type ItemCharges,
  mechanicsOf,
  type RuleRow,
} from './mechanics';

export function itemTypeCode(e: DataEntity): string | undefined {
  const t = str(e.type);
  return t?.split('|')[0];
}

export const ARMOR_TYPES = new Set(['LA', 'MA', 'HA']);
const ARMOR_WEIGHTS: Readonly<Record<string, ArmorWeight>> = {
  LA: 'light',
  MA: 'medium',
  HA: 'heavy',
};

export function isArmor(e: DataEntity): boolean {
  const t = itemTypeCode(e);
  return t !== undefined && ARMOR_TYPES.has(t);
}

export function isShield(e: DataEntity): boolean {
  return itemTypeCode(e) === 'S';
}

/** Whether an effect spares the wearer of this armor its `penalty` (`armorPenaltyLift`). */
export function armorPenaltyLifted(
  effects: readonly EffectInput[],
  penalty: ArmorPenalty,
  e: DataEntity,
): boolean {
  const weight = ARMOR_WEIGHTS[itemTypeCode(e) ?? ''];
  return effects.some(
    (x) =>
      x.kind === 'armorPenaltyLift' &&
      x.penalty === penalty &&
      (x.armor === undefined || x.armor === weight),
  );
}

/** A weapon: one the data marks so, or of a weapon's type (melee, ranged, firearm ammunition). */
export function isWeapon(e: DataEntity): boolean {
  if (e.weapon === true || e.weaponCategory !== undefined) return true;
  const type = itemTypeCode(e);
  return type === 'M' || type === 'R' || type === 'AF';
}

export function parseBonus(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v.replace('+', ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * The item an equipment entry names, as the engine reads it: one the Workshop
 * wrote before its Charges section counted charges reads as it would write it
 * now (`upgradeOlderCharges`), so every reader of a carried item sees one shape.
 */
export function lookupItem(
  col: Pick<Collector, 'ctx'>,
  name: string,
  source?: string,
): DataEntity | undefined {
  const found =
    col.ctx.get('item', name, source) ??
    col.ctx.get('baseitem', name, source) ??
    col.ctx.get('itemGroup', name, source);
  return found === undefined ? undefined : upgradeOlderCharges(found);
}

/** Whether the item gives nothing until someone attunes to it ("optional" never holds it back). */
export function needsAttunement(e: DataEntity): boolean {
  return e.reqAttune === true || (typeof e.reqAttune === 'string' && e.reqAttune !== 'optional');
}

/**
 * Whether an equipped item's magic works: its bonuses to AC, attacks and saves
 * and its defenses. An item that asks for attunement gives them only once attuned;
 * the armor, shield or weapon underneath works either way.
 */
export function magicWorks(e: DataEntity, attuned: boolean): boolean {
  return attuned || !needsAttunement(e);
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

/**
 * What an equipped item's data tags and bonus fields give, once its magic works
 * (`magicWorks`), kind by kind in `WORN_TAG_KINDS` order: its defenses, its save
 * bonus, and its bonuses to attacks, damage and the spell save DC
 * (`readBonusField`). A built-in `wornTags` row under the item's own
 * `name|source` stands in for the kinds it `replaces`, its effects where the
 * data's of that kind would be. For the bonus kinds, a copy or a converted
 * printing (`entryKeys`) then reads the official item's row: its fields are the
 * official one's, which the row corrects. Its defense tags stay its author's.
 * A potion's last a while once it is drunk, so it gives none while carried.
 * `id` is its equipment entry's.
 */
function readWornTags(col: Collector, e: DataEntity, id: string, origin: EffectOrigin): void {
  if (itemTypeCode(e) === 'P') return;
  const key = refUid({ name: str(e.name) ?? '', source: str(e.source) ?? '' });
  const row = builtInRowsFor(col, 'wornTags', [key])?.[0];
  const official = entryKeys(e, key).slice(1);
  const copied = official.length === 0 ? undefined : builtInRowsFor(col, 'wornTags', official)?.[0];
  for (const kind of WORN_TAG_KINDS) {
    const bonus = kind === 'attackBonus' || kind === 'damageBonus' || kind === 'spellDcBonus';
    const standing =
      row?.replaces?.includes(kind) === true
        ? row
        : bonus && copied?.replaces?.includes(kind) === true
          ? copied
          : undefined;
    if (standing !== undefined) emitKind(col, standing, kind, origin);
    else if (kind === 'conditionImmune') {
      for (const condition of strings(e.conditionImmune)) col.add({ kind, condition, origin });
    } else if (kind === 'saveBonus') {
      const amount = parseBonus(e.bonusSavingThrow);
      if (amount !== 0) col.add({ kind, amount, origin });
    } else if (bonus) {
      readBonusField(col, e, kind, id, origin);
    } else {
      for (const damageType of strings(e[kind])) col.add({ kind, damageType, origin });
    }
  }
}

/** The buckets of an item's `attachedSpells` the sheet grants: at will, a number a day, a number a short rest. */
const ATTACHED_BUCKETS = ['will', 'daily', 'rest'] as const;

/**
 * The spells an item's `attachedSpells` (`attached`) lets its holder cast
 * without its charges, as an `additionalSpells` entry open at every level: its
 * `will`, `daily` and `rest` lists, its charge spells that cost none (at
 * will), and the `ability` it names. Only those: any other list (`limited`,
 * `other`, `ritual`) counts its uses some way the sheet does not, and the
 * charges' spells are the pool's (`fieldChargeSpells`). Absent when it grants
 * none.
 */
export function attachedInnate(attached: unknown): DataEntity | undefined {
  if (!isRecord(attached)) return undefined;
  const innate: Record<string, unknown> = {};
  for (const bucket of ATTACHED_BUCKETS) {
    if (attached[bucket] !== undefined) innate[bucket] = attached[bucket];
  }
  const free = isRecord(attached.charges) ? attached.charges['0'] : undefined;
  if (Array.isArray(free)) {
    innate.will = [...(Array.isArray(innate.will) ? innate.will : []), ...free];
  }
  if (Object.keys(innate).length === 0) return undefined;
  const ability = ABILITIES.find((x) => x === attached.ability);
  return { ...(ability === undefined ? {} : { ability }), innate: { _: innate } };
}

/**
 * Grant what an item casts without its charges (`attachedInnate`), as what
 * the item inherits: a pack's patch that replaces its effects takes them away.
 * Its built-in `itemSpells` row stands in for the data's lists and its charge
 * spells costing none, since it is read from the item's text where they
 * misstate it (the 2024 Staff of Healing's Cure Wounds is no cantrip); the
 * ability the data names still counts. A Workshop copy takes the row of the
 * item it copies (`itemRowKeys`), save where that item has a `charges` row
 * too (whose spells such a row takes out of the lists: the 2024 Staff of
 * Healing's Cure Wounds) and the copy counts its charges by no effect of its
 * own or a pack's (`from`: by its fields, which cast none of them, or not at
 * all). Until the Workshop writes the row out as its effect, the copy keeps
 * its data's lists, so no spell is lost.
 */
function grantAttached(
  col: Collector,
  e: DataEntity,
  ref: EntityRef,
  origin: EffectOrigin,
  from: ChargesFrom | undefined,
): void {
  const data = isRecord(e.attachedSpells) ? e.attachedSpells : {};
  const keys = itemRowKeys(ref, e);
  const copied = keys[1];
  const priced =
    copied !== undefined &&
    from !== 'own' &&
    from !== 'pack' &&
    builtInRuleFor(col, 'charges', [copied]) !== undefined;
  const row = builtInRuleFor(col, 'itemSpells', priced ? keys.slice(0, 1) : keys)?.itemSpells;
  const innate = attachedInnate(row === undefined ? data : { ...row, ability: data.ability });
  if (innate === undefined) return;
  const ability = innate.ability as Ability | undefined;
  collectAdditionalSpells(col, [innate], origin, ability, `attached:${origin.uid}`);
}

/**
 * Give each spell an item grants the DC and attack bonus its text fixes
 * (`fixed`), from effect `from` on: its charges', its lists', its own grants'.
 */
function fixGrants(col: Collector, from: number, fixed: FixedCast | undefined): void {
  if (fixed?.dc === undefined && fixed?.attack === undefined) return;
  for (let i = from; i < col.effects.length; i++) {
    const x = col.effects[i];
    if (x?.kind !== 'grantSpell') continue;
    if (fixed.dc !== undefined) x.dc = fixed.dc;
    if (fixed.attack !== undefined) x.attack = fixed.attack;
  }
}

/**
 * The bonus of one kind an item's fields give: `attackBonus` from
 * `bonusWeaponAttack` (a carried weapon's attacks, or on a weapon its own alone)
 * and `bonusSpellAttack` (spell attacks), `damageBonus` from `bonusWeaponDamage`
 * (as the weapon attack bonus), `spellDcBonus` from `bonusSpellSaveDc`. A
 * weapon's own `bonusWeapon` is the attack row's magic bonus.
 */
function readBonusField(
  col: Collector,
  e: DataEntity,
  kind: 'attackBonus' | 'damageBonus' | 'spellDcBonus',
  id: string,
  origin: EffectOrigin,
): void {
  // "With weapons": a carried weapon's, never an unarmed strike's.
  const weapon = isWeapon(e) ? { weapon: id } : { weaponsOnly: true };
  if (kind === 'attackBonus') {
    const toHit = parseBonus(e.bonusWeaponAttack);
    if (toHit !== 0) col.add({ kind, scope: 'all', amount: toHit, ...weapon, origin });
    const spell = parseBonus(e.bonusSpellAttack);
    if (spell !== 0) col.add({ kind, scope: 'all', attack: 'spell', amount: spell, origin });
  } else if (kind === 'damageBonus') {
    const damage = parseBonus(e.bonusWeaponDamage);
    if (damage !== 0) col.add({ kind, scope: 'all', amount: damage, ...weapon, origin });
  } else {
    const dc = parseBonus(e.bonusSpellSaveDc);
    if (dc !== 0) col.add({ kind, amount: dc, origin });
  }
}

/**
 * What armor's data says it costs its wearer, magic or not: disadvantage on
 * Stealth checks (`stealth`), once the whole build is in, unless something in
 * it lifts that (Medium Armor Master). False says the armor has none (mithral).
 * Its Strength requirement costs speed (`calcWalkSpeed`).
 */
function readArmorDrawbacks(col: Collector, e: DataEntity, origin: EffectOrigin): void {
  if (!isArmor(e) || e.stealth !== true) return;
  col.afterAll.push(() => {
    if (armorPenaltyLifted(col.effects, 'stealth', e)) return;
    col.add({
      kind: 'rollAdvantage',
      mode: 'dis',
      on: { rolls: ['check'], skills: ['Stealth'] },
      origin,
    });
  });
}

/** A `wornTags` row's effects of one kind, in the row's order. */
function emitKind(col: Collector, row: RuleRow, kind: string, origin: EffectOrigin): void {
  const effects = row.effects.filter((t) => t.effect.kind === kind);
  if (effects.length > 0) emitRuleRows(col, [{ ...row, effects }], origin);
}

/** Equipped-item effects that aren't armor/weapon math (handled in calc). */
export function collectItems(col: Collector): void {
  for (const entry of col.doc.equipment) {
    if (!entry.equipped) continue;
    if (entry.custom !== undefined) {
      if (entry.custom.acBonus !== undefined && entry.custom.acBonus !== 0) {
        col.add({
          kind: 'acBonus',
          amount: entry.custom.acBonus,
          origin: { label: entry.custom.name, uid: entry.id, type: 'item' },
        });
      }
      continue;
    }
    if (entry.ref === undefined) continue;
    const e = lookupItem(col, entry.ref.name, entry.ref.source);
    if (e === undefined) {
      col.warn(`Item not found: ${refUid(entry.ref)}`);
      continue;
    }
    const origin: EffectOrigin = {
      label: str(e.name) ?? entry.ref.name,
      uid: refUid(entry.ref),
      type: 'item',
    };
    const ref = entry.ref;
    const from = col.effects.length;
    let charged: ItemCharges | undefined;
    if (magicWorks(e, entry.attuned)) {
      // Its charges (its own charge fields, a built-in `charges` row, or the
      // item's own or a pack's `charges` effect, under the entry's ref as the
      // cast prompt finds them), and where they come from, which its lists
      // need (`grantAttached`).
      const counted = itemChargesFrom(col.ctx, col.doc.id, ref);
      charged = counted?.charges;
      // Its magic fields are what it inherits; its own `castGuidance` adds to
      // them, and a pack's patch can replace them, while the magic works.
      const inherited = () => {
        // Rings/cloaks of protection etc: bonusAc on a non-armor non-shield item.
        const bonusAc = parseBonus(e.bonusAc);
        if (bonusAc !== 0 && !isArmor(e) && !isShield(e)) {
          col.add({ kind: 'acBonus', amount: bonusAc, origin });
        }
        readWornTags(col, e, entry.id, origin);
        grantAttached(col, e, ref, origin, counted?.from);
      };
      // A potion's own effects are what it does once drunk (+ Effect puts them
      // in play, `homebrewLanding`), so carried or equipped it gives only what
      // its data does: neither those, its moments nor a pack's patch for it.
      // Drinking lands its own effects alone (a moment or a patch, none).
      if (itemTypeCode(e) === 'P') inherited();
      else
        mechanicsOf(col, { entry: e, label: origin.label, origin, target: origin.uid, inherited });
      // Its charges are a pool of its own, which the cast prompt and the
      // item's actions spend and a long rest (dawn) refills by its roll.
      if (charged !== undefined) {
        const key = itemChargeKey(entry.id);
        // Its actions that spend its charges or give them back (a buy-back, a
        // slot turned into them, a regain, `ACTION_CHARGE_PLACES`) spend or
        // restore this copy's pool. Each is a copy of what the item says
        // (`emit`), and each part a new object, so the next copy's is its own.
        for (let i = from; i < col.effects.length; i++) {
          const x = col.effects[i];
          if (x?.kind !== 'action') continue;
          const parts = x as unknown as Record<string, Record<string, unknown> | undefined>;
          for (const [part, field] of ACTION_CHARGE_PLACES) {
            const at = parts[part];
            if (at?.[field] === ITEM_CHARGES) parts[part] = { ...at, [field]: key };
          }
        }
        const roll = regainRollOf(charged);
        col.add({
          kind: 'resource',
          key,
          label: `${origin.label} charges`,
          max: charged.charges,
          resetOn: 'long',
          ...(roll === undefined ? {} : { regainRoll: roll }),
          origin,
        });
        // The spells its charges cast are granted, each paid from this copy's
        // pool by level. A built-in row's name no book: the sheet finds each
        // by name in the character's rules version.
        for (const s of charged.spells) {
          col.add({
            kind: 'grantSpell',
            spell: s.ref ?? { name: s.spell, source: '' },
            usage: 'charges',
            resourceKey: key,
            ...(charged.ability === undefined ? {} : { ability: charged.ability }),
            origin,
          });
        }
      }
    }

    readArmorDrawbacks(col, e, origin);

    // Spells the item grants: a wand's cantrip, a cloak's daily misty step.
    // Same 5etools shape races and feats use, so an imported magic item and a
    // homebrew one both arrive here already speaking it. Equipping is what
    // turns it on: an item's bonuses and defenses wait on attunement
    // (`magicWorks`), and its spells do not.
    collectAdditionalSpells(col, e.additionalSpells, origin);
    // Each spell it grants casts at the DC its text fixes: its charges' say it,
    // else its `itemDc` row, or a copy's original's (`itemChargesOf` gives a
    // row's and the fields' it).
    fixGrants(col, from, charged ?? itemDcIn(col.ctx.byType(RULE_SET_TYPE), ref, e));
  }
}
