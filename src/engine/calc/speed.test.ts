import { describe, expect, it } from 'vitest';
import { Collector } from '../effects/base';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { calcWalkSpeed } from './speed';

const origin: EffectOrigin = { label: 'Boots', uid: 'item|boots', type: 'item' };

interface Entities {
  race?: DataEntity;
  subrace?: DataEntity;
  items?: DataEntity[];
}

function ctx(entities: Entities): EngineContext {
  return {
    byType: () => [],
    get: (type, name) =>
      type === 'race'
        ? entities.race
        : type === 'subrace'
          ? entities.subrace
          : type === 'item'
            ? entities.items?.find((i) => i.name === name)
            : undefined,
  };
}

function speed(d: CharacterDoc, entities: Entities, effects: EffectInput[] = []) {
  return calcWalkSpeed(d, new Collector(d, ctx(entities)), effects);
}

function docWithRace(): CharacterDoc {
  const d = newCharacterDoc('c', 'H', 't');
  d.race = { name: 'R', source: 'T' };
  return d;
}

describe('calcWalkSpeed', () => {
  it('defaults to 30 with no race', () => {
    expect(speed(newCharacterDoc('c', 'H', 't'), {}).value).toBe(30);
  });

  it('reads a numeric race speed and a subrace {walk} override', () => {
    expect(speed(docWithRace(), { race: { name: 'R', speed: 25 } }).value).toBe(25);
    const d = docWithRace();
    d.subrace = { name: 'S', source: 'T' };
    expect(
      speed(d, { race: { name: 'R', speed: 25 }, subrace: { name: 'S', speed: { walk: 40 } } })
        .value,
    ).toBe(40);
  });

  it('adds speedBonus effects and honors an override', () => {
    const effects: EffectInput[] = [{ origin, kind: 'speedBonus', amount: 10 }];
    expect(speed(docWithRace(), { race: { name: 'R', speed: 30 } }, effects).value).toBe(40);

    const d = docWithRace();
    d.overrides = { 'speed.walk': { value: 15 } };
    expect(speed(d, { race: { name: 'R', speed: 30 } }).value).toBe(15);
  });

  it('leaves out a bonus that holds only without the armor worn', () => {
    const items: DataEntity[] = [
      { name: 'Plate', type: 'HA', ac: 18 },
      { name: 'Breastplate', type: 'MA', ac: 14 },
      { name: 'Shield', type: 'S', ac: 2 },
    ];
    const effects: EffectInput[] = [
      { origin, kind: 'speedBonus', amount: 10, unless: 'heavyArmor' },
      { origin, kind: 'speedBonus', amount: 15, unless: 'armorOrShield' },
    ];
    const wearing = (...names: string[]) => {
      const d = docWithRace();
      d.equipment = names.map((name, i) => ({
        id: `e${i}`,
        ref: { name, source: 'T' },
        qty: 1,
        equipped: true,
        attuned: false,
      }));
      return speed(d, { race: { name: 'R', speed: 30 }, items }, effects).value;
    };
    expect(wearing()).toBe(55);
    expect(wearing('Breastplate')).toBe(40);
    expect(wearing('Shield')).toBe(40);
    expect(wearing('Plate')).toBe(30);
    // Gear the data does not have, or a custom entry, is not armor.
    expect(wearing('Mystery Mail')).toBe(55);
    const custom = docWithRace();
    custom.equipment = [
      {
        id: 'c',
        custom: { name: 'Tin Plate', acBonus: 2 },
        qty: 1,
        equipped: true,
        attuned: false,
      },
    ];
    expect(speed(custom, { race: { name: 'R', speed: 30 }, items }, effects).value).toBe(55);
    // Carried, not worn, it counts for nothing.
    const d = docWithRace();
    d.equipment = [
      { id: 'e', ref: { name: 'Plate', source: 'T' }, qty: 1, equipped: false, attuned: false },
    ];
    expect(speed(d, { race: { name: 'R', speed: 30 }, items }, effects).value).toBe(55);
  });
});
