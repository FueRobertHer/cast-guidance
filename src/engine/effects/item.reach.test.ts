/**
 * An equipped item's bonus fields (ADR-002 D7): `bonusWeaponAttack`,
 * `bonusWeaponDamage`, `bonusSpellAttack` and `bonusSpellSaveDc` count once its
 * magic works, and armor's `stealth` disadvantage counts whenever it is worn.
 * The items are invented; the fixture's Longsword and Dagger are the weapons.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';

const BAND: DataEntity = {
  name: 'Band of Aim',
  source: 'HB',
  type: 'RG',
  rarity: 'rare',
  bonusWeaponAttack: '+1',
  bonusWeaponDamage: '+2',
  entries: ['You gain a +1 bonus to attack rolls and a +2 bonus to damage rolls with weapons.'],
};

const KEEN: DataEntity = {
  name: 'Keen Blade',
  source: 'HB',
  type: 'M',
  weapon: true,
  weaponCategory: 'martial',
  dmg1: '1d8',
  dmgType: 'S',
  rarity: 'rare',
  bonusWeaponAttack: '+3',
  entries: ['You have a +3 bonus to attack rolls made with this weapon.'],
};

const ROD: DataEntity = {
  name: 'Rod of Focus',
  source: 'HB',
  type: 'RD',
  rarity: 'rare',
  reqAttune: true,
  bonusSpellAttack: '+2',
  bonusSpellSaveDc: '+1',
  entries: ['You gain a +2 bonus to spell attack rolls and a +1 bonus to your spell save DC.'],
};

const PLATE: DataEntity = {
  name: 'Loud Plate',
  source: 'HB',
  type: 'HA',
  ac: 18,
  rarity: 'rare',
  reqAttune: true,
  stealth: true,
  entries: ['It clanks.'],
};

const QUIET: DataEntity = { ...PLATE, name: 'Quiet Plate', stealth: false };

interface Carried {
  item: DataEntity;
  attuned?: boolean;
}

function sheet(
  carried: Carried[],
  opts: { classes?: 'Warrior' | 'Mage'; packs?: DataEntity[] } = {},
) {
  const base = makeTestContext();
  const mine = carried.map((c) => c.item);
  const ctx: EngineContext = {
    byType: (t) =>
      t === 'item'
        ? [...base.byType(t), ...mine]
        : t === RULE_PACK_TYPE
          ? (opts.packs ?? [])
          : base.byType(t),
    get: (t, n, s) =>
      (t === 'item' ? mine.find((m) => m.name === n) : undefined) ?? base.get(t, n, s),
  };
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  const cls = opts.classes ?? 'Warrior';
  doc.classes = [{ ref: { name: cls, source: 'TST' }, levels: 1, hp: ['avg'] }];
  doc.equipment = [
    {
      id: 'sword',
      ref: { name: 'Longsword', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
    ...carried.map((c, i) => ({
      id: `c${i}`,
      ref: { name: c.item.name as string, source: c.item.source as string },
      qty: 1,
      equipped: true,
      attuned: c.attuned ?? false,
    })),
  ] as typeof doc.equipment;
  return deriveSheet(doc, ctx);
}

const row = (s: ReturnType<typeof sheet>, label: string) =>
  s.attacks.find((a) => a.label === label);
const toHitFrom = (s: ReturnType<typeof sheet>, label: string, from: string) =>
  row(s, label)?.toHit.parts.find((p) => p.label === from)?.amount;

describe("an item's weapon bonus fields", () => {
  it('reach every weapon attack from an item that is no weapon', () => {
    const s = sheet([{ item: BAND }]);
    expect(toHitFrom(s, 'Longsword', 'Band of Aim')).toBe(1);
    expect(row(s, 'Longsword')?.damage).toBe(`1d8+${2 + s.abilities.str.mod}`);
    expect(row(s, 'Longsword')?.damageFrom).toEqual(['Band of Aim']);
  });

  it('never reach an unarmed strike, which is no weapon', () => {
    const s = sheet([{ item: BAND }]);
    expect(row(s, 'Unarmed Strike')).toBeDefined();
    expect(toHitFrom(s, 'Unarmed Strike', 'Band of Aim')).toBeUndefined();
    expect(row(s, 'Unarmed Strike')?.damageFrom).toBeUndefined();
  });

  it("reach only the weapon's own attacks on a weapon", () => {
    const s = sheet([{ item: KEEN }]);
    expect(toHitFrom(s, 'Keen Blade', 'Keen Blade')).toBe(3);
    expect(toHitFrom(s, 'Longsword', 'Keen Blade')).toBeUndefined();
  });

  it('never reach a spell attack', () => {
    const s = sheet([{ item: BAND }], { classes: 'Mage' });
    expect(s.spellcasting[0]?.attackMod.parts.some((p) => p.label === 'Band of Aim')).toBe(false);
  });

  it("go when a pack's patch replaces the item's effects", () => {
    const pack: DataEntity = {
      name: 'Brew',
      source: 'Brew',
      appliesTo: { characters: ['hero'] },
      castGuidance: {
        v: 1,
        patches: [{ target: 'Band of Aim|HB', effects: [{ kind: 'cue', text: 'Aim true' }] }],
      },
    };
    const s = sheet([{ item: BAND }], { packs: [pack] });
    expect(toHitFrom(s, 'Longsword', 'Band of Aim')).toBeUndefined();
    expect(row(s, 'Longsword')?.damageFrom).toBeUndefined();
  });
});

describe("an item's spell bonus fields", () => {
  it('raise spell attacks and the spell save DC once attuned', () => {
    const block = sheet([{ item: ROD, attuned: true }], { classes: 'Mage' }).spellcasting[0];
    expect(block?.attackMod.parts.find((p) => p.label === 'Rod of Focus')?.amount).toBe(2);
    expect(block?.saveDc.parts.find((p) => p.label === 'Rod of Focus')?.amount).toBe(1);
  });

  it('wait on attunement', () => {
    const block = sheet([{ item: ROD }], { classes: 'Mage' }).spellcasting[0];
    expect(block?.attackMod.parts.some((p) => p.label === 'Rod of Focus')).toBe(false);
    expect(block?.saveDc.parts.some((p) => p.label === 'Rod of Focus')).toBe(false);
  });

  it('never reach a weapon attack', () => {
    const s = sheet([{ item: ROD, attuned: true }]);
    expect(toHitFrom(s, 'Longsword', 'Rod of Focus')).toBeUndefined();
  });
});

describe("armor's stealth field", () => {
  const stealthDis = (s: ReturnType<typeof sheet>) =>
    s.rollRiders.filter(
      (r) =>
        r.kind === 'advantage' && r.mode === 'dis' && r.on.skills?.includes('Stealth') === true,
    );

  it('puts disadvantage on Stealth checks while worn, attuned or not', () => {
    expect(stealthDis(sheet([{ item: PLATE }])).map((r) => r.origin)).toEqual(['Loud Plate']);
  });

  it('puts none when it is false, or the armor is not worn', () => {
    expect(stealthDis(sheet([{ item: QUIET }]))).toEqual([]);
    expect(stealthDis(sheet([]))).toEqual([]);
  });
});
