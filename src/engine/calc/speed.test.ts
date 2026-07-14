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

function ctx(entities: { race?: DataEntity; subrace?: DataEntity }): EngineContext {
  return {
    byType: () => [],
    get: (type) =>
      type === 'race' ? entities.race : type === 'subrace' ? entities.subrace : undefined,
  };
}

function speed(
  d: CharacterDoc,
  entities: { race?: DataEntity; subrace?: DataEntity },
  effects: EffectInput[] = [],
) {
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
});
