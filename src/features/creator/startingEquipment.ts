/**
 * Tolerant parser for class/background `startingEquipment`. Bundles the
 * wizard can grant; anything unparseable becomes a labeled note item —
 * never blocks character creation.
 */
import { pickForVersion, type RulesVersion } from '@/data5e/rulesVersion';
import type { DataEntity, EquipmentEntry } from '@/engine/types';

export interface ParsedBundleItem {
  label: string;
  /** What a gear item with no entry to name it is called in the inventory: the label with no count. */
  name?: string;
  /** Resolvable "name|source" item uid, when the entry names a concrete item. */
  uid?: string;
  /** Open slot ("any martial weapon") the player fills with a concrete item. */
  equipmentType?: string;
  /** Value in copper for a "gold instead of gear" entry — becomes currency. */
  goldCp?: number;
  /** Copper held in the item (a pouch with 15 gp), which becomes currency beside it. */
  containsCp?: number;
  quantity: number;
}

export interface EquipmentBundle {
  key: string;
  label: string;
  items: ParsedBundleItem[];
}

/** Copper as coins: 1500 is "15 gp", 10 is "1 sp", 1550 is "15 gp 5 sp". */
export function coinLabel(cp: number): string {
  const coins = [
    [Math.floor(cp / 100), 'gp'],
    [Math.floor((cp % 100) / 10), 'sp'],
    [cp % 10, 'cp'],
  ] as const;
  const shown = coins.filter(([n]) => n > 0).map(([n, coin]) => `${n} ${coin}`);
  return shown.length > 0 ? shown.join(' ') : '0 gp';
}

/** "×5", unless the background's own name for it already says how many ("Parchment (4 sheets)"). */
const count = (e: DataEntity) =>
  typeof e.quantity === 'number' &&
  e.quantity > 1 &&
  !(typeof e.displayName === 'string' && /\d/.test(e.displayName))
    ? ` ×${e.quantity}`
    : '';

/** The coins an item or a purse holds (`containsValue`), said after it: " with 15 gp". */
const held = (e: DataEntity) =>
  typeof e.containsValue === 'number'
    ? { words: ` with ${coinLabel(e.containsValue)}`, cp: { containsCp: e.containsValue } }
    : { words: '', cp: {} };

function parseItemEntry(entry: unknown): ParsedBundleItem | undefined {
  if (typeof entry === 'string') {
    const [name] = entry.split('|');
    return { label: name ?? entry, uid: entry.toLowerCase(), quantity: 1 };
  }
  if (typeof entry !== 'object' || entry === null) return undefined;
  const e = entry as DataEntity;
  if (typeof e.item === 'string') {
    const [name] = e.item.split('|');
    // The background's own words for it ("prayer book" for a book), and what it holds.
    const called = typeof e.displayName === 'string' ? e.displayName : name;
    const holds = held(e);
    return {
      label: `${called}${count(e)}${holds.words}`,
      uid: e.item.toLowerCase(),
      quantity: typeof e.quantity === 'number' ? e.quantity : 1,
      ...holds.cp,
    };
  }
  if (typeof e.special === 'string') {
    const worth = typeof e.worthValue === 'number' ? ` worth ${coinLabel(e.worthValue)}` : '';
    const name = `${e.special}${worth}`;
    // A purse with coins in it names no item, so it is gear by its words.
    const holds = held(e);
    return {
      label: `${name}${count(e)}${holds.words}`,
      name,
      quantity: typeof e.quantity === 'number' ? e.quantity : 1,
      ...holds.cp,
    };
  }
  // One slot of a type, or of any of several ("a musical instrument or artisan's
  // tools", as `equipmentTypes`), kept as the types joined by "|".
  const types =
    typeof e.equipmentType === 'string'
      ? [e.equipmentType]
      : Array.isArray(e.equipmentTypes)
        ? e.equipmentTypes.filter((t): t is string => typeof t === 'string')
        : [];
  if (types.length > 0) {
    const labels: Record<string, string> = {
      weaponSimple: 'any simple weapon',
      weaponSimpleMelee: 'any simple melee weapon',
      weaponMartial: 'any martial weapon',
      weaponMartialMelee: 'any martial melee weapon',
      instrumentMusical: 'a musical instrument',
      armorLight: 'any light armor',
      setGaming: 'a gaming set',
      toolArtisan: "artisan's tools",
      focusSpellcastingArcane: 'an arcane focus',
      focusSpellcastingDruidic: 'a druidic focus',
      focusSpellcastingHoly: 'a holy symbol',
    };
    return {
      // The background's words for the slot ("Gaming Set (same as above)") where it has them.
      label:
        typeof e.displayName === 'string'
          ? e.displayName
          : types.map((t) => labels[t] ?? t).join(' or '),
      equipmentType: types.join('|'),
      quantity: typeof e.quantity === 'number' ? e.quantity : 1,
    };
  }
  if (typeof e.value === 'number') {
    return { label: coinLabel(e.value), goldCp: e.value, quantity: 1 };
  }
  return undefined;
}

/** Total copper of a bundle's coins: "gold instead of gear" and what its items hold. */
export function bundleGoldCp(bundle: EquipmentBundle): number {
  return bundle.items.reduce((sum, i) => sum + (i.goldCp ?? 0) + (i.containsCp ?? 0), 0);
}

/**
 * Groups of bundles, one bundle to pick per group: [{ a: [...], b: [...] }, { _: [...] }].
 * A class keeps them under `defaultData`, beside the `default` words; a background's
 * `startingEquipment` is the list itself.
 */
export function parseStartingEquipment(entity: DataEntity | undefined): EquipmentBundle[][] {
  const se: unknown = entity?.startingEquipment;
  const defaultData = Array.isArray(se) ? se : (se as DataEntity | undefined)?.defaultData;
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
      custom: { name: item.name ?? item.label, note: 'from starting equipment' },
      qty: item.quantity,
      equipped: false,
      attuned: false,
    };
  });
}

/**
 * Concrete items that satisfy an `equipmentType` slot, drawn from baseitems
 * (weapons/armor) or items (instruments, tools, gaming sets), one per name in
 * the printing for the character's rules version. The PHB and XPHB print most
 * of the same gear, but only the 2024 weapons carry a mastery property, so a
 * 2024 character handed the first printing in the data got a Longsword with
 * none. A name printed only in the other book is still offered.
 */
export function itemsForEquipmentType(
  type: string,
  baseitems: readonly DataEntity[],
  items: readonly DataEntity[],
  version: RulesVersion,
): DataEntity[] {
  const typeCode = (e: DataEntity) => String(e.type ?? '').split('|')[0];
  const isWeapon = (e: DataEntity) => e.weaponCategory !== undefined;
  const category = (e: DataEntity) =>
    String(e.weaponCategory ?? '')
      .split('|')[0]
      ?.toLowerCase();
  const melee = (e: DataEntity) => typeCode(e) === 'M';
  const byType = (code: string) => (e: DataEntity) => typeCode(e) === code;
  const focus = (kind: string) => (e: DataEntity) => typeCode(e) === 'SCF' && e.scfType === kind;
  const filters: Record<string, (e: DataEntity) => boolean> = {
    weaponSimple: (e) => isWeapon(e) && category(e) === 'simple',
    weaponSimpleMelee: (e) => isWeapon(e) && category(e) === 'simple' && melee(e),
    weaponMartial: (e) => isWeapon(e) && category(e) === 'martial',
    weaponMartialMelee: (e) => isWeapon(e) && category(e) === 'martial' && melee(e),
    armorLight: byType('LA'),
    instrumentMusical: byType('INS'),
    setGaming: byType('GS'),
    toolArtisan: byType('AT'),
    // A spellcasting focus of its kind: an orb, a sprig of mistletoe, an amulet.
    focusSpellcastingArcane: focus('arcane'),
    focusSpellcastingDruidic: focus('druid'),
    focusSpellcastingHoly: focus('holy'),
  };
  // A slot of several types ("instrumentMusical|toolArtisan") takes any of them.
  const kinds = type.split('|');
  const known = kinds.flatMap((k) => (filters[k] === undefined ? [] : [filters[k]]));
  if (known.length === 0) return [];
  const filter = (e: DataEntity) => known.some((f) => f(e));
  const pool = kinds.every((k) => k.startsWith('weapon') || k === 'armorLight')
    ? baseitems
    : [...baseitems, ...items];
  // Core printings only — starting gear means longswords, not laser rifles.
  const coreSources = new Set(['phb', 'xphb']);
  const printings = new Map<string, DataEntity[]>();
  for (const e of pool) {
    if (!coreSources.has(String(e.source ?? '').toLowerCase())) continue;
    if (!filter(e)) continue;
    const key = String(e.name ?? '').toLowerCase();
    printings.set(key, [...(printings.get(key) ?? []), e]);
  }
  return [...printings.values()].flatMap((list) => {
    const picked = pickForVersion(list, version);
    return picked === undefined ? [] : [picked];
  });
}

/** Raw `default` strings — the human-readable fallback list. */
export function defaultStrings(entity: DataEntity | undefined): string[] {
  const se = entity?.startingEquipment as DataEntity | undefined;
  const d = se?.default;
  return Array.isArray(d) ? d.filter((s): s is string => typeof s === 'string') : [];
}
