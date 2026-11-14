import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS, makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import type { D20Test } from '../conditions';
import { deriveSheet } from '../derive';
import { rollEffects } from '../playRules';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import { emitBuiltInRows, readRuleSet } from './mechanics';

// The roll parts of the built-in rule sets: advantage on the character's own
// d20 tests (`rollAdvantage`) and what rolls in with them (`rollExtra`).

const rules: EngineContext = {
  get: () => undefined,
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : []),
};
const origin: EffectOrigin = { label: 'Feature', uid: 'feature|tst', type: 'feat' };

/** The built-in rows of a roll part for `keys`, as a call site emits them. */
function emitRolls(part: 'rollAdvantage' | 'rollExtra', keys: string[], featureLevel?: number) {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), rules);
  const found = emitBuiltInRows(col, part, keys, origin, { featureLevel });
  return { found, rows: col.effects };
}

const shipped = BUILT_IN_RULE_SETS.flatMap((set) => readRuleSet(set).rows);

describe('the built-in roll rows', () => {
  it('word every situation as the prompt reads it', () => {
    const rows = shipped.filter((r) => r.part === 'rollAdvantage');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      for (const { effect } of row.effects) {
        if (effect.kind !== 'rollAdvantage' || effect.when === undefined) continue;
        expect(effect.when, row.keys[0]).toMatch(/^Only /);
        expect(effect.when, row.keys[0]).not.toMatch(/[\u2013\u2014.]$/);
      }
    }
  });

  it('are written with lowercase keys, as the code tables were', () => {
    for (const set of BUILT_IN_RULE_SETS) {
      for (const row of set.rows as Array<{ part: string; keys: string[] }>) {
        if (row.part !== 'rollAdvantage' && row.part !== 'rollExtra') continue;
        for (const key of row.keys) expect(key).toBe(key.toLowerCase());
      }
    }
  });

  it('add nothing, and say so, for keys they have no row for', () => {
    expect(emitRolls('rollAdvantage', ['nothing|tst'])).toEqual({ found: false, rows: [] });
    expect(emitRolls('rollExtra', ['nothing|tst'])).toEqual({ found: false, rows: [] });
  });

  it('stop at the first key that has rows', () => {
    const { rows } = emitRolls('rollAdvantage', ['brave|phb', 'feral instinct|barbarian|phb']);
    expect(rows.map((r) => (r.kind === 'rollAdvantage' ? r.on : undefined))).toEqual([
      { rolls: ['save'] },
    ]);
  });

  it('read the first key that has rows, as advantage from the origin itself', () => {
    const { found, rows } = emitRolls('rollAdvantage', [
      'shifting feature|beasthide|erlw',
      'feral instinct|barbarian|phb',
    ]);
    expect(found).toBe(true);
    expect(rows).toEqual([
      {
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['check'], initiative: true },
        origin,
      },
    ]);
    expect(rows[0]?.origin).toBe(origin);
  });

  it('carry when an advantage holds, and a state it holds while', () => {
    expect(emitRolls('rollAdvantage', ['brave|phb']).rows[0]).toMatchObject({
      on: { rolls: ['save'] },
      when: 'Only against being Frightened',
    });
    expect(emitRolls('rollAdvantage', ['purple dragon commandant|frhof']).rows[0]).toMatchObject({
      on: { rolls: ['attack'] },
      while: [{ state: 'bloodied' }],
    });
    expect(emitRolls('rollAdvantage', ['war caster|phb']).rows[0]).toMatchObject({
      on: { rolls: ['save'], abilities: ['con'], save: 'concentration' },
    });
  });

  it('tell option features of one name apart by their level', () => {
    const bear = (level?: number) =>
      emitRolls('rollAdvantage', ['bear|path of the totem warrior|phb'], level).rows;
    expect(bear(3)).toEqual([]);
    expect(bear(6)).toHaveLength(1);
    expect(bear(14)).toEqual([]);
    expect(bear()).toEqual([]);
  });

  it('read a free die as one that rolls in', () => {
    expect(emitRolls('rollExtra', ["warder's intuition|erlw"]).rows).toEqual([
      {
        kind: 'rollDie',
        dice: '1d4',
        on: { rolls: ['check'], skills: ['Investigation'] },
        origin,
      },
    ]);
  });
});

describe('roll advantages on a derived sheet', () => {
  const FEATS: DataEntity[] = [
    { name: 'War Caster', source: 'PHB', entries: ['Placeholder text.'] },
    { name: 'Durable', source: 'XPHB', entries: ['Placeholder text.'] },
    { name: 'Purple Dragon Commandant', source: 'FRHoF', entries: ['Placeholder text.'] },
    // A homebrew feat as the Workshop's Advantage and Added die cards write one.
    {
      name: 'Steady Nerves',
      source: 'MyHomebrew',
      entries: ['Placeholder text.'],
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'rollAdvantage',
            mode: 'adv',
            on: { rolls: ['save'], abilities: ['wis'] },
            when: 'Only against being Charmed',
          },
          { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], save: 'death' } },
          { kind: 'rollDie', dice: '1d4', on: { rolls: ['check'], initiative: true } },
          { kind: 'rollDie', dice: '1d6', on: { rolls: ['check'], proficient: true } },
        ],
      },
    },
  ];
  const trait = (name: string) => ({ name, type: 'entries', entries: ['Placeholder text.'] });
  const RACES: DataEntity[] = [
    { name: 'Halfling', source: 'PHB', entries: [trait('Brave')] },
    // Two traits of one name in one book: only the Reborn's gives advantage.
    { name: 'Reborn', source: 'VRGR', entries: [trait('Deathless Nature')] },
    { name: 'Dhampir', source: 'VRGR', entries: [trait('Deathless Nature')] },
    // A Brave of the book's, with a row of its own race's beside it.
    { name: 'Kithkin', source: 'PHB', entries: [trait('Brave')] },
  ];
  // Rows for the synthetic world's own class feature (at the level it comes)
  // and fighting style, so the class and optional feature walks are read
  // through a rule set as real data is, and one for a race beside its book's.
  const adv = (on: Record<string, unknown>, when?: string) => ({
    kind: 'rollAdvantage',
    mode: 'adv',
    on,
    ...(when !== undefined ? { when } : {}),
  });
  const ADDED: DataEntity = {
    type: RULE_SET_TYPE,
    v: 1,
    name: 'Test roll rows',
    rows: [
      {
        part: 'rollAdvantage',
        keys: ['grit|warrior|tst'],
        level: 1,
        effects: [adv({ rolls: ['check'], initiative: true })],
      },
      {
        part: 'rollAdvantage',
        keys: ['archery|phb'],
        effects: [adv({ rolls: ['attack'] }, 'Only at range')],
      },
      {
        part: 'rollAdvantage',
        keys: ['brave|kithkin|phb'],
        effects: [adv({ rolls: ['check'], initiative: true })],
      },
      // Free dice at the class, feat and optional feature walks.
      {
        part: 'rollExtra',
        keys: ['grit|warrior|tst'],
        level: 1,
        effects: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['check'], initiative: true } }],
      },
      {
        part: 'rollExtra',
        keys: ['war caster|phb'],
        effects: [{ kind: 'rollDie', dice: '1d8', on: { rolls: ['save'], save: 'concentration' } }],
      },
      {
        part: 'rollExtra',
        keys: ['archery|phb'],
        effects: [{ kind: 'rollDie', dice: '1d6', on: { rolls: ['attack'], range: 'ranged' } }],
      },
    ],
  };
  const dice = (sheet: DerivedSheet, test: D20Test) =>
    rollEffects(sheet, test).dice.map(({ dice, source }) => ({ dice, source }));
  const world = makeTestContext();
  const find = (list: DataEntity[], name: string, source?: string) =>
    list.find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    );
  const ruleSets = [...world.byType(RULE_SET_TYPE), ADDED];
  const ctx: EngineContext = {
    get: (type, name, source) =>
      type === 'feat'
        ? find(FEATS, name, source)
        : type === 'race'
          ? (find(RACES, name, source) ?? world.get(type, name, source))
          : world.get(type, name, source),
    byType: (type) =>
      type === 'feat'
        ? FEATS
        : type === 'race'
          ? [...world.byType(type), ...RACES]
          : type === RULE_SET_TYPE
            ? ruleSets
            : world.byType(type),
  };

  const warrior = (edit: (doc: CharacterDoc) => void = () => undefined) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
    edit(doc);
    return doc;
  };
  const withFeat = (name: string, source: string) =>
    warrior((doc) => {
      doc.feats = [{ ref: { name, source }, instanceId: 'f0' }];
    });
  const ofRace = (name: string, source: string) =>
    warrior((doc) => {
      doc.race = { name, source };
    });

  it('reads a class feature, named for the feature', () => {
    const sheet = deriveSheet(warrior(), ctx);
    expect(rollEffects(sheet, { kind: 'initiative' }).advantage).toEqual(['Grit']);
    expect(rollEffects(sheet, { kind: 'check', ability: 'dex' }).advantage).toEqual([]);
  });

  it('reads a picked optional feature', () => {
    const doc = warrior();
    const id = deriveSheet(doc, ctx).pending.find((p) => p.label === 'Combat Stance')?.id;
    expect(id).toBeDefined();
    doc.choices[id ?? ''] = ['archery|phb'];
    expect(rollEffects(deriveSheet(doc, ctx), { kind: 'attack' }).declare).toEqual([
      { source: 'Combat Stance: Archery', mode: 'adv', when: 'Only at range' },
    ]);
  });

  it('adds a built-in free die at a class feature, a feat and a picked optional feature', () => {
    expect(dice(deriveSheet(warrior(), ctx), { kind: 'initiative' })).toEqual([
      { dice: '1d4', source: 'Grit' },
    ]);
    expect(dice(deriveSheet(warrior(), ctx), { kind: 'check', ability: 'dex' })).toEqual([]);
    const caster = deriveSheet(withFeat('War Caster', 'PHB'), ctx);
    expect(dice(caster, { kind: 'save', ability: 'con', purpose: 'concentration' })).toEqual([
      { dice: '1d8', source: 'War Caster' },
    ]);
    expect(dice(caster, { kind: 'save', ability: 'con' })).toEqual([]);
    const doc = warrior();
    const id = deriveSheet(doc, ctx).pending.find((p) => p.label === 'Combat Stance')?.id;
    doc.choices[id ?? ''] = ['archery|phb'];
    const archer = deriveSheet(doc, ctx);
    expect(dice(archer, { kind: 'attack', range: 'ranged' })).toEqual([
      { dice: '1d6', source: 'Combat Stance: Archery' },
    ]);
    expect(dice(archer, { kind: 'attack', range: 'melee' })).toEqual([]);
  });

  it('reads a homebrew feat that sets when, a death save, initiative and a proficient skill', () => {
    const sheet = deriveSheet(withFeat('Steady Nerves', 'MyHomebrew'), ctx);
    expect(rollEffects(sheet, { kind: 'save', ability: 'wis' }).declare).toEqual([
      { source: 'Steady Nerves', mode: 'adv', when: 'Only against being Charmed' },
    ]);
    expect(rollEffects(sheet, { kind: 'save', ability: 'cha' }).declare).toBeUndefined();
    expect(rollEffects(sheet, { kind: 'save', purpose: 'death' }).advantage).toEqual([
      'Steady Nerves',
    ]);
    // Beside the test class's own Grit.
    expect(dice(sheet, { kind: 'initiative' })).toEqual([
      { dice: '1d4', source: 'Grit' },
      { dice: '1d4', source: 'Steady Nerves' },
    ]);
    const stealth = { kind: 'check', ability: 'dex', skill: 'Stealth' } as const;
    expect(dice(sheet, { ...stealth, proficient: true })).toEqual([
      { dice: '1d6', source: 'Steady Nerves' },
    ]);
    expect(dice(sheet, stealth)).toEqual([]);
  });

  it('gives War Caster to concentration saves and no other Constitution save', () => {
    const sheet = deriveSheet(withFeat('War Caster', 'PHB'), ctx);
    const concentrating = { kind: 'save', ability: 'con', purpose: 'concentration' } as const;
    expect(rollEffects(sheet, concentrating).advantage).toEqual(['War Caster']);
    expect(rollEffects(sheet, { kind: 'save', ability: 'con' }).advantage).toEqual([]);
  });

  it('gives 2024 Durable to death saves alone', () => {
    const sheet = deriveSheet(withFeat('Durable', 'XPHB'), ctx);
    expect(rollEffects(sheet, { kind: 'save', purpose: 'death' }).advantage).toEqual(['Durable']);
    expect(rollEffects(sheet, { kind: 'save', ability: 'con' }).advantage).toEqual([]);
  });

  it('holds a Bloodied advantage only while the character is Bloodied', () => {
    const at = (hp: number) => {
      const doc = withFeat('Purple Dragon Commandant', 'FRHoF');
      doc.play.hpInitialized = true;
      doc.play.currentHp = hp;
      return rollEffects(deriveSheet(doc, ctx), { kind: 'attack' }).advantage;
    };
    expect(at(1)).toEqual(['Purple Dragon Commandant']);
    expect(at(999)).toEqual([]);
  });

  it('offers a species trait to claim, named for the trait, and not on a death save', () => {
    const sheet = deriveSheet(ofRace('Halfling', 'PHB'), ctx);
    expect(rollEffects(sheet, { kind: 'save', ability: 'wis' }).declare).toEqual([
      { source: 'Brave', mode: 'adv', when: 'Only against being Frightened' },
    ]);
    expect(rollEffects(sheet, { kind: 'save', purpose: 'death' }).declare).toBeUndefined();
  });

  it('reads a trait by its race before its book', () => {
    const death = (name: string) =>
      rollEffects(deriveSheet(ofRace(name, 'VRGR'), ctx), { kind: 'save', purpose: 'death' });
    expect(death('Reborn').advantage).toEqual(['Deathless Nature']);
    expect(death('Dhampir').advantage).toEqual([]);
    // The race's row wins over the book's Brave, and stops there.
    const kithkin = deriveSheet(ofRace('Kithkin', 'PHB'), ctx);
    expect(rollEffects(kithkin, { kind: 'initiative' }).advantage).toContain('Brave');
    expect(rollEffects(kithkin, { kind: 'save', ability: 'wis' }).declare).toBeUndefined();
  });
});
