import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE, RULE_SET_LIMITS, RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import {
  builtInRowsFor,
  builtInRuleFor,
  emitRuleRows,
  mechanicsOf,
  readRuleSet,
  readStoredEffects,
} from './mechanics';

// Invented rows: what the reader and the seam do with them is the point. Keys
// reuse real feature names (Stunning Strike), which are rule facts.

const ruleSet = (rows: unknown[], body: Record<string, unknown> = {}) => ({
  type: RULE_SET_TYPE,
  v: 1,
  name: 'Built-in rules',
  rows,
  ...body,
});
const row = (keys: unknown[], effects: unknown[], scan?: 'replace' | 'keep') => ({
  part: 'curated',
  keys,
  ...(scan !== undefined ? { scan } : {}),
  effects,
});
const cue = (text: string) => ({ kind: 'cue', text });

function world(extra: Record<string, DataEntity[]>, more: Partial<EngineContext> = {}) {
  const base = makeTestContext();
  const ctx: EngineContext = {
    get(type, name, source) {
      const hit = (extra[type] ?? []).find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      );
      return hit ?? base.get(type, name, source);
    },
    byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
    ...more,
  };
  return ctx;
}
const withRules = (...sets: unknown[]) => world({ [RULE_SET_TYPE]: sets as DataEntity[] });

function character(edit: (d: CharacterDoc) => void = () => {}): CharacterDoc {
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.abilities.base = { str: 14, dex: 14, con: 14, int: 10, wis: 16, cha: 10 };
  d.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
  ];
  d.play.hpInitialized = true;
  d.play.currentHp = 30;
  edit(d);
  return d;
}

const origin: EffectOrigin = { label: 'Lantern', uid: 'lantern|hb', type: 'feat' };

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('readRuleSet', () => {
  it('reads every row, with its keys lowercased and the prose scan off by default', () => {
    const read = readRuleSet(
      ruleSet(
        [
          row([' Stunning Strike|Monk ', 'stunning strike|warrior'], [cue('Stun')]),
          row(['alert|phb'], [{ kind: 'initiativeBonus', amount: 5 }], 'keep'),
        ],
        { edition: 'both' },
      ),
    );
    expect(read.problems).toEqual([]);
    expect(read.name).toBe('Built-in rules');
    expect(read.edition).toBe('both');
    expect(read.rows.map((r) => [r.part, r.keys, r.scan, r.effects.length])).toEqual([
      ['curated', ['stunning strike|monk', 'stunning strike|warrior'], 'replace', 1],
      ['curated', ['alert|phb'], 'keep', 1],
    ]);
  });

  it('reads one object once', () => {
    const raw = ruleSet([row(['a'], [])]);
    expect(readRuleSet(raw)).toBe(readRuleSet(raw));
  });

  it('reads nothing of what is not a rule set it knows, and says why', () => {
    expect(readRuleSet('rules')).toEqual({
      name: 'A rule set',
      rows: [],
      problems: ['is not a rule set'],
    });
    expect(readRuleSet({ ...ruleSet([row(['a'], [])]), type: 'rulePack' }).problems).toEqual([
      '"type" is "ruleSet"',
    ]);
    expect(readRuleSet(ruleSet([row(['a'], [])], { v: 99 }))).toMatchObject({
      rows: [],
      problems: ['made with a newer Cast Guidance: update to use its mechanics'],
    });
    expect(readRuleSet(ruleSet([], { v: undefined })).problems).toEqual([
      'its mechanics have no version, so they do not count',
    ]);
    expect(readRuleSet(ruleSet([], { rows: {} })).problems).toEqual(['"rows" is not a list']);
    expect(readRuleSet(ruleSet([], { name: ' ' })).name).toBe('A rule set');
  });

  it('keeps its rows when only the edition is wrong', () => {
    const read = readRuleSet(ruleSet([row(['a'], [])], { edition: '5e' }));
    expect(read.problems).toEqual(['"edition" is "2014", "2024" or "both"']);
    expect(read.edition).toBeUndefined();
    expect(read.rows).toHaveLength(1);
  });

  it('leaves out each row it cannot read, says why, and reads the rest', () => {
    const read = readRuleSet(
      ruleSet([
        'a row',
        { part: 'nowhere', keys: ['a'], effects: [] },
        { part: 'curated', keys: ['a'], scan: 'maybe', effects: [] },
        { part: 'curated', keys: [], effects: [] },
        { part: 'curated', effects: [] },
        { part: 'curated', keys: ['b'], effects: {} },
        row(['c', 7, ' ', 'x'.repeat(201)], [cue('C')]),
        row(['d'], [cue('D'), { kind: 'fly' }]),
      ]),
    );
    expect(read.problems).toEqual([
      'row 1: is not a row',
      'row 2: has no part "nowhere"',
      'row 3: "scan" is "replace" or "keep"',
      'row 4: "keys" lists the keys it is found under',
      'row 5: "keys" lists the keys it is found under',
      'row 6 (b): "effects" is not a list',
      'row 7: a key is a name, as "stunning strike|monk"',
      'row 7: a key is a name, as "stunning strike|monk"',
      'row 7: a key is a name, as "stunning strike|monk"',
      'row 8 (d): effect 2 (fly): has no kind "fly"',
    ]);
    expect(read.rows.map((r) => [r.keys, r.effects.length])).toEqual([
      [['c'], 1],
      [['d'], 1],
    ]);
  });

  describe('strictly, as the app’s own files', () => {
    // Each holds a field the reader does not read, or reads past.
    const unread = [
      {
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['save'] },
        when: 'against being frightened',
      },
      { kind: 'action', economy: 'none', label: 'Shove', save: { targetAbility: 'str', dc: 12 } },
      { kind: 'acBonus', amount: 1, while: { effect: 'Rage', until: 'end' } },
      { kind: 'acBonus', amount: { f: 'prof', byLevel: { 1: 1 } } },
      { kind: 'acBonus', amount: { f: 'prof', round: 'up' } },
    ];

    it('says what a row holds that it does not read, and leaves that effect out', () => {
      const read = readRuleSet(ruleSet([row(['b'], [...unread, cue('Kept')])]));
      expect(read.problems).toEqual([
        'row 1 (b): effect 1 (rollAdvantage): "when" is not a field this kind reads',
        'row 1 (b): effect 2 (action): "save.dc" is not a field this kind reads',
        'row 1 (b): effect 3 (acBonus): "while.until" is not a field a state reads',
        'row 1 (b): effect 4 (acBonus): "amount" is a formula or a level table, not both',
        'row 1 (b): effect 5 (acBonus): "amount.round" is not a field an amount reads',
      ]);
      expect(read.rows.map((r) => [r.keys, r.effects.map((e) => e.effect.kind)])).toEqual([
        [['b'], ['cue']],
      ]);
    });

    it('leaves out a row with a field its part does not have, and names a set’s', () => {
      const read = readRuleSet(
        ruleSet([{ ...row(['a'], [cue('A')]), level: 3 }, row(['b'], [])], { author: 'me' }),
      );
      expect(read.problems).toEqual([
        '"author" is not a field a rule set has',
        'row 1: "level" is not a field a curated row has',
      ]);
      expect(read.rows.map((r) => r.keys)).toEqual([['b']]);
    });

    it('while a player’s file keeps reading past what it does not know', () => {
      const read = readStoredEffects(unread);
      expect(read.problems).toEqual([]);
      expect(read.effects).toHaveLength(unread.length);
    });
  });

  it('keeps the first row under a key and says so of a later one', () => {
    const read = readRuleSet(
      ruleSet([row(['a', 'b'], [cue('First')]), row(['B', 'c'], [cue('Second')]), row(['a'], [])]),
    );
    expect(read.problems).toEqual(['row 2: "b" is already a row', 'row 3: "a" is already a row']);
    expect(read.rows.map((r) => r.keys)).toEqual([['a', 'b'], ['c']]);
  });

  it('lets a row it left out take no keys, and a row name a key once', () => {
    const read = readRuleSet(
      ruleSet([{ part: 'curated', keys: ['a'], effects: {} }, row(['a', 'A'], [cue('A')])]),
    );
    expect(read.problems).toEqual([
      'row 1 (a): "effects" is not a list',
      'row 2: "a" is already a row',
    ]);
    expect(read.rows.map((r) => r.keys)).toEqual([['a']]);
  });

  it('counts only so many keys in a row and rows in a set', () => {
    const keys = Array.from({ length: RULE_SET_LIMITS.keysPerRow + 2 }, (_, i) => `k${i}`);
    const wide = readRuleSet(ruleSet([row(keys, [])]));
    expect(wide.problems).toEqual([
      `row 1: only the first ${RULE_SET_LIMITS.keysPerRow} keys count`,
    ]);
    expect(wide.rows[0]?.keys).toHaveLength(RULE_SET_LIMITS.keysPerRow);
    const rows = Array.from({ length: RULE_SET_LIMITS.rowsPerSet + 1 }, (_, i) =>
      row([`r${i}`], []),
    );
    const long = readRuleSet(ruleSet(rows));
    expect(long.problems).toEqual([`only the first ${RULE_SET_LIMITS.rowsPerSet} rows count`]);
    expect(long.rows).toHaveLength(RULE_SET_LIMITS.rowsPerSet);
  });
});

// ---------------------------------------------------------------------------

describe('standing rows', () => {
  const standing = (keys: unknown[], effects: unknown[], level?: unknown) => ({
    part: 'standing',
    keys,
    ...(level !== undefined ? { level } : {}),
    effects,
  });
  const resist = (damageType: string) => ({ kind: 'resist', damageType });

  it('read beside the scan, at one feature level or at every one', () => {
    const read = readRuleSet(
      ruleSet([
        standing(['Desert|Storm'], [resist('fire')], 6),
        standing(['desert|storm'], [resist('cold')], 14),
        standing(['desert|storm'], [cue('Hot')]),
      ]),
    );
    expect(read.problems).toEqual([]);
    expect(read.rows.map((r) => [r.part, r.keys, r.scan, r.level])).toEqual([
      ['standing', ['desert|storm'], 'keep', 6],
      ['standing', ['desert|storm'], 'keep', 14],
      ['standing', ['desert|storm'], 'keep', undefined],
    ]);
  });

  it('leave out a scan, a level that is not a feature level, and a key taken at that level', () => {
    const read = readRuleSet(
      ruleSet([
        { ...standing(['a'], []), scan: 'keep' },
        ...[0, 21, 2.5, '6'].map((level) => standing(['b'], [], level)),
        standing(['c'], [], 6),
        standing(['C'], [], 6),
        standing(['c'], []),
      ]),
    );
    expect(read.problems).toEqual([
      'row 1: "scan" is not a field a standing row has',
      ...[2, 3, 4, 5].map(
        (n) => `row ${n}: "level" is a feature level, 1 to ${RULE_SET_LIMITS.level}`,
      ),
      'row 7: "c @6" is already a row',
    ]);
    expect(read.rows.map((r) => [r.keys, r.level])).toEqual([
      [['c'], 6],
      [['c'], undefined],
    ]);
  });

  const at = (
    ctx: EngineContext,
    keys: string[],
    level: number,
    inCode?: (k: string) => boolean,
  ) => {
    const col = new Collector(character(), ctx);
    const rows = builtInRowsFor(col, 'standing', keys, inCode);
    if (rows !== undefined) emitRuleRows(col, rows, origin, level, level);
    return { found: rows !== undefined, effects: col.effects };
  };
  const types = (effects: readonly { kind: string }[]) =>
    effects.map((e) => ('damageType' in e ? e.damageType : e.kind));

  it('emit the rows at the feature level and those at every level, with the origin itself', () => {
    const ctx = withRules(
      ruleSet([
        standing(['desert|storm'], [resist('fire')], 6),
        standing(['desert|storm'], [resist('cold')]),
      ]),
    );
    expect(types(at(ctx, ['desert|storm'], 6).effects)).toEqual(['fire', 'cold']);
    expect(types(at(ctx, ['desert|storm'], 3).effects)).toEqual(['cold']);
    expect(at(ctx, ['desert|storm'], 6).effects.every((e) => e.origin === origin)).toBe(true);
  });

  it('find a key whose rows are all at other levels, so no later key is read', () => {
    const ctx = withRules(
      ruleSet([
        standing(['desert|storm'], [resist('fire')], 6),
        standing(['desert|copy'], [resist('acid')]),
      ]),
    );
    expect(at(ctx, ['desert|storm', 'desert|copy'], 3)).toEqual({ found: true, effects: [] });
    expect(types(at(ctx, ['none', 'desert|copy'], 3).effects)).toEqual(['acid']);
  });

  it('stop at an earlier key the code table still has a row under', () => {
    const ctx = withRules(ruleSet([standing(['b'], [resist('fire')])]));
    expect(at(ctx, ['a', 'b'], 1, (k) => k === 'a')).toEqual({ found: false, effects: [] });
    expect(types(at(ctx, ['b'], 1, (k) => k === 'b').effects)).toEqual(['fire']);
  });

  it('take a later set’s row at the same level, and keep the earlier set’s at others', () => {
    const ctx = withRules(
      ruleSet([
        standing(['desert|storm'], [resist('fire')], 6),
        standing(['desert|storm'], [resist('cold')], 14),
      ]),
      ruleSet([standing(['desert|storm'], [resist('acid')], 6)], { name: 'Later' }),
    );
    expect(types(at(ctx, ['desert|storm'], 6).effects)).toEqual(['acid']);
    expect(types(at(ctx, ['desert|storm'], 14).effects)).toEqual(['cold']);
  });

  it('are not curated rows, nor the other way round', () => {
    const ctx = withRules(
      ruleSet([standing(['lantern|hb'], [resist('fire')]), row(['lamp|hb'], [cue('Lit')])]),
    );
    const col = new Collector(character(), ctx);
    expect(builtInRuleFor(col, 'curated', ['lantern|hb'])).toBeUndefined();
    expect(builtInRowsFor(col, 'standing', ['lamp|hb'])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('mechanicsOf: a built-in row is the curated row', () => {
  const subject = (col: Collector, extra: Partial<Parameters<typeof mechanicsOf>[1]> = {}) => {
    const inherited = vi.fn(() => {
      col.add({ kind: 'speedBonus', amount: 10, origin });
    });
    mechanicsOf(col, {
      entry: { name: 'Lantern' },
      label: 'Lantern',
      origin,
      target: 'lantern|hb',
      ruleKeys: ['lantern|hb'],
      inherited,
      ...extra,
    });
    return inherited;
  };
  const kinds = (col: Collector) => col.effects.map((e) => e.kind);

  it('emits its effects with the subject origin itself, then tells the call site', () => {
    const col = new Collector(character(), withRules(ruleSet([row(['lantern|hb'], [cue('Lit')])])));
    const inherited = subject(col);
    expect(kinds(col)).toEqual(['cue', 'speedBonus']);
    // The object itself, as `CURATED` rows add it: spend links find actions by it.
    expect(col.effects[0]?.origin).toBe(origin);
    expect(inherited).toHaveBeenCalledWith({ scan: 'replace' });
    expect(col.warnings).toEqual([]);
  });

  it('tells the call site a row that keeps the prose scan', () => {
    const col = new Collector(
      character(),
      withRules(ruleSet([row(['lantern|hb'], [cue('Lit')], 'keep')])),
    );
    expect(subject(col)).toHaveBeenCalledWith({ scan: 'keep' });
  });

  it('looks for none without keys, and finds none under keys no row has', () => {
    const ctx = withRules(ruleSet([row(['lantern|hb'], [cue('Lit')])]));
    const col = new Collector(character(), ctx);
    expect(subject(col, { ruleKeys: undefined })).toHaveBeenCalledWith(undefined);
    expect(subject(col, { ruleKeys: ['other|hb'] })).toHaveBeenCalledWith(undefined);
    expect(kinds(col)).toEqual(['speedBonus', 'speedBonus']);
  });

  it('takes the row of the first key that has one, whatever its case', () => {
    const ctx = withRules(ruleSet([row(['b'], [cue('B')]), row(['a'], [cue('A')])]));
    const col = new Collector(character(), ctx);
    subject(col, { ruleKeys: ['none', 'A', 'b'] });
    expect(col.effects[0]).toMatchObject({ kind: 'cue', text: 'A' });
    expect(builtInRuleFor(col, 'curated', ['NONE', 'B'])?.keys).toEqual(['b']);
  });

  it('stops at an earlier key the code table still has a row under', () => {
    const ctx = withRules(ruleSet([row(['b'], [cue('B')])]));
    const inCode = (key: string) => key === 'a';
    const col = new Collector(character(), ctx);
    expect(subject(col, { ruleKeys: ['A', 'b'], inCode })).toHaveBeenCalledWith(undefined);
    expect(kinds(col)).toEqual(['speedBonus']);
    // Under the same key, the built-in row is the one read.
    expect(builtInRuleFor(col, 'curated', ['b'], (key) => key === 'b')?.keys).toEqual(['b']);
    expect(builtInRuleFor(col, 'curated', ['c', 'b'], inCode)?.keys).toEqual(['b']);
  });

  it('takes the later set’s row under the same key', () => {
    const ctx = withRules(
      ruleSet([row(['lantern|hb'], [cue('One')])]),
      ruleSet([row(['lantern|hb'], [cue('Two')])], { name: 'Later' }),
    );
    const col = new Collector(character(), ctx);
    subject(col);
    expect(col.effects[0]).toMatchObject({ kind: 'cue', text: 'Two' });
  });

  it('gives way to a pack’s replacement, and sits beside a pack’s addition', () => {
    const pack = (patch: Record<string, unknown>): DataEntity => ({
      name: 'Gritty',
      source: 'Gritty',
      appliesTo: { characters: ['hero'] },
      castGuidance: { v: 1, patches: [{ target: 'lantern|hb', ...patch }] },
    });
    const sets = [ruleSet([row(['lantern|hb'], [cue('Lit')])])] as DataEntity[];
    const replaced = new Collector(
      character(),
      world({
        [RULE_SET_TYPE]: sets,
        [RULE_PACK_TYPE]: [pack({ effects: [{ kind: 'acBonus', amount: 2 }] })],
      }),
    );
    expect(subject(replaced)).not.toHaveBeenCalled();
    expect(kinds(replaced)).toEqual(['acBonus']);
    const added = new Collector(
      character(),
      world({ [RULE_SET_TYPE]: sets, [RULE_PACK_TYPE]: [pack({ add: [cue('Grit')] })] }),
    );
    subject(added);
    expect(added.effects.map((e) => [e.kind, e.origin.pack])).toEqual([
      ['cue', 'Gritty'],
      ['cue', undefined],
      ['speedBonus', undefined],
    ]);
  });

  it('gives way to an entry that replaces what it inherits, and drops what its entry drops', () => {
    const ctx = withRules(
      ruleSet([row(['lantern|hb'], [cue('Lit'), { kind: 'acBonus', amount: 1 }])]),
    );
    const replaced = new Collector(character(), ctx);
    const inherited = subject(replaced, {
      entry: {
        castGuidance: { v: 1, replace: true, effects: [{ kind: 'initiativeBonus', amount: 1 }] },
      },
    });
    expect(inherited).not.toHaveBeenCalled();
    expect(kinds(replaced)).toEqual(['initiativeBonus']);
    const dropped = new Collector(character(), ctx);
    subject(dropped, { entry: { castGuidance: { v: 1, drop: [{ kind: 'cue' }] } } });
    expect(kinds(dropped)).toEqual(['acBonus', 'speedBonus']);
  });

  it('marks its formulas built-in, and only its own', () => {
    const ctx = withRules(
      ruleSet([row(['lantern|hb'], [{ kind: 'acBonus', amount: { f: 'prof' } }])]),
    );
    const col = new Collector(character(), ctx);
    subject(col, {
      entry: { castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: { f: 'prof' } }] } },
    });
    expect(col.effects.map((e) => e.formulas?.[0]?.builtIn)).toEqual([undefined, true, undefined]);
  });

  it('says what in a set does not count once, on the console, never on the sheet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = withRules(ruleSet([row(['lantern|hb'], [{ kind: 'fly' }]), 'a row']));
    for (let i = 0; i < 2; i++) {
      const col = new Collector(character(), ctx);
      subject(col);
      expect(col.warnings).toEqual([]);
    }
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Built-in rules: row 1 (lantern|hb): effect 1 (fly): has no kind "fly"; row 2: is not a row',
    );
  });

  it('reads past a set that is not an object', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const col = new Collector(
      character(),
      withRules(null, ruleSet([row(['lantern|hb'], [cue('Lit')])])),
    );
    subject(col);
    expect(kinds(col)).toEqual(['cue', 'speedBonus']);
    expect(warn).toHaveBeenCalledWith('A rule set: is not a rule set');
  });
});

// ---------------------------------------------------------------------------

describe('the call sites read built-in rows', () => {
  const monk = (d: CharacterDoc) => {
    d.classes = [{ ref: { name: 'Monk', source: 'TST' }, levels: 5, hp: Array(5).fill('avg') }];
  };
  const stunning = (sheet: ReturnType<typeof deriveSheet>) =>
    sheet.actions.filter((a) => a.label === 'Stunning Strike');

  it("a class feature's row is read under name|class, a later set's over the shipped one", () => {
    // The shipped set's Stunning Strike row (`src/rules/cast-guidance/curated.json`).
    const plain = deriveSheet(character(monk), world({}));
    expect(stunning(plain)).toHaveLength(1);
    const sheet = deriveSheet(
      character(monk),
      withRules(
        ruleSet([
          row(
            ['stunning strike|monk'],
            [
              {
                kind: 'action',
                economy: 'none',
                label: 'Stunning Strike',
                note: 'from the rule set',
                save: { targetAbility: 'con', dcAbility: 'wis' },
              },
            ],
          ),
        ]),
      ),
    );
    expect(stunning(sheet).map((a) => [a.note, a.save?.dc])).toEqual([['from the rule set', 14]]);
  });

  it("a class's own row is read under class:", () => {
    const sheet = deriveSheet(
      character(monk),
      withRules(ruleSet([row(['class:monk|tst'], [cue('Monk row')])])),
    );
    expect(sheet.cues).toContainEqual({ tone: 'info', text: 'Monk row', origin: 'Monk' });
  });

  it('reads a CURATED row under an earlier key before a built-in row under a later one', () => {
    // An Alert|PHB that copies Gift|HB: its keys are alert|phb, then gift|hb.
    const alert: DataEntity = {
      name: 'Alert',
      source: 'PHB',
      entries: ['You are alert.'],
      castGuidance: { v: 1, basedOn: 'Gift|HB' },
    };
    const sheet = deriveSheet(
      character((d) => {
        d.feats = [{ ref: { name: 'Alert', source: 'PHB' }, instanceId: 'f0' }];
      }),
      world({
        feat: [alert],
        [RULE_SET_TYPE]: [ruleSet([row(['gift|hb'], [cue('Gift row')])])] as DataEntity[],
      }),
    );
    expect(sheet.initiative.parts.find((p) => p.label === 'Alert')?.amount).toBe(5);
    expect(sheet.cues.map((c) => c.text)).not.toContain('Gift row');
  });

  describe('a feat, whose prose the scan reads', () => {
    const gift: DataEntity = {
      name: 'Gift',
      source: 'HB',
      entries: ['You can use it once per long rest.'],
    };
    const sheetWith = (...sets: unknown[]) =>
      deriveSheet(
        character((d) => {
          d.feats = [{ ref: { name: 'Gift', source: 'HB' }, instanceId: 'f0' }];
        }),
        world({ feat: [gift], [RULE_SET_TYPE]: sets as DataEntity[] }),
      );
    const scanned = (sheet: ReturnType<typeof deriveSheet>) =>
      sheet.resources.some((r) => r.label === 'Gift');
    const cued = (sheet: ReturnType<typeof deriveSheet>) =>
      sheet.cues.some((c) => c.text === 'Gift row');

    it('scans it without a row', () => {
      const sheet = sheetWith();
      expect([scanned(sheet), cued(sheet)]).toEqual([true, false]);
    });

    it('scans it no more under a row that replaces the scan', () => {
      const sheet = sheetWith(ruleSet([row(['gift|hb'], [cue('Gift row')])]));
      expect([scanned(sheet), cued(sheet)]).toEqual([false, true]);
    });

    it('scans it beside a row that keeps the scan', () => {
      const sheet = sheetWith(ruleSet([row(['gift|hb'], [cue('Gift row')], 'keep')]));
      expect([scanned(sheet), cued(sheet)]).toEqual([true, true]);
    });
  });

  it('a race trait is read under trait:', () => {
    const testfolk = (d: CharacterDoc) => {
      d.race = { name: 'Testfolk', source: 'TST' };
    };
    const endures = (sheet: ReturnType<typeof deriveSheet>) =>
      sheet.resources.some((r) => r.label === 'Relentless Endurance');
    expect(endures(deriveSheet(character(testfolk), world({})))).toBe(true);
    const sheet = deriveSheet(
      character(testfolk),
      withRules(ruleSet([row(['trait:relentless endurance'], [cue('Endure')])])),
    );
    expect(endures(sheet)).toBe(false);
    expect(sheet.cues.map((c) => c.text)).toContain('Endure');
    const kept = deriveSheet(
      character(testfolk),
      withRules(ruleSet([row(['trait:relentless endurance'], [cue('Endure')], 'keep')])),
    );
    expect(endures(kept)).toBe(true);
    expect(kept.cues.map((c) => c.text)).toContain('Endure');
  });

  it("an optional feature's row stands in for its CURATED row", () => {
    const sheetWith = (ctx: EngineContext) => {
      const doc = character();
      const prompt = deriveSheet(doc, ctx).pending.find((p) => p.kind === 'optionalfeature');
      expect(prompt).toBeDefined();
      doc.choices[prompt?.id ?? ''] = ['defense|phb'];
      return deriveSheet(doc, ctx);
    };
    const defense = (sheet: ReturnType<typeof deriveSheet>) =>
      sheet.ac.parts.filter((p) => p.label.endsWith('Defense')).map((p) => p.amount);
    const plain = sheetWith(world({}));
    expect(defense(plain)).toEqual([1]);
    const sheet = sheetWith(
      withRules(ruleSet([row(['defense|phb'], [{ kind: 'acBonus', amount: 3 }])])),
    );
    expect(defense(sheet)).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------

describe('built-in rules and the sheet', () => {
  it('spend none of the formula budget, so they never crowd out a player’s', () => {
    // 99 steps each, as the per-derive budget test counts them.
    const heavy = { f: `max(1${',0'.repeat(97)})` };
    const many = (n: number) =>
      Array.from({ length: n }, () => ({ kind: 'acBonus', amount: heavy }));
    const names = ['A', 'B', 'C', 'D'];
    const ctx = world({
      feat: names.map((n) => ({
        name: n,
        source: 'HB',
        entries: [`${n} does something.`],
        castGuidance: { v: 1, effects: many(64) },
      })),
      [RULE_SET_TYPE]: [ruleSet([row(['class:warrior|tst'], many(64))])] as DataEntity[],
    });
    const doc = character((d) => {
      d.feats = names.map((n, i) => ({ ref: { name: n, source: 'HB' }, instanceId: `f${i}` }));
    });
    const sheet = deriveSheet(doc, ctx);
    const counted = (label: string) =>
      sheet.ac.parts.filter((p) => p.label === label && p.amount === 1).length;
    expect(counted('Warrior')).toBe(64);
    // As many of the player's as fit without them (138 if they spent it): 202 of 256.
    expect(names.reduce((sum, n) => sum + counted(n), 0)).toBe(202);
  });

  it('says on every sheet when they did not load', () => {
    const sheet = deriveSheet(character(), world({}, { ruleSetsFailed: true }));
    expect(sheet.warnings).toContain(
      'The built-in rules did not load, so some features show no mechanics. Reload to try again.',
    );
    expect(deriveSheet(character(), world({})).warnings).not.toContain(
      expect.stringContaining('built-in rules'),
    );
  });
});
