import { describe, expect, it } from 'vitest';
import { Collector } from '../effects/base';
import {
  type Ability,
  type CharacterDoc,
  type DataEntity,
  type DerivedAbility,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { calcAttacks } from './attacks';

const origin: EffectOrigin = { label: 'Rage', uid: 'x', type: 'class' };

const WEAPONS: Record<string, DataEntity> = {
  Longsword: {
    name: 'Longsword',
    type: 'M',
    weaponCategory: 'martial',
    dmg1: '1d8',
    dmgType: 'S',
    property: ['V'],
    dmg2: '1d10',
  },
  Rapier: {
    name: 'Rapier',
    type: 'M',
    weaponCategory: 'martial',
    dmg1: '1d8',
    dmgType: 'P',
    property: ['F'],
  },
  Shortbow: {
    name: 'Shortbow',
    type: 'R',
    weaponCategory: 'simple',
    dmg1: '1d6',
    dmgType: 'P',
    range: '80/320',
  },
};

const ctx: EngineContext = { byType: () => [], get: (_t, name) => WEAPONS[name] };

function abilities(str: number, dex: number): Record<Ability, DerivedAbility> {
  const out = {} as Record<Ability, DerivedAbility>;
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]) {
    const mod = a === 'str' ? str : a === 'dex' ? dex : 0;
    out[a] = { value: 10, base: 10, overridden: false, parts: [], mod };
  }
  return out;
}

function docWith(name: string): CharacterDoc {
  const d = newCharacterDoc('c', 'H', 't');
  d.equipment = [{ id: 'e1', ref: { name, source: 'T' }, qty: 1, equipped: true, attuned: false }];
  return d;
}

function attacks(
  d: CharacterDoc,
  abils: Record<Ability, DerivedAbility>,
  profBonus = 2,
  weaponProfs: string[] = ['martial weapons', 'simple weapons'],
  effects: EffectInput[] = [],
) {
  return calcAttacks(d, new Collector(d, ctx), effects, abils, profBonus, weaponProfs);
}

const row = (rows: ReturnType<typeof attacks>, label: string) =>
  rows.find((r) => r.label === label);

describe('calcAttacks', () => {
  it('a proficient melee weapon uses STR + proficiency and shows versatile damage', () => {
    const r = row(attacks(docWith('Longsword'), abilities(3, 1)), 'Longsword');
    expect(r?.toHit.value).toBe(5); // str 3 + prof 2
    expect(r?.damage).toBe('1d8+3');
    expect(r?.versatileDamage).toBe('1d10+3');
    expect(r?.damageType).toBe('slashing');
    expect(r?.properties).toContain('versatile');
  });

  it('a finesse weapon uses the higher of STR/DEX', () => {
    expect(row(attacks(docWith('Rapier'), abilities(0, 4)), 'Rapier')?.toHit.value).toBe(6); // dex 4 + prof 2
    expect(row(attacks(docWith('Rapier'), abilities(3, 1)), 'Rapier')?.toHit.value).toBe(5); // str 3 + prof 2
  });

  it('a ranged weapon uses DEX', () => {
    const r = row(attacks(docWith('Shortbow'), abilities(3, 2)), 'Shortbow');
    expect(r?.toHit.value).toBe(4); // dex 2 + prof 2
    expect(r?.range).toBe('80/320 ft.');
  });

  it('drops proficiency when the category is not on the list', () => {
    expect(
      row(attacks(docWith('Longsword'), abilities(3, 1), 2, ['simple weapons']), 'Longsword')?.toHit
        .value,
    ).toBe(3);
  });

  it('applies scoped attack bonuses', () => {
    const effects: EffectInput[] = [{ origin, kind: 'attackBonus', scope: 'all', amount: 1 }];
    expect(
      row(
        attacks(docWith('Longsword'), abilities(3, 1), 2, ['martial weapons'], effects),
        'Longsword',
      )?.toHit.value,
    ).toBe(6);
  });

  it('always includes an unarmed strike', () => {
    const r = row(attacks(newCharacterDoc('c', 'H', 't'), abilities(2, 0)), 'Unarmed Strike');
    expect(r?.toHit.value).toBe(4); // str 2 + prof 2
    expect(r?.damage).toBe('3'); // max(1, 1 + str 2)
  });

  it('surfaces a custom-item attack verbatim', () => {
    const d = newCharacterDoc('c', 'H', 't');
    d.equipment = [
      {
        id: 'c1',
        custom: { name: 'Laser', attack: { toHitBonus: 7, damage: '2d6', damageType: 'fire' } },
        qty: 1,
        equipped: true,
        attuned: false,
      },
    ];
    const r = row(attacks(d, abilities(0, 0)), 'Laser');
    expect(r?.toHit.value).toBe(7);
    expect(r?.damage).toBe('2d6');
  });
});
