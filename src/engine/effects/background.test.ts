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

  it('resolves an origin feat with a "; option" sub-selector (Acolyte/Sage/Guide)', () => {
    // "magic initiate; cleric|xphb" style key — the base feat (Alert here, a
    // curated +5 initiative feat in the fixture) must resolve and apply.
    const col = collect({ name: 'Custom', feats: [{ 'alert; cleric|phb': true }], entries: ['x'] });
    expect(col.warnings).not.toContainEqual(expect.stringMatching(/Origin feat not found/i));
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'initiativeBonus', amount: 5 }),
    );
    // The locked sub-choice is surfaced as a note.
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'note', text: expect.stringMatching(/locked to .*cleric/i) }),
    );
  });

  it('still warns (with the base name) when a "; option" feat is missing', () => {
    const col = collect({ name: 'Custom', feats: [{ 'ghostfeat; wizard|zzz': true }] });
    expect(col.warnings).toContainEqual(
      expect.stringMatching(/Origin feat not found: ghostfeat\|zzz/i),
    );
  });

  it('pushes a feature card for the background', () => {
    const col = collect({ name: 'Custom', entries: ['Background flavor.'] });
    expect(col.features.some((f) => f.name === 'Custom')).toBe(true);
  });

  it('grants a background additionalSpells known spell (previously dropped)', () => {
    const col = collect({
      name: 'Custom',
      additionalSpells: [{ ability: 'int', known: { _: ['guidance|tst'] } }],
      entries: ['x'],
    });
    expect(col.effects).toContainEqual(
      expect.objectContaining({ kind: 'grantSpell', spell: { name: 'guidance', source: 'tst' } }),
    );
  });

  it('surfaces a background expanded list keyed by spell level (Strixhaven student)', () => {
    const col = collect({
      name: 'Custom',
      additionalSpells: [{ expanded: { s1: ['shield|tst'], s5: ['flame strike|tst'] } }],
      entries: ['x'],
    });
    const warning = col.warnings.find((w) => /expands your spell options/.test(w));
    expect(warning).toBeDefined();
    expect(warning).toContain('shield');
    expect(warning).toContain('flame strike');
  });
});
