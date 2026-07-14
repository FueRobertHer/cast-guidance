import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type EffectInput, type EffectOrigin, newCharacterDoc } from '../types';
import { Collector } from './base';
import { flattenEntries, proseScanFeature } from './proseScan';

const origin: EffectOrigin = { label: 'Trait', uid: 'race|x', type: 'race' };

function scan(name: string, entries: unknown): EffectInput[] {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
  proseScanFeature(col, name, entries, origin);
  return col.effects;
}

describe('flattenEntries', () => {
  it('walks nested entries/entry/items and lowercases', () => {
    expect(flattenEntries([{ entries: ['Hello'] }, { entry: 'World' }, { items: ['A'] }])).toBe(
      'hello world a',
    );
  });

  it('keeps the display text of {@tag ...} markup and folds apostrophes', () => {
    expect(flattenEntries('Cast {@spell bless|phb} once')).toBe('cast bless once');
    expect(flattenEntries('It’s fine')).toBe("it's fine");
  });

  it('is empty for non-text content', () => {
    expect(flattenEntries(undefined)).toBe('');
    expect(flattenEntries([{ type: 'table' }])).toBe('');
  });
});

describe('proseScanFeature — limited-use detection', () => {
  const resource = (effects: EffectInput[]) =>
    effects.find((e): e is Extract<EffectInput, { kind: 'resource' }> => e.kind === 'resource');

  it('emits a once-per-long-rest resource', () => {
    const r = resource(scan('Breath', ['You can use it once per long rest.']));
    expect(r).toMatchObject({ kind: 'resource', label: 'Breath', max: 1, resetOn: 'long' });
  });

  it('resets on a short rest when the prose says so', () => {
    const r = resource(
      scan('Trick', ['You can use it twice, and you regain all uses on a short or long rest.']),
    );
    expect(r?.resetOn).toBe('short');
    expect(r?.max).toBe(2);
  });

  it('reads a proficiency-bonus number of uses', () => {
    const r = resource(
      scan('Channel', ['You can use it a number of times equal to your proficiency bonus.']),
    );
    expect(r?.max).toBe('profBonus');
  });

  it('adds nothing when there is no usage wording', () => {
    expect(scan('Flavor', ['You have a keen sense of smell.'])).toEqual([]);
  });
});
