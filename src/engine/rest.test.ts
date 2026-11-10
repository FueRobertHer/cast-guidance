import { describe, expect, it } from 'vitest';
import { type EffectChange, endsAtRest, type HpLimits, restEndings, restTaken } from './effectLife';
import { type MomentsInForce, readMoments } from './moments';
import { longRestRecovery, type RestSheet, takeRest } from './rest';
import { type ActiveEffect, type FormulaScope, newCharacterDoc, type PlayState } from './types';

/** A character at 10 of 40 HP, in play. */
function play(): PlayState {
  const p = newCharacterDoc('hild', 'Hild', 'tag').play;
  p.currentHp = 10;
  p.hpInitialized = true;
  return p;
}

const sheet: RestSheet = {
  maxHp: { value: 40, base: 40, overridden: false, parts: [] },
  hitDice: { d12: 5 },
  resources: [
    { key: 'grit', label: 'Grit', max: 4, resetOn: 'long' },
    { key: 'wind', label: 'Second Wind', max: 1, resetOn: 'short' },
  ] as RestSheet['resources'],
};

const SCOPE: FormulaScope = {
  level: 5,
  classLevel: 5,
  prof: 3,
  hp: 0,
  maxHp: 40,
  mod: { str: 3, dex: 2, con: 1, int: 0, wis: 1, cha: 0 },
  score: { str: 16, dex: 14, con: 12, int: 10, wis: 12, cha: 10 },
};

/** Moments in force from stored ones, as a pack named Gritty would give them. */
function inForce(raw: unknown[]): MomentsInForce {
  const read = readMoments(raw, 'Gritty');
  expect(read.problems).toEqual([]);
  return {
    moments: read.moments,
    scope: SCOPE,
    pools: [{ key: 'grit', label: 'Grit', max: 4 }],
    hpWhenDerived: 10,
  };
}

const limits = (moments?: MomentsInForce): HpLimits => ({
  maxHp: 40,
  edition: '2024',
  ...(moments === undefined ? {} : { moments }),
});

const rollTotal = () => 1;

describe('HP on a long rest', () => {
  const rested = (rule: 'all' | 'half' | 'hitDice', hp = 10) => {
    const p = play();
    p.currentHp = hp;
    const { restored } = longRestRecovery(p, sheet, limits(), { hpOnLongRest: rule, rollTotal });
    return { hp: p.currentHp, restored };
  };

  it('gives back all of it as written', () => {
    expect(rested('all')).toMatchObject({ hp: 40, restored: ['+30 HP'] });
  });

  it('gives back half the maximum, never past it', () => {
    expect(rested('half')).toMatchObject({ hp: 30, restored: ['+20 HP'] });
    expect(rested('half', 35).hp).toBe(40);
    expect(rested('half', 0).hp).toBe(20);
  });

  it('gives back none when spent hit dice heal instead', () => {
    expect(rested('hitDice')).toEqual({ hp: 10, restored: [] });
  });

  it('brings hit points down under a maximum the ended effects lowered, under every rule', () => {
    for (const rule of ['all', 'half', 'hitDice'] as const) {
      const p = play();
      p.currentHp = 45;
      longRestRecovery(p, sheet, limits(), { hpOnLongRest: rule, maxHpChange: -5, rollTotal });
      expect(p.currentHp).toBe(35);
    }
  });

  it('still gives back the rest of what a long rest gives under every rule', () => {
    for (const rule of ['all', 'half', 'hitDice'] as const) {
      const p = play();
      p.hitDiceSpent = { d12: 3 };
      p.slotsSpent = [1, 0, 0, 0, 0, 0, 0, 0, 0];
      p.tempHp = 5;
      longRestRecovery(p, sheet, limits(), { hpOnLongRest: rule, rollTotal });
      expect(p.hitDiceSpent).toEqual({ d12: 1 });
      expect(p.slotsSpent[0]).toBe(0);
      expect(p.tempHp).toBe(0);
    }
  });
});

describe('rest length', () => {
  const lasting = (minutes: number): ActiveEffect => ({
    id: `m${minutes}`,
    name: `${minutes} minutes`,
    parts: [],
    lasts: { minutes },
  });

  it('ends what lasts as long as the rest or less, by the table’s rest length', () => {
    const ends = (length: 'standard' | 'gritty' | 'heroic', rest: 'short' | 'long') =>
      [1, 10, 60, 480, 1440, 10080].filter((m) => endsAtRest(lasting(m), rest, length));
    expect(ends('standard', 'short')).toEqual([1, 10, 60]);
    expect(ends('standard', 'long')).toEqual([1, 10, 60, 480]);
    expect(ends('gritty', 'short')).toEqual([1, 10, 60, 480]);
    expect(ends('gritty', 'long')).toEqual([1, 10, 60, 480, 1440, 10080]);
    expect(ends('heroic', 'short')).toEqual([1]);
    expect(ends('heroic', 'long')).toEqual([1, 10, 60]);
  });

  it('ends what lasts until a rest whatever its length', () => {
    const untilLong: ActiveEffect = { id: 'l', name: 'L', parts: [], lasts: { rest: 'long' } };
    expect(endsAtRest(untilLong, 'long', 'heroic')).toBe(true);
    expect(endsAtRest(untilLong, 'short', 'gritty')).toBe(false);
  });

  it('is as written when no length is given, as the rest sheet asks today', () => {
    expect(endsAtRest(lasting(480), 'long')).toBe(true);
    expect(endsAtRest(lasting(480), 'short')).toBe(false);
    const p = play();
    p.activeEffects = [lasting(480), lasting(60)];
    expect(restEndings(p, 'short', limits(), 'gritty').ended).toEqual([
      '480 minutes',
      '60 minutes',
    ]);
  });
});

describe('the rest moments', () => {
  const regain = { kind: 'regain', resource: 'grit', amount: 1 };
  const temp = { kind: 'tempHp', amount: 5 };

  it('fire after a short rest, once its recovery is done', () => {
    const p = play();
    p.resources = [{ key: 'grit', used: 3 }];
    const done = takeRest(p, sheet, 'short', limits(inForce([{ at: 'shortRest', do: [regain] }])), {
      rollTotal,
    });
    expect(p.resources).toEqual([{ key: 'grit', used: 2 }]);
    expect(done.change.moments?.done).toEqual([{ text: 'Grit: regained 1', from: 'Gritty' }]);
  });

  it('fire after a long rest, so the rest does not wipe what they give', () => {
    const p = play();
    p.resources = [{ key: 'grit', used: 3 }];
    const moments = inForce([
      { at: 'longRest', do: [{ kind: 'spend', resource: 'grit', amount: 1 }, temp] },
    ]);
    takeRest(p, sheet, 'long', limits(moments), { rollTotal });
    // The rest gave every use back, then the moment spent one; its temporary HP outlasts the rest.
    expect(p.resources).toEqual([{ key: 'grit', used: 1 }]);
    expect(p.tempHp).toBe(5);
    expect(p.currentHp).toBe(40);
  });

  it('fire only for their own rest', () => {
    const p = play();
    const moments = inForce([{ at: 'shortRest', do: [temp] }]);
    expect(
      takeRest(p, sheet, 'long', limits(moments), { rollTotal }).change.moments,
    ).toBeUndefined();
    expect(p.tempHp).toBe(0);
  });

  it('fire conditionEnded when a long rest takes the last level of Exhaustion off, first', () => {
    const p = play();
    p.conditions = [{ id: 'Exhaustion', level: 1 }];
    const moments = inForce([
      {
        at: 'conditionEnded',
        condition: 'Exhaustion',
        do: [{ kind: 'cue', text: 'Rested at last' }],
      },
      { at: 'longRest', do: [{ kind: 'cue', text: 'Dawn' }] },
    ]);
    const done = takeRest(p, sheet, 'long', limits(moments), { rollTotal });
    expect(p.conditions).toEqual([]);
    expect(done.change.moments?.cues.map((c) => c.text)).toEqual(['Rested at last', 'Dawn']);
  });

  it('fire no conditionEnded while Exhaustion only goes down a level', () => {
    const p = play();
    p.conditions = [{ id: 'Exhaustion', level: 3 }];
    const moments = inForce([
      {
        at: 'conditionEnded',
        condition: 'Exhaustion',
        do: [{ kind: 'cue', text: 'Rested at last' }],
      },
    ]);
    expect(
      takeRest(p, sheet, 'long', limits(moments), { rollTotal }).change.moments,
    ).toBeUndefined();
    expect(p.conditions).toEqual([{ id: 'Exhaustion', level: 2 }]);
  });

  it('join the effects the rest ended, and read the maximum they left', () => {
    const p = play();
    const before: EffectChange = { ended: ['Aid'], maxHpChange: -5 };
    const moments = inForce([{ at: 'longRest', do: [{ kind: 'tempHp', amount: { f: 'maxHp' } }] }]);
    const done = takeRest(p, sheet, 'long', limits(moments), { rollTotal, before });
    expect(p.currentHp).toBe(35);
    expect(p.tempHp).toBe(35);
    expect(done.change.ended).toEqual(['Aid']);
    expect(done.change.maxHpChange).toBe(-5);
  });

  it('fire nothing without the character’s moments, and the rest is as before', () => {
    const p = play();
    p.conditions = [{ id: 'Exhaustion', level: 1 }];
    const done = takeRest(p, sheet, 'long', limits(), { rollTotal });
    expect(done.change).toEqual({ ended: [], maxHpChange: 0 });
    expect(done.restored).toEqual(['+30 HP', '1 exhaustion level']);
  });

  it('can be fired on their own, after any rest the sheet took', () => {
    const p = play();
    const change = restTaken(p, 'short', limits(inForce([{ at: 'shortRest', do: [temp] }])));
    expect(change.moments?.done).toEqual([{ text: '5 temporary hit points', from: 'Gritty' }]);
  });
});
