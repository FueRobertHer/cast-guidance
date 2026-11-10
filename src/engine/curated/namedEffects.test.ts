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
  recklessAttackEffect,
  recklessAttackOn,
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
      guidanceEffect('g', '2024'),
      bardicEffect('h', '2014', 'd8'),
      bardicEffect('i', '2024', 'd12'),
      recklessAttackEffect('j', '2014'),
      recklessAttackEffect('k', '2024'),
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
    // 2014 ends when you are knocked unconscious; 2024 when you are Incapacitated.
    expect(old.lasts).toEqual({ minutes: 1, endsWhen: 'unconscious' });
    const now = rageEffect('r', 2, '2024');
    expect(now.parts).toContainEqual({
      kind: 'damageBonus',
      scope: 'all',
      amount: 2,
      ability: 'str',
    });
    expect(now.lasts).toEqual({ minutes: 10, endsWhen: 'incapacitated' });
    expect(now.mine).toBe(true);
    expect(now.lasts?.concentration).toBeUndefined();
  });

  it('end Bless with your concentration only when you cast it', () => {
    expect(blessEffect('b', true).mine).toBe(true);
    expect('mine' in blessEffect('b', false)).toBe(false);
  });

  it('offer 2024 Guidance on every skill check until it ends, and 2014 Guidance once', () => {
    const now = guidanceEffect('g', '2024');
    expect(now.name).toBe('Guidance');
    expect(now.parts).toEqual([
      { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'], skilled: true } },
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

describe('Reckless Attack', () => {
  const swing = {
    kind: 'attack',
    attack: 'weapon',
    range: 'melee',
    ability: 'str',
  } as const;

  it('gives 2014 advantage on melee weapon attacks with Strength, and no other', () => {
    const on = recklessAttackOn('2014');
    expect(filterReaches(on, swing)).toBe(true);
    expect(filterReaches(on, { ...swing, ability: 'dex' })).toBe(false);
    expect(filterReaches(on, { ...swing, range: 'ranged' })).toBe(false);
    expect(filterReaches(on, { kind: 'attack', attack: 'spell', ability: 'str' })).toBe(false);
    // An attack that does not say its range or ability is not reached.
    expect(filterReaches(on, { kind: 'attack', attack: 'weapon' })).toBe(false);
    expect(filterReaches(on, { kind: 'check', ability: 'str' })).toBe(false);
  });

  it('gives 2024 advantage on any attack with Strength, a thrown weapon too', () => {
    const on = recklessAttackOn('2024');
    expect(filterReaches(on, swing)).toBe(true);
    expect(filterReaches(on, { ...swing, range: 'ranged' })).toBe(true);
    expect(filterReaches(on, { ...swing, ability: 'dex' })).toBe(false);
    expect(filterReaches(on, { kind: 'save', ability: 'str' })).toBe(false);
  });

  it('lasts until the start of your next turn, saying its cost', () => {
    const old = recklessAttackEffect('r', '2014');
    expect(old).toMatchObject({ name: 'Reckless Attack', turnsLeft: 1, mine: true });
    expect(old.lasts).toBeUndefined();
    expect(old.parts).toEqual([
      { kind: 'rollAdvantage', mode: 'adv', on: recklessAttackOn('2014') },
      {
        kind: 'cue',
        tone: 'warn',
        text: 'Attack rolls against you have advantage until your next turn',
      },
      // 2014's advantage is "during this turn"; its cost lasts until the next.
      {
        kind: 'cue',
        tone: 'info',
        text: 'The advantage is for your turn only, so none on an opportunity attack',
      },
    ]);
    expect(recklessAttackEffect('r', '2024').parts).toEqual([
      { kind: 'rollAdvantage', mode: 'adv', on: recklessAttackOn('2024') },
      {
        kind: 'cue',
        tone: 'warn',
        text: 'Attack rolls against you have advantage until the start of your next turn',
      },
    ]);
  });
});
