import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import {
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  newCharacterDoc,
  refUid,
} from '../types';
import { collectAdditionalSpells, hasChosenSpell, parseSpellRef } from './additionalSpells';
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

describe('hasChosenSpell', () => {
  const pick = { choose: 'level=0' };

  it.each<[string, unknown]>([
    ['a known spell', [{ known: { _: [pick] } }]],
    ['a known spell at a later level', [{ known: { 5: [pick] } }]],
    ['an innate spell', [{ innate: { _: { daily: { 1: [pick] } } } }]],
    ['a filter where an innate bucket would be', [{ innate: { _: pick } }]],
    ['a prepared spell', [{ prepared: { 3: [pick] } }]],
    ['an entry past the first', [{ known: { _: ['fake one'] } }, { known: { _: [pick] } }]],
  ])('finds %s', (_where, raw) => {
    expect(hasChosenSpell(raw)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['fixed spells', [{ known: { _: ['fake one'] }, innate: { _: { will: ['fake two'] } } }]],
    ['a choice of ability', [{ ability: { choose: ['int', 'wis'] }, known: { _: ['fake one'] } }]],
    ['an expanded list', [{ expanded: { s1: [pick] } }]],
  ])('does not count %s', (_where, raw) => {
    expect(hasChosenSpell(raw)).toBe(false);
  });
});

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

  describe('with a level passed in, as a subclass passes its class level', () => {
    const subclass: EffectOrigin = { label: 'Order of Lint', uid: 'order|tst', type: 'subclass' };

    /** A character of `total` levels, gated at `gate` when one is passed. */
    function gated(raw: unknown, total: number, gate?: number) {
      const doc = newCharacterDoc('c', 'H', 't');
      doc.classes = [{ ref: { name: 'Warlock', source: 'PHB' }, levels: total, hp: [] }];
      const col = new Collector(doc, makeTestContext());
      collectAdditionalSpells(col, raw, subclass, 'cha', undefined, gate);
      return col;
    }

    const raw = [
      {
        prepared: { 1: ['fake early'], 17: ['fake prepared'] },
        known: { 17: ['fake known'] },
        innate: { 17: { daily: { 1: ['fake innate'] } } },
        expanded: { 17: ['fake expanded'] },
      },
    ];

    it('reads every kind of key against that level, not the character level', () => {
      const col = gated(raw, 17, 1);
      expect(granted(col.effects).map((e) => e.spell.name)).toEqual(['fake early']);
      expect(col.effects.some((e) => e.kind === 'resource')).toBe(false);
      expect(col.warnings).toEqual([]);
    });

    it('opens those keys once that level reaches them', () => {
      const col = gated(raw, 17, 17);
      expect(granted(col.effects).map((e) => e.spell.name)).toEqual([
        'fake innate',
        'fake known',
        'fake early',
        'fake prepared',
      ]);
      expect(col.warnings.join()).toContain('fake expanded');
    });

    it('does not ask about a chosen spell its key has not reached', () => {
      const chosen = [{ known: { 17: [{ choose: 'level=1' }] } }];
      expect(gated(chosen, 17, 1).warnings).toEqual([]);
      expect(gated(chosen, 17, 17).warnings).toEqual([
        'Order of Lint: also lets you choose a spell. See the trait text.',
      ]);
    });

    it('goes by character level when none is passed', () => {
      expect(granted(gated(raw, 17).effects).map((e) => e.spell.name)).toContain('fake prepared');
    });
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

  it('strips a hint written after the source, as 5etools writes it', () => {
    // The XPHB Tiefling's "thaumaturgy|xphb#c" kept "xphb#c" as its source,
    // so the Features and Build links named a printing that does not exist.
    const col = collect([
      { known: { '1': ['thaumaturgy|xphb#c', 'chill touch|XPHB#c', 'ray of frost#c'] } },
    ]);
    expect(granted(col.effects).map((e) => e.spell)).toEqual([
      { name: 'thaumaturgy', source: 'xphb' },
      { name: 'chill touch', source: 'XPHB' },
      { name: 'ray of frost', source: '' },
    ]);
  });

  it.each([
    ['thaumaturgy|xphb#c', { name: 'thaumaturgy', source: 'xphb' }],
    ['hellish rebuke|xphb#2', { name: 'hellish rebuke', source: 'xphb' }],
    ['hellish rebuke#2|xge', { name: 'hellish rebuke', source: 'xge' }],
    ['guidance#c', { name: 'guidance', source: '' }],
    [' mage hand | phb ', { name: 'mage hand', source: 'phb' }],
    ['fireball', { name: 'fireball', source: '' }],
  ])('reads %j as its name and source', (ref, expected) => {
    expect(parseSpellRef(ref)).toEqual(expected);
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

const resources = (effects: EffectInput[]) =>
  effects.filter((e): e is Extract<EffectInput, { kind: 'resource' }> => e.kind === 'resource');

describe('innate usage buckets', () => {
  it('turns a daily bucket into a limited grant with its own pool', () => {
    const col = collect([{ innate: { '1': { daily: { '1': ['hellish rebuke'] } } } }]);
    const g = granted(col.effects);
    expect(g[0]).toMatchObject({ spell: { name: 'hellish rebuke' }, usage: '1/day' });
    const key = g[0]?.resourceKey;
    expect(key).toBeDefined();
    expect(resources(col.effects)[0]).toMatchObject({
      key,
      label: 'Hellish Rebuke',
      max: 1,
      resetOn: 'long',
    });
  });

  it('reads a per-rest bucket as a short-rest pool', () => {
    const col = collect([{ innate: { _: { rest: { '2': ['shield'] } } } }]);
    expect(granted(col.effects)[0]).toMatchObject({ usage: '2/rest' });
    expect(resources(col.effects)[0]).toMatchObject({ max: 2, resetOn: 'short' });
  });

  it('gives each spell its own pool when the count says "each"', () => {
    const col = collect([{ innate: { _: { daily: { '1e': ['bless', 'bane'] } } } }]);
    const g = granted(col.effects);
    expect(g.map((e) => e.usage)).toEqual(['1/day', '1/day']);
    // Two spells, two pools: spending one leaves the other untouched.
    const keys = resources(col.effects).map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
  });

  it('shares one pool when the count has no "each"', () => {
    // "1/day" over a two-spell bucket is one cast between them, not one apiece.
    const col = collect([{ innate: { _: { daily: { '1': ['bless', 'bane'] } } } }]);
    const pools = resources(col.effects);
    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({ label: 'Bless, Bane', max: 1 });
    // Both spells spend from it, so casting either empties the other.
    const keys = granted(col.effects).map((e) => e.resourceKey);
    expect(new Set(keys)).toEqual(new Set([pools[0]?.key]));
  });

  it('reads a choose filter standing where a bucket would as a note, not a spell', () => {
    const col = collect([{ innate: { _: { choose: 'level=1|class=Wizard' } } }]);
    expect(granted(col.effects)).toHaveLength(0);
    expect(col.warnings.join(' ')).toContain('lets you choose a spell');
  });

  it('leaves at-will spells unlimited', () => {
    const col = collect([{ innate: { _: { will: ['detect magic'] } } }]);
    expect(granted(col.effects)[0]?.usage).toBeUndefined();
    expect(resources(col.effects)).toHaveLength(0);
  });

  it('keeps the limit when the same spell is also listed as known', () => {
    const col = collect([
      { known: { _: ['misty step'] }, innate: { _: { daily: { '1': ['misty step'] } } } },
    ]);
    const g = granted(col.effects);
    expect(g).toHaveLength(1);
    expect(g[0]?.usage).toBe('1/day');
  });

  it('gates a daily bucket by character level like any other', () => {
    const col = collect([{ innate: { '5': { daily: { '1': ['fireball'] } } } }], 1);
    expect(granted(col.effects)).toHaveLength(0);
  });
});

describe('collectAdditionalSpells: a chosen spell on a feat', () => {
  const feat: EffectOrigin = { label: 'Test Feat', uid: 'feat|test feat|hb', type: 'feat' };
  const cantrip = { choose: 'level=0|class=Testclass', count: 2 };
  const firstLevel = { choose: 'level=1|school=E;D' };

  function collectFeat(
    raw: unknown,
    choices: Record<string, string[] | string> = {},
    level = 1,
    spells: Array<Record<string, unknown>> = [],
  ) {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Testclass', source: 'HB' }, levels: level, hp: [] }];
    doc.choices = choices;
    const ctx = {
      get: (type: string, name: string, source?: string) =>
        type === 'spell'
          ? spells.find(
              (s) =>
                String(s.name).toLowerCase() === name.toLowerCase() &&
                String(s.source).toLowerCase() === source?.toLowerCase(),
            )
          : undefined,
      byType: () => [],
    };
    const col = new Collector(doc, ctx);
    collectAdditionalSpells(col, raw, feat, undefined, 'feat:base');
    return col;
  }

  const fresh = (col: Collector) => col.pending.filter((p) => col.doc.choices[p.id] === undefined);

  it('asks for the pick and grants nothing until it is made', () => {
    const col = collectFeat([{ ability: 'int', known: { _: [cantrip] } }]);
    expect(col.pending).toHaveLength(1);
    expect(col.pending[0]).toMatchObject({
      id: 'feat:base:spell:u:0:known:_:0',
      kind: 'spell',
      label: 'Test Feat: Testclass cantrips',
      count: 2,
      options: [],
      spellQuery: { levels: [0], classes: ['Testclass'] },
    });
    expect(granted(col.effects)).toEqual([]);
    expect(col.warnings).toEqual([]);
  });

  it('holds the pick back behind the branch and then the ability', () => {
    const raw = [
      { name: 'Alpha', ability: { choose: ['int', 'wis'] }, known: { _: [cantrip] } },
      { name: 'Beta', ability: { choose: ['int', 'wis'] }, known: { _: ['fake fixed'] } },
    ];
    const branch = 'feat:base:branch';
    const ability = 'feat:base:ability:b:alpha:0';
    expect(fresh(collectFeat(raw)).map((p) => p.id)).toEqual([branch]);
    expect(fresh(collectFeat(raw, { [branch]: ['alpha'] })).map((p) => p.id)).toEqual([ability]);
    const opened = collectFeat(raw, { [branch]: ['alpha'], [ability]: ['wis'] });
    expect(fresh(opened).map((p) => p.id)).toEqual(['feat:base:spell:b:alpha:0:known:_:0']);
    // The other option has no pick to make.
    const other = collectFeat(raw, { [branch]: ['beta'], 'feat:base:ability:b:beta:0': ['wis'] });
    expect(fresh(other)).toEqual([]);
  });

  it('waits for the level key, and keeps its id as more levels open', () => {
    const raw = [{ prepared: { _: [firstLevel], 5: [firstLevel] } }];
    const ids = (level: number) => collectFeat(raw, {}, level).pending.map((p) => p.id);
    expect(ids(4)).toEqual(['feat:base:spell:u:0:prepared:_:0']);
    expect(ids(5)).toEqual(
      expect.arrayContaining([
        'feat:base:spell:u:0:prepared:_:0',
        'feat:base:spell:u:0:prepared:5:0',
      ]),
    );
  });

  it('grants a saved pick with the spell files not in yet, as a reload finds it', () => {
    const col = collectFeat([{ ability: 'int', known: { _: [cantrip] } }], {
      'feat:base:spell:u:0:known:_:0': ['Fake One|HB', 'Fake Two|HB'],
    });
    expect(col.pending).toEqual([]);
    expect(granted(col.effects)).toMatchObject([
      { spell: { name: 'Fake One', source: 'HB' }, ability: 'int' },
      { spell: { name: 'Fake Two', source: 'HB' }, ability: 'int' },
    ]);
    expect(col.resolved[0]?.prompt.options.map((o) => o.label)).toEqual(['Fake One', 'Fake Two']);
  });

  it('keeps asking until a multi-pick is full, granting what is picked so far', () => {
    const col = collectFeat([{ known: { _: [cantrip] } }], {
      'feat:base:spell:u:0:known:_:0': ['Fake One|HB'],
    });
    expect(col.pending).toHaveLength(1);
    expect(granted(col.effects)).toHaveLength(1);
  });

  it('gives a pick its bucket: one pool each for "1e", beside the named spell', () => {
    const col = collectFeat([{ innate: { _: { daily: { '1e': ['fake fixed', firstLevel] } } } }], {
      'feat:base:spell:u:0:innate:_:0': ['Fake One|HB'],
    });
    expect(granted(col.effects)).toMatchObject([
      {
        spell: { name: 'fake fixed' },
        usage: '1/day',
        resourceKey: 'spell:feat|test feat|hb:fake-fixed',
      },
      {
        spell: { name: 'Fake One' },
        usage: '1/day',
        resourceKey: 'spell:feat|test feat|hb:fake-one',
      },
    ]);
  });

  it('gives a pick its bucket: one pool between them for a shared count', () => {
    const col = collectFeat([{ innate: { _: { rest: { 1: [{ ...firstLevel, count: 2 }] } } } }], {
      'feat:base:spell:u:0:innate:_:0': ['Fake One|HB', 'Fake Two|HB'],
    });
    const key = 'spell:feat|test feat|hb:fake-one+fake-two';
    expect(granted(col.effects)).toMatchObject([
      { usage: '1/rest', resourceKey: key },
      { usage: '1/rest', resourceKey: key },
    ]);
    expect(col.effects.filter((e) => e.kind === 'resource')).toHaveLength(1);
  });

  it('marks a plain prepared pick as always prepared', () => {
    const col = collectFeat([{ prepared: { _: ['fake fixed', firstLevel] } }], {
      'feat:base:spell:u:0:prepared:_:0': ['Fake One|HB'],
    });
    expect(granted(col.effects)).toMatchObject([
      { spell: { name: 'fake fixed' }, usage: 'prepared' },
      { spell: { name: 'Fake One' }, usage: 'prepared' },
    ]);
  });

  it('gives a limited prepared spell, named or picked, a row for slots and one for its uses', () => {
    const col = collectFeat(
      [{ prepared: { _: { daily: { '1e': ['fake fixed', firstLevel] } } } }],
      {
        'feat:base:spell:u:0:prepared:_:0': ['Fake One|HB'],
      },
    );
    expect(granted(col.effects)).toMatchObject([
      { spell: { name: 'fake fixed' }, usage: 'prepared', slotsOnly: true },
      {
        spell: { name: 'fake fixed' },
        usage: '1/day',
        resourceKey: 'spell:feat|test feat|hb:fake-fixed',
      },
      { spell: { name: 'Fake One' }, usage: 'prepared', slotsOnly: true },
      {
        spell: { name: 'Fake One' },
        usage: '1/day',
        resourceKey: 'spell:feat|test feat|hb:fake-one',
      },
    ]);
    expect(granted(col.effects)[0]?.resourceKey).toBeUndefined();
  });

  it('counts a prepared bucket per spell, even with no "e" on its count', () => {
    const col = collectFeat([{ prepared: { _: { daily: { 1: ['fake fixed', 'fake other'] } } } }]);
    expect(col.effects.filter((e) => e.kind === 'resource')).toMatchObject([
      { key: 'spell:feat|test feat|hb:fake-fixed', max: 1, resetOn: 'long' },
      { key: 'spell:feat|test feat|hb:fake-other', max: 1, resetOn: 'long' },
    ]);
  });

  it('leaves a plain prepared spell with no count as a single row', () => {
    const col = collectFeat([{ prepared: { _: ['fake fixed'] } }]);
    expect(granted(col.effects)).toHaveLength(1);
    expect(granted(col.effects)[0]?.slotsOnly).toBeUndefined();
  });

  it('keeps a prepared spell in a bucket it cannot read as always prepared', () => {
    const col = collectFeat([{ prepared: { _: { ritual: ['fake fixed'] } } }]);
    expect(granted(col.effects)).toMatchObject([{ usage: 'prepared' }]);
  });

  it('casts a prepared pick at will when its bucket says so', () => {
    const col = collectFeat([{ prepared: { _: { will: [firstLevel] } } }], {
      'feat:base:spell:u:0:prepared:_:0': ['Fake One|HB'],
    });
    expect(granted(col.effects)[0]?.usage).toBeUndefined();
  });

  it('asks again for a saved pick that the spell on file does not fit', () => {
    const col = collectFeat(
      [{ known: { _: [{ choose: 'level=0' }] } }],
      { 'feat:base:spell:u:0:known:_:0': ['Fake Big|HB'] },
      1,
      [{ name: 'Fake Big', source: 'HB', level: 9 }],
    );
    expect(granted(col.effects)).toEqual([]);
    expect(col.pending).toHaveLength(1);
    expect(col.warnings.join()).toContain('no longer available');
  });

  it.each<[string, unknown]>([
    ['an empty answer', ['']],
    ['a name with no source', ['Fake One']],
    ['the empty answer the report walks with', ''],
  ])('never grants %s', (_what, saved) => {
    const col = collectFeat([{ known: { _: [{ choose: 'level=0' }] } }], {
      'feat:base:spell:u:0:known:_:0': saved as string[],
    });
    expect(granted(col.effects)).toEqual([]);
    expect(col.pending).toHaveLength(1);
  });

  it('offers a spelled-out list as it is, and grants by name', () => {
    const list = { choose: { from: ['fake one', 'fake two|hb', 'fake three'], count: 2 } };
    const raw = [{ innate: { _: { daily: { '1e': [list] } } } }];
    const asked = collectFeat(raw).pending[0];
    expect(asked).toMatchObject({ count: 2, label: 'Test Feat: Spells from this list' });
    expect(asked?.spellQuery).toBeUndefined();
    expect(asked?.options.map((o) => o.label)).toEqual(['Fake One', 'Fake Two', 'Fake Three']);
    const col = collectFeat(raw, {
      'feat:base:spell:u:0:innate:_:0': ['fake one', 'fake two|hb'],
    });
    expect(granted(col.effects)).toMatchObject([
      { spell: { name: 'fake one', source: '' }, usage: '1/day' },
      { spell: { name: 'fake two', source: 'hb' }, usage: '1/day' },
    ]);
  });

  it('keeps the note for a filter it cannot read, rather than offering too much', () => {
    const col = collectFeat([{ known: { _: [{ choose: 'level=0|sparkle=yes' }] } }]);
    expect(col.pending).toEqual([]);
    expect(col.warnings).toEqual(['Test Feat: also lets you choose a spell. See the trait text.']);
  });
});

describe('collectAdditionalSpells: a chosen spell beyond feats', () => {
  const cantrip = { choose: 'level=0|class=Testclass' };
  const upToThird = { choose: 'level=0;1;2;3' };
  const note = (label: string) => `${label}: also lets you choose a spell. See the trait text.`;

  function collectAs(
    type: EffectOrigin['type'],
    raw: unknown,
    choices: Record<string, string[]> = {},
    level = 1,
  ) {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Testclass', source: 'HB' }, levels: level, hp: [] }];
    doc.choices = choices;
    const col = new Collector(doc, makeTestContext());
    const owner: EffectOrigin = { label: 'Owner', uid: 'owner|hb', type };
    collectAdditionalSpells(col, raw, owner, 'wis', 'base');
    return col;
  }

  it.each<EffectOrigin['type']>(['race', 'subclass'])('asks for a cantrip on a %s', (type) => {
    const col = collectAs(type, [{ known: { 1: { _: [cantrip] } } }]);
    expect(col.warnings).toEqual([]);
    expect(col.pending).toMatchObject([
      {
        id: 'base:spell:u:0:known:1:0',
        kind: 'spell',
        label: 'Owner: Testclass cantrip',
        count: 1,
        options: [],
        spellQuery: { levels: [0], classes: ['Testclass'] },
      },
    ]);
    expect(granted(col.effects)).toEqual([]);
  });

  it('grants the picked cantrip with the default ability, as nothing else to spend', () => {
    const col = collectAs('subclass', [{ known: { 1: { _: [cantrip] } } }], {
      'base:spell:u:0:known:1:0': ['Fake One|HB'],
    });
    expect(col.pending).toEqual([]);
    expect(granted(col.effects)).toMatchObject([
      { spell: { name: 'Fake One', source: 'HB' }, ability: 'wis', usage: undefined },
    ]);
  });

  it('keeps each branch its own pick, so going back finds it', () => {
    const raw = [
      { name: 'Alpha', known: { 1: { _: [cantrip] } } },
      { name: 'Beta', known: { 1: { _: [cantrip] } } },
    ];
    const alpha = 'base:spell:b:alpha:0:known:1:0';
    const beta = 'base:spell:b:beta:0:known:1:0';
    expect(collectAs('subclass', raw).pending.map((p) => p.id)).toEqual(['base:branch']);
    const saved = { [alpha]: ['Fake One|HB'], [beta]: ['Fake Two|HB'] };
    const names = (branch: string) =>
      granted(collectAs('subclass', raw, { 'base:branch': [branch], ...saved }).effects).map(
        (e) => e.spell.name,
      );
    expect(names('alpha')).toEqual(['Fake One']);
    expect(names('beta')).toEqual(['Fake Two']);
  });

  it('holds a race pick back behind the ability the entry asks for', () => {
    const raw = [{ ability: { choose: ['int', 'wis'] }, known: { 1: { _: [cantrip] } } }];
    expect(collectAs('race', raw).pending.map((p) => p.id)).toEqual(['base:ability:u:0']);
    const open = collectAs('race', raw, { 'base:ability:u:0': ['int'] });
    expect(open.pending.map((p) => p.id)).toEqual(['base:spell:u:0:known:1:0']);
    const made = collectAs('race', raw, {
      'base:ability:u:0': ['int'],
      'base:spell:u:0:known:1:0': ['Fake One|HB'],
    });
    expect(granted(made.effects)[0]?.ability).toBe('int');
  });

  it('asks for an always-prepared spell at its level, cast with the class slots', () => {
    const raw = [{ known: { 1: { _: [cantrip] } }, prepared: { 7: [{ choose: 'level=4' }] } }];
    const ids = (level: number) => collectAs('subclass', raw, {}, level).pending.map((p) => p.id);
    expect(ids(6)).toEqual(['base:spell:u:0:known:1:0']);
    // The later pick opens beside the earlier one, which keeps its id.
    expect(ids(7)).toEqual(['base:spell:u:0:known:1:0', 'base:spell:u:0:prepared:7:0']);
    const made = collectAs('subclass', raw, { 'base:spell:u:0:prepared:7:0': ['Fake One|HB'] }, 7);
    expect(granted(made.effects)).toMatchObject([
      { spell: { name: 'Fake One' }, usage: 'prepared' },
    ]);
  });

  it('asks for a spelled-out list its data marks as cantrips', () => {
    const list = { choose: { from: ['fake one|hb#c', 'fake two#c|hb'], count: 1 } };
    const col = collectAs('subclass', [{ innate: { 1: [list] } }]);
    expect(col.warnings).toEqual([]);
    expect(col.pending[0]?.options.map((o) => o.label)).toEqual(['Fake One', 'Fake Two']);
  });

  it.each<[string, unknown]>([
    ['can reach past cantrips', upToThird],
    ['has no level at all', { choose: 'class=Testclass' }],
    [
      'is a list not all marked as cantrips',
      { choose: { from: ['fake one|hb#c', 'fake two|hb'] } },
    ],
  ])('keeps the note for a plain spell whose filter %s', (_what, filter) => {
    for (const raw of [
      { known: { 1: [filter] } },
      { known: { _: [filter] } },
      { innate: { 1: [filter] } },
    ]) {
      const col = collectAs('subclass', [raw]);
      expect(col.pending).toEqual([]);
      expect(col.warnings).toEqual([note('Owner')]);
    }
  });

  // Nothing would limit a leveled spell here, so a race could hand out anything at will.
  it('keeps the note for a leveled spell in a count that is no count', () => {
    const col = collectAs('race', [{ innate: { _: { daily: { 0: [{ choose: 'level=3' }] } } } }]);
    expect(col.pending).toEqual([]);
    expect(col.warnings).toEqual([note('Owner')]);
  });

  it.each<[string, unknown, unknown]>([
    ['a count', { innate: { _: { daily: { 1: [{ choose: 'level=3' }] } } } }, '1/day'],
    [
      'at will, as the bucket says',
      { innate: { _: { will: [{ choose: 'level=3' }] } } },
      undefined,
    ],
  ])('asks for a leveled spell in a bucket with %s', (_what, raw, usage) => {
    const id = 'base:spell:u:0:innate:_:0';
    expect(collectAs('race', [raw]).pending.map((p) => p.id)).toEqual([id]);
    const made = collectAs('race', [raw], { [id]: ['Fake One|HB'] });
    expect(made.warnings).toEqual([]);
    expect(granted(made.effects)[0]).toMatchObject({ spell: { name: 'Fake One' }, usage });
  });

  it('asks a race for an always-prepared spell only with a count to cast it by', () => {
    const plain = collectAs('race', [{ prepared: { 1: [{ choose: 'level=1' }] } }]);
    expect(plain.pending).toEqual([]);
    expect(plain.warnings).toEqual([note('Owner')]);
    const counted = [{ prepared: { 1: { daily: { 1: [{ choose: 'level=1' }] } } } }];
    expect(collectAs('race', counted).pending).toHaveLength(1);
  });

  it('numbers a pick by its place in the data, whatever is offered before it', () => {
    const col = collectAs('subclass', [{ known: { 1: [upToThird, cantrip] } }]);
    expect(col.pending.map((p) => p.id)).toEqual(['base:spell:u:0:known:1:1']);
    expect(col.warnings).toEqual([note('Owner')]);
  });

  it.each<EffectOrigin['type']>([
    'item',
    'background',
    'custom',
  ])('keeps the note on a %s', (type) => {
    const col = collectAs(type, [{ known: { _: [cantrip] } }]);
    expect(col.pending).toEqual([]);
    expect(col.warnings).toEqual([note('Owner')]);
  });

  describe('on a class that learns spells', () => {
    const anyUpToThird = { choose: 'level=0;1;2;3' };
    const row = Array.from({ length: 20 }, (_, i) => i + 2);
    const casters: Record<string, DataEntity> = {
      Knower: { name: 'Knower', casterProgression: 'full', spellsKnownProgression: row },
      Preparer: { name: 'Preparer', casterProgression: 'full', preparedSpells: '<$level$>' },
      Pactbound: { name: 'Pactbound', casterProgression: 'pact', spellsKnownProgression: row },
      Scribe: {
        name: 'Scribe',
        casterProgression: 'full',
        preparedSpells: '<$level$>',
        spellsKnownProgressionFixed: row,
      },
      Plain: { name: 'Plain' },
    };

    function collectFor(
      className: string,
      type: 'class' | 'subclass',
      raw: unknown,
      choices: Record<string, string[]> = {},
      { level = 6, gateLevel }: { level?: number; gateLevel?: number } = {},
    ) {
      const world = makeTestContext();
      const doc = newCharacterDoc('c', 'H', 't');
      const ref = { name: className, source: 'HB' };
      const owned = { name: 'Fake Path', source: 'HB' };
      doc.classes = [
        { ref, levels: level, hp: [], ...(type === 'subclass' ? { subclass: owned } : {}) },
      ];
      doc.choices = choices;
      const col = new Collector(doc, {
        ...world,
        get: (kind, name, source) =>
          kind === 'class' ? casters[name] : world.get(kind, name, source),
      });
      const owner: EffectOrigin =
        type === 'class'
          ? { label: className, uid: refUid(ref), type }
          : { label: 'Fake Path', uid: refUid(owned), type };
      collectAdditionalSpells(col, raw, owner, 'cha', 'base', gateLevel);
      return col;
    }
    const known = { known: { 1: [anyUpToThird] } };
    const id = 'base:spell:u:0:known:1:0';

    it.each([
      'Knower',
      'Preparer',
      'Pactbound',
    ])('asks on a %s, and the pick casts with class slots', (className) => {
      expect(collectFor(className, 'subclass', [known]).pending.map((p) => p.id)).toEqual([id]);
      const made = collectFor(className, 'subclass', [known], { [id]: ['Fake One|HB'] });
      expect(made.warnings).toEqual([]);
      expect(granted(made.effects)).toMatchObject([
        { spell: { name: 'Fake One' }, ability: 'cha', usage: 'prepared' },
      ]);
    });

    it.each(['Scribe', 'Plain'])('keeps the note on a %s, which has no slots to give', (name) => {
      const col = collectFor(name, 'subclass', [known]);
      expect(col.pending).toEqual([]);
      expect(col.warnings).toEqual([note('Fake Path')]);
    });

    it('leaves a pick that can only be a cantrip outside the class slots', () => {
      const raw = [{ known: { 1: [cantrip] } }];
      const made = collectFor('Knower', 'subclass', raw, { [id]: ['Fake One|HB'] });
      expect(granted(made.effects)).toMatchObject([{ usage: undefined }]);
    });

    it('leaves a named spell beside a pick as it was', () => {
      const raw = [{ known: { 1: ['fake fixed', anyUpToThird] } }];
      const made = collectFor('Knower', 'subclass', raw, { [id]: ['Fake One|HB'] });
      expect(granted(made.effects)).toMatchObject([
        { spell: { name: 'fake fixed' }, usage: undefined },
        { spell: { name: 'Fake One' }, usage: 'prepared' },
      ]);
    });

    it('holds a second pick to its own place, whichever is picked first', () => {
      const raw = [{ known: { 1: [anyUpToThird, cantrip] } }];
      const second = 'base:spell:u:0:known:1:1';
      const made = collectFor('Knower', 'subclass', raw, { [second]: ['Fake Two|HB'] });
      expect(made.pending.map((p) => p.id)).toEqual([id]);
      expect(granted(made.effects)).toMatchObject([
        { spell: { name: 'Fake Two' }, usage: undefined },
      ]);
    });

    it('reads a class for its picks alone, not what it names or expands', () => {
      const raw = [{ known: { 1: ['fake fixed', anyUpToThird] }, expanded: { 1: ['fake wide'] } }];
      const made = collectFor('Knower', 'class', raw, { [id]: ['Fake One|HB'] });
      expect(granted(made.effects).map((e) => e.spell.name)).toEqual(['Fake One']);
      expect(made.warnings).toEqual([]);
    });

    it('marks a class pick as taking a place in spells known, and no subclass pick', () => {
      const choices = { [id]: ['Fake One|HB'] };
      expect(granted(collectFor('Knower', 'class', [known], choices).effects)).toMatchObject([
        { countsAsKnown: true },
      ]);
      expect(
        granted(collectFor('Knower', 'subclass', [known], choices).effects)[0],
      ).not.toHaveProperty('countsAsKnown');
    });

    it.each<[string, unknown, string]>([
      ['can only be a cantrip', { known: { 1: [cantrip] } }, id],
      [
        'sits in a bucket of its own',
        { innate: { 1: { will: [anyUpToThird] } } },
        'base:spell:u:0:innate:1:0',
      ],
      ['is always prepared', { prepared: { 1: [anyUpToThird] } }, 'base:spell:u:0:prepared:1:0'],
    ])('takes no place in spells known for a class pick that %s', (_what, raw, pickId) => {
      const made = collectFor('Knower', 'class', [raw], { [pickId]: ['Fake One|HB'] });
      expect(granted(made.effects).map((e) => e.spell.name)).toEqual(['Fake One']);
      expect(granted(made.effects)[0]).not.toHaveProperty('countsAsKnown');
    });

    it('offers any spell for an empty filter, and keeps what was picked', () => {
      const raw = [{ known: { 1: [{ choose: '' }] } }];
      const asked = collectFor('Knower', 'class', raw).pending[0];
      expect(asked?.label).toBe('Knower: Any spell');
      const made = collectFor('Knower', 'class', raw, { [id]: ['Fake One|HB'] });
      expect(granted(made.effects).map((e) => e.spell.name)).toEqual(['Fake One']);
    });

    it('opens a key by the level it is given, not the character level', () => {
      const raw = [{ known: { 6: [anyUpToThird] } }];
      expect(collectFor('Knower', 'class', raw, {}, { level: 6 }).pending).toHaveLength(1);
      expect(collectFor('Knower', 'class', raw, {}, { level: 6, gateLevel: 5 }).pending).toEqual(
        [],
      );
    });
  });

  it('leaves the named spells beside a pick as they were', () => {
    const col = collectAs('race', [{ known: { 1: ['fake fixed', upToThird] } }]);
    expect(granted(col.effects)).toMatchObject([
      { spell: { name: 'fake fixed' }, ability: 'wis', usage: undefined },
    ]);
    expect(col.warnings).toEqual([note('Owner')]);
  });
});
