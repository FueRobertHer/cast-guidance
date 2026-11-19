// A homebrew condition that moves the hit point maximum (the owner's rules,
// 2026-11-19): one that lowers it brings current HP down to the new maximum
// when it is above it; one that raises it raises current HP by as much as it
// comes on. One coming off gives back the maximum alone, and switching one
// back on heals nothing, as switching Aid back on does not.
import { describe, expect, it } from 'vitest';
import { conditionEntries } from './conditions';
import {
  conditionEnded,
  conditionEndings,
  conditionsMoved,
  type HpLimits,
  newTurn,
} from './effectLife';
import { type MomentsInForce, readMoments } from './moments';
import { newCharacterDoc, type PlayState } from './types';

const entry = (name: string, effects: unknown[]) => ({
  name,
  source: 'MyHomebrew',
  entries: [],
  castGuidance: { v: 1, effects },
});
const entryOf = conditionEntries(
  [
    entry('Withered', [{ kind: 'maxHpBonus', amount: -5 }]),
    entry('Hale', [{ kind: 'maxHpBonus', amount: 5 }]),
    entry('Calm', [{ kind: 'conditionImmune', condition: 'Withered' }]),
    entry('Bulwark', [
      { kind: 'maxHpBonus', amount: 5 },
      { kind: 'conditionImmune', condition: 'Withered' },
    ]),
    // Each holds the other off: the first in play counts.
    entry('Ay', [
      { kind: 'maxHpBonus', amount: 5 },
      { kind: 'conditionImmune', condition: 'Bee' },
    ]),
    entry('Bee', [
      { kind: 'maxHpBonus', amount: -5 },
      { kind: 'conditionImmune', condition: 'Ay' },
    ]),
  ],
  '2024',
);

/** At `hp` of a derived maximum `max` (what the conditions on already move it to). */
function at(hp: number, conditions: PlayState['conditions'] = []): PlayState {
  const p = newCharacterDoc('hild', 'Hild', 'tag').play;
  p.currentHp = hp;
  p.hpInitialized = true;
  p.conditions = conditions;
  return p;
}
const limits = (maxHp: number, more: Partial<HpLimits> = {}): HpLimits => ({
  maxHp,
  edition: '2024',
  conditionEntry: entryOf,
  ...more,
});

/** Put `id` on, as the strip does, and settle what it does. */
function add(p: PlayState, id: string, hp: HpLimits) {
  p.conditions.push({ id });
  return conditionEndings(p, id, hp);
}
/** Take `id` off, as the strip does, and settle what it does. */
function take(p: PlayState, id: string, hp: HpLimits) {
  const before = p.conditions.map((c) => ({ ...c }));
  p.conditions = p.conditions.filter((c) => c.id !== id);
  return conditionEnded(p, id, hp, before);
}

/** A turn-start moment that puts `condition` on, with a sheet whose maximum is 40. */
function addingAtTurnStart(condition: string): MomentsInForce {
  const read = readMoments(
    [{ at: 'turnStart', do: [{ kind: 'addCondition', condition }] }],
    'Gritty',
  );
  expect(read.problems).toEqual([]);
  return {
    moments: read.moments,
    scope: {
      level: 5,
      classLevel: 5,
      prof: 3,
      hp: 40,
      maxHp: 40,
      mod: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      score: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    },
    pools: [],
    hpWhenDerived: 40,
  };
}

describe('a homebrew condition coming on', () => {
  it('that lowers the maximum brings current HP down to it, and leaves it be below it', () => {
    const full = at(40);
    expect(add(full, 'Withered', limits(40)).maxHpChange).toBe(-5);
    expect(full.currentHp).toBe(35);
    const hurt = at(10);
    add(hurt, 'Withered', limits(40));
    expect(hurt.currentHp).toBe(10);
  });

  it('that raises the maximum raises current HP by as much, at full HP or not', () => {
    const full = at(40);
    expect(add(full, 'Hale', limits(40)).maxHpChange).toBe(5);
    expect(full.currentHp).toBe(45);
    const hurt = at(10);
    add(hurt, 'Hale', limits(40));
    expect(hurt.currentHp).toBe(15);
  });

  it('at 0 HP, a raise brings the character up and the death saves start over', () => {
    const down = at(0);
    down.deathSaves = { success: 1, fail: 2 };
    add(down, 'Hale', limits(40));
    expect(down.currentHp).toBe(5);
    expect(down.deathSaves).toEqual({ success: 0, fail: 0 });
  });

  it('under 2014 Exhaustion 4, comes down to half the new maximum', () => {
    const p = at(20, [{ id: 'Exhaustion', level: 4 }]);
    add(p, 'Withered', limits(40, { edition: '2014' }));
    // Half of 35, rounded down.
    expect(p.currentHp).toBe(17);
  });

  it('switched back on, it moves the maximum and heals nothing', () => {
    const p = at(40, [{ id: 'Hale', ignored: true }]);
    delete p.conditions[0]?.ignored;
    expect(conditionEndings(p, 'Hale', limits(40), 'switchedOn').maxHpChange).toBe(5);
    expect(p.currentHp).toBe(40);
    const w = at(40, [{ id: 'Withered', ignored: true }]);
    delete w.conditions[0]?.ignored;
    conditionEndings(w, 'Withered', limits(40), 'switchedOn');
    expect(w.currentHp).toBe(35);
  });

  it('moves nothing when the sheet gives no way to find its entry', () => {
    const p = at(40);
    const { conditionEntry: _none, ...noEntries } = limits(40);
    expect(add(p, 'Withered', noEntries).maxHpChange).toBe(0);
    expect(p.currentHp).toBe(40);
  });

  it('from a moment, settles as from the strip: down under a penalty, up by a raise', () => {
    const p = at(40);
    const turn = newTurn(p, limits(40, { moments: addingAtTurnStart('Withered') }));
    expect(p.conditions).toEqual([{ id: 'Withered' }]);
    expect(p.currentHp).toBe(35);
    expect(turn.maxHpChange).toBe(-5);
    const hurt = at(30);
    expect(newTurn(hurt, limits(40, { moments: addingAtTurnStart('Hale') })).maxHpChange).toBe(5);
    expect(hurt.currentHp).toBe(35);
  });

  it('that holds a penalty off gives back that maximum alone, and raises only by its own', () => {
    // Withered counts: the sheet's maximum is 35.
    const calm = at(20, [{ id: 'Withered' }]);
    expect(add(calm, 'Calm', limits(35)).maxHpChange).toBe(5);
    expect(calm.currentHp).toBe(20);
    // Bulwark gives +5 of its own besides holding Withered off.
    const bulwark = at(20, [{ id: 'Withered' }]);
    expect(add(bulwark, 'Bulwark', limits(35)).maxHpChange).toBe(10);
    expect(bulwark.currentHp).toBe(25);
  });
});

describe('a homebrew condition coming off', () => {
  it('that lowered the maximum gives it back, and no hit points', () => {
    const p = at(30, [{ id: 'Withered' }]);
    expect(take(p, 'Withered', limits(35)).maxHpChange).toBe(5);
    expect(p.currentHp).toBe(30);
  });

  it('that raised the maximum brings current HP down with it', () => {
    const full = at(45, [{ id: 'Hale' }]);
    expect(take(full, 'Hale', limits(45)).maxHpChange).toBe(-5);
    expect(full.currentHp).toBe(40);
    const hurt = at(15, [{ id: 'Hale' }]);
    take(hurt, 'Hale', limits(45));
    expect(hurt.currentHp).toBe(15);
  });

  it('moves nothing while it was switched off, or held off by an immunity', () => {
    const off = at(40, [{ id: 'Hale', ignored: true }]);
    expect(take(off, 'Hale', limits(40)).maxHpChange).toBe(0);
    expect(off.currentHp).toBe(40);
    const held = at(40, [{ id: 'Hale' }]);
    const immune = [{ condition: 'Hale', origin: 'Ring of Calm' }];
    expect(take(held, 'Hale', limits(40, { immune })).maxHpChange).toBe(0);
    expect(held.currentHp).toBe(40);
  });

  it('settles a pair that hold each other off in the order they were on', () => {
    // Ay came first, so Ay counts and the sheet's maximum is 45.
    const p = at(45, [{ id: 'Ay' }, { id: 'Bee' }]);
    const immune = [{ condition: 'Bee', origin: 'Ay' }];
    expect(take(p, 'Ay', limits(45, { immune })).maxHpChange).toBe(-10);
    expect(p.currentHp).toBe(35);
  });

  it('lets another it held off count again, and settles that one too', () => {
    // Calm holds Withered off, so the sheet lists Calm's immunity and no -5.
    const p = at(40, [{ id: 'Withered' }, { id: 'Calm' }]);
    const immune = [{ condition: 'Withered', origin: 'Calm' }];
    expect(take(p, 'Calm', limits(40, { immune })).maxHpChange).toBe(-5);
    expect(p.currentHp).toBe(35);
  });
});

describe('a homebrew condition switched off', () => {
  it('settles as an effect in play switched off does: a raise gone takes current HP down', () => {
    const p = at(45, [{ id: 'Hale' }]);
    const before = structuredClone(p.conditions);
    (p.conditions[0] as { ignored?: boolean }).ignored = true;
    expect(conditionsMoved(p, before, limits(45)).maxHpChange).toBe(-5);
    expect(p.currentHp).toBe(40);
    const w = at(30, [{ id: 'Withered' }]);
    const was = structuredClone(w.conditions);
    (w.conditions[0] as { ignored?: boolean }).ignored = true;
    expect(conditionsMoved(w, was, limits(35)).maxHpChange).toBe(5);
    expect(w.currentHp).toBe(30);
  });
});
