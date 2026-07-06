import type { DataEntity, EffectOrigin } from '../types';
import { refUid } from '../types';
import { type Collector, str } from './base';

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

export function lookupItem(col: Collector, name: string, source?: string): DataEntity | undefined {
  return (
    col.ctx.get('item', name, source) ??
    col.ctx.get('baseitem', name, source) ??
    col.ctx.get('itemGroup', name, source)
  );
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
    // Rings/cloaks of protection etc: bonusAc on a non-armor non-shield item.
    const bonusAc = parseBonus(e.bonusAc);
    if (bonusAc !== 0 && !isArmor(e) && !isShield(e)) {
      col.add({ kind: 'acBonus', amount: bonusAc, origin });
    }
  }
}
