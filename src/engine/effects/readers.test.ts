import { describe, expect, it } from 'vitest';
import {
  type ChoicePrompt,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import {
  ARTISANS_TOOLS,
  GAMING_SETS,
  MUSICAL_INSTRUMENTS,
  readProficiencyList,
  toolOptions,
} from './readers';

const ctx: EngineContext = {
  get: () => undefined,
  byType: () => [],
};
const origin: EffectOrigin = { label: 'Test origin', uid: 'test|tst', type: 'race' };

function toolCollector(raw: unknown): Collector {
  const col = new Collector(newCharacterDoc('id', 'Test', 'test-tag'), ctx);
  readProficiencyList(
    col,
    raw,
    origin,
    'race:test|tst:tool',
    'tool',
    'Tool proficiency',
    (name) => col.add({ kind: 'toolProf', name, origin }),
    toolOptions,
  );
  return col;
}

describe('tool proficiency choices', () => {
  it('offers a full tool list for generic any choices such as Autognome', () => {
    const col = toolCollector([{ any: 2 }]);
    expect(col.pending).toHaveLength(1);
    expect(col.pending[0]?.count).toBe(2);
    expect(col.pending[0]?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "smith's tools" }),
        expect.objectContaining({ id: 'lute' }),
        expect.objectContaining({ id: 'dice set' }),
        expect.objectContaining({ id: "thieves' tools" }),
      ]),
    );
  });

  it('expands artisan, instrument, and gaming-set category keys', () => {
    expect(toolCollector([{ anyArtisansTool: 2 }]).pending[0]?.options).toHaveLength(
      ARTISANS_TOOLS.length,
    );
    expect(toolCollector([{ anyMusicalInstrument: 1 }]).pending[0]?.options).toHaveLength(
      MUSICAL_INSTRUMENTS.length,
    );
    expect(toolCollector([{ anyGamingSet: 1 }]).pending[0]?.options).toHaveLength(
      GAMING_SETS.length,
    );
  });

  it('expands category tokens nested in explicit choices', () => {
    const col = toolCollector([{ choose: { from: ['anyArtisansTool', 'musical instrument'] } }]);
    expect(col.pending[0]?.options).toHaveLength(
      ARTISANS_TOOLS.length + MUSICAL_INSTRUMENTS.length,
    );
  });

  it('turns a generic fixed category into a concrete choice', () => {
    const col = toolCollector([{ 'gaming set': true }]);
    expect(col.pending[0]?.options).toHaveLength(GAMING_SETS.length);
    expect(col.effects).toHaveLength(0);
  });
});

describe('stored choice validation', () => {
  function collect(prompt: ChoicePrompt, stored: string[] | string) {
    const doc = newCharacterDoc('id', 'Test', 'test-tag');
    doc.choices[prompt.id] = stored;
    const col = new Collector(doc, ctx);
    let applied: string[] = [];
    col.choice(prompt, (selected) => {
      applied = selected;
    });
    return { col, applied };
  }

  const prompt: ChoicePrompt = {
    id: 'choice',
    origin,
    kind: 'tool',
    label: 'Tool proficiency',
    count: 2,
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B', disabled: { reason: 'already granted' } },
      { id: 'c', label: 'C' },
    ],
  };

  it('does not apply unknown, duplicate, or excess stored values', () => {
    const unknown = collect(prompt, ['a', 'missing']);
    expect(unknown.applied).toEqual(['a']);
    expect(unknown.col.pending).toHaveLength(1);
    expect(unknown.col.warnings.join(' ')).toContain('no longer available');

    const duplicate = collect(prompt, ['a', 'a']);
    expect(duplicate.applied).toEqual(['a']);
    expect(duplicate.col.pending).toHaveLength(1);
    expect(duplicate.col.warnings.join(' ')).toContain('more than once');

    const excess = collect(prompt, ['a', 'c', 'b']);
    expect(excess.applied).toEqual(['a', 'c']);
    expect(excess.col.pending).toHaveLength(1);
    expect(excess.col.warnings.join(' ')).toContain('extra choices were ignored');
  });

  it('keeps disabled overrides but labels them unusual', () => {
    const result = collect(prompt, ['a', 'b']);
    expect(result.applied).toEqual(['a', 'b']);
    expect(result.col.resolved).toHaveLength(1);
    expect(result.col.warnings.join(' ')).toContain('unusual');
  });

  it('allows repeats only when the prompt explicitly opts in', () => {
    const result = collect({ ...prompt, allowRepeat: true }, ['a', 'a']);
    expect(result.applied).toEqual(['a', 'a']);
    expect(result.col.resolved).toHaveLength(1);
  });
});
