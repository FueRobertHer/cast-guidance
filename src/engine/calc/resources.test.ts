import { describe, expect, it } from 'vitest';
import {
  type Ability,
  type CharacterDoc,
  type DerivedAbility,
  type DerivedResource,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
} from '../types';
import { calcResources, costOnSheet } from './resources';

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

  it('resolves twice the proficiency bonus', () => {
    expect(calcResources(doc, [res('twiceProfBonus')], abilities(), 3)[0]?.max).toBe(6);
  });

  it('resolves "1 + modifier" maxima, dropping the resource at zero', () => {
    expect(calcResources(doc, [res('abilityModPlus1:cha')], abilities(3), 2)[0]?.max).toBe(4);
    // 1 + (-1) = 0 uses: rules-accurate for Divine Sense with CHA 8.
    expect(calcResources(doc, [res('abilityModPlus1:cha')], abilities(-1), 2)).toHaveLength(0);
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

describe('costOnSheet', () => {
  const pool = (key: string): DerivedResource => ({
    key,
    label: key,
    max: 3,
    resetOn: 'long',
    origin: 'Test',
  });

  it('keeps a cost on a pool the sheet has', () => {
    const cost = { resource: 'dice', amount: 2 };
    expect(costOnSheet(cost, [pool('dice')])).toEqual(cost);
  });

  it('finds Focus and ki under either name', () => {
    expect(costOnSheet({ resource: 'focus', amount: 1 }, [pool('ki')])?.resource).toBe('ki');
    expect(costOnSheet({ resource: 'ki', amount: 1 }, [pool('focus')])?.resource).toBe('focus');
  });

  it('prefers the name it was given when the sheet has both', () => {
    const both = [pool('ki'), pool('focus')];
    expect(costOnSheet({ resource: 'focus', amount: 1 }, both)?.resource).toBe('focus');
  });

  it('drops a cost the sheet has nothing to pay it with', () => {
    expect(costOnSheet({ resource: 'dice', amount: 1 }, [pool('ki')])).toBeUndefined();
    expect(costOnSheet(undefined, [pool('ki')])).toBeUndefined();
  });
});
