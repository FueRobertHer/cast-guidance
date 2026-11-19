import { WORN_TAG_KINDS } from '../castGuidance';
import { ITEM_CHARGES, itemChargeKey, itemChargesOf, regainRollOf } from '../curated/itemCharges';
import type { DataEntity, EffectOrigin } from '../types';
import { refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { type Collector, str } from './base';
import { builtInRowsFor, emitRuleRows, mechanicsOf, type RuleRow } from './mechanics';

export function itemTypeCode(e: DataEntity): string | undefined {
  const t = str(e.type);
  return t?.split('|')[0];
}

export const ARMOR_TYPES = new Set(['LA', 'MA', 'HA']);

export function isArmor(e: DataEntity): boolean {
  const t = itemTypeCode(e);
  return t !== undefined && ARMOR_TYPES.has(t);
}

export function isShield(e: DataEntity): boolean {
  return itemTypeCode(e) === 'S';
}

export function parseBonus(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v.replace('+', ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function lookupItem(
  col: Pick<Collector, 'ctx'>,
  name: string,
  source?: string,
): DataEntity | undefined {
  return (
    col.ctx.get('item', name, source) ??
    col.ctx.get('baseitem', name, source) ??
    col.ctx.get('itemGroup', name, source)
  );
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
 * The defenses and save bonus an equipped item gives, once its magic works
 * (`magicWorks`), from its data tags, kind by kind in `WORN_TAG_KINDS` order.
 * A built-in `wornTags` row under the item's own `name|source` stands in for
 * the kinds it `replaces`, its effects where the tags of that kind would be.
 * A potion's last a while once it is drunk, so it gives none while carried.
 */
function readWornTags(col: Collector, e: DataEntity, origin: EffectOrigin): void {
  if (itemTypeCode(e) === 'P') return;
  const key = refUid({ name: str(e.name) ?? '', source: str(e.source) ?? '' });
  const row = builtInRowsFor(col, 'wornTags', [key])?.[0];
  for (const kind of WORN_TAG_KINDS) {
    if (row?.replaces?.includes(kind) === true) emitKind(col, row, kind, origin);
    else if (kind === 'conditionImmune') {
      for (const condition of strings(e.conditionImmune)) col.add({ kind, condition, origin });
    } else if (kind === 'saveBonus') {
      const amount = parseBonus(e.bonusSavingThrow);
      if (amount !== 0) col.add({ kind, amount, origin });
    } else {
      for (const damageType of strings(e[kind])) col.add({ kind, damageType, origin });
    }
  }
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
    if (magicWorks(e, entry.attuned)) {
      const from = col.effects.length;
      // Its magic fields are what it inherits; its own `castGuidance` adds to
      // them, and a pack's patch can replace them, while the magic works.
      mechanicsOf(col, {
        entry: e,
        label: origin.label,
        origin,
        target: origin.uid,
        inherited: () => {
          // Rings/cloaks of protection etc: bonusAc on a non-armor non-shield item.
          const bonusAc = parseBonus(e.bonusAc);
          if (bonusAc !== 0 && !isArmor(e) && !isShield(e)) {
            col.add({ kind: 'acBonus', amount: bonusAc, origin });
          }
          readWornTags(col, e, origin);
        },
      });
      // Charges that cast spells (a built-in `charges` row, or the item's own
      // or a pack's `charges` effect, under the entry's ref as the cast prompt
      // finds them): a pool of its own, outside what the item inherits, which
      // the cast prompt spends and a long rest (dawn) refills by its roll.
      const charged = itemChargesOf(col.ctx, col.doc.id, entry.ref);
      if (charged !== undefined) {
        const key = itemChargeKey(entry.id);
        // Its actions that spend its charges or give them back (a buy-back, a
        // slot turned into them, a regain) spend or restore this copy's pool.
        // Each is a copy of what the item says (`emit`), and each price a new
        // object, so the next copy's is its own.
        for (let i = from; i < col.effects.length; i++) {
          const x = col.effects[i];
          if (x?.kind !== 'action') continue;
          if (x.cost?.resource === ITEM_CHARGES) x.cost = { ...x.cost, resource: key };
          if (x.cost?.slotRefills === ITEM_CHARGES) x.cost = { ...x.cost, slotRefills: key };
          if (x.buyBack?.own === ITEM_CHARGES) x.buyBack = { ...x.buyBack, own: key };
          if (x.regains?.resource === ITEM_CHARGES) x.regains = { ...x.regains, resource: key };
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
        // The spells its own or a pack's charges cast are granted, each paid
        // from this copy's pool by level. Those name their book (`ref`); a
        // built-in row's name none, as they only price spells the character
        // casts anyway: some of their items cast at a fixed DC, which a grant
        // would not show.
        for (const s of charged.spells) {
          if (s.ref === undefined) continue;
          col.add({
            kind: 'grantSpell',
            spell: s.ref,
            usage: 'charges',
            resourceKey: key,
            ...(charged.ability === undefined ? {} : { ability: charged.ability }),
            origin,
          });
        }
      }
    }

    // Spells the item grants: a wand's cantrip, a cloak's daily misty step.
    // Same 5etools shape races and feats use, so an imported magic item and a
    // homebrew one both arrive here already speaking it. Equipping is what
    // turns it on: an item's bonuses and defenses wait on attunement
    // (`magicWorks`), and its spells do not.
    collectAdditionalSpells(col, e.additionalSpells, origin);
  }
}
