/**
 * Temporary hit points an entry gives its owner each turn (ADR-002 D7, the
 * owner's addition): a feat's or an item's own `tempHpEachTurn`, which the
 * sheet reads from the build (`HpLimits.tempHpEachTurn`), is offered at the
 * start of a turn as an effect in play's is, the best of them kept.
 */
import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { hpLimits } from '../features/sheet/effectsInPlay';
import { deriveSheet } from './derive';
import { type HpLimits, newTurn } from './effectLife';
import {
  type ActiveEffect,
  type DataEntity,
  type EngineContext,
  newCharacterDoc,
  type PlayState,
} from './types';

function play(): PlayState {
  const p = newCharacterDoc('p', 'Hild', 'tag').play;
  p.currentHp = 30;
  p.hpInitialized = true;
  return p;
}

const WARD = { amount: 4, origin: 'Lamp Ward' };
const limits = (build?: HpLimits['tempHpEachTurn']): HpLimits => ({
  maxHp: 40,
  edition: '2024',
  ...(build === undefined ? {} : { tempHpEachTurn: build }),
});
const heroism = (amount: number, turnsLeft?: number): ActiveEffect => ({
  id: 'heroism',
  name: 'Heroism',
  parts: [{ kind: 'tempHpEachTurn', amount }],
  ...(turnsLeft === undefined ? {} : { turnsLeft }),
});

describe("the build's own temporary hit points each turn", () => {
  it('are offered at the start of a turn, belonging to no effect', () => {
    const p = play();
    p.tempHpFrom = 'gone';
    expect(newTurn(p, limits(WARD)).tempHp).toEqual({ amount: 4, source: 'Lamp Ward', kept: true });
    expect(p.tempHp).toBe(4);
    expect(p).not.toHaveProperty('tempHpFrom');
  });

  it('give way to more from an effect in play, and win over less', () => {
    const p = play();
    p.activeEffects = [heroism(6)];
    expect(newTurn(p, limits(WARD)).tempHp?.source).toBe('Heroism');
    expect([p.tempHp, p.tempHpFrom]).toEqual([6, 'heroism']);
    const q = play();
    q.activeEffects = [heroism(3)];
    expect(newTurn(q, limits(WARD)).tempHp?.source).toBe('Lamp Ward');
    expect(q.tempHp).toBe(4);
  });

  it('still count when the effect in play giving more ends this turn', () => {
    const p = play();
    p.activeEffects = [heroism(6, 1)];
    const change = newTurn(p, limits(WARD));
    expect(change.ended).toEqual(['Heroism']);
    expect(change.tempHp).toEqual({ amount: 4, source: 'Lamp Ward', kept: true });
  });

  it('give nothing at 0, or with none', () => {
    const p = play();
    expect(newTurn(p, limits({ amount: 0, origin: 'Lamp Ward' })).tempHp).toBeUndefined();
    expect(newTurn(p, limits()).tempHp).toBeUndefined();
    expect(p.tempHp).toBe(0);
  });
});

describe('through the sheet (`hpLimits`)', () => {
  const base = makeTestContext();
  const ward: DataEntity = {
    name: 'Lamp Ward',
    source: 'HB',
    entries: ['You gain 4 temporary hit points at the start of each of your turns.'],
    castGuidance: { v: 1, effects: [{ kind: 'tempHpEachTurn', amount: 4 }] },
  };
  const ctx: EngineContext = {
    byType: (t) => (t === 'feat' ? [...base.byType(t), ward] : base.byType(t)),
    get: (t, n, s) => (t === 'feat' && n === 'Lamp Ward' ? ward : base.get(t, n, s)),
  };
  const turn = (feat: boolean, effects: ActiveEffect[]) => {
    const doc = newCharacterDoc('hero', 'Hero', 'test');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 1, hp: ['avg'] }];
    if (feat) doc.feats = [{ ref: { name: 'Lamp Ward', source: 'HB' }, instanceId: 'one' }];
    doc.play.activeEffects = effects;
    const hp = hpLimits(deriveSheet(doc, ctx), '2024');
    return { change: newTurn(doc.play, hp), play: doc.play };
  };

  it("gives a feat's own at the start of a turn", () => {
    const { change, play } = turn(true, []);
    expect(change.tempHp).toEqual({ amount: 4, source: 'Lamp Ward', kept: true });
    expect(play.tempHp).toBe(4);
  });

  it('gives none from an effect in play ending this turn, through the sheet or play', () => {
    const { change, play } = turn(false, [heroism(6, 1)]);
    expect(change.ended).toEqual(['Heroism']);
    expect(change.tempHp).toBeUndefined();
    expect(play.tempHp).toBe(0);
  });
});
