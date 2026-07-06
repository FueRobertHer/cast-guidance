/**
 * Tolerant parser for class/background `startingEquipment`. Bundles the
 * wizard can grant; anything unparseable becomes a labeled note item —
 * never blocks character creation.
 */
import type { DataEntity, EquipmentEntry } from '@/engine/types';

export interface ParsedBundleItem {
  label: string;
  /** Resolvable "name|source" item uid, when the entry names a concrete item. */
  uid?: string;
  quantity: number;
}

export interface EquipmentBundle {
  key: string;
  label: string;
  items: ParsedBundleItem[];
}

function parseItemEntry(entry: unknown): ParsedBundleItem | undefined {
  if (typeof entry === 'string') {
    const [name] = entry.split('|');
    return { label: name ?? entry, uid: entry.toLowerCase(), quantity: 1 };
  }
  if (typeof entry !== 'object' || entry === null) return undefined;
  const e = entry as DataEntity;
  if (typeof e.item === 'string') {
    const [name] = e.item.split('|');
    return {
      label: `${name}${typeof e.quantity === 'number' && e.quantity > 1 ? ` ×${e.quantity}` : ''}`,
      uid: e.item.toLowerCase(),
      quantity: typeof e.quantity === 'number' ? e.quantity : 1,
    };
  }
  if (typeof e.special === 'string') {
    return { label: e.special, quantity: typeof e.quantity === 'number' ? e.quantity : 1 };
  }
  if (typeof e.equipmentType === 'string') {
    const labels: Record<string, string> = {
      weaponSimple: 'any simple weapon',
      weaponSimpleMelee: 'any simple melee weapon',
      weaponMartial: 'any martial weapon',
      weaponMartialMelee: 'any martial melee weapon',
      instrumentMusical: 'a musical instrument',
      armorLight: 'any light armor',
      setGaming: 'a gaming set',
      toolArtisan: "artisan's tools",
    };
    return {
      label: labels[e.equipmentType] ?? e.equipmentType,
      quantity: typeof e.quantity === 'number' ? e.quantity : 1,
    };
  }
  if (typeof e.value === 'number') {
    return { label: `${Math.floor(e.value / 100)} gp`, quantity: 1 };
  }
  return undefined;
}

/** defaultData: [{ a: [...], b: [...] }, { _: [...] }] -> selectable bundles. */
export function parseStartingEquipment(entity: DataEntity | undefined): EquipmentBundle[][] {
  const se = entity?.startingEquipment as DataEntity | undefined;
  const defaultData = se?.defaultData;
  if (!Array.isArray(defaultData)) return [];
  const groups: EquipmentBundle[][] = [];
  defaultData.forEach((group, gi) => {
    if (typeof group !== 'object' || group === null) return;
    const bundles: EquipmentBundle[] = [];
    for (const [key, list] of Object.entries(group as DataEntity)) {
      if (!Array.isArray(list)) continue;
      const items = list.map(parseItemEntry).filter((i): i is ParsedBundleItem => i !== undefined);
      if (items.length === 0) continue;
      bundles.push({
        key: `${gi}:${key}`,
        label:
          key === '_'
            ? items.map((i) => i.label).join(', ')
            : `(${key.toUpperCase()}) ${items.map((i) => i.label).join(', ')}`,
        items,
      });
    }
    if (bundles.length > 0) groups.push(bundles);
  });
  return groups;
}

export function bundleToEquipment(bundle: EquipmentBundle): EquipmentEntry[] {
  return bundle.items.map((item) => {
    if (item.uid !== undefined) {
      const [name, source] = item.uid.split('|');
      return {
        id: crypto.randomUUID(),
        ref: { name: name ?? item.label, source: source ?? '' },
        qty: item.quantity,
        equipped: false,
        attuned: false,
      };
    }
    return {
      id: crypto.randomUUID(),
      custom: { name: item.label, note: 'from starting equipment' },
      qty: item.quantity,
      equipped: false,
      attuned: false,
    };
  });
}

/** Raw `default` strings — the human-readable fallback list. */
export function defaultStrings(entity: DataEntity | undefined): string[] {
  const se = entity?.startingEquipment as DataEntity | undefined;
  const d = se?.default;
  return Array.isArray(d) ? d.filter((s): s is string => typeof s === 'string') : [];
}
