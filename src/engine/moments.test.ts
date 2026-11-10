import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { CAST_GUIDANCE_LIMITS as L, MOMENTS, RULE_PACK_TYPE } from './castGuidance';
import { deriveSheet } from './derive';
import {
  conditionEnded,
  conditionEndings,
  type EffectChange,
  type HpLimits,
  knockedOut,
  maxHpFrom,
  newTurn,
  spellCast,
} from './effectLife';
import { parseFormula } from './formula';
import {
  collectMoments,
  type MomentsInForce,
  momentsAt,
  momentsInForce,
  readMoments,
} from './moments';
import {
  type ActiveEffect,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  type FormulaScope,
  newCharacterDoc,
  type PlayState,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cue = (text = 'Mind the edge') => ({ kind: 'cue', text });

/** A character at 30 of 40 HP, in play. */
function play(): PlayState {
  const p = newCharacterDoc('hild', 'Hild', 'tag').play;
  p.currentHp = 30;
  p.hpInitialized = true;
  return p;
}

const SCOPE: FormulaScope = {
  level: 5,
  classLevel: 5,
  prof: 3,
  hp: 0,
  maxHp: 40,
  mod: { str: 0, dex: 2, con: 1, int: 0, wis: 1, cha: 3 },
  score: { str: 10, dex: 14, con: 12, int: 10, wis: 12, cha: 16 },
};

/** Moments in force from stored ones, as a pack named Gritty would give them. */
function inForce(raw: unknown[], pools = [{ key: 'grit', label: 'Grit', max: 4 }]): MomentsInForce {
  const read = readMoments(raw, 'Gritty');
  expect(read.problems).toEqual([]);
  return { moments: read.moments, scope: SCOPE, pools, hpWhenDerived: 30 };
}

/** The sheet's maximum with the effects in `p` counted: 40 before any. */
const limits = (p: PlayState, moments?: MomentsInForce): HpLimits => ({
  maxHp: 40 + maxHpFrom(p.activeEffects),
  edition: '2024',
  ...(moments !== undefined ? { moments } : {}),
});

const bless = (mine = true): ActiveEffect => ({
  id: 'bless',
  name: 'Bless',
  parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
  lasts: { minutes: 1, concentration: true },
  ...(mine ? { mine: true } : {}),
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('readMoments', () => {
  it('reads every moment the app sees', () => {
    for (const at of MOMENTS) {
      const read = readMoments([{ at, do: [cue()] }], 'Gritty');
      expect(read.problems, at).toEqual([]);
      expect(read.moments, at).toEqual([
        { at, do: [{ kind: 'cue', text: 'Mind the edge', tone: 'info' }], from: 'Gritty' },
      ]);
    }
  });

  it('reads each outcome', () => {
    const read = readMoments(
      [
        {
          at: 'zeroHp',
          do: [
            { kind: 'addCondition', condition: 'exhaustion' },
            { kind: 'addCondition', condition: 'Dazed', level: 2 },
            {
              kind: 'addEffect',
              name: 'Second Wind',
              effects: [{ kind: 'acBonus', amount: { f: 'max(1, mod.cha)' } }],
              lasts: { minutes: 10, rest: 'short', concentration: false, endsWhen: 'unconscious' },
            },
            { kind: 'regain', resource: 'grit', amount: 1 },
            { kind: 'spend', resource: 'Grit', amount: { byLevel: { '1': 1, '5': 2 } } },
            { kind: 'tempHp', amount: { f: 'level + mod.con' } },
            { kind: 'cue', text: ' Roll on the scar table. ', tone: 'warn' },
            { kind: 'offer', label: 'Last stand', dice: '1d6 + 2' },
            { kind: 'offer', label: 'Call for help' },
          ],
        },
      ],
      'Gritty',
    );
    expect(read.problems).toEqual([]);
    const [moment] = read.moments;
    const kinds = moment?.do.map((o) => o.kind);
    expect(kinds).toEqual([
      'addCondition',
      'addCondition',
      'addEffect',
      'regain',
      'spend',
      'tempHp',
      'cue',
      'offer',
      'offer',
    ]);
    // A built-in condition is spelled as the sheet spells it; a homebrew one as written.
    expect(moment?.do[0]).toEqual({ kind: 'addCondition', condition: 'Exhaustion', level: 1 });
    expect(moment?.do[1]).toEqual({ kind: 'addCondition', condition: 'Dazed', level: 2 });
    const effect = moment?.do[2];
    expect(effect?.kind === 'addEffect' && effect.lasts).toEqual({
      minutes: 10,
      rest: 'short',
      endsWhen: 'unconscious',
    });
    expect(effect?.kind === 'addEffect' && effect.effects[0]?.formulas?.[0]?.formula.text).toBe(
      'max(1, mod.cha)',
    );
    expect(moment?.do[3]).toEqual({ kind: 'regain', resource: 'grit', amount: { value: 1 } });
    expect(moment?.do[6]).toEqual({ kind: 'cue', text: 'Roll on the scar table.', tone: 'warn' });
    expect(moment?.do[7]).toEqual({ kind: 'offer', label: 'Last stand', dice: '1d6 + 2' });
    expect(moment?.do[8]).toEqual({ kind: 'offer', label: 'Call for help' });
  });

  it('reads the filters each moment takes', () => {
    const read = readMoments(
      [
        { at: 'natural20', rolls: ['attack', 'attack'], do: [cue()] },
        { at: 'castAtLevel', level: 3, do: [cue()] },
        { at: 'conditionAdded', condition: ' Prone ', do: [cue()] },
      ],
      'Gritty',
    );
    expect(read.problems).toEqual([]);
    expect(
      read.moments.map(({ rolls, level, condition }) => ({ rolls, level, condition })),
    ).toEqual([
      { rolls: ['attack'], level: undefined, condition: undefined },
      { rolls: undefined, level: 3, condition: undefined },
      { rolls: undefined, level: undefined, condition: 'prone' },
    ]);
  });

  it('counts no filter on a moment that never says what it filters', () => {
    const read = readMoments(
      [
        { at: 'zeroHp', level: 3, do: [cue()] },
        { at: 'turnStart', condition: 'Prone', do: [cue()] },
        { at: 'castAtLevel', rolls: ['attack'], do: [cue()] },
        { at: 'conditionEnded', condition: 'Prone', do: [cue('Counts')] },
      ],
      'Gritty',
    );
    expect(read.moments.map((m) => m.at)).toEqual(['conditionEnded']);
    expect(read.problems).toEqual([
      'moment 1 (zeroHp): "level" goes only with castAtLevel',
      'moment 2 (turnStart): "condition" goes only with conditionAdded or conditionEnded',
      'moment 3 (castAtLevel): "rolls" goes only with natural20 or natural1',
    ]);
  });

  it('says which effects an effect in play cannot hold as written, and keeps the rest', () => {
    const read = readMoments(
      [
        {
          at: 'turnStart',
          do: [
            {
              kind: 'addEffect',
              name: 'Fury',
              effects: [
                { kind: 'acBonus', amount: 1 },
                { kind: 'damageDie', scope: 'melee', dice: '1d6 + 2' },
                { kind: 'critRange', min: 1 },
                { kind: 'tempHpEachTurn', amount: -2 },
              ],
            },
          ],
        },
      ],
      'Gritty',
    );
    const [fury] = read.moments[0]?.do ?? [];
    expect(fury?.kind === 'addEffect' && fury.effects.map((t) => t.effect.kind)).toEqual([
      'acBonus',
    ]);
    expect(read.problems).toEqual([
      'moment 1 (turnStart), outcome 1: effect 2 (damageDie): an effect in play cannot hold it as written',
      'moment 1 (turnStart), outcome 1: effect 3 (critRange): an effect in play cannot hold it as written',
      'moment 1 (turnStart), outcome 1: effect 4 (tempHpEachTurn): an effect in play cannot hold it as written',
    ]);
  });

  it('says what keeps a moment or an outcome from counting, and counts the rest', () => {
    const read = readMoments(
      [
        null,
        { at: 'payday', do: [cue()] },
        { do: [cue()] },
        { at: 'zeroHp', do: [] },
        { at: 'zeroHp', do: 'everything' },
        { at: 'castAtLevel', level: 0, do: [cue()] },
        { at: 'castAtLevel', level: 1.5, do: [cue()] },
        { at: 'natural20', rolls: ['damage'], do: [cue()] },
        { at: 'conditionAdded', condition: '', do: [cue()] },
        {
          at: 'turnStart',
          do: [
            { kind: 'explode' },
            { kind: 'addCondition' },
            { kind: 'addCondition', condition: 'Exhaustion', level: 7 },
            { kind: 'cue', text: 'x', tone: 'loud' },
            { kind: 'offer', label: 'Roll', dice: 'lots' },
            { kind: 'regain', resource: 'grit', amount: -1 },
            { kind: 'spend', resource: 'grit', amount: 1.5 },
            { kind: 'tempHp', amount: { f: 'luck * 2' } },
            { kind: 'tempHp' },
            {
              kind: 'addEffect',
              name: 'Training',
              effects: [{ kind: 'skillProf', skill: 'Athletics' }],
            },
            {
              kind: 'addEffect',
              name: 'Grim',
              effects: [{ kind: 'acBonus', amount: 1, while: 'bloodied' }],
            },
            {
              kind: 'addEffect',
              name: 'Odd',
              effects: [{ kind: 'acBonus', amount: 1 }],
              lasts: { rest: 'nap' },
            },
            cue('This one counts'),
          ],
        },
        { at: 'zeroHp', do: [cue('So does this')] },
      ],
      'Gritty',
    );
    expect(read.moments.map((m) => m.do.map((o) => o.kind === 'cue' && o.text))).toEqual([
      ['This one counts'],
      ['So does this'],
    ]);
    expect(read.problems).toEqual([
      'moment 1: is not a moment',
      'moment 2 (payday): has no moment "payday"',
      'moment 3: has no moment "undefined"',
      'moment 4 (zeroHp): "do" lists what happens',
      'moment 5 (zeroHp): "do" lists what happens',
      'moment 6 (castAtLevel): "level" is a slot level, from 1 to 9',
      'moment 7 (castAtLevel): "level" is a slot level, from 1 to 9',
      'moment 8 (natural20): "rolls" lists attack, save or check',
      'moment 9 (conditionAdded): "condition" needs words',
      'moment 10 (turnStart), outcome 1 (explode): has no kind "explode"',
      'moment 10 (turnStart), outcome 2 (addCondition): "condition" needs words',
      'moment 10 (turnStart), outcome 3 (addCondition): "level" is from 1 to 6',
      'moment 10 (turnStart), outcome 4 (cue): "tone" is help, ward, warn or info',
      'moment 10 (turnStart), outcome 5 (offer): "dice" is dice, like 1d6 or 2d8 + 2',
      'moment 10 (turnStart), outcome 6 (regain): "amount" is a whole number, 0 or more',
      'moment 10 (turnStart), outcome 7 (spend): "amount" is a whole number, 0 or more',
      'moment 10 (turnStart), outcome 8 (tempHp): "amount" formula "luck * 2": "luck" is not a name a formula can read',
      'moment 10 (turnStart), outcome 9 (tempHp): "amount" is missing',
      'moment 10 (turnStart), outcome 10: effect 1 (skillProf): an effect in play reaches only numbers and rolls',
      'moment 10 (turnStart), outcome 10 (addEffect): "effects" has nothing an effect in play can do',
      'moment 10 (turnStart), outcome 11: effect 1 (acBonus): an effect in play has no "while"',
      'moment 10 (turnStart), outcome 11 (addEffect): "effects" has nothing an effect in play can do',
      'moment 10 (turnStart), outcome 12 (addEffect): "lasts.rest" is short or long',
    ]);
  });

  it('reads at most 200 moments a list and 64 outcomes a moment', () => {
    const many = Array.from({ length: L.momentsPerPack + 5 }, () => ({
      at: 'zeroHp',
      do: [cue()],
    }));
    const read = readMoments(many, 'Gritty');
    expect(read.moments).toHaveLength(L.momentsPerPack);
    expect(read.problems).toEqual([`only the first ${L.momentsPerPack} of "moments" count`]);

    const long = readMoments(
      [{ at: 'zeroHp', do: Array.from({ length: L.effectsPerEntry + 1 }, () => cue()) }],
      'Gritty',
    );
    expect(long.moments[0]?.do).toHaveLength(L.effectsPerEntry);
    expect(long.problems).toEqual([
      `moment 1 (zeroHp): only the first ${L.effectsPerEntry} of "do" count`,
    ]);
  });

  it('keeps text, labels and formulas within their limits', () => {
    const read = readMoments(
      [
        { at: 'zeroHp', do: [{ kind: 'cue', text: 'x'.repeat(L.textLength + 1) }] },
        { at: 'zeroHp', do: [{ kind: 'offer', label: 'x'.repeat(L.labelLength + 1) }] },
        { at: 'zeroHp', do: [{ kind: 'tempHp', amount: { f: `${'1+'.repeat(150)}1` } }] },
        { at: 'zeroHp', do: [{ kind: 'tempHp', amount: 1_000_000 }] },
        { at: 'zeroHp', do: [{ kind: 'cue', text: 'x'.repeat(L.textLength) }] },
      ],
      'Gritty',
    );
    expect(read.moments).toHaveLength(1);
    expect(read.problems).toEqual([
      `moment 1 (zeroHp), outcome 1 (cue): "text" is at most ${L.textLength} characters`,
      'moment 1 (zeroHp): nothing it does can happen',
      `moment 2 (zeroHp), outcome 1 (offer): "label" is at most ${L.labelLength} characters`,
      'moment 2 (zeroHp): nothing it does can happen',
      `moment 3 (zeroHp), outcome 1 (tempHp): "amount" a formula is at most ${L.formulaLength} characters`,
      'moment 3 (zeroHp): nothing it does can happen',
      'moment 4 (zeroHp), outcome 1 (tempHp): "amount" 1000000 is too large',
      'moment 4 (zeroHp): nothing it does can happen',
    ]);
  });

  it('reads known keys only, never inherited ones', () => {
    const inherited = Object.create({ at: 'zeroHp', do: [cue()] });
    const polluted = JSON.parse(
      '{"__proto__": {"at": "zeroHp"}, "at": "turnStart", "do": [{"kind": "cue", "text": "x", "__proto__": {"tone": "warn"}}, {"kind": "constructor"}]}',
    );
    const read = readMoments(
      [inherited, polluted, { at: 'constructor', do: [cue()] }, { at: 'toString', do: [cue()] }],
      'Gritty',
    );
    expect(read.moments).toEqual([
      { at: 'turnStart', do: [{ kind: 'cue', text: 'x', tone: 'info' }], from: 'Gritty' },
    ]);
    expect(read.problems).toEqual([
      'moment 1: has no moment "undefined"',
      'moment 2 (turnStart), outcome 2 (constructor): has no kind "constructor"',
      'moment 3 (constructor): has no moment "constructor"',
      'moment 4 (toString): has no moment "toString"',
    ]);
    expect(({} as Record<string, unknown>).at).toBeUndefined();
    expect(({} as Record<string, unknown>).tone).toBeUndefined();
  });

  it('never throws, whatever a file holds', () => {
    const deep: unknown[] = [];
    let at: unknown[] = deep;
    for (let i = 0; i < 10_000; i++) {
      const next: unknown[] = [];
      at.push(next);
      at = next;
    }
    const hostile: unknown[] = [
      null,
      undefined,
      0,
      'zeroHp',
      {},
      [],
      deep,
      { at: 'zeroHp', do: deep },
      { at: 'zeroHp', do: [{ kind: 'addEffect', name: 'Deep', effects: deep }] },
      { at: 'zeroHp', do: [{ kind: 'tempHp', amount: { f: '('.repeat(5000) } }] },
      { at: 'zeroHp', do: [{ kind: 'tempHp', amount: { byLevel: deep } }] },
      { at: ['zeroHp'], do: [cue()] },
      { at: 'zeroHp', rolls: deep, do: [cue()] },
      { at: 'zeroHp', do: [{ kind: 'cue', text: { toString: () => 'x' } }] },
    ];
    for (const raw of [...hostile, hostile, Array.from({ length: 100_000 }, () => null)]) {
      expect(() => readMoments(raw, 'Gritty')).not.toThrow();
    }
    expect(readMoments('everything', 'Gritty')).toEqual({
      moments: [],
      problems: ['"moments" is not a list'],
    });
  });
});

// ---------------------------------------------------------------------------
// Collecting a character's moments
// ---------------------------------------------------------------------------

const ctxOf = (packs: DataEntity[]) => ({
  byType: (type: string) => (type === RULE_PACK_TYPE ? packs : []),
});

const pack = (name: unknown, moments: unknown[], appliesTo?: unknown): DataEntity =>
  ({
    name,
    source: 'Brew',
    castGuidance: { v: 1, moments },
    ...(appliesTo !== undefined ? { appliesTo } : {}),
  }) as DataEntity;

describe('collectMoments', () => {
  const feature = (moments: unknown, v: unknown = 1): DataEntity =>
    ({ name: 'Grim Resolve', source: 'Brew', castGuidance: { v, moments } }) as DataEntity;

  it("reads an entry's own moments, with the class level its amounts read", () => {
    const got = collectMoments(
      [
        {
          entry: feature([{ at: 'zeroHp', do: [cue('Grim')] }]),
          label: 'Grim Resolve',
          classLevel: 3,
        },
        { entry: { name: 'Plain', source: 'Brew' } as DataEntity, label: 'Plain' },
        { entry: feature([{ at: 'turnStart', do: [cue('Old')] }], 99), label: 'Newer' },
        { entry: feature([{ at: 'turnStart', do: [cue('None')] }], null), label: 'No version' },
        { entry: feature([{ at: 'payday', do: [cue()] }]), label: 'Bad' },
      ],
      ctxOf([]),
      'hild',
    );
    expect(got.moments.map((m) => [m.from, m.at, m.classLevel])).toEqual([
      ['Grim Resolve', 'zeroHp', 3],
    ]);
    // An unreadable version is said once, by the entry's mechanics reader.
    expect(got.problems).toEqual(['Bad: moment 1 (payday): has no moment "payday"']);
  });

  it('reads packs applied to the character, after its entries, in the player order', () => {
    const got = collectMoments(
      [{ entry: feature([{ at: 'zeroHp', do: [cue('Own')] }]), label: 'Grim Resolve' }],
      ctxOf([
        pack('Gritty', [{ at: 'zeroHp', do: [cue('First')] }], { characters: ['hild'] }),
        pack('Elsewhere', [{ at: 'zeroHp', do: [cue('Other')] }], { characters: ['bram'] }),
        pack('Nobody', [{ at: 'zeroHp', do: [cue('No one')] }]),
        pack('Default only', [{ at: 'zeroHp', do: [cue('Default')] }], { appDefault: true }),
        pack('Odd', [{ at: 'zeroHp', do: [cue('Odd')] }], { characters: 'hild' }),
        pack(
          '',
          [
            { at: 'zeroHp', do: [cue('Last')] },
            { at: 'payday', do: [cue()] },
          ],
          {
            characters: ['hild'],
          },
        ),
      ]),
      'hild',
    );
    expect(got.moments.map((m) => [m.from, m.do[0]?.kind === 'cue' && m.do[0].text])).toEqual([
      ['Grim Resolve', 'Own'],
      ['Gritty', 'First'],
      ['A rule pack', 'Last'],
    ]);
    expect(got.problems).toEqual(['A rule pack: moment 2 (payday): has no moment "payday"']);
  });

  it('reads each stored object once', () => {
    const entry = feature([{ at: 'zeroHp', do: [cue()] }]);
    const a = collectMoments([{ entry, label: 'Grim' }], ctxOf([]), 'hild');
    const b = collectMoments([{ entry, label: 'Grim' }], ctxOf([]), 'hild');
    expect(b.moments[0]).toBe(a.moments[0]);
  });
});

describe('momentsInForce', () => {
  const sheet = {
    abilities: Object.fromEntries(
      Object.entries(SCOPE.mod).map(([a, mod]) => [
        a,
        {
          mod,
          value: SCOPE.score[a as keyof typeof SCOPE.score],
          base: 0,
          overridden: false,
          parts: [],
        },
      ]),
    ) as unknown as DerivedSheet['abilities'],
    profBonus: { value: 3, base: 3, overridden: false, parts: [] },
    totalLevel: 5,
    maxHp: { value: 40, base: 40, overridden: false, parts: [] },
    resources: [{ key: 'grit', label: 'Grit', max: 4, resetOn: 'long' as const, origin: 'Gritty' }],
  };

  it('is nothing for a character with no moments', () => {
    expect(momentsInForce({ moments: [], problems: [] }, sheet, 30)).toBeUndefined();
  });

  it('reads the level, scores, proficiency, HP maximum and pools from the sheet', () => {
    const read = readMoments([{ at: 'zeroHp', do: [cue()] }], 'Gritty');
    expect(momentsInForce(read, sheet, 30)).toEqual({
      moments: read.moments,
      scope: { ...SCOPE, hp: 30 },
      pools: [{ key: 'grit', label: 'Grit', max: 4 }],
      hpWhenDerived: 30,
    });
  });
});

describe('momentsAt', () => {
  const moments = inForce([
    { at: 'castAtLevel', do: [cue('any cast')] },
    { at: 'castAtLevel', level: 3, do: [cue('third or higher')] },
    { at: 'conditionAdded', do: [cue('any condition')] },
    { at: 'conditionAdded', condition: 'prone', do: [cue('prone')] },
    { at: 'natural20', do: [cue('any roll')] },
    { at: 'natural20', rolls: ['attack'], do: [cue('attack')] },
  ]);
  const said = (at: Parameters<typeof momentsAt>[1], detail?: Parameters<typeof momentsAt>[2]) =>
    momentsAt(moments, at, detail).map((m) => m.do[0]?.kind === 'cue' && m.do[0].text);

  it('holds a cast at or above its level', () => {
    expect(said('castAtLevel', { level: 0 })).toEqual(['any cast']);
    expect(said('castAtLevel', { level: 2 })).toEqual(['any cast']);
    expect(said('castAtLevel', { level: 3 })).toEqual(['any cast', 'third or higher']);
    expect(said('castAtLevel', { level: 9 })).toEqual(['any cast', 'third or higher']);
  });

  it('holds its condition, in any case, or any condition', () => {
    expect(said('conditionAdded', { condition: 'Prone' })).toEqual(['any condition', 'prone']);
    expect(said('conditionAdded', { condition: 'Poisoned' })).toEqual(['any condition']);
    expect(said('conditionEnded', { condition: 'Prone' })).toEqual([]);
  });

  it('holds its kinds of roll, or any roll', () => {
    expect(said('natural20', { roll: 'attack' })).toEqual(['any roll', 'attack']);
    expect(said('natural20', { roll: 'save' })).toEqual(['any roll']);
    expect(said('natural1', { roll: 'attack' })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Firing moments (effectLife)
// ---------------------------------------------------------------------------

describe('moments where they happen', () => {
  it('leaves every result and the play state as before when no moment holds', () => {
    const run = (moments?: MomentsInForce) => {
      const p = play();
      p.activeEffects = [bless()];
      p.concentratingOn = { label: 'Bless' };
      p.conditions.push({ id: 'Stunned' });
      const results: EffectChange[] = [
        conditionEndings(p, 'Stunned', limits(p, moments)),
        conditionEnded(p, 'Prone', limits(p, moments)),
        newTurn(p, limits(p, moments)),
        knockedOut(p, limits(p, moments)),
        spellCast(p, 1, limits(p, moments)),
      ];
      return { p, results };
    };
    const without = run();
    // Only a moment no step here sets off.
    const unrelated = run(inForce([{ at: 'natural20', do: [{ kind: 'tempHp', amount: 5 }] }]));
    expect(unrelated).toStrictEqual(without);
    expect(without.results).toStrictEqual([
      { ended: ['Bless'], maxHpChange: 0 },
      { ended: [], maxHpChange: 0 },
      { ended: [], maxHpChange: 0 },
      { ended: [], maxHpChange: 0 },
      { ended: [], maxHpChange: 0 },
    ]);
  });

  it('dropping to 0 HP gives a level of exhaustion each time, up to the sixth', () => {
    const moments = inForce([
      { at: 'zeroHp', do: [{ kind: 'addCondition', condition: 'Exhaustion' }] },
    ]);
    const p = play();
    const first = knockedOut(p, limits(p, moments));
    expect(first.moments).toEqual({
      done: [{ text: 'Exhaustion 1', from: 'Gritty' }],
      cues: [],
      offers: [],
      problems: [],
    });
    expect(p.conditions).toEqual([{ id: 'Exhaustion', level: 1 }]);
    for (let i = 0; i < 7; i++) knockedOut(p, limits(p, moments));
    expect(p.conditions).toEqual([{ id: 'Exhaustion', level: 6 }]);
    expect(knockedOut(p, limits(p, moments)).moments).toBeUndefined();
  });

  it('a hit at 0 HP is no new drop: the sheet had the character at 0 already', () => {
    const moments = inForce([{ at: 'zeroHp', do: [{ kind: 'addCondition', condition: 'Prone' }] }]);
    const p = play();
    p.currentHp = 0;
    p.activeEffects = [bless()];
    p.concentratingOn = { label: 'Bless' };
    const got = knockedOut(p, limits(p, { ...moments, hpWhenDerived: 0 }));
    // What dropping ends still ends; the moment does not fire again.
    expect(got).toStrictEqual({ ended: ['Bless'], maxHpChange: 0 });
    expect(p.conditions).toEqual([]);
  });

  it('adds levels of exhaustion as an outcome says', () => {
    const moments = inForce([
      { at: 'zeroHp', do: [{ kind: 'addCondition', condition: 'exhaustion', level: 2 }] },
    ]);
    const p = play();
    knockedOut(p, limits(p, moments));
    knockedOut(p, limits(p, moments));
    expect(p.conditions).toEqual([{ id: 'Exhaustion', level: 4 }]);
  });

  it('a condition coming on sets off its moments, unless it is switched off or held off', () => {
    const moments = inForce([
      { at: 'conditionAdded', condition: 'prone', do: [cue('Standing costs half your speed')] },
      { at: 'conditionAdded', condition: 'Poisoned', do: [cue('Poisoned')] },
    ]);
    const p = play();
    p.conditions.push({ id: 'Prone' }, { id: 'Poisoned', ignored: true }, { id: 'Grappled' });
    expect(conditionEndings(p, 'Prone', limits(p, moments)).moments?.cues).toEqual([
      { text: 'Standing costs half your speed', tone: 'info', from: 'Gritty' },
    ]);
    expect(conditionEndings(p, 'Poisoned', limits(p, moments)).moments).toBeUndefined();
    expect(conditionEndings(p, 'Grappled', limits(p, moments)).moments).toBeUndefined();
    const immune = { ...limits(p, moments), immune: [{ condition: 'prone', origin: 'Steady' }] };
    expect(conditionEndings(p, 'Prone', immune).moments).toBeUndefined();
  });

  it('a condition coming off sets off its moments', () => {
    const moments = inForce([
      {
        at: 'conditionEnded',
        condition: 'Frightened',
        do: [{ kind: 'regain', resource: 'grit', amount: 1 }],
      },
    ]);
    const p = play();
    p.resources.push({ key: 'grit', used: 2 });
    expect(conditionEnded(p, 'Frightened', limits(p, moments)).moments?.done).toEqual([
      { text: 'Grit: regained 1', from: 'Gritty' },
    ]);
    expect(p.resources).toEqual([{ key: 'grit', used: 1 }]);
    expect(conditionEnded(p, 'Prone', limits(p, moments)).moments).toBeUndefined();
  });

  it('the start of a turn sets off its moments after counting down, before temporary HP each turn', () => {
    const moments = inForce([
      {
        at: 'turnStart',
        do: [
          { kind: 'tempHp', amount: { f: 'max(1, mod.cha)' } },
          {
            kind: 'addEffect',
            name: 'Second Wind',
            effects: [{ kind: 'tempHpEachTurn', amount: { f: 'prof + 2' } }],
          },
        ],
      },
    ]);
    const p = play();
    p.activeEffects = [
      { id: 'dodge', name: 'Dodge', parts: [{ kind: 'acBonus', amount: 1 }], turnsLeft: 1 },
    ];
    const got = newTurn(p, limits(p, moments));
    expect(got.ended).toEqual(['Dodge']);
    expect(got.moments?.done).toEqual([
      { text: '3 temporary hit points', from: 'Gritty' },
      { text: 'Second Wind', from: 'Gritty' },
    ]);
    // The effect the moment added gives its temporary HP this turn, more than the 3.
    expect(got.tempHp).toEqual({ amount: 5, source: 'Second Wind', kept: true });
    expect(p.tempHp).toBe(5);
  });

  it('casting at a level sets off moments for that level or lower', () => {
    const moments = inForce([
      { at: 'castAtLevel', level: 3, do: [{ kind: 'offer', label: 'Overchannel', dice: '1d12' }] },
    ]);
    const p = play();
    expect(spellCast(p, 2, limits(p, moments)).moments).toBeUndefined();
    expect(spellCast(p, 3, limits(p, moments)).moments?.offers).toEqual([
      { label: 'Overchannel', dice: '1d12', from: 'Gritty' },
    ]);
  });
});

describe('each outcome', () => {
  it('adds an effect, its numbers worked out now, replacing one of its name', () => {
    const moments = inForce([
      {
        at: 'zeroHp',
        do: [
          {
            kind: 'addEffect',
            name: 'Defiant',
            effects: [
              { kind: 'acBonus', amount: { f: 'mod.cha + level' } },
              { kind: 'maxHpBonus', amount: 5 },
            ],
            lasts: { rest: 'long' },
          },
        ],
      },
    ]);
    const p = play();
    const first = knockedOut(p, limits(p, moments));
    expect(first.maxHpChange).toBe(5);
    expect(p.currentHp).toBe(35);
    const [defiant] = p.activeEffects ?? [];
    expect(defiant).toMatchObject({
      name: 'Defiant',
      parts: [
        { kind: 'acBonus', amount: 8 },
        { kind: 'maxHpBonus', amount: 5 },
      ],
      lasts: { rest: 'long' },
    });
    knockedOut(p, limits(p, moments));
    expect(p.activeEffects?.map((e) => e.id)).toEqual([defiant?.id]);
  });

  it('says which effects come out where an effect in play cannot hold them, and adds the rest', () => {
    const moments = inForce([
      {
        at: 'turnStart',
        do: [
          {
            kind: 'addEffect',
            name: 'Dim',
            effects: [
              { kind: 'acBonus', amount: { f: 'mod.dex' } },
              { kind: 'tempHpEachTurn', amount: { f: 'mod.str - 5' } },
            ],
          },
        ],
      },
    ]);
    const p = play();
    expect(newTurn(p, limits(p, moments)).moments).toEqual({
      done: [{ text: 'Dim', from: 'Gritty' }],
      cues: [],
      offers: [],
      problems: [
        'Gritty: Dim, effect 2 (tempHpEachTurn): an effect in play cannot hold it with these numbers',
      ],
    });
    expect(p.activeEffects?.[0]?.parts).toEqual([{ kind: 'acBonus', amount: 2 }]);
  });

  it("never replaces the character's own casting of that name", () => {
    const moments = inForce([
      {
        at: 'turnStart',
        do: [{ kind: 'addEffect', name: 'Bless', effects: [{ kind: 'acBonus', amount: 1 }] }],
      },
    ]);
    const p = play();
    p.activeEffects = [bless()];
    newTurn(p, limits(p, moments));
    expect(p.activeEffects?.map((e) => e.name)).toEqual(['Bless', 'Bless']);
    expect(p.activeEffects?.[0]?.id).toBe('bless');
  });

  it('regains and spends uses within the pool, by key or label', () => {
    const moments = inForce([
      { at: 'turnStart', do: [{ kind: 'spend', resource: 'GRIT', amount: 3 }] },
      { at: 'zeroHp', do: [{ kind: 'regain', resource: 'Grit', amount: { f: 'prof * 2' } }] },
      { at: 'castAtLevel', do: [{ kind: 'spend', resource: 'luck', amount: 1 }] },
    ]);
    const p = play();
    newTurn(p, limits(p, moments));
    expect(p.resources).toEqual([{ key: 'grit', used: 3 }]);
    expect(newTurn(p, limits(p, moments)).moments?.done).toEqual([
      { text: 'Grit: spent 1', from: 'Gritty' },
    ]);
    expect(p.resources).toEqual([{ key: 'grit', used: 4 }]);
    expect(newTurn(p, limits(p, moments)).moments).toBeUndefined();
    expect(knockedOut(p, limits(p, moments)).moments?.done).toEqual([
      { text: 'Grit: regained 4', from: 'Gritty' },
    ]);
    expect(p.resources).toEqual([{ key: 'grit', used: 0 }]);
    expect(spellCast(p, 1, limits(p, moments)).moments?.problems).toEqual([
      'Gritty: no pool named luck',
    ]);
  });

  it('spends nothing from a pool already spent past its maximum', () => {
    const moments = inForce([
      { at: 'turnStart', do: [{ kind: 'spend', resource: 'grit', amount: 1 }] },
    ]);
    const p = play();
    // The maximum shrank since these were spent.
    p.resources = [{ key: 'grit', used: 6 }];
    expect(newTurn(p, limits(p, moments)).moments).toBeUndefined();
    expect(p.resources).toEqual([{ key: 'grit', used: 6 }]);
  });

  it('gives temporary hit points only when more than the character has', () => {
    const moments = inForce([{ at: 'zeroHp', do: [{ kind: 'tempHp', amount: { f: 'level' } }] }]);
    const p = play();
    p.tempHp = 8;
    expect(knockedOut(p, limits(p, moments)).moments).toBeUndefined();
    expect(p.tempHp).toBe(8);
    p.tempHp = 2;
    p.tempHpFrom = 'heroism';
    knockedOut(p, limits(p, moments));
    expect(p.tempHp).toBe(5);
    expect(p.tempHpFrom).toBeUndefined();
    const one = inForce([{ at: 'zeroHp', do: [{ kind: 'tempHp', amount: 1 }] }]);
    const q = play();
    expect(knockedOut(q, limits(q, one)).moments?.done).toEqual([
      { text: '1 temporary hit point', from: 'Gritty' },
    ]);
  });

  it('says cues and offers, in order', () => {
    const moments = inForce([
      {
        at: 'zeroHp',
        do: [cue('Roll on the scar table'), { kind: 'offer', label: 'Last stand', dice: '1d6' }],
      },
      { at: 'zeroHp', do: [{ kind: 'cue', text: 'Tell the DM', tone: 'warn' }] },
    ]);
    const p = play();
    expect(knockedOut(p, limits(p, moments)).moments).toEqual({
      done: [],
      cues: [
        { text: 'Roll on the scar table', tone: 'info', from: 'Gritty' },
        { text: 'Tell the DM', tone: 'warn', from: 'Gritty' },
      ],
      offers: [{ label: 'Last stand', dice: '1d6', from: 'Gritty' }],
      problems: [],
    });
  });

  it('a condition it adds ends what that condition ends and sets off its own moments', () => {
    const moments = inForce([
      { at: 'turnStart', do: [{ kind: 'addCondition', condition: 'unconscious' }] },
      { at: 'conditionAdded', condition: 'Unconscious', do: [cue('Out cold')] },
    ]);
    const p = play();
    p.activeEffects = [bless()];
    p.concentratingOn = { label: 'Bless' };
    const got = newTurn(p, limits(p, moments));
    expect(p.conditions).toEqual([{ id: 'Unconscious' }]);
    expect(p.concentratingOn).toBeUndefined();
    expect(got.ended).toEqual(['Bless']);
    expect(got.moments).toEqual({
      done: [{ text: 'Unconscious', from: 'Gritty' }],
      cues: [{ text: 'Out cold', tone: 'info', from: 'Gritty' }],
      offers: [],
      problems: [],
    });
  });

  it('adds no condition the character cannot have, and none already on', () => {
    const moments = inForce([
      { at: 'zeroHp', do: [{ kind: 'addCondition', condition: 'Poisoned' }] },
    ]);
    const p = play();
    const immune = {
      ...limits(p, moments),
      immune: [{ condition: 'Poisoned', origin: 'Periapt' }],
    };
    expect(knockedOut(p, immune).moments?.problems).toEqual([
      'Gritty: you cannot be poisoned (Periapt)',
    ]);
    expect(p.conditions).toEqual([]);
    p.conditions.push({ id: 'Poisoned', ignored: true });
    expect(knockedOut(p, limits(p, moments)).moments).toBeUndefined();
    expect(p.conditions).toEqual([{ id: 'Poisoned', ignored: true }]);
  });
});

describe('limits when firing', () => {
  it('fires each moment once a chain, so moments that set each other off end', () => {
    const moments = inForce([
      { at: 'zeroHp', do: [{ kind: 'addCondition', condition: 'Prone' }] },
      {
        at: 'conditionAdded',
        condition: 'Prone',
        do: [{ kind: 'addCondition', condition: 'Poisoned' }],
      },
      {
        at: 'conditionAdded',
        condition: 'Poisoned',
        do: [{ kind: 'addCondition', condition: 'Prone' }, cue('Once')],
      },
    ]);
    const p = play();
    const got = knockedOut(p, limits(p, moments));
    expect(p.conditions).toEqual([{ id: 'Prone' }, { id: 'Poisoned' }]);
    expect(got.moments?.cues).toHaveLength(1);
  });

  it('fires a moment once a chain when an earlier one sets it off first', () => {
    const moments = inForce([
      {
        at: 'conditionAdded',
        condition: 'Prone',
        do: [{ kind: 'addCondition', condition: 'Poisoned' }],
      },
      {
        at: 'conditionAdded',
        do: [
          { kind: 'addCondition', condition: 'Exhaustion' },
          { kind: 'regain', resource: 'grit', amount: 1 },
        ],
      },
    ]);
    const p = play();
    p.conditions.push({ id: 'Prone' });
    p.resources = [{ key: 'grit', used: 3 }];
    const got = conditionEndings(p, 'Prone', limits(p, moments));
    expect(p.conditions).toEqual([
      { id: 'Prone' },
      { id: 'Poisoned' },
      { id: 'Exhaustion', level: 1 },
    ]);
    expect(p.resources).toEqual([{ key: 'grit', used: 2 }]);
    expect(got.moments?.done).toEqual([
      { text: 'Poisoned', from: 'Gritty' },
      { text: 'Exhaustion 1', from: 'Gritty' },
      { text: 'Grit: regained 1', from: 'Gritty' },
    ]);
  });

  it('goes at most 8 moments deep', () => {
    const chain = Array.from({ length: 12 }, (_, i) => ({
      at: 'conditionAdded',
      condition: `Hex ${i}`,
      do: [{ kind: 'addCondition', condition: `Hex ${i + 1}` }],
    }));
    const moments = inForce([
      { at: 'zeroHp', do: [{ kind: 'addCondition', condition: 'Hex 0' }] },
      ...chain,
    ]);
    const p = play();
    const got = knockedOut(p, limits(p, moments));
    expect(p.conditions.map((c) => c.id)).toEqual(Array.from({ length: 8 }, (_, i) => `Hex ${i}`));
    expect(got.moments?.problems).toEqual([
      'Moments set each other off 8 deep; the rest did not happen',
    ]);
  });

  it('works out formulas within the step budget, and 0 past it', () => {
    // Wide, not deep: one call with many arguments, worth 1.
    const text = `max(${'1,'.repeat(97)}1)`;
    const formula = parseFormula(text, new Set());
    if (!('cost' in formula)) throw new Error('the test formula should parse');
    const counted = Math.floor(L.formulaStepsPerDerive / formula.cost);
    const many = Array.from({ length: counted + 20 }, () => ({
      at: 'zeroHp',
      do: [{ kind: 'spend', resource: 'grit', amount: { f: text } }],
    }));
    const read = readMoments(many.slice(0, L.momentsPerPack), 'Gritty');
    const second = readMoments(many.slice(L.momentsPerPack), 'Gritty');
    const moments: MomentsInForce = {
      moments: [...read.moments, ...second.moments],
      scope: SCOPE,
      pools: [{ key: 'grit', label: 'Grit', max: L.amountLimit }],
      hpWhenDerived: 30,
    };
    const p = play();
    knockedOut(p, limits(p, moments));
    expect(text.length).toBeLessThanOrEqual(L.formulaLength);
    expect(p.resources).toEqual([{ key: 'grit', used: counted }]);
  });
});

// ---------------------------------------------------------------------------
// The sheet (derive)
// ---------------------------------------------------------------------------

describe('moments on the derived sheet', () => {
  function world(extra: Record<string, DataEntity[]>): EngineContext {
    const base = makeTestContext();
    return {
      get(type, name, source) {
        const hit = (extra[type] ?? []).find(
          (e) =>
            String(e.name).toLowerCase() === name.toLowerCase() &&
            (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
        );
        return hit ?? base.get(type, name, source);
      },
      byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
    };
  }

  const hero = (feats: string[]) => {
    const d = newCharacterDoc('hero', 'Hero', 'test');
    d.abilities.base = { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 16 };
    d.classes = [
      { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
    ];
    d.play.hpInitialized = true;
    d.play.currentHp = 20;
    d.feats = feats.map((n, i) => ({ ref: { name: n, source: 'HB' }, instanceId: `f${i}` }));
    return d;
  };
  const feat = (name: string, castGuidance?: unknown): DataEntity => ({
    name,
    source: 'HB',
    entries: [`${name} does something.`],
    ...(castGuidance !== undefined ? { castGuidance } : {}),
  });

  it('has none for data with no moments, exactly as before', () => {
    const ctx = world({ feat: [feat('Plain'), feat('Own', { v: 1, effects: [] })] });
    const sheet = deriveSheet(hero(['Plain', 'Own']), ctx);
    expect('moments' in sheet).toBe(false);
  });

  it("holds the moments of the character's entries and the packs applied to them", () => {
    const ctx = world({
      feat: [
        feat('Grim Resolve', {
          v: 1,
          moments: [
            { at: 'zeroHp', do: [{ kind: 'tempHp', amount: { f: 'mod.cha + prof' } }] },
            { at: 'payday', do: [cue()] },
          ],
        }),
      ],
      [RULE_PACK_TYPE]: [
        pack('Gritty', [{ at: 'turnStart', do: [cue('Breathe')] }], { characters: ['hero'] }),
        pack('Elsewhere', [{ at: 'turnStart', do: [cue('Not here')] }], { characters: ['other'] }),
      ],
    });
    const sheet = deriveSheet(hero(['Grim Resolve']), ctx);
    expect(sheet.moments?.moments.map((m) => [m.from, m.at])).toEqual([
      ['Grim Resolve', 'zeroHp'],
      ['Gritty', 'turnStart'],
    ]);
    expect(sheet.moments?.scope).toMatchObject({
      level: 4,
      prof: 2,
      hp: 20,
      maxHp: sheet.maxHp.value,
    });
    expect(sheet.moments?.scope.mod.cha).toBe(3);
    expect(sheet.moments?.hpWhenDerived).toBe(20);
    expect(sheet.warnings).toContain('Grim Resolve: moment 2 (payday): has no moment "payday"');

    // And they fire from the limits the sheet gives.
    const p = hero(['Grim Resolve']).play;
    knockedOut(p, { maxHp: sheet.maxHp.value, edition: '2024', moments: sheet.moments });
    expect(p.tempHp).toBe(5);
  });

  it('counts an entry met twice once', () => {
    const ctx = world({
      feat: [feat('Twice', { v: 1, moments: [{ at: 'zeroHp', do: [cue()] }] })],
    });
    const d = hero(['Twice', 'Twice']);
    expect(deriveSheet(d, ctx).moments?.moments).toHaveLength(1);
  });
});
