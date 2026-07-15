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

describe('collectAdditionalSpells — mutually-exclusive branches (FIX-001)', () => {
  const branchRaw = [
    { name: 'Lorehold', ability: 'int', known: { _: ['light'] } },
    { name: 'Witherbloom', ability: 'wis', known: { _: ['spare the dying'] } },
  ];

  it('surfaces a pick-one choice and grants nothing until a branch is chosen', () => {
    // Strixhaven Initiate style: five colleges, pick one — do not grant all.
    const col = collect(branchRaw);
    expect(granted(col.effects)).toHaveLength(0);
    const prompt = col.pending.find((p) => p.id === 'spells:race|tiefling:branch');
    expect(prompt).toBeDefined();
    expect(prompt?.options.map((o) => o.label)).toEqual(['Lorehold', 'Witherbloom']);
  });

  it('grants only the chosen branch', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warlock', source: 'PHB' }, levels: 1, hp: [] }];
    doc.choices['spells:race|tiefling:branch'] = ['witherbloom'];
    const col = new Collector(doc, makeTestContext());
    collectAdditionalSpells(col, branchRaw, origin, 'cha');
    expect(granted(col.effects).map((e) => e.spell.name)).toEqual(['spare the dying']);
  });

  it('still grants every entry when none carry a name (back-compat)', () => {
    const col = collect([{ known: { _: ['light'] } }, { known: { _: ['guidance'] } }]);
    expect(
      granted(col.effects)
        .map((e) => e.spell.name)
        .sort(),
    ).toEqual(['guidance', 'light']);
  });

  it('grants a single named block normally without emitting a choice', () => {
    // A lone named group (e.g. one subclass "always prepared" block) is not a
    // real choice — it must grant its spells and create no branch prompt.
    const col = collect([{ name: 'Domain', prepared: { _: ['bless'] } }]);
    expect(granted(col.effects).map((e) => e.spell.name)).toEqual(['bless']);
    expect(col.pending.some((p) => p.id.endsWith(':branch'))).toBe(false);
  });
});

describe('collectAdditionalSpells — choose-ability picker (FIX-001)', () => {
  const chooseAbilityRaw = [
    { ability: { choose: ['int', 'wis', 'cha'] }, known: { '1': ['guidance'] } },
  ];

  it('surfaces an ability picker instead of silently defaulting to the first option', () => {
    const col = collect(chooseAbilityRaw);
    const prompt = col.pending.find((p) => p.id === 'spells:race|tiefling:ability:u:0');
    expect(prompt).toBeDefined();
    expect(prompt?.kind).toBe('ability');
    expect(prompt?.count).toBe(1);
    expect(prompt?.options.map((o) => o.id)).toEqual(['int', 'wis', 'cha']);
    // Like the branch choice, the grant waits on the pick — nothing is granted
    // with a guessed ability (the old behavior defaulted to the first option).
    expect(granted(col.effects)).toHaveLength(0);
    // No stale "your choice of…" warning — the picker replaces the note.
    expect(col.warnings.some((w) => /your choice/.test(w))).toBe(false);
  });

  it('grants with the chosen ability once the pick is stored', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warlock', source: 'PHB' }, levels: 1, hp: [] }];
    doc.choices['spells:race|tiefling:ability:u:0'] = ['wis'];
    const col = new Collector(doc, makeTestContext());
    collectAdditionalSpells(col, chooseAbilityRaw, origin, 'cha');
    const g = granted(col.effects);
    expect(g[0]).toMatchObject({ spell: { name: 'guidance' }, ability: 'wis' });
    expect(col.pending.some((p) => p.id.endsWith(':ability:u:0'))).toBe(false);
  });

  it('falls back to the default ability and warns when choose has no valid options', () => {
    const col = collect([{ ability: { choose: ['???'] }, known: { '1': ['guidance'] } }]);
    expect(granted(col.effects)[0]).toMatchObject({ spell: { name: 'guidance' }, ability: 'cha' });
    expect(col.warnings.some((w) => /your choice/.test(w))).toBe(true);
    expect(col.pending.some((p) => p.kind === 'ability')).toBe(false);
  });

  it('grants immediately (no picker) when only one valid ability is offered', () => {
    // A single option — or a mixed list that filters to one — is not a real
    // choice, so grant it like a fixed ability instead of prompting.
    for (const choose of [['int'], ['int', '???']]) {
      const col = collect([{ ability: { choose }, known: { '1': ['guidance'] } }]);
      expect(granted(col.effects)[0]).toMatchObject({
        spell: { name: 'guidance' },
        ability: 'int',
      });
      expect(col.pending.some((p) => p.kind === 'ability')).toBe(false);
      expect(col.warnings.some((w) => /your choice/.test(w))).toBe(false);
    }
  });

  it('grants nothing for an invalid/stale stored pick and keeps prompting', () => {
    // A saved ability no longer offered (e.g. a data update narrowed the list)
    // must not grant with an empty ability; it re-prompts, like the branch choice.
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warlock', source: 'PHB' }, levels: 1, hp: [] }];
    doc.choices['spells:race|tiefling:ability:u:0'] = ['str']; // not among int/wis/cha
    const col = new Collector(doc, makeTestContext());
    collectAdditionalSpells(col, chooseAbilityRaw, origin, 'cha');
    expect(granted(col.effects)).toHaveLength(0);
    expect(col.pending.some((p) => p.id === 'spells:race|tiefling:ability:u:0')).toBe(true);
  });

  it('namespaces the ability picker per chosen branch', () => {
    const branchAbilityRaw = [
      { name: 'Lorehold', ability: { choose: ['int', 'wis'] }, known: { _: ['light'] } },
      { name: 'Witherbloom', ability: 'wis', known: { _: ['spare the dying'] } },
    ];
    const build = (choices: Record<string, string[]>) => {
      const doc = newCharacterDoc('c', 'H', 't');
      doc.classes = [{ ref: { name: 'Warlock', source: 'PHB' }, levels: 1, hp: [] }];
      doc.choices = choices;
      const col = new Collector(doc, makeTestContext());
      collectAdditionalSpells(col, branchAbilityRaw, origin, 'cha');
      return col;
    };
    // Choosing the branch surfaces the branch's own choose-ability picker.
    const chosen = build({ 'spells:race|tiefling:branch': ['lorehold'] });
    expect(chosen.pending.some((p) => p.id === 'spells:race|tiefling:ability:b:lorehold:0')).toBe(
      true,
    );
    expect(granted(chosen.effects)).toHaveLength(0);
    // Answering both prompts grants the branch's spell with the chosen ability.
    const both = build({
      'spells:race|tiefling:branch': ['lorehold'],
      'spells:race|tiefling:ability:b:lorehold:0': ['int'],
    });
    expect(granted(both.effects)).toEqual([
      expect.objectContaining({ spell: { name: 'light', source: '' }, ability: 'int' }),
    ]);
  });
});
