/**
 * A background's mechanics through `mechanicsOf` (ADR-002 D7): its own
 * `castGuidance` adds to what its data gives, `replace` and `drop` reach what
 * its data gives, a pack's patch reaches it by `name|source`, and its moments
 * count. Its origin feats are feats of their own, which none of that reaches.
 * The background is invented; Alert is the fixture's curated feat.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE } from '../castGuidance';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { collectBackground } from './background';
import { Collector } from './base';
import { subjectsWithMoments } from './mechanics';

const BACKGROUND: DataEntity = {
  name: 'Lamplighter',
  source: 'HB',
  skillProficiencies: [{ perception: true }],
  feats: [{ 'alert|phb': true }],
  entries: ['You keep the lamps lit.'],
};

function world(bg: DataEntity, packs: DataEntity[] = []): EngineContext {
  const base = makeTestContext();
  return {
    byType: (t) => (t === RULE_PACK_TYPE ? packs : base.byType(t)),
    get: (type, name, source) =>
      type === 'background' && name === 'Lamplighter' ? bg : base.get(type, name, source),
  };
}

function collect(guidance?: Record<string, unknown>, packs: DataEntity[] = []): Collector {
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  doc.background = { name: 'Lamplighter', source: 'HB' };
  const bg = guidance === undefined ? BACKGROUND : { ...BACKGROUND, castGuidance: guidance };
  const col = new Collector(doc, world(bg, packs));
  collectBackground(col);
  return col;
}

const kinds = (col: Collector) => col.effects.map((e) => e.kind);

describe('a background read through mechanicsOf', () => {
  it('gives what its data gives when it says nothing of its own', () => {
    const col = collect();
    expect(kinds(col)).toEqual(['skillProf', 'initiativeBonus']);
    expect(col.warnings).toEqual([]);
  });

  it('adds its own effects, under its own origin, before what its data gives', () => {
    const col = collect({ v: 1, effects: [{ kind: 'speedBonus', amount: 5 }] });
    expect(kinds(col)).toEqual(['speedBonus', 'skillProf', 'initiativeBonus']);
    expect(col.effects[0]).toEqual({
      kind: 'speedBonus',
      amount: 5,
      origin: { label: 'Lamplighter', uid: 'lamplighter|hb', type: 'background' },
    });
  });

  it("starts from nothing with replace, but keeps the origin feat, which is the feat's own", () => {
    const col = collect({ v: 1, replace: true, effects: [{ kind: 'speedBonus', amount: 5 }] });
    expect(kinds(col)).toEqual(['speedBonus', 'initiativeBonus']);
  });

  it("drops what its data gives by kind, never the origin feat's effects", () => {
    const col = collect({
      v: 1,
      drop: [{ kind: 'skillProf' }, { kind: 'initiativeBonus' }],
    });
    expect(kinds(col)).toEqual(['initiativeBonus']);
  });

  it("takes a pack's patch by its name and source", () => {
    const pack: DataEntity = {
      name: 'Bright',
      source: 'Bright',
      appliesTo: { characters: ['hero'] },
      castGuidance: {
        v: 1,
        patches: [{ target: 'Lamplighter|HB', add: [{ kind: 'acBonus', amount: 1 }] }],
      },
    };
    const col = collect(undefined, [pack]);
    expect(col.effects.map((e) => [e.kind, e.origin.pack])).toEqual([
      ['acBonus', 'Bright'],
      ['skillProf', undefined],
      ['initiativeBonus', undefined],
    ]);
  });

  it('says what does not count, by its name', () => {
    const col = collect({ v: 1, effects: [{ kind: 'speedBonus' }] });
    expect(col.warnings).toEqual([expect.stringMatching(/^Lamplighter: effect 1 \(speedBonus\)/)]);
    expect(kinds(col)).toEqual(['skillProf', 'initiativeBonus']);
  });

  it('carries its moments to the sheet', () => {
    const moments = [{ at: 'longRest', do: [{ kind: 'cue', text: 'Trim the wicks' }] }];
    const col = collect({ v: 1, moments });
    expect(subjectsWithMoments(col).map((s) => s.label)).toEqual(['Lamplighter']);
  });
});
