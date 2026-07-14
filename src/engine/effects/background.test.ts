import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { collectBackground } from './background';
import { Collector } from './base';

/** Fixture context with one synthetic background injected by name. */
function ctxWith(bg: DataEntity | undefined): EngineContext {
  const base = makeTestContext();
  return {
    byType: (t) => base.byType(t),
    get: (type, name, source) =>
      type === 'background' && name === 'Custom' ? bg : base.get(type, name, source),
  };
}

function collect(bg: DataEntity | undefined, ref = { name: 'Custom', source: 'TST' }) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.background = ref;
  const col = new Collector(doc, ctxWith(bg));
  collectBackground(col);
  return col;
}

describe('collectBackground', () => {
  it('no-ops when the character has no background', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    const col = new Collector(doc, makeTestContext());
    collectBackground(col);
    expect(col.effects).toEqual([]);
    expect(col.features).toEqual([]);
  });

  it('warns when the background is not in the registry', () => {
    const col = collect(undefined);
    expect(col.warnings).toContainEqual(
      expect.stringMatching(/Background not found: custom\|tst/i),
    );
  });

  it('notes a free-choice origin feat (any)', () => {
    const col = collect({ name: 'Custom', feats: [{ any: true }], entries: ['x'] });
    expect(col.effects).toContainEqual(
      expect.objectContaining({
        kind: 'note',
        text: expect.stringMatching(/origin feat of your choice/),
      }),
    );
  });

  it('warns when a named origin feat is missing from the registry', () => {
    const col = collect({ name: 'Custom', feats: [{ 'ghostfeat|zzz': true }] });
    expect(col.warnings).toContainEqual(
      expect.stringMatching(/Origin feat not found: ghostfeat\|zzz/i),
    );
  });

  it('pushes a feature card for the background', () => {
    const col = collect({ name: 'Custom', entries: ['Background flavor.'] });
    expect(col.features.some((f) => f.name === 'Custom')).toBe(true);
  });
});
