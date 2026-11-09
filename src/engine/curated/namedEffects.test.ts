import { describe, expect, it } from 'vitest';
import { readActiveEffects } from '../activeEffects';
import { filterReaches } from '../playRules';
import {
  bardicEffect,
  blessEffect,
  guidanceEffect,
  innateSorceryEffect,
  rageDamage,
  rageEffect,
} from './namedEffects';

describe('rageDamage', () => {
  it('is +2, +3 at 9th level and +4 at 16th', () => {
    expect([1, 8, 9, 15, 16, 20].map(rageDamage)).toEqual([2, 2, 3, 3, 4, 4]);
  });
});

describe('the named effects', () => {
  it('store in a shape the reader keeps whole', () => {
    const all = [
      rageEffect('a', 9, '2014'),
      rageEffect('b', 3, '2024'),
      innateSorceryEffect('c'),
      blessEffect('d', true),
      blessEffect('e', false),
      guidanceEffect('f', '2014'),
      guidanceEffect('g', '2024', 'Athletics'),
      bardicEffect('h', '2014', 'd8'),
      bardicEffect('i', '2024', 'd12'),
    ];
    const read = readActiveEffects(all);
    expect(read.problems).toEqual([]);
    expect(read.effects).toEqual(all);
  });

  it('give Rage its edition: melee only and a minute in 2014, any Strength attack for 10 in 2024', () => {
    const old = rageEffect('r', 16, '2014');
    expect(old.parts).toContainEqual({
      kind: 'damageBonus',
      scope: 'melee',
      amount: 4,
      ability: 'str',
    });
    expect(old.lasts).toEqual({ minutes: 1 });
    const now = rageEffect('r', 2, '2024');
    expect(now.parts).toContainEqual({
      kind: 'damageBonus',
      scope: 'all',
      amount: 2,
      ability: 'str',
    });
    expect(now.lasts).toEqual({ minutes: 10 });
    expect(now.mine).toBe(true);
    expect(now.lasts?.concentration).toBeUndefined();
  });

  it('end Bless with your concentration only when you cast it', () => {
    expect(blessEffect('b', true).mine).toBe(true);
    expect('mine' in blessEffect('b', false)).toBe(false);
  });

  it('roll 2024 Guidance in for its skill alone, and offer 2014 Guidance once', () => {
    const skill = guidanceEffect('g', '2024', 'Athletics');
    expect(skill).toMatchObject({ name: 'Guidance: Athletics', same: 'Guidance' });
    expect(skill.parts).toEqual([
      { kind: 'rollDie', dice: '1d4', on: { rolls: ['check'], skills: ['Athletics'] } },
    ]);
    expect(guidanceEffect('g', '2014').parts).toEqual([
      { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] }, once: true },
    ]);
  });

  it('wait for a failed roll with 2024 Bardic Inspiration, for an hour', () => {
    const now = bardicEffect('b', '2024', 'd10');
    expect(now.parts[0]).toMatchObject({ dice: '1d10', once: true, ifFailed: true });
    expect(now.lasts).toEqual({ minutes: 60 });
    const old = bardicEffect('b', '2014', 'd6');
    expect(old.parts[0]).not.toHaveProperty('ifFailed');
    expect(old.lasts).toEqual({ minutes: 10 });
  });
});

describe("Innate Sorcery's advantage", () => {
  const on = innateSorceryEffect('i').parts.find((p) => p.kind === 'rollAdvantage');
  if (on?.kind !== 'rollAdvantage') throw new Error('no advantage part');

  it('reaches Sorcerer spell attacks, and no other', () => {
    expect(filterReaches(on.on, { kind: 'attack', attack: 'spell', className: 'Sorcerer' })).toBe(
      true,
    );
    expect(filterReaches(on.on, { kind: 'attack', attack: 'spell', className: 'Wizard' })).toBe(
      false,
    );
    // A spell attack that does not say its class (a granted spell) is not reached.
    expect(filterReaches(on.on, { kind: 'attack', attack: 'spell' })).toBe(false);
    expect(filterReaches(on.on, { kind: 'attack', attack: 'weapon', className: 'Sorcerer' })).toBe(
      false,
    );
  });
});
