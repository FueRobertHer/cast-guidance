import { describe, expect, it } from 'vitest';
import {
  applyEffect,
  endEffect,
  type HpLimits,
  keepHigherTemp,
  maxHpFrom,
  newTurn,
  restEndings,
  setConcentration,
  setEffectOff,
} from './effectLife';
import { type ActiveEffect, newCharacterDoc, type PlayState } from './types';

/** A character at 30 of 40 HP, in play. */
function play(): PlayState {
  const p = newCharacterDoc('p', 'Hild', 'tag').play;
  p.currentHp = 30;
  p.hpInitialized = true;
  return p;
}

/** The sheet's maximum with the effects in `p` counted: 40 before any. */
const limits = (p: PlayState, edition: HpLimits['edition'] = '2014'): HpLimits => ({
  maxHp: 40 + maxHpFrom(p.activeEffects),
  edition,
});

const aid = (amount: number, id = `aid${amount}`): ActiveEffect => ({
  id,
  name: 'Aid',
  parts: [{ kind: 'maxHpBonus', amount }],
  lasts: { minutes: 480 },
});
const bless = (id = 'bless', mine = true): ActiveEffect => ({
  id,
  name: 'Bless',
  parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
  lasts: { minutes: 1, concentration: true },
  ...(mine ? { mine: true } : {}),
});
const haste = (): ActiveEffect => ({
  id: 'haste',
  name: 'Haste',
  parts: [{ kind: 'acBonus', amount: 2 }],
  lasts: { minutes: 1, concentration: true },
  mine: true,
});
const heroism = (amount = 3): ActiveEffect => ({
  id: 'heroism',
  name: 'Heroism',
  parts: [{ kind: 'tempHpEachTurn', amount }],
  lasts: { minutes: 1, concentration: true },
});
const names = (p: PlayState) => (p.activeEffects ?? []).map((e) => e.name);

describe('applyEffect', () => {
  it('raises current HP with the maximum, by what the stronger casting adds', () => {
    const p = play();
    expect(applyEffect(p, aid(5), limits(p))).toEqual({ ended: [], maxHpChange: 5, hpGained: 5 });
    expect(p.currentHp).toBe(35);
    // A second Aid counts only by what it adds over the first.
    expect(applyEffect(p, aid(10), limits(p))).toMatchObject({ maxHpChange: 5, hpGained: 5 });
    expect(applyEffect(p, aid(5, 'again'), limits(p))).toMatchObject({
      maxHpChange: 0,
      hpGained: 0,
    });
    expect(p.currentHp).toBe(40);
  });

  it('wakes a character at 0 HP, clearing their death saves', () => {
    const p = play();
    p.currentHp = 0;
    p.deathSaves = { success: 1, fail: 2 };
    applyEffect(p, aid(5), limits(p));
    expect(p.currentHp).toBe(5);
    expect(p.deathSaves).toEqual({ success: 0, fail: 0 });
  });

  it('raises current HP no further than a maximum 2014 exhaustion halves', () => {
    const p = play();
    p.conditions = [{ id: 'Exhaustion', level: 4 }];
    p.currentHp = 20;
    expect(applyEffect(p, aid(5), limits(p)).hpGained).toBe(2);
    expect(p.currentHp).toBe(22);
  });

  it('heals nothing when a recast ends a casting worth as much', () => {
    const buff = (id: string, amount: number): ActiveEffect => ({
      id,
      name: 'Vigor',
      parts: [{ kind: 'maxHpBonus', amount }],
      lasts: { minutes: 1, concentration: true },
      mine: true,
    });
    const p = play();
    applyEffect(p, buff('first', 10), limits(p));
    p.currentHp = 30;
    expect(applyEffect(p, buff('second', 10), limits(p))).toEqual({
      ended: ['Vigor'],
      maxHpChange: 0,
      hpGained: 0,
    });
    expect(p.currentHp).toBe(30);
    // A weaker recast lowers the maximum, and current HP under it.
    p.currentHp = 50;
    expect(applyEffect(p, buff('third', 5), limits(p)).maxHpChange).toBe(-5);
    expect(p.currentHp).toBe(45);
  });

  it('keeps the level when an effect named otherwise is the spell held', () => {
    const p = play();
    p.concentratingOn = { label: 'Haste', level: 3 };
    applyEffect(p, { ...haste(), id: 'potion', name: 'Haste (upcast)', same: 'Haste' }, limits(p));
    expect(p.concentratingOn).toEqual({ label: 'Haste', level: 3 });
  });

  it('leaves current HP to fill itself in on a new character', () => {
    const p = play();
    p.hpInitialized = false;
    p.currentHp = 0;
    applyEffect(p, aid(5), limits(p));
    expect(p.currentHp).toBe(0);
  });

  it('brings current HP under a maximum a drain lowers', () => {
    const p = play();
    p.currentHp = 40;
    const drain = {
      id: 'd',
      name: 'Life Drain',
      parts: [{ kind: 'maxHpBonus' as const, amount: -7 }],
    };
    expect(applyEffect(p, drain, limits(p)).maxHpChange).toBe(-7);
    expect(p.currentHp).toBe(33);
  });

  it("ends the caster's other concentration and takes its place", () => {
    const p = play();
    applyEffect(p, bless(), limits(p));
    expect(p.concentratingOn).toEqual({ label: 'Bless' });
    expect(applyEffect(p, haste(), limits(p)).ended).toEqual(['Bless']);
    expect(names(p)).toEqual(['Haste']);
    expect(p.concentratingOn).toEqual({ label: 'Haste' });
  });

  it('ends an earlier casting of the same spell, keeping the slot level', () => {
    const p = play();
    applyEffect(p, bless('first'), limits(p));
    p.concentratingOn = { label: 'Bless', level: 3 };
    expect(applyEffect(p, bless('second'), limits(p)).ended).toEqual(['Bless']);
    expect((p.activeEffects ?? []).map((e) => e.id)).toEqual(['second']);
    expect(p.concentratingOn).toEqual({ label: 'Bless', level: 3 });
  });

  it("leaves the character's concentration alone for an ally's spell", () => {
    const p = play();
    p.concentratingOn = { label: 'Hunter’s Mark' };
    applyEffect(p, bless('ally', false), limits(p));
    expect(p.concentratingOn).toEqual({ label: 'Hunter’s Mark' });
  });

  it('replaces an effect under the same id where it stood, and stores no false flags', () => {
    const p = play();
    applyEffect(p, aid(5, 'a'), limits(p));
    applyEffect(p, bless('b', false), limits(p));
    applyEffect(p, { ...aid(10, 'a'), off: false, mine: false }, limits(p));
    expect((p.activeEffects ?? []).map((e) => e.id)).toEqual(['a', 'b']);
    expect(p.activeEffects?.[0]).not.toHaveProperty('off');
    expect(p.activeEffects?.[0]).not.toHaveProperty('mine');
  });
});

describe('endEffect', () => {
  it('brings current HP down to the maximum without Aid, and deletes an empty list', () => {
    const p = play();
    applyEffect(p, aid(5), limits(p));
    p.currentHp = 45;
    expect(endEffect(p, 'aid5', limits(p))).toEqual({ ended: ['Aid'], maxHpChange: -5 });
    expect(p.currentHp).toBe(40);
    expect(p).not.toHaveProperty('activeEffects');
  });

  it('brings current HP under a maximum 2014 exhaustion halves', () => {
    const p = play();
    applyEffect(p, aid(10), limits(p));
    p.conditions = [{ id: 'Exhaustion', level: 4 }];
    p.currentHp = 25;
    endEffect(p, 'aid10', limits(p));
    expect(p.currentHp).toBe(20);
  });

  it('takes the temporary hit points Heroism gave, and only those', () => {
    const p = play();
    applyEffect(p, heroism(), limits(p));
    newTurn(p, limits(p));
    expect([p.tempHp, p.tempHpFrom]).toEqual([3, 'heroism']);
    endEffect(p, 'heroism', limits(p));
    expect(p.tempHp).toBe(0);
    expect(p).not.toHaveProperty('tempHpFrom');

    const q = play();
    applyEffect(q, heroism(), limits(q));
    keepHigherTemp(q, 8);
    newTurn(q, limits(q));
    endEffect(q, 'heroism', limits(q));
    expect(q.tempHp).toBe(8);
  });

  it('ends concentration with the effect it was on', () => {
    const p = play();
    applyEffect(p, bless(), limits(p));
    endEffect(p, 'bless', limits(p));
    expect(p).not.toHaveProperty('concentratingOn');
  });

  it('ends nothing for an id not in play, and leaves entries it cannot read', () => {
    const p = play();
    const odd = { id: 'odd', name: 'Future', parts: [{ kind: 'timeStop' }] };
    p.activeEffects = [null, odd, aid(5)] as unknown as ActiveEffect[];
    expect(endEffect(p, 'missing', limits(p))).toEqual({ ended: [], maxHpChange: 0 });
    endEffect(p, 'aid5', limits(p));
    expect(p.activeEffects).toEqual([null, odd]);
  });
});

describe('setEffectOff', () => {
  it('brings current HP under the maximum when Aid goes off, and heals nothing when it comes back', () => {
    const p = play();
    applyEffect(p, aid(5), limits(p));
    expect(p.currentHp).toBe(35);
    p.currentHp = 45;
    expect(setEffectOff(p, 'aid5', true, limits(p))).toEqual({ ended: [], maxHpChange: -5 });
    expect(p.currentHp).toBe(40);
    expect(p.activeEffects?.[0]?.off).toBe(true);
    expect(setEffectOff(p, 'aid5', false, limits(p))).toEqual({ ended: [], maxHpChange: 5 });
    expect(p.currentHp).toBe(40);
    // Back on, the flag is deleted rather than stored as false.
    expect(p.activeEffects?.[0]).not.toHaveProperty('off');
    expect(names(p)).toEqual(['Aid']);
  });

  it('changes nothing for an effect already that way, or one not in play', () => {
    const p = play();
    applyEffect(p, bless(), limits(p));
    expect(setEffectOff(p, 'bless', false, limits(p))).toEqual({ ended: [], maxHpChange: 0 });
    expect(p.activeEffects?.[0]).not.toHaveProperty('off');
    expect(setEffectOff(p, 'missing', true, limits(p))).toEqual({ ended: [], maxHpChange: 0 });
    setEffectOff(p, 'bless', true, limits(p));
    expect(setEffectOff(p, 'bless', true, limits(p))).toEqual({ ended: [], maxHpChange: 0 });
    // Off is not ended: the concentration it holds stays.
    expect(p.concentratingOn?.label).toBe('Bless');
  });
});

describe('setConcentration', () => {
  it('ends what the caster held under another name, and keeps the new one', () => {
    const p = play();
    p.activeEffects = [bless(), haste(), aid(5)];
    expect(setConcentration(p, { label: 'haste' }, limits(p)).ended).toEqual(['Bless']);
    expect(names(p)).toEqual(['Haste', 'Aid']);
    expect(p.concentratingOn).toEqual({ label: 'haste' });
  });

  it('ends all of it when concentration goes', () => {
    const p = play();
    p.activeEffects = [bless(), bless('ally', false)];
    p.concentratingOn = { label: 'Bless' };
    expect(setConcentration(p, undefined, limits(p)).ended).toEqual(['Bless']);
    expect((p.activeEffects ?? []).map((e) => e.id)).toEqual(['ally']);
    expect(p).not.toHaveProperty('concentratingOn');
  });

  it('keeps the level held when the same spell is named again with none', () => {
    const p = play();
    p.concentratingOn = { label: 'Bless', level: 2 };
    setConcentration(p, { label: 'Bless' }, limits(p));
    expect(p.concentratingOn).toEqual({ label: 'Bless', level: 2 });
    setConcentration(p, { label: 'Bless', level: 4 }, limits(p));
    expect(p.concentratingOn).toEqual({ label: 'Bless', level: 4 });
  });
});

describe('restEndings', () => {
  const rage: ActiveEffect = { id: 'rage', name: 'Rage', parts: [], lasts: { minutes: 1 } };
  const ward: ActiveEffect = { id: 'ward', name: 'Ward', parts: [], lasts: { rest: 'long' } };
  const charm: ActiveEffect = { id: 'charm', name: 'Charm', parts: [], lasts: { rest: 'short' } };
  const forever: ActiveEffect = { id: 'f', name: 'Blessing', parts: [] };

  it('ends an hour or less, and what lasts until a short rest, on a short rest', () => {
    const p = play();
    p.activeEffects = [rage, aid(5), ward, charm, forever];
    expect(restEndings(p, 'short', limits(p))).toEqual({
      ended: ['Rage', 'Charm'],
      maxHpChange: 0,
    });
    expect(names(p)).toEqual(['Aid', 'Ward', 'Blessing']);
  });

  it('ends eight hours or less, and what lasts until a rest, on a long rest', () => {
    const p = play();
    p.activeEffects = [
      rage,
      aid(5),
      ward,
      charm,
      forever,
      { ...aid(5, 'day'), lasts: { minutes: 1440 } },
    ];
    expect(restEndings(p, 'long', limits(p))).toEqual({
      ended: ['Rage', 'Aid', 'Ward', 'Charm'],
      maxHpChange: 0,
    });
    // The day-long Aid of the same name now counts in its place.
    expect(maxHpFrom(p.activeEffects)).toBe(5);
    const q = play();
    q.activeEffects = [aid(5)];
    expect(restEndings(q, 'long', limits(q)).maxHpChange).toBe(-5);
  });
});

describe('stored entries the reader would not take', () => {
  it('reads a duration that is not one, and a count that is not a whole number, as none', () => {
    const p = play();
    const odd = [
      { id: 'a', name: 'A', parts: [], lasts: null },
      { id: 'b', name: 'B', parts: [], lasts: { minutes: '30' } },
      { id: 'c', name: 'C', parts: [], turnsLeft: null },
      { id: 'd', name: 'D', parts: [], turnsLeft: '3' },
    ];
    p.activeEffects = structuredClone(odd) as unknown as ActiveEffect[];
    expect(restEndings(p, 'long', limits(p)).ended).toEqual([]);
    expect(newTurn(p, limits(p)).ended).toEqual([]);
    expect(p.activeEffects).toEqual(odd);
  });
});

describe('newTurn', () => {
  it('counts turns down, ending one at 1 and keeping one at 2 for a turn', () => {
    const p = play();
    p.activeEffects = [
      { id: 'a', name: 'Dodge', parts: [], turnsLeft: 1 },
      { id: 'b', name: 'Shield', parts: [{ kind: 'acBonus', amount: 5 }], turnsLeft: 2 },
      { id: 'c', name: 'Rage', parts: [] },
    ];
    expect(newTurn(p, limits(p)).ended).toEqual(['Dodge']);
    expect(p.activeEffects?.map((e) => [e.name, e.turnsLeft])).toEqual([
      ['Shield', 1],
      ['Rage', undefined],
    ]);
    expect(newTurn(p, limits(p)).ended).toEqual(['Shield']);
  });

  it('offers the best temporary hit points, kept only when more than there are', () => {
    const p = play();
    p.activeEffects = [heroism(3), { ...heroism(5), id: 'song', name: 'Inspiring Song' }];
    expect(newTurn(p, limits(p)).tempHp).toEqual({
      amount: 5,
      source: 'Inspiring Song',
      kept: true,
    });
    expect([p.tempHp, p.tempHpFrom]).toEqual([5, 'song']);
    p.tempHp = 9;
    delete p.tempHpFrom;
    expect(newTurn(p, limits(p)).tempHp?.kept).toBe(false);
    expect(p.tempHp).toBe(9);
  });

  it('gives no temporary hit points from an effect ending this turn', () => {
    const p = play();
    p.activeEffects = [{ ...heroism(3), turnsLeft: 1 }];
    expect(newTurn(p, limits(p))).toEqual({ ended: ['Heroism'], maxHpChange: 0 });
    expect(p.tempHp).toBe(0);
  });
});

describe('keepHigherTemp', () => {
  it('keeps the higher amount and forgets an effect that no longer gave them', () => {
    const p = play();
    expect(keepHigherTemp(p, 5, 'heroism')).toBe(true);
    expect(keepHigherTemp(p, 5)).toBe(false);
    expect(p.tempHpFrom).toBe('heroism');
    expect(keepHigherTemp(p, 6)).toBe(true);
    expect(p).not.toHaveProperty('tempHpFrom');
  });
});
