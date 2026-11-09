import { describe, expect, it } from 'vitest';
import type { Defenses } from '@/engine/playRules';
import type { ActiveEffect, AttackRow, DerivedSheet, DerivedValue } from '@/engine/types';
import {
  andList,
  attackLift,
  conditionsInForce,
  defendedTypes,
  defensesRaisedBy,
  defenseView,
  effectMark,
  immunityTo,
  lastsLine,
  newTurnLines,
  partLine,
  raised,
  raisedBy,
  restLasts,
} from './effectsInPlay';

const value = (n: number, parts: Array<[string, number]> = []): DerivedValue => ({
  value: n,
  base: n,
  overridden: false,
  parts: parts.map(([label, amount]) => ({ label, amount })),
});

const effect = (over: Partial<ActiveEffect>): ActiveEffect => ({
  id: 'e',
  name: 'Bless',
  parts: [],
  ...over,
});

describe('andList', () => {
  it('joins one, two and three', () => {
    expect(andList([])).toBe('');
    expect(andList(['fire'])).toBe('fire');
    expect(andList(['fire', 'cold'])).toBe('fire and cold');
    expect(andList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('conditionsInForce', () => {
  const periapt = [{ condition: 'poisoned', origin: 'Periapt of Proof against Poison' }];

  it('holds off a condition the character is immune to, whatever its case', () => {
    expect(conditionsInForce([{ id: 'Poisoned' }, { id: 'Prone' }], periapt)).toEqual([
      { id: 'Poisoned', ignored: true },
      { id: 'Prone' },
    ]);
  });

  it('leaves the list as it is with no immunity, and never changes what it was given', () => {
    const list = [{ id: 'Poisoned' }];
    expect(conditionsInForce(list, [])).toEqual(list);
    conditionsInForce(list, periapt);
    expect(list).toEqual([{ id: 'Poisoned' }]);
  });

  it('names what holds a condition off, once each', () => {
    const two = [...periapt, ...periapt, { condition: 'Charmed', origin: 'Fey Ancestry' }];
    expect(immunityTo('Poisoned', two)).toEqual(['Periapt of Proof against Poison']);
    expect(immunityTo('Prone', two)).toEqual([]);
  });
});

describe('effectMark', () => {
  it('marks the die an effect rolls in or offers, without the 1', () => {
    const bless = effect({
      parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
    });
    expect(effectMark(bless)).toBe('+d4');
    const offer = effect({
      parts: [{ kind: 'rollOffer', dice: '2d6', on: { rolls: ['check'] } }],
    });
    expect(effectMark(offer)).toBe('+2d6');
    expect(effectMark(effect({ parts: [{ kind: 'acBonus', amount: 2 }] }))).toBeUndefined();
  });
});

describe('partLine', () => {
  it('says each kind as the effect sheet lists it', () => {
    expect(partLine({ kind: 'acBonus', amount: 2 })).toBe('+2 to AC');
    expect(partLine({ kind: 'acMin', min: 16 })).toBe('AC is at least 16');
    expect(partLine({ kind: 'resist', damageType: 'Fire' })).toBe('Half fire damage');
    expect(partLine({ kind: 'resist', damageType: 'all' })).toBe('Half damage of every type');
    expect(partLine({ kind: 'immune', damageType: 'poison', note: 'nonmagical' })).toBe(
      'No poison damage (nonmagical)',
    );
    expect(partLine({ kind: 'speedMultiplier', factor: 2 })).toBe('Walking speed × 2');
    expect(partLine({ kind: 'speedBonus', amount: 10 })).toBe('+10 ft. walking speed');
    expect(partLine({ kind: 'saveBonus', amount: 1, abilities: ['str', 'con'] })).toBe(
      '+1 to Strength and Constitution saving throws',
    );
    expect(partLine({ kind: 'saveBonus', amount: 3 })).toBe('+3 to every saving throw');
    expect(partLine({ kind: 'critRange', min: 19 })).toBe(
      'Attacks score a critical hit on a 19 or 20',
    );
  });

  it('says which rolls a die reaches, and when an offered die waits', () => {
    expect(partLine({ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } })).toBe(
      'Add 1d4 to attack rolls and saving throws',
    );
    expect(
      partLine({
        kind: 'rollOffer',
        dice: '1d6',
        once: true,
        ifFailed: true,
        on: { rolls: ['check', 'save'] },
      }),
    ).toBe(
      'Add 1d6 to one of your ability checks and saving throws, after you see the d20, if it failed',
    );
    // 2024 Guidance.
    expect(
      partLine({ kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'], skilled: true } }),
    ).toBe('Add 1d4 to your skill checks, after you see the d20');
    expect(
      partLine({
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['check', 'save'], abilities: ['str'] },
      }),
    ).toBe('Advantage on Strength checks and Strength saving throws');
    expect(
      partLine({
        kind: 'attackBonus',
        amount: 1,
        scope: 'melee',
        attack: 'weapon',
        ability: 'str',
      }),
    ).toBe('+1 to melee weapon attack rolls made with Strength');
  });
});

describe('lastsLine', () => {
  it('says the time, the rest and the concentration', () => {
    expect(lastsLine(effect({ lasts: { minutes: 60, concentration: true }, mine: true }))).toBe(
      'Lasts up to 1 hour, while you concentrate.',
    );
    expect(lastsLine(effect({ lasts: { minutes: 1, concentration: true } }))).toBe(
      'Lasts up to 1 minute, while its caster concentrates.',
    );
    expect(lastsLine(effect({ lasts: { minutes: 480 } }))).toBe('Lasts up to 8 hours.');
    expect(lastsLine(effect({ lasts: { rest: 'long' } }))).toBe(
      'Lasts until you finish a long rest.',
    );
    expect(lastsLine(effect({ turnsLeft: 1 }))).toBe('Lasts until the start of your next turn.');
    expect(lastsLine(effect({ lasts: { concentration: true }, mine: true }))).toBe(
      'Lasts while you concentrate.',
    );
    expect(lastsLine(effect({}))).toBeUndefined();
  });
});

describe('raised and raisedBy', () => {
  it('finds a number an effect raised, and names the effect', () => {
    const before = value(15, [
      ['Chain shirt', 13],
      ['DEX', 2],
    ]);
    const now = value(17, [
      ['Chain shirt', 13],
      ['DEX', 2],
      ['Shield of Faith', 2],
    ]);
    expect(raised(now, before)).toBe(true);
    expect(raisedBy(now, before)).toEqual(['Shield of Faith']);
  });

  it('finds nothing without a build to compare, or when the number fell', () => {
    expect(raised(value(17), undefined)).toBe(false);
    expect(raisedBy(value(12, [['Slowed', -2]]), value(14))).toEqual([]);
  });

  it('says an effect in play when the parts name nothing new (a floor or a multiplier)', () => {
    expect(raisedBy(value(16), value(13))).toEqual(['an effect in play']);
  });
});

describe('attackLift', () => {
  const row = (over: Partial<AttackRow>): AttackRow =>
    ({ toHit: value(5), damage: '1d8+3', extraDamage: [], ...over }) as AttackRow;

  it('rings the hit, both damage rolls and a rider an effect added, naming the new bonus', () => {
    const before = row({
      versatileDamage: '1d10+3',
      damageFrom: ['Dueling'],
      extraDamage: [{ dice: '1d6', damageType: 'fire' }],
    });
    const now = row({
      toHit: value(6),
      damage: '1d8+5',
      versatileDamage: '1d10+5',
      damageFrom: ['Dueling', 'Rage'],
      extraDamage: [
        { dice: '1d6', damageType: 'fire' },
        { dice: '1d4', label: 'Enlarge' },
      ],
    });
    expect(attackLift(now, before)).toEqual({
      hit: true,
      damage: true,
      versatile: true,
      damageBy: ['Rage'],
      riders: [false, true],
    });
  });

  it('says an effect in play when no bonus it names raised the damage (a Strength floor)', () => {
    expect(attackLift(row({ damage: '1d8+5' }), row({})).damageBy).toEqual(['an effect in play']);
  });

  it('rings a bigger die but not a smaller one, and nothing without a row to compare', () => {
    expect(attackLift(row({ damage: '1d10+3' }), row({})).damage).toBe(true);
    expect(attackLift(row({ damage: '1d6+3' }), row({})).damage).toBe(false);
    expect(attackLift(row({ toHit: value(9) }), undefined)).toEqual({
      hit: false,
      damage: false,
      versatile: false,
      damageBy: [],
      riders: [],
    });
  });
});

describe('defenseView', () => {
  const sheet = (
    over: Partial<Pick<DerivedSheet, 'conditionImmunities' | 'rollRiders'>> = {},
  ): Pick<
    DerivedSheet,
    'resists' | 'immunities' | 'vulnerabilities' | 'conditionImmunities' | 'rollRiders'
  > => ({
    resists: [],
    immunities: [],
    vulnerabilities: [],
    conditionImmunities: [],
    rollRiders: [],
    ...over,
  });
  const none: Defenses = { resist: [], immune: [], vulnerable: [] };
  const rage = ['bludgeoning', 'piercing', 'slashing'].map((damageType) => ({
    damageType,
    origin: 'Rage',
  }));

  it('lists what gives each defense in one row, and counts the types on the chip', () => {
    const view = defenseView(sheet(), { ...none, resist: rage });
    expect(view.half).toEqual([{ what: 'Bludgeoning, piercing, slashing', from: 'Rage' }]);
    expect(view.chip).toEqual({
      word: 'Resists 3',
      say: 'Resists 3 damage types',
      icon: 'half',
    });
  });

  it('shows nothing on the card for a character with no defenses', () => {
    expect(defenseView(sheet(), none).chip).toBeUndefined();
  });

  it('says a resistance that an immunity beats, and counts the type once, as immune', () => {
    const view = defenseView(sheet(), {
      ...none,
      immune: [{ damageType: 'poison', origin: 'Periapt of Proof against Poison' }],
      resist: [
        { damageType: 'poison', origin: 'Dwarven Resilience' },
        { damageType: 'fire', origin: 'Ring of Fire Resistance' },
      ],
    });
    expect(view.none).toEqual([
      {
        what: 'Poison',
        from: 'Periapt of Proof against Poison. Dwarven Resilience would halve it, but none beats half.',
      },
    ]);
    // Poison is immune, so the chip counts fire resisted and poison immune: two types.
    expect(view.chip?.word).toBe('Defenses 2');
    expect(
      defenseView(sheet(), {
        ...none,
        immune: [{ damageType: 'poison', origin: 'Periapt' }],
        resist: [{ damageType: 'poison', origin: 'Dwarven Resilience' }],
      }).chip,
    ).toEqual({ word: 'Immune 1', say: 'Immune to 1 damage type', icon: 'check' });
  });

  it('names a resistance to all damage under an immunity it cannot beat', () => {
    const view = defenseView(sheet(), {
      ...none,
      immune: [{ damageType: 'fire', origin: 'Fire Shield' }],
      resist: [{ damageType: 'all', origin: 'Warding Bond' }],
    });
    expect(view.none[0]?.from).toBe(
      'Fire Shield. Warding Bond would halve it, but none beats half.',
    );
    expect(view.half).toEqual([{ what: 'All damage', from: 'Warding Bond' }]);
    expect(view.chip).toEqual({
      word: 'Defenses',
      say: 'Defenses against every damage type',
      icon: 'half',
    });
  });

  it('shows the alert when a type does double', () => {
    const view = defenseView(sheet(), {
      ...none,
      resist: rage,
      vulnerable: [{ damageType: 'radiant', origin: 'Curse' }],
    });
    expect(view.chip).toEqual({
      word: 'Defenses 4',
      say: 'Defenses against 4 damage types',
      icon: 'alert',
    });
    expect(
      defenseView(sheet(), { ...none, vulnerable: [{ damageType: 'radiant', origin: 'Curse' }] })
        .chip?.word,
    ).toBe('Double 1');
  });

  it('lists conditions the character cannot have, and advantage on saves', () => {
    const view = defenseView(
      sheet({
        conditionImmunities: [
          { condition: 'Poisoned', origin: 'Periapt' },
          { condition: 'poisoned', origin: 'Periapt' },
        ],
        rollRiders: [
          {
            kind: 'advantage',
            mode: 'adv',
            on: { rolls: ['check', 'save'], abilities: ['str'] },
            origin: 'Rage',
          },
          { kind: 'die', dice: '1d4', on: { rolls: ['save'] }, origin: 'Bless' },
        ],
      }),
      none,
    );
    expect(view.cannot).toEqual([{ what: 'Poisoned', from: 'Periapt' }]);
    expect(view.saves).toEqual([{ what: 'Advantage on Strength saving throws', from: 'Rage' }]);
    expect(view.chip).toEqual({
      word: 'Defenses',
      say: 'Defenses: 1 condition you cannot have',
      icon: 'check',
    });
  });
});

describe('defendedTypes', () => {
  it('offers each type a defense names once, immune first, and never "all"', () => {
    expect(
      defendedTypes({
        resist: [
          { damageType: 'Fire', origin: 'Ring' },
          { damageType: 'all', origin: 'Warding Bond' },
          { damageType: 'poison', origin: 'Dwarf' },
        ],
        immune: [{ damageType: 'poison', origin: 'Periapt' }],
        vulnerable: [{ damageType: 'radiant', origin: 'Curse' }],
      }),
    ).toEqual([
      { type: 'poison', icon: 'check' },
      { type: 'radiant', icon: 'alert' },
      { type: 'fire', icon: 'half' },
    ]);
  });
});

describe('defensesRaisedBy', () => {
  const none: Defenses = { resist: [], immune: [], vulnerable: [] };
  const fireRes: Defenses = {
    resist: [{ damageType: 'fire', origin: 'Tiefling' }],
    immune: [],
    vulnerable: [],
  };

  it('names an effect that adds a resistance, an immunity or a condition held off', () => {
    const now: Defenses = {
      resist: [{ damageType: 'slashing', origin: 'Rage' }],
      immune: [{ damageType: 'poison', origin: 'Periapt' }],
      vulnerable: [],
    };
    expect(
      defensesRaisedBy(now, none, [{ condition: 'paralyzed', origin: 'Freedom of Movement' }], []),
    ).toEqual(['Periapt', 'Rage', 'Freedom of Movement']);
  });

  it('names nothing for a vulnerability, or a resistance the build already has', () => {
    const now: Defenses = {
      resist: [...fireRes.resist, { damageType: 'Fire', origin: 'Protection from Energy' }],
      immune: [],
      vulnerable: [{ damageType: 'radiant', origin: 'Curse' }],
    };
    expect(defensesRaisedBy(now, fireRes, [], [])).toEqual([]);
    const held = [{ condition: 'Poisoned', origin: 'Dwarf' }];
    expect(defensesRaisedBy(none, none, held, [{ condition: 'poisoned' }])).toEqual([]);
  });

  it('names an immunity where the build only resisted, and nothing under a resistance to all', () => {
    const immune: Defenses = {
      resist: [],
      immune: [{ damageType: 'fire', origin: 'Fire Shield' }],
      vulnerable: [],
    };
    expect(defensesRaisedBy(immune, fireRes, [], [])).toEqual(['Fire Shield']);
    const all: Defenses = {
      resist: [{ damageType: 'all', origin: 'Petrified' }],
      immune: [],
      vulnerable: [],
    };
    const rage: Defenses = {
      resist: [...all.resist, { damageType: 'slashing', origin: 'Rage' }],
      immune: [],
      vulnerable: [],
    };
    expect(defensesRaisedBy(rage, all, [], [])).toEqual([]);
  });
});

describe('restLasts', () => {
  const fx = (lasts: ActiveEffect['lasts']): ActiveEffect => ({
    id: 'x',
    name: 'X',
    parts: [],
    ...(lasts ? { lasts } : {}),
  });
  it('says what an effect lasts as a rest row does', () => {
    expect(restLasts(fx({ minutes: 480 }), true)).toBe('8 hours');
    expect(restLasts(fx({ minutes: 10, concentration: true }), true)).toBe(
      'Concentration, 10 minutes',
    );
    expect(restLasts(fx({ minutes: 1440 }), false)).toBe('24 hours, so it stays');
    expect(restLasts(fx({ rest: 'long' }), true)).toBe('Until a long rest');
    expect(restLasts(fx(undefined), false)).toBe('Until you end it, so it stays');
  });
});

describe('newTurnLines', () => {
  it('says the temp HP given, the boxes ready again and what ended', () => {
    expect(
      newTurnLines(
        {
          ended: ['Reckless Attack'],
          maxHpChange: 0,
          tempHp: { amount: 3, source: 'Heroism', kept: true },
        },
        ['Haste action'],
        3,
      ),
    ).toEqual(['+3 temp HP: Heroism', 'Haste action ready again', 'Reckless Attack ended']);
  });

  it('says temp HP offered and not kept, since they never add up', () => {
    expect(
      newTurnLines(
        { ended: [], maxHpChange: 0, tempHp: { amount: 3, source: 'Heroism', kept: false } },
        [],
        10,
      ),
    ).toEqual(['Heroism offers 3 temp HP; you keep your 10']);
    expect(newTurnLines({ ended: [], maxHpChange: 0 }, [], 0)).toEqual([]);
    // Its own 3 untouched since the last turn: nothing gained, nothing passed up.
    expect(
      newTurnLines(
        { ended: [], maxHpChange: 0, tempHp: { amount: 3, source: 'Heroism', kept: false } },
        [],
        3,
      ),
    ).toEqual(['Heroism keeps your temp HP at 3']);
  });
});
