import { describe, expect, it } from 'vitest';
import type { DataEntity } from '@/engine/types';
import { bundleGoldCp, bundleToEquipment, parseStartingEquipment } from './startingEquipment';

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
