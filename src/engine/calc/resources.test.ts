import { describe, expect, it } from 'vitest';
import {
  type Ability,
  type CharacterDoc,
  type DerivedAbility,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
} from '../types';
import { calcResources } from './resources';

const origin: EffectOrigin = { label: 'Class', uid: 'class|x', type: 'class' };

function abilities(cha = 0): Record<Ability, DerivedAbility> {
  const out = {} as Record<Ability, DerivedAbility>;
  for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]) {
    const mod = a === 'cha' ? cha : 0;
    out[a] = { value: 10, base: 10, overridden: false, parts: [], mod };
  }
  return out;
}

type ResourceEffect = Extract<EffectInput, { kind: 'resource' }>;

function res(max: ResourceEffect['max'], extra: Partial<ResourceEffect> = {}): ResourceEffect {
  return { origin, kind: 'resource', key: 'k', label: 'Pool', max, resetOn: 'long', ...extra };
}

function docWith(classes: CharacterDoc['classes']): CharacterDoc {
  const d = newCharacterDoc('c', 'H', 't');
  d.classes = classes;
  return d;
}

describe('calcResources max resolution', () => {
  const doc = docWith([{ ref: { name: 'Barbarian', source: 'PHB' }, levels: 5, hp: [] }]);

  it('reads a numeric max', () => {
    expect(calcResources(doc, [res(3)], abilities(), 2)[0]?.max).toBe(3);
  });

  it('resolves profBonus and abilityMod maxima', () => {
    expect(calcResources(doc, [res('profBonus')], abilities(), 4)[0]?.max).toBe(4);
    expect(calcResources(doc, [res('abilityMod:cha')], abilities(3), 2)[0]?.max).toBe(3);
  });

  it('resolves a class level max', () => {
    expect(calcResources(doc, [res('level:Barbarian')], abilities(), 2)[0]?.max).toBe(5);
    expect(calcResources(doc, [res('level:Wizard')], abilities(), 2)).toHaveLength(0); // 0 → dropped
  });
});

describe('calcResources pooling', () => {
  const doc = docWith([{ ref: { name: 'Fighter', source: 'PHB' }, levels: 3, hp: [] }]);

  it('stacks same-key sources when stack is true', () => {
    const effects = [res(4, { stack: true }), res(1, { stack: true })];
    const out = calcResources(doc, effects, abilities(), 2);
    expect(out).toHaveLength(1);
    expect(out[0]?.max).toBe(5);
  });

  it('keeps the first source (curated wins) when not stacking', () => {
    const effects = [res(4, { label: 'Curated' }), res(1, { label: 'Prose' })];
    const out = calcResources(doc, effects, abilities(), 2);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ max: 4, origin: 'Class' });
  });
});
