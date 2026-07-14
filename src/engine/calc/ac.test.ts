import { describe, expect, it } from 'vitest';
import type { Collector } from '../effects/base';
import {
  type Ability,
  type DerivedAbility,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
} from '../types';
import { calcAc } from './ac';

const origin: EffectOrigin = { label: 'Barbarian', uid: 'class|barb', type: 'class' };
// The equipment loop is skipped for a doc with no equipment, so `col` is unused.
const noCol = {} as unknown as Collector;

function abilities(mods: Partial<Record<Ability, number>>): Record<Ability, DerivedAbility> {
  const out = {} as Record<Ability, DerivedAbility>;
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]) {
    const mod = mods[a] ?? 0;
    out[a] = { value: 10 + mod * 2, base: 10, overridden: false, parts: [], mod };
  }
  return out;
}

describe('calcAc', () => {
  it('defaults to unarmored 10 + DEX', () => {
    const { ac, label } = calcAc(newCharacterDoc('c', 'H', 't'), noCol, [], abilities({ dex: 3 }));
    expect(ac.value).toBe(13);
    expect(label).toBe('Unarmored');
  });

  it('picks the best AC formula (Unarmored Defense over plain unarmored)', () => {
    const effects: EffectInput[] = [
      {
        origin,
        kind: 'acFormula',
        label: 'Unarmored Defense',
        base: 10,
        addAbilities: ['dex', 'con'],
      },
    ];
    const { ac, label } = calcAc(
      newCharacterDoc('c', 'H', 't'),
      noCol,
      effects,
      abilities({ dex: 2, con: 3 }),
    );
    expect(ac.value).toBe(15); // 10 + 2 + 3
    expect(label).toBe('Unarmored Defense');
  });

  it('caps DEX in a formula with a dexMax', () => {
    const effects: EffectInput[] = [
      {
        origin,
        kind: 'acFormula',
        label: 'Mage Armor',
        base: 13,
        addAbilities: ['dex'],
        dexMax: 2,
      },
    ];
    const { ac } = calcAc(newCharacterDoc('c', 'H', 't'), noCol, effects, abilities({ dex: 4 }));
    expect(ac.value).toBe(15); // 13 + min(4, 2)
  });

  it('adds acBonus effects on top of the best candidate', () => {
    const effects: EffectInput[] = [{ origin, kind: 'acBonus', amount: 1 }];
    const { ac } = calcAc(newCharacterDoc('c', 'H', 't'), noCol, effects, abilities({ dex: 2 }));
    expect(ac.value).toBe(13); // 10 + 2 + 1
  });

  it('honors an explicit AC override', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.overrides = { ac: { value: 18 } };
    const { ac } = calcAc(doc, noCol, [], abilities({ dex: 2 }));
    expect(ac.value).toBe(18);
    expect(ac.overridden).toBe(true);
  });
});
