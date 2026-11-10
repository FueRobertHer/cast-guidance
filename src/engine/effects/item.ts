import { ITEM_TAG_FIXES } from '../curated/itemTags';
import type { DataEntity, EffectOrigin } from '../types';
import { refUid } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { type Collector, str } from './base';
import { mechanicsOf } from './mechanics';

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
 * (`magicWorks`), from its data tags as `ITEM_TAG_FIXES` corrects them. A
 * potion's last a while once it is drunk, so it gives none while carried.
 */
function readWornTags(col: Collector, e: DataEntity, origin: EffectOrigin): void {
  if (itemTypeCode(e) === 'P') return;
  const fix = ITEM_TAG_FIXES[refUid({ name: str(e.name) ?? '', source: str(e.source) ?? '' })];
  for (const kind of ['resist', 'immune', 'vulnerable'] as const) {
    for (const damageType of strings(fix?.[kind] ?? e[kind])) {
      col.add({ kind, damageType, origin });
    }
  }
  for (const condition of strings(fix?.conditionImmune ?? e.conditionImmune)) {
    col.add({ kind: 'conditionImmune', condition, origin });
  }
  const save = fix?.save !== undefined ? fix.save : { amount: parseBonus(e.bonusSavingThrow) };
  if (save !== null && save.amount !== 0) {
    col.add({
      kind: 'saveBonus',
      amount: save.amount,
      ...(save.abilities !== undefined ? { abilities: [...save.abilities] } : {}),
      origin,
    });
  }
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
    }

    // Spells the item grants: a wand's cantrip, a cloak's daily misty step.
    // Same 5etools shape races and feats use, so an imported magic item and a
    // homebrew one both arrive here already speaking it. Equipping is what
    // turns it on: an item's bonuses and defenses wait on attunement
    // (`magicWorks`), and its spells do not.
    collectAdditionalSpells(col, e.additionalSpells, origin);
  }
}
