import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type DataEntity, newCharacterDoc } from '../types';
import { Collector } from './base';
import { collectFeatEntity, collectFeats } from './feat';

function collect(feat: DataEntity) {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
  collectFeatEntity(col, feat, 'testfeat|tst', 'i1');
  return col;
}

describe('collectFeatEntity', () => {
  it('emits senses from a senses block', () => {
    const col = collect({ name: 'Darksight', senses: [{ darkvision: 60 }] });
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'sense', sense: 'darkvision', range: 60 }),
    );
  });

  it('grants expertise for a fixed named skill', () => {
    const col = collect({ name: 'Expert', expertise: [{ Stealth: true }] });
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'skillProf', skill: 'Stealth', level: 2 }),
    );
  });

  it('always pushes a feature card for the feat', () => {
    const col = collect({ name: 'Lucky', entries: ['You have 3 luck points.'] });
    expect(col.features.some((f) => f.name === 'Lucky')).toBe(true);
  });
});

describe('collectFeats', () => {
  it('warns for a feat the registry does not have', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.feats = [{ ref: { name: 'Nonexistent', source: 'TST' }, instanceId: 'i1' }];
    const col = new Collector(doc, makeTestContext());
    collectFeats(col);
    expect(col.warnings).toContainEqual(expect.stringMatching(/Feat not found: nonexistent\|tst/i));
  });
});
