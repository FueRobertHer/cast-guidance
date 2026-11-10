import { describe, expect, it } from 'vitest';
import { chargeCosts, ITEM_CHARGES } from './itemCharges';

const row = (uid: string) => {
  const found = ITEM_CHARGES[uid];
  if (found === undefined) throw new Error(`no row for ${uid}`);
  return found;
};

describe('chargeCosts', () => {
  it('costs a Staff of Healing one charge a level of Cure Wounds, up to 4th', () => {
    expect(chargeCosts(row('staff of healing|xdmg'), 'Cure Wounds', 1)).toEqual([
      { level: 1, cost: 1 },
      { level: 2, cost: 2 },
      { level: 3, cost: 3 },
      { level: 4, cost: 4 },
    ]);
  });

  it('costs its other spells one fixed price, at their own level', () => {
    expect(chargeCosts(row('staff of healing|dmg'), 'lesser restoration', 2)).toEqual([
      { level: 2, cost: 2 },
    ]);
    expect(chargeCosts(row('staff of healing|dmg'), 'Mass Cure Wounds', 5)).toEqual([
      { level: 5, cost: 5 },
    ]);
  });

  it('casts nothing it does not hold', () => {
    expect(chargeCosts(row('staff of healing|dmg'), 'Fireball', 3)).toEqual([]);
  });

  it('lets a 2014 wand spend charges as far as they go, and a 2024 one three at most', () => {
    expect(chargeCosts(row('wand of fireballs|dmg'), 'Fireball', 3).map((c) => c.level)).toEqual([
      3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(chargeCosts(row('wand of fireballs|xdmg'), 'Fireball', 3)).toEqual([
      { level: 3, cost: 1 },
      { level: 4, cost: 2 },
      { level: 5, cost: 3 },
    ]);
    expect(chargeCosts(row('wand of magic missiles|dmg'), 'magic missile', 1)).toHaveLength(7);
    expect(chargeCosts(row('wand of magic missiles|xdmg'), 'magic missile', 1)).toHaveLength(3);
  });

  it('keys every row by a lower-case name and source', () => {
    for (const uid of Object.keys(ITEM_CHARGES)) expect(uid).toBe(uid.toLowerCase());
  });
});
