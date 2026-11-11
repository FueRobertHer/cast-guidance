import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { AS_WRITTEN } from './castGuidance';
import type { D20Test } from './conditions';
import { deriveSheet } from './derive';
import {
  type DamageHit,
  type Defenses,
  damageTaken,
  defensesInForce,
  filterReaches,
  rollEffects,
} from './playRules';
import { type ActiveEffect, newCharacterDoc, type RollRider } from './types';

const ATTACKS_AND_SAVES = { rolls: ['attack', 'save'] as Array<'attack' | 'save'> };

describe('filterReaches', () => {
  const reckless = {
    rolls: ['attack' as const],
    attack: 'weapon' as const,
    range: 'melee' as const,
    abilities: ['str' as const],
  };

  it('reaches only the attacks it names, and none that do not say', () => {
    const swing: D20Test = { kind: 'attack', attack: 'weapon', range: 'melee', ability: 'str' };
    expect(filterReaches(reckless, swing)).toBe(true);
    expect(filterReaches(reckless, { ...swing, range: 'ranged' })).toBe(false);
    expect(filterReaches(reckless, { ...swing, ability: 'dex' })).toBe(false);
    expect(filterReaches(reckless, { ...swing, attack: 'spell' })).toBe(false);
    expect(filterReaches(reckless, { kind: 'attack' })).toBe(false);
    expect(filterReaches(reckless, { kind: 'save', ability: 'str' })).toBe(false);
  });

  it('takes initiative as a Dexterity check and a death save as a save', () => {
    const checks = { rolls: ['check' as const] };
    expect(filterReaches(checks, { kind: 'initiative' })).toBe(true);
    expect(filterReaches({ ...checks, abilities: ['dex'] }, { kind: 'initiative' })).toBe(true);
    expect(filterReaches({ ...checks, abilities: ['str'] }, { kind: 'initiative' })).toBe(false);
    expect(filterReaches(ATTACKS_AND_SAVES, { kind: 'save' })).toBe(true);
    expect(filterReaches({ rolls: ['save'], abilities: ['con'] }, { kind: 'save' })).toBe(false);
  });

  it('narrows checks by skill, leaving saves in the same filter alone', () => {
    const stealth = { rolls: ['check' as const, 'save' as const], skills: ['Stealth'] };
    expect(filterReaches(stealth, { kind: 'check', ability: 'dex', skill: 'stealth' })).toBe(true);
    expect(filterReaches(stealth, { kind: 'check', ability: 'dex', skill: 'Acrobatics' })).toBe(
      false,
    );
    expect(filterReaches(stealth, { kind: 'check', ability: 'dex' })).toBe(false);
    expect(filterReaches(stealth, { kind: 'save', ability: 'dex' })).toBe(true);
  });

  it('reaches any skill check, but no bare ability check or initiative, when skilled', () => {
    const skilled = { rolls: ['check' as const], skilled: true };
    expect(filterReaches(skilled, { kind: 'check', ability: 'str', skill: 'Athletics' })).toBe(
      true,
    );
    expect(filterReaches(skilled, { kind: 'check', ability: 'wis', skill: 'Insight' })).toBe(true);
    expect(filterReaches(skilled, { kind: 'check', ability: 'str' })).toBe(false);
    expect(filterReaches(skilled, { kind: 'initiative' })).toBe(false);
    expect(filterReaches(skilled, { kind: 'save', ability: 'wis' })).toBe(false);
  });

  it('reaches initiative alone, and no other Dexterity check, when it names initiative', () => {
    const initiative = { rolls: ['check' as const], initiative: true };
    expect(filterReaches(initiative, { kind: 'initiative' })).toBe(true);
    expect(filterReaches(initiative, { kind: 'check', ability: 'dex' })).toBe(false);
    expect(filterReaches(initiative, { kind: 'save', ability: 'dex' })).toBe(false);
  });

  it('reaches a death or concentration save alone when it names one', () => {
    const death = { rolls: ['save' as const], save: 'death' as const };
    const concentration = {
      rolls: ['save' as const],
      abilities: ['con' as const],
      save: 'concentration' as const,
    };
    expect(filterReaches(death, { kind: 'save', purpose: 'death' })).toBe(true);
    expect(filterReaches(death, { kind: 'save' })).toBe(false);
    expect(filterReaches(death, { kind: 'save', ability: 'con', purpose: 'concentration' })).toBe(
      false,
    );
    expect(
      filterReaches(concentration, { kind: 'save', ability: 'con', purpose: 'concentration' }),
    ).toBe(true);
    expect(filterReaches(concentration, { kind: 'save', ability: 'con' })).toBe(false);
    // A filter that names no purpose still reaches both, as Bless does.
    expect(filterReaches(ATTACKS_AND_SAVES, { kind: 'save', purpose: 'death' })).toBe(true);
    expect(
      filterReaches(
        { rolls: ['save'], abilities: ['con'] },
        { kind: 'save', ability: 'con', purpose: 'concentration' },
      ),
    ).toBe(true);
  });
});

describe('rollEffects', () => {
  const riders: RollRider[] = [
    { kind: 'die', dice: '1d4', on: ATTACKS_AND_SAVES, origin: 'Bless', effectId: 'b' },
    { kind: 'offer', dice: '1d4', on: { rolls: ['check'] }, once: true, origin: 'Guidance' },
    {
      kind: 'offer',
      dice: '1d8',
      on: { rolls: ['attack', 'check', 'save'] },
      once: true,
      ifFailed: true,
      origin: 'Bardic Inspiration',
      effectId: 'bi',
    },
    {
      kind: 'advantage',
      mode: 'adv',
      on: { rolls: ['attack'], attack: 'weapon', range: 'melee', abilities: ['str'] },
      origin: 'Reckless Attack',
    },
    { kind: 'advantage', mode: 'dis', on: { rolls: ['check'] }, origin: 'Curse' },
  ];
  const sheet = { rollRiders: riders };

  it('rolls Bless in with an attack and offers Bardic after it', () => {
    expect(
      rollEffects(sheet, { kind: 'attack', attack: 'weapon', range: 'melee', ability: 'str' }),
    ).toEqual({
      dice: [{ dice: '1d4', source: 'Bless', effectId: 'b' }],
      offers: [
        { dice: '1d8', source: 'Bardic Inspiration', effectId: 'bi', once: true, ifFailed: true },
      ],
      advantage: ['Reckless Attack'],
      disadvantage: [],
      test: 'attack',
    });
  });

  it('gives a death save Bless, and initiative Guidance', () => {
    expect(rollEffects(sheet, { kind: 'save' }).dice.map((d) => d.source)).toEqual(['Bless']);
    const initiative = rollEffects(sheet, { kind: 'initiative' });
    // The kind its roll carries, for a natural 20 or 1's moments: initiative is a check.
    expect(rollEffects(sheet, { kind: 'save' }).test).toBe('save');
    expect(initiative.test).toBe('check');
    expect(initiative.offers.map((o) => o.source)).toEqual(['Guidance', 'Bardic Inspiration']);
    expect(initiative.offers[0]).toEqual({
      dice: '1d4',
      source: 'Guidance',
      once: true,
      ifFailed: false,
    });
    expect(initiative.disadvantage).toEqual(['Curse']);
    expect(initiative.dice).toEqual([]);
  });

  describe('what a feature adds when paid for (`paid`)', () => {
    const ambush: RollRider[] = [
      {
        kind: 'paid',
        on: { rolls: ['check'], skills: ['Stealth'] },
        poolDie: true,
        origin: 'Maneuvers: Ambush',
      },
      {
        kind: 'paid',
        on: { rolls: ['check'], initiative: true },
        poolDie: true,
        origin: 'Maneuvers: Ambush',
      },
    ];
    const tacticalMind: RollRider = {
      kind: 'paid',
      on: { rolls: ['check'] },
      dice: '1d10',
      ifFailed: true,
      spentOnSuccess: true,
      origin: 'Tactical Mind',
    };
    const deflection: RollRider = {
      kind: 'paid',
      on: { rolls: ['save'] },
      bonus: 4,
      after: true,
      reaction: true,
      ifFailed: true,
      origin: 'Arcane Deflection',
    };

    it('passes each on unpriced, with what it adds and its flags, and offers nothing yet', () => {
      const effects = rollEffects(
        { rollRiders: [tacticalMind, deflection] },
        { kind: 'check', ability: 'int' },
      );
      expect(effects.paid).toEqual([
        {
          source: 'Tactical Mind',
          dice: '1d10',
          ifFailed: true,
          spentOnSuccess: true,
        },
      ]);
      expect(effects.offers).toEqual([]);
      expect(rollEffects({ rollRiders: [deflection] }, { kind: 'save' }).paid).toEqual([
        { source: 'Arcane Deflection', bonus: 4, after: true, reaction: true, ifFailed: true },
      ]);
    });

    it('takes one a source, though two of its rows fit', () => {
      const both = { ...ambush[1], on: { rolls: ['check' as const] } } as RollRider;
      const effects = rollEffects(
        { rollRiders: [...ambush.slice(0, 1), both] },
        { kind: 'check', ability: 'dex', skill: 'Stealth' },
      );
      expect(effects.paid?.map((p) => p.source)).toEqual(['Maneuvers: Ambush']);
    });

    it('gives initiative what adds before the roll, and nothing that turns a failure', () => {
      const initiative = rollEffects(
        { rollRiders: [...ambush, tacticalMind] },
        { kind: 'initiative' },
      );
      expect(initiative.paid?.map((p) => p.source)).toEqual(['Maneuvers: Ambush']);
    });

    it('gives a death save only what names it', () => {
      const death = { kind: 'save', purpose: 'death' } as const;
      expect(rollEffects({ rollRiders: [deflection] }, death).paid).toBeUndefined();
      const named = { ...deflection, on: { rolls: ['save' as const], save: 'death' as const } };
      expect(rollEffects({ rollRiders: [named] }, death).paid).toHaveLength(1);
    });
  });

  describe('what rerolls (`rerolls`)', () => {
    const luck: RollRider = {
      kind: 'reroll',
      on: { rolls: ['attack', 'check', 'save'] },
      die: 'one',
      atMost: 1,
      auto: true,
      free: true,
      origin: 'Luck',
    };
    const indomitable: RollRider = {
      kind: 'reroll',
      on: { rolls: ['save'] },
      ifFailed: true,
      bonus: 9,
      origin: 'Indomitable',
    };

    it('passes each on with its flags, once a source, for the sheet to price', () => {
      const save = rollEffects(
        { rollRiders: [luck, indomitable, { ...indomitable }] },
        { kind: 'save', ability: 'wis' },
      );
      expect(save.rerolls).toEqual([
        { source: 'Luck', die: 'one', atMost: 1, auto: true, free: true },
        { source: 'Indomitable', ifFailed: true, bonus: 9 },
      ]);
      expect(save.offers).toEqual([]);
      expect(rollEffects({ rollRiders: [indomitable] }, { kind: 'check' }).rerolls).toBeUndefined();
    });

    it("keeps two of one name that reroll differently (a halfling's Lucky and the feat)", () => {
      const feat: RollRider = { ...luck, die: 'extra', auto: false, free: false, origin: 'Lucky' };
      const trait: RollRider = { ...luck, origin: 'Lucky' };
      const save = rollEffects({ rollRiders: [trait, feat] }, { kind: 'save', ability: 'wis' });
      expect(save.rerolls?.map((r) => r.die)).toEqual(['one', 'extra']);
    });

    it('gives a death save the rerolls of saves, and initiative none that turns a failure', () => {
      expect(
        rollEffects({ rollRiders: [luck, indomitable] }, { kind: 'save', purpose: 'death' })
          .rerolls,
      ).toHaveLength(2);
      const initiative = rollEffects(
        { rollRiders: [luck, { ...indomitable, on: { rolls: ['check'] } }] },
        { kind: 'initiative' },
      );
      expect(initiative.rerolls?.map((r) => r.source)).toEqual(['Luck']);
    });
  });

  describe('flanking, under the table’s rule', () => {
    const melee: D20Test = { kind: 'attack', attack: 'weapon', range: 'melee', ability: 'str' };
    const when = 'Only with an ally next to the target, on its opposite side';
    const under = (flanking: 'off' | 'advantage' | 'plusTwo') => ({
      rollRiders: [],
      rules: { ...AS_WRITTEN['2014'], flanking },
    });

    it('is not offered as written, nor with no rules on the sheet', () => {
      expect(rollEffects(under('off'), melee).declare).toBeUndefined();
      expect(rollEffects({ rollRiders: [] }, melee).declare).toBeUndefined();
    });

    it('is offered on a melee attack as advantage, or as +2 to hit', () => {
      expect(rollEffects(under('advantage'), melee).declare).toEqual([
        { source: 'Flanking', mode: 'adv', when },
      ]);
      expect(rollEffects(under('plusTwo'), melee).declare).toEqual([
        { source: 'Flanking', bonus: 2, when },
      ]);
    });

    it('is offered on no other roll: a ranged attack, one of unknown range, a save', () => {
      for (const test of [
        { kind: 'attack', attack: 'weapon', range: 'ranged' },
        { kind: 'attack', attack: 'spell' },
        { kind: 'save', ability: 'dex' },
      ] as D20Test[]) {
        expect(rollEffects(under('advantage'), test).declare).toBeUndefined();
      }
    });
  });

  describe('an advantage that holds only sometimes (`when`)', () => {
    const brave: RollRider = {
      kind: 'advantage',
      mode: 'adv',
      on: { rolls: ['save'] },
      when: 'Only against being Frightened',
      origin: 'Brave',
    };
    const tokens: RollRider = {
      kind: 'advantage',
      mode: 'adv',
      on: { rolls: ['save'], save: 'death' },
      when: 'Only while you have a soul trinket',
      origin: 'Tokens of the Departed',
    };

    it('is offered to declare, not given, once a source', () => {
      const effects = rollEffects(
        { rollRiders: [brave, { ...brave }] },
        { kind: 'save', ability: 'wis' },
      );
      expect(effects.advantage).toEqual([]);
      expect(effects.declare).toEqual([
        { source: 'Brave', mode: 'adv', when: 'Only against being Frightened' },
      ]);
    });

    it('follows flanking in the prompt', () => {
      const melee: D20Test = { kind: 'attack', attack: 'weapon', range: 'melee', ability: 'str' };
      const grappler: RollRider = { ...brave, on: { rolls: ['attack'] }, origin: 'Grappler' };
      const sheet = {
        rollRiders: [grappler],
        rules: { ...AS_WRITTEN['2014'], flanking: 'advantage' as const },
      };
      expect(rollEffects(sheet, melee).declare?.map((d) => d.source)).toEqual([
        'Flanking',
        'Grappler',
      ]);
    });

    it('reaches a death save only when it names one', () => {
      const death = rollEffects(
        { rollRiders: [brave, tokens] },
        { kind: 'save', purpose: 'death' },
      );
      expect(death.declare?.map((d) => d.source)).toEqual(['Tokens of the Departed']);
      expect(rollEffects({ rollRiders: [brave] }, { kind: 'save' }).declare).toHaveLength(1);
    });

    it('declares no disadvantage', () => {
      const curse: RollRider = { ...brave, mode: 'dis', origin: 'Curse' };
      const effects = rollEffects({ rollRiders: [curse] }, { kind: 'save', ability: 'wis' });
      expect(effects.declare).toBeUndefined();
      expect(effects.disadvantage).toEqual([]);
    });
  });

  it('reads the riders deriveSheet lists for effects in play', () => {
    const doc = newCharacterDoc('r', 'Rider', 'tag');
    const bless: ActiveEffect = {
      id: 'b1',
      name: 'Bless',
      parts: [{ kind: 'rollDie', dice: '1d4', on: ATTACKS_AND_SAVES }],
    };
    doc.play.activeEffects = [bless, { ...bless, id: 'b2' }];
    const derived = deriveSheet(doc, makeTestContext());
    expect(rollEffects(derived, { kind: 'save', ability: 'wis' }).dice).toEqual([
      { dice: '1d4', source: 'Bless', effectId: 'b1' },
    ]);
  });
});

describe('damageTaken', () => {
  const none: Defenses = { resist: [], immune: [], vulnerable: [] };
  const fire = (amount: number): DamageHit => ({ amount, type: 'fire' });

  it('takes damage as rolled when nothing changes it', () => {
    expect(damageTaken([fire(15)], none)).toEqual({
      total: 15,
      parts: [{ type: 'fire', rolled: 15, taken: 15, steps: [] }],
    });
  });

  it('halves for resistance and doubles for vulnerability, each rounding down, each once', () => {
    const defenses: Defenses = {
      resist: [
        { damageType: 'Fire', origin: 'Protection from Energy' },
        { damageType: 'fire', origin: 'Tiefling' },
      ],
      immune: [],
      vulnerable: [{ damageType: 'fire', origin: 'Curse' }],
    };
    expect(damageTaken([fire(15)], defenses).parts[0]?.steps).toEqual([
      { kind: 'resisted', to: 7, sources: ['Protection from Energy', 'Tiefling'] },
      { kind: 'vulnerable', to: 14, sources: ['Curse'] },
    ]);
  });

  it('halves on a save before resistance, and stops at nothing when immune', () => {
    const resist: Defenses = { ...none, resist: [{ damageType: 'fire', origin: 'Tiefling' }] };
    expect(damageTaken([fire(15)], resist, { half: true }).parts[0]?.steps).toEqual([
      { kind: 'half', to: 7 },
      { kind: 'resisted', to: 3, sources: ['Tiefling'] },
    ]);
    const immune: Defenses = {
      ...resist,
      immune: [{ damageType: 'fire', origin: "Heroes' Feast" }],
    };
    expect(damageTaken([fire(15)], immune, { half: true })).toEqual({
      total: 0,
      parts: [
        {
          type: 'fire',
          rolled: 15,
          taken: 0,
          steps: [{ kind: 'immune', sources: ["Heroes' Feast"] }],
        },
      ],
    });
  });

  it('takes a flat reduction once from the hit, across the types it names', () => {
    const ham = {
      amount: 3,
      types: ['bludgeoning', 'piercing', 'slashing'],
      source: 'Heavy Armor Master',
    };
    const hit = damageTaken(
      [{ amount: 8, type: 'Slashing' }, { amount: 2, type: 'piercing' }, fire(4)],
      none,
      { reduce: ham },
    );
    expect(hit.parts.map((p) => p.taken)).toEqual([5, 2, 4]);
    expect(hit.total).toBe(11);
    // What one type cannot take moves on to the next, never below 0.
    const small = damageTaken(
      [
        { amount: 2, type: 'piercing' },
        { amount: 8, type: 'slashing' },
      ],
      none,
      { reduce: ham },
    );
    expect(small.parts.map((p) => p.steps)).toEqual([
      [{ kind: 'reduced', by: 2, to: 0, source: 'Heavy Armor Master' }],
      [{ kind: 'reduced', by: 1, to: 7, source: 'Heavy Armor Master' }],
    ]);
  });

  it('takes a reduction that names no type from the whole hit, once', () => {
    const ward = { amount: 3, source: 'Ward' };
    expect(damageTaken([fire(5), { amount: 5, type: 'cold' }], none, { reduce: ward }).total).toBe(
      7,
    );
    expect(damageTaken([fire(10)], none, { reduce: { ...ward, types: [] } }).total).toBe(7);
  });

  it('adds parts of one type before halving, as one instance of damage', () => {
    const resist: Defenses = { ...none, resist: [{ damageType: 'fire', origin: 'Tiefling' }] };
    expect(damageTaken([fire(3), { amount: 3, type: 'FIRE' }], resist).total).toBe(3);
  });

  it('lets resistance to all cover untyped damage, and a named type cover only itself', () => {
    const all: Defenses = { ...none, resist: [{ damageType: 'all', origin: 'Petrified' }] };
    expect(damageTaken([{ amount: 9 }], all).total).toBe(4);
    const fireOnly: Defenses = { ...none, resist: [{ damageType: 'fire', origin: 'Tiefling' }] };
    expect(damageTaken([{ amount: 9 }, { amount: 9, type: 'cold' }], fireOnly).total).toBe(18);
  });

  it('takes nothing from a hit that is not a number', () => {
    expect(damageTaken([{ amount: Number.NaN, type: 'fire' }, { amount: -4 }], none)).toEqual({
      total: 0,
      parts: [{ rolled: 0, taken: 0, steps: [] }],
    });
  });
});

describe('defensesInForce', () => {
  const sheet = {
    resists: [{ damageType: 'fire', origin: 'Tiefling' }],
    immunities: [{ damageType: 'poison', origin: 'Dwarf' }],
    vulnerabilities: [],
    conditionImmunities: [],
  };

  it("adds the conditions' defenses to the sheet's", () => {
    expect(defensesInForce(sheet, [{ id: 'Petrified' }], '2014').resist).toEqual([
      { damageType: 'fire', origin: 'Tiefling' },
      { damageType: 'all', origin: 'Petrified' },
    ]);
    expect(defensesInForce(sheet, [], '2014').immune).toEqual(sheet.immunities);
  });

  it('gives no defense from a condition the character is immune to', () => {
    const stoneproof = {
      ...sheet,
      conditionImmunities: [{ condition: 'petrified', origin: 'Stone Ward' }],
    };
    expect(defensesInForce(stoneproof, [{ id: 'Petrified' }], '2014').resist).toEqual(
      sheet.resists,
    );
  });
});
