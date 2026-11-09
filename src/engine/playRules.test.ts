import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
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
    });
  });

  it('gives a death save Bless, and initiative Guidance', () => {
    expect(rollEffects(sheet, { kind: 'save' }).dice.map((d) => d.source)).toEqual(['Bless']);
    const initiative = rollEffects(sheet, { kind: 'initiative' });
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
