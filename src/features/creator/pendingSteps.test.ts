import { describe, expect, it } from 'vitest';
import { type ChoicePrompt, type EffectOrigin, newCharacterDoc } from '@/engine/types';
import { pendingSteps, stepForOrigin } from './pendingSteps';

function warrior() {
  const doc = newCharacterDoc('id', 'Aria', 't');
  doc.classes = [
    {
      ref: { name: 'Warrior', source: 'TST' },
      subclass: { name: 'Champion', source: 'TST' },
      levels: 3,
      hp: ['avg', 'avg', 'avg'],
    },
  ];
  return doc;
}

const origin = (type: EffectOrigin['type'], uid: string): EffectOrigin => ({
  label: uid,
  uid,
  type,
});

const prompt = (id: string, o: EffectOrigin): ChoicePrompt => ({
  id,
  origin: o,
  kind: 'skill',
  label: id,
  count: 1,
  options: [{ id: 'a', label: 'A' }],
});

describe('stepForOrigin', () => {
  it('puts each origin on the step that shows its picks', () => {
    const doc = warrior();
    expect(stepForOrigin(doc, origin('class', 'warrior|tst'))).toBe('class');
    expect(stepForOrigin(doc, origin('subclass', 'champion|tst'))).toBe('class');
    expect(stepForOrigin(doc, origin('race', 'testfolk|tst'))).toBe('species');
    expect(stepForOrigin(doc, origin('background', 'acolyte|tst'))).toBe('background');
    expect(stepForOrigin(doc, origin('feat', 'alert|tst'))).toBe('choices');
  });

  it("sends a class's optional features, which have no card of their own, to Choices", () => {
    // A fighting style's picks carry the 'class' type with the feature's uid.
    expect(stepForOrigin(warrior(), origin('class', 'blessed warrior|tst'))).toBe('choices');
  });
});

describe('pendingSteps', () => {
  it('counts the picks waiting on each step, in wizard order', () => {
    const doc = warrior();
    const pending = [
      prompt('feat', origin('feat', 'alert|tst')),
      prompt('lang', origin('race', 'testfolk|tst')),
      prompt('skill', origin('class', 'warrior|tst')),
      prompt('style', origin('class', 'warrior|tst')),
    ];
    expect(pendingSteps(doc, pending)).toEqual([
      { step: 'class', count: 2 },
      { step: 'species', count: 1 },
      { step: 'choices', count: 1 },
    ]);
  });

  it('has nothing when no pick is waiting', () => {
    expect(pendingSteps(warrior(), [])).toEqual([]);
  });
});
