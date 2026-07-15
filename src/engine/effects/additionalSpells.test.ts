import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { type EffectInput, type EffectOrigin, newCharacterDoc } from '../types';
import { collectAdditionalSpells } from './additionalSpells';
import { Collector } from './base';

const origin: EffectOrigin = { label: 'Tiefling', uid: 'race|tiefling', type: 'race' };

function collect(raw: unknown, level = 1) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.classes = [{ ref: { name: 'Warlock', source: 'PHB' }, levels: level, hp: [] }];
  const col = new Collector(doc, makeTestContext());
  collectAdditionalSpells(col, raw, origin, 'cha');
  return col;
}

const granted = (effects: EffectInput[]) =>
  effects.filter((e): e is Extract<EffectInput, { kind: 'grantSpell' }> => e.kind === 'grantSpell');

describe('collectAdditionalSpells', () => {
  it('grants innate/known spells whose level gate is met', () => {
    const col = collect([{ ability: 'cha', known: { '1': ['thaumaturgy'] } }]);
    const g = granted(col.effects);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ spell: { name: 'thaumaturgy' }, ability: 'cha' });
    expect(g[0]?.usage).toBeUndefined();
  });

  it('gates by character level, and "_" is always granted', () => {
    const col = collect([{ known: { '5': ['fireball'], _: ['guidance'] } }], 1);
    const names = granted(col.effects).map((e) => e.spell.name);
    expect(names).toContain('guidance');
    expect(names).not.toContain('fireball'); // level-5 gate not met at level 1
  });

  it('marks prepared spells as always-prepared', () => {
    const col = collect([{ prepared: { '1': ['bless'] } }]);
    const g = granted(col.effects);
    expect(g[0]).toMatchObject({ spell: { name: 'bless' }, usage: 'prepared' });
  });

  it('parses a spell ref, stripping the cast-level hint and reading the source', () => {
    const col = collect([{ innate: { '1': ['hellish rebuke#2|xge'] } }]);
    expect(granted(col.effects)[0]?.spell).toEqual({ name: 'hellish rebuke', source: 'xge' });
  });

  it('surfaces expanded lists and {choose} filters as warnings, not grants', () => {
    const col = collect([
      {
        expanded: { '1': ['armor of agathys'] },
        known: { '1': [{ choose: 'level=1|class=wizard' }] },
      },
    ]);
    expect(granted(col.effects)).toHaveLength(0);
    expect(col.warnings.some((w) => /expands your spell options/.test(w))).toBe(true);
    expect(col.warnings.some((w) => /choose a spell/.test(w))).toBe(true);
  });

  it('surfaces spell-level-keyed expanded lists (sN) instead of dropping them', () => {
    // Witherbloom/Lorehold Student backgrounds key `expanded` by spell level
    // (s1…s5, case-insensitive), which used to parse to NaN and vanish. They are
    // not gated by character level, so they surface even at level 1.
    const col = collect([{ expanded: { s1: ['armor of agathys'], S5: ['cone of cold'] } }], 1);
    expect(granted(col.effects)).toHaveLength(0);
    const warning = col.warnings.find((w) => /expands your spell options/.test(w));
    expect(warning).toBeDefined();
    expect(warning).toContain('armor of agathys');
    expect(warning).toContain('cone of cold');
  });

  it('does NOT treat sN keys as ungated for grant maps (known/prepared)', () => {
    // The sN carve-out is scoped to `expanded`; a stray sN key on a grant map
    // must not silently grant an ungated spell.
    const col = collect([{ known: { s1: ['fireball'] } }], 1);
    expect(granted(col.effects)).toHaveLength(0);
  });
});
