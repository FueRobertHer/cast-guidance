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
  /** Open slot ("any martial weapon") the player fills with a concrete item. */
  equipmentType?: string;
  /** Value in copper for a "gold instead of gear" entry — becomes currency. */
  goldCp?: number;
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
      equipmentType: e.equipmentType,
      quantity: typeof e.quantity === 'number' ? e.quantity : 1,
    };
  }
  if (typeof e.value === 'number') {
    return { label: `${Math.floor(e.value / 100)} gp`, goldCp: e.value, quantity: 1 };
  }
  return undefined;
}

/** Total copper of the "gold instead of gear" entries in a bundle. */
export function bundleGoldCp(bundle: EquipmentBundle): number {
  return bundle.items.reduce((sum, i) => sum + (i.goldCp ?? 0), 0);
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

/**
 * Materialize a bundle. `slotPicks` maps an item's index within the bundle to
 * the concrete "name|source" uid the player chose for an equipmentType slot;
 * unfilled slots become labeled note items so nothing silently disappears.
 */
export function bundleToEquipment(
  bundle: EquipmentBundle,
  slotPicks: Record<number, string> = {},
): EquipmentEntry[] {
  return bundle.items.flatMap((item, idx) => {
    // Gold entries become spendable currency (handled by the caller), not items.
    if (item.goldCp !== undefined) return [];
    const uid = item.uid ?? (item.equipmentType !== undefined ? slotPicks[idx] : undefined);
    if (uid !== undefined) {
      const [name, source] = uid.split('|');
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

/**
 * Concrete items that satisfy an `equipmentType` slot, drawn from baseitems
 * (weapons/armor) or items (instruments, tools, gaming sets).
 */
export function itemsForEquipmentType(
  type: string,
  baseitems: readonly DataEntity[],
  items: readonly DataEntity[],
): DataEntity[] {
  const typeCode = (e: DataEntity) => String(e.type ?? '').split('|')[0];
  const isWeapon = (e: DataEntity) => e.weaponCategory !== undefined;
  const category = (e: DataEntity) =>
    String(e.weaponCategory ?? '')
      .split('|')[0]
      ?.toLowerCase();
  const melee = (e: DataEntity) => typeCode(e) === 'M';
  const byType = (code: string) => (e: DataEntity) => typeCode(e) === code;
  const filters: Record<string, (e: DataEntity) => boolean> = {
    weaponSimple: (e) => isWeapon(e) && category(e) === 'simple',
    weaponSimpleMelee: (e) => isWeapon(e) && category(e) === 'simple' && melee(e),
    weaponMartial: (e) => isWeapon(e) && category(e) === 'martial',
    weaponMartialMelee: (e) => isWeapon(e) && category(e) === 'martial' && melee(e),
    armorLight: byType('LA'),
    instrumentMusical: byType('INS'),
    setGaming: byType('GS'),
    toolArtisan: byType('AT'),
  };
  const filter = filters[type];
  if (filter === undefined) return [];
  const pool =
    type.startsWith('weapon') || type === 'armorLight' ? baseitems : [...baseitems, ...items];
  // Core printings only — starting gear means longswords, not laser rifles.
  const coreSources = new Set(['phb', 'xphb']);
  const seen = new Set<string>();
  return pool.filter((e) => {
    if (!coreSources.has(String(e.source ?? '').toLowerCase())) return false;
    if (!filter(e)) return false;
    const key = String(e.name ?? '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Raw `default` strings — the human-readable fallback list. */
export function defaultStrings(entity: DataEntity | undefined): string[] {
  const se = entity?.startingEquipment as DataEntity | undefined;
  const d = se?.default;
  return Array.isArray(d) ? d.filter((s): s is string => typeof s === 'string') : [];
}
