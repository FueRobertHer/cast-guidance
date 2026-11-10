import { describe, expect, it } from 'vitest';
import type { Defenses } from '@/engine/playRules';
import type {
  ActiveEffect,
  AttackRow,
  DerivedSheet,
  DerivedValue,
  EffectPart,
} from '@/engine/types';
import {
  andList,
  attackDrop,
  attackLift,
  conditionsInForce,
  defendedTypes,
  defensesRaisedBy,
  defenseView,
  effectMark,
  effectWay,
  hpLimits,
  immunityTo,
  lastsLine,
  loweredBy,
  momentNotice,
  newTurnLines,
  partLine,
  raised,
  raisedBy,
  restLasts,
  saveDcLoweredBy,
  saveDcRaisedBy,
  withMoments,
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

  it('names the weapon a part is on, or says it is gone', () => {
    const name = (id: string) => (id === 'e1' ? 'Longsword' : undefined);
    expect(partLine({ kind: 'attackBonus', amount: 2, scope: 'all', weapon: 'e1' }, name)).toBe(
      '+2 to attack rolls with your Longsword',
    );
    expect(partLine({ kind: 'damageBonus', amount: 2, scope: 'all', weapon: 'e1' }, name)).toBe(
      '+2 damage with your Longsword',
    );
    expect(
      partLine(
        { kind: 'damageDie', scope: 'all', dice: '1d4', damageType: 'Fire', weapon: 'e9' },
        name,
      ),
    ).toBe('+1d4 fire damage on hits with the weapon it is on');
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

describe('loweredBy', () => {
  it('finds a number an effect lowered, and names the effect', () => {
    const before = value(15, [
      ['Chain shirt', 13],
      ['DEX', 2],
    ]);
    const now = value(13, [
      ['Chain shirt', 13],
      ['DEX', 2],
      ['Dazed', -2],
    ]);
    expect(loweredBy(now, before)).toEqual(['Dazed']);
    expect(raisedBy(now, before)).toEqual([]);
  });

  it('finds nothing without a build to compare, or when the number rose or held', () => {
    expect(loweredBy(value(12), undefined)).toEqual([]);
    expect(loweredBy(value(16, [['Shield of Faith', 2]]), value(14))).toEqual([]);
    expect(
      loweredBy(
        value(14, [
          ['Bane-ish', -2],
          ['Shield of Faith', 2],
        ]),
        value(14),
      ),
    ).toEqual([]);
  });

  it('follows the total when one effect raises a number and another lowers it', () => {
    const before = value(14);
    const net = value(13, [
      ['Shield of Faith', 2],
      ['Dazed', -3],
    ]);
    expect(loweredBy(net, before)).toEqual(['Dazed']);
    expect(raisedBy(net, before)).toEqual([]);
  });

  it('says an effect in play when the parts name nothing new (a slower multiplier)', () => {
    expect(loweredBy(value(10), value(13))).toEqual(['an effect in play']);
  });

  it("finds a class's lowered save DC against the same class built", () => {
    const block = { classUid: 'wiz', saveDc: value(12, [['Muddled', -1]]) };
    const built = { spellcasting: [{ classUid: 'wiz', saveDc: value(13) }] } as Pick<
      DerivedSheet,
      'spellcasting'
    >;
    expect(saveDcLoweredBy(block, built)).toEqual(['Muddled']);
    expect(saveDcRaisedBy(block, built)).toEqual([]);
    expect(saveDcLoweredBy(block, null)).toEqual([]);
  });
});

describe('attackDrop', () => {
  const row = (over: Partial<AttackRow>): AttackRow =>
    ({ toHit: value(5), damage: '1d8+3', extraDamage: [], ...over }) as AttackRow;

  it('names what lowered the hit and both damage rolls', () => {
    const before = row({ versatileDamage: '1d10+3', damageFrom: ['Dueling'] });
    const now = row({
      toHit: value(3, [['Shaken', -2]]),
      damage: '1d8+1',
      versatileDamage: '1d10+1',
      damageFrom: ['Dueling', 'Shaken'],
    });
    expect(attackDrop(now, before)).toEqual({
      hit: ['Shaken'],
      damage: ['Shaken'],
      versatile: ['Shaken'],
    });
    expect(attackLift(now, before)).toMatchObject({ hit: false, damage: false, versatile: false });
  });

  it('finds nothing for a raised or unchanged attack, or without a row to compare', () => {
    expect(attackDrop(row({ damage: '1d8+5' }), row({}))).toEqual({
      hit: [],
      damage: [],
      versatile: [],
    });
    expect(attackDrop(row({ toHit: value(1) }), undefined)).toEqual({
      hit: [],
      damage: [],
      versatile: [],
    });
  });
});

describe('effectWay', () => {
  const parts = (...p: EffectPart[]) => p;

  it('is down for penalties, disadvantage, a vulnerability and a slower pace', () => {
    expect(effectWay(parts({ kind: 'acBonus', amount: -2 }), 'up')).toBe('down');
    expect(
      effectWay(parts({ kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['attack'] } }), 'up'),
    ).toBe('down');
    expect(effectWay(parts({ kind: 'vulnerable', damageType: 'fire' }), 'up')).toBe('down');
    expect(effectWay(parts({ kind: 'speedMultiplier', factor: 0.5 }), 'up')).toBe('down');
  });

  it('is up for bonuses, dice and defenses', () => {
    expect(effectWay(parts({ kind: 'acBonus', amount: 2 }), 'down')).toBe('up');
    expect(
      effectWay(parts({ kind: 'rollDie', dice: '1d4', on: { rolls: ['save'] } }), 'down'),
    ).toBe('up');
    expect(effectWay(parts({ kind: 'resist', damageType: 'fire' }), 'down')).toBe('up');
  });

  it('takes the given way when it works both ways or neither', () => {
    const both = parts(
      { kind: 'attackBonus', scope: 'all', amount: 2 },
      { kind: 'acBonus', amount: -2 },
    );
    expect(effectWay(both, 'down')).toBe('down');
    expect(effectWay(both, 'up')).toBe('up');
    expect(effectWay([], 'down')).toBe('down');
    expect(effectWay(parts({ kind: 'cue', tone: 'info', text: 'Note' }), 'up')).toBe('up');
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

describe('what moments did', () => {
  const report = {
    done: [{ text: 'Exhaustion 1', from: 'Gritty' }],
    cues: [{ text: 'Tell the DM', tone: 'help' as const, from: 'Gritty' }],
    offers: [{ label: 'Last stand', dice: '1d6', from: 'Heroic' }],
    problems: [],
  };

  it('leads with a cue, then offers, changes and problems, naming where they came from', () => {
    expect(momentNotice(report)).toEqual({
      title: 'Tell the DM',
      detail: 'Last stand: 1d6 · Exhaustion 1 · Gritty · Heroic',
      tone: 'good',
    });
  });

  it('warns when something could not happen, and says nothing when nothing did', () => {
    expect(
      momentNotice({ done: [], cues: [], offers: [], problems: ['Gritty: no pool named luck'] }),
    ).toEqual({ title: 'Gritty: no pool named luck', tone: 'warn' });
    expect(momentNotice({ done: [], cues: [], offers: [], problems: [] })).toBeNull();
  });

  it('joins onto a notice already being shown, as one, still naming where they came from', () => {
    const broken = {
      title: 'Concentration broken',
      detail: 'Bless · Stunned',
      tone: 'warn' as const,
    };
    expect(withMoments(broken, report)).toEqual({
      title: 'Concentration broken',
      detail: 'Bless · Stunned · Tell the DM · Last stand: 1d6 · Exhaustion 1 · Gritty · Heroic',
      tone: 'warn',
    });
    expect(withMoments(broken, undefined)).toBe(broken);
    expect(withMoments(null, undefined)).toBeNull();
    expect(withMoments(null, report)).toEqual(momentNotice(report));
  });

  it('says them on the new turn toast, after what the turn itself did', () => {
    expect(newTurnLines({ ended: ['Dodge'], maxHpChange: 0, moments: report }, [], 0)).toEqual([
      'Dodge ended',
      'Tell the DM',
      'Last stand: 1d6',
      'Exhaustion 1',
    ]);
  });

  it('come with the limits the sheet gives, only when the sheet has moments', () => {
    const sheet = {
      maxHp: { value: 40, base: 40, overridden: false, parts: [] },
      conditionImmunities: [],
    } as unknown as DerivedSheet;
    expect(hpLimits(sheet, '2024')).toStrictEqual({ maxHp: 40, edition: '2024', immune: [] });
    const moments = { moments: [], scope: {}, pools: [], hpWhenDerived: 40 } as never;
    expect(hpLimits({ ...sheet, moments }, '2024').moments).toBe(moments);
  });
});
