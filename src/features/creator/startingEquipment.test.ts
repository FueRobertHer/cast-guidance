import { describe, expect, it } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  bundleGoldCp,
  bundleToEquipment,
  coinLabel,
  itemsForEquipmentType,
  parseStartingEquipment,
} from './startingEquipment';

// A 2024-style class: option A is gear (+ a little gold), option B is "gold instead".
const classEntity = {
  startingEquipment: {
    defaultData: [
      {
        a: [{ item: 'longsword|phb' }, { value: 1000 }],
        b: [{ value: 15000 }],
      },
    ],
  },
} as unknown as DataEntity;

describe('startingEquipment — gold alternative', () => {
  const bundles = parseStartingEquipment(classEntity)[0] ?? [];
  const goldBundle = bundles.find((b) => b.label.includes('150 gp'));
  const gearBundle = bundles.find((b) => /longsword/i.test(b.label));

  it('parses gold entries as copper values', () => {
    expect(bundleGoldCp(goldBundle ?? { key: '', label: '', items: [] })).toBe(15000);
    expect(bundleGoldCp(gearBundle ?? { key: '', label: '', items: [] })).toBe(1000);
  });

  it('turns gold entries into currency, not equipment items', () => {
    // Gold-only bundle yields no equipment (it's spendable currency).
    expect(bundleToEquipment(goldBundle ?? { key: '', label: '', items: [] })).toHaveLength(0);
    // Gear bundle keeps the weapon but drops the +10 gp entry.
    expect(bundleToEquipment(gearBundle ?? { key: '', label: '', items: [] })).toHaveLength(1);
  });
});

describe('itemsForEquipmentType', () => {
  // items-base.json lists the PHB printing of each weapon before the XPHB one,
  // and only the XPHB one carries a mastery.
  const baseitems: DataEntity[] = [
    { name: 'Longsword', source: 'PHB', weaponCategory: 'martial', type: 'M' },
    {
      name: 'Longsword',
      source: 'XPHB',
      weaponCategory: 'martial',
      type: 'M|XPHB',
      mastery: ['Sap|XPHB'],
    },
    { name: 'Whip', source: 'PHB', weaponCategory: 'martial', type: 'M' },
    { name: 'Laser Rifle', source: 'DMG', weaponCategory: 'martial', type: 'R' },
  ];
  const uids = (list: DataEntity[]) => list.map((e) => `${String(e.name)}|${String(e.source)}`);

  it("offers each weapon in the printing for the character's rules", () => {
    expect(uids(itemsForEquipmentType('weaponMartial', baseitems, [], '2024'))).toEqual([
      'Longsword|XPHB',
      // Printed only in the 2014 book, so that one.
      'Whip|PHB',
    ]);
    expect(uids(itemsForEquipmentType('weaponMartial', baseitems, [], '2014'))).toEqual([
      'Longsword|PHB',
      'Whip|PHB',
    ]);
  });
});

describe('itemsForEquipmentType, a slot of several types', () => {
  const items: DataEntity[] = [
    { name: 'Lute', source: 'XPHB', type: 'INS|XPHB' },
    { name: "Smith's Tools", source: 'XPHB', type: 'AT|XPHB' },
    { name: 'Dice Set', source: 'XPHB', type: 'GS|XPHB' },
  ];
  const names = (list: DataEntity[]) => list.map((e) => String(e.name));

  it('offers an item of any of them, and nothing for types it does not know', () => {
    expect(
      names(itemsForEquipmentType('instrumentMusical|toolArtisan', [], items, '2024')),
    ).toEqual(['Lute', "Smith's Tools"]);
    expect(itemsForEquipmentType('vehicleLand|vehicleWater', [], items, '2024')).toEqual([]);
  });
});

// The 2014 Acolyte as printed: a background's kit is the list of groups itself.
const acolyte = {
  startingEquipment: [
    {
      _: [
        {
          item: 'holy symbol|phb',
          displayName: 'holy symbol (a gift to you when you entered the priesthood)',
        },
        { special: 'sticks of incense', quantity: 5 },
        'common clothes|phb',
        { item: 'pouch|phb', containsValue: 1500 },
      ],
    },
    { a: [{ item: 'book|phb', displayName: 'prayer book' }], b: [{ special: 'prayer wheel' }] },
  ],
} as unknown as DataEntity;

describe('startingEquipment of a background', () => {
  const groups = parseStartingEquipment(acolyte);
  const [kit, book] = groups;

  it('reads the list of groups, in the words the background uses', () => {
    expect(groups.map((g) => g.map((b) => b.label))).toEqual([
      [
        'holy symbol (a gift to you when you entered the priesthood), sticks of incense ×5, common clothes, pouch with 15 gp',
      ],
      ['(A) prayer book', '(B) prayer wheel'],
    ]);
  });

  it('gives the pouch and the coins in it', () => {
    const bundle = kit?.[0] ?? { key: '', label: '', items: [] };
    expect(bundleGoldCp(bundle)).toBe(1500);
    const gear = bundleToEquipment(bundle);
    expect(gear.map((g) => g.ref?.name ?? g.custom?.name)).toEqual([
      'holy symbol',
      'sticks of incense',
      'common clothes',
      'pouch',
    ]);
    expect(gear[1]?.qty).toBe(5);
  });

  it('keeps the item a display name stands for', () => {
    const prayerBook = bundleToEquipment(book?.[0] ?? { key: '', label: '', items: [] });
    expect(prayerBook.map((g) => g.ref)).toEqual([{ name: 'book', source: 'phb' }]);
  });

  it('says what a keepsake is worth, and coins short of a gold piece as they are', () => {
    const traveler = parseStartingEquipment({
      startingEquipment: [
        {
          _: [
            { special: 'small piece of jewelry', worthValue: 1000 },
            { value: 10 },
            { value: 1550 },
          ],
        },
      ],
    } as unknown as DataEntity)[0]?.[0];
    expect(traveler?.label).toBe('small piece of jewelry worth 10 gp, 1 sp, 15 gp 5 sp');
  });

  it('reads a slot of several types, as the 2024 Monk’s kit has', () => {
    const monk = parseStartingEquipment({
      startingEquipment: {
        defaultData: [{ A: [{ equipmentTypes: ['instrumentMusical', 'toolArtisan'] }] }],
      },
    } as unknown as DataEntity)[0]?.[0];
    expect(monk?.label).toBe("(A) a musical instrument or artisan's tools");
    expect(monk?.items[0]?.equipmentType).toBe('instrumentMusical|toolArtisan');
  });
});

describe('itemsForEquipmentType, a spellcasting focus', () => {
  const baseitems: DataEntity[] = [
    { name: 'Orb', source: 'PHB', type: 'SCF', scfType: 'arcane' },
    {
      name: 'Wooden Staff',
      source: 'PHB',
      type: 'SCF',
      scfType: 'druid',
      weaponCategory: 'simple',
    },
  ];
  const items: DataEntity[] = [
    { name: 'Amulet', source: 'PHB', type: 'SCF', scfType: 'holy' },
    { name: 'Sprig of Mistletoe', source: 'PHB', type: 'SCF', scfType: 'druid' },
  ];
  const names = (type: string) =>
    itemsForEquipmentType(type, baseitems, items, '2014').map((e) => String(e.name));

  it('offers the foci of its kind, from the weapons and the gear alike', () => {
    expect(names('focusSpellcastingArcane')).toEqual(['Orb']);
    expect(names('focusSpellcastingDruidic')).toEqual(['Wooden Staff', 'Sprig of Mistletoe']);
    expect(names('focusSpellcastingHoly')).toEqual(['Amulet']);
  });

  it('names the slot for what it is', () => {
    const cleric = parseStartingEquipment({
      startingEquipment: {
        defaultData: [{ _: [{ item: 'shield|phb' }, { equipmentType: 'focusSpellcastingHoly' }] }],
      },
    } as unknown as DataEntity)[0]?.[0];
    expect(cleric?.label).toBe('shield, a holy symbol');
  });
});

describe('coinLabel', () => {
  it('says copper as the coins it makes, and none as no gold', () => {
    expect(coinLabel(1557)).toBe('15 gp 5 sp 7 cp');
    expect(coinLabel(7)).toBe('7 cp');
    expect(coinLabel(0)).toBe('0 gp');
  });
});
