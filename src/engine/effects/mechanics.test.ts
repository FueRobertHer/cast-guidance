import { describe, expect, it, vi } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { CAST_GUIDANCE_LIMITS, RULE_PACK_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { Formula } from '../formula';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import {
  basedOn,
  entryKeys,
  mechanicsOf,
  officialOf,
  readMechanics,
  readStoredEffects,
} from './mechanics';

// Invented entries: what the seam does with them is the point, not any book's wording.
// Curated keys reuse real feature names (Alert, Fast Movement), which are rule facts.

function world(extra: Record<string, DataEntity[]>): EngineContext {
  const base = makeTestContext();
  return {
    get(type, name, source) {
      const hit = (extra[type] ?? []).find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      );
      return hit ?? base.get(type, name, source);
    },
    byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
  };
}

function character(edit: (d: CharacterDoc) => void = () => {}): CharacterDoc {
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.abilities.base = { str: 14, dex: 14, con: 14, int: 10, wis: 10, cha: 16 };
  d.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: ['avg', 'avg', 'avg', 'avg'] },
  ];
  d.play.hpInitialized = true;
  d.play.currentHp = 30;
  edit(d);
  return d;
}

const cg = (body: Record<string, unknown>) => ({ castGuidance: { v: 1, ...body } });
const feat = (name: string, body?: Record<string, unknown>): DataEntity => ({
  name,
  source: 'HB',
  entries: [`${name} does something.`],
  ...(body !== undefined ? cg(body) : {}),
});
const withFeats = (...names: string[]) =>
  character((d) => {
    d.feats = names.map((n, i) => ({ ref: { name: n, source: 'HB' }, instanceId: `f${i}` }));
  });

const origin: EffectOrigin = { label: 'Lantern', uid: 'lantern|hb', type: 'feat' };
const kinds = (col: Collector) => col.effects.map((e) => e.kind);

// ---------------------------------------------------------------------------

describe('readMechanics', () => {
  const every: Array<Record<string, unknown>> = [
    { kind: 'abilityMin', ability: 'str', min: 19 },
    { kind: 'abilityBonus', ability: 'con', amount: 2, max: 22 },
    { kind: 'skillProf', skill: 'stealth' },
    { kind: 'saveProf', ability: 'wis' },
    { kind: 'toolProf', name: "Thieves' tools" },
    { kind: 'armorProf', name: 'shields' },
    { kind: 'weaponProf', name: 'longsword' },
    { kind: 'language', name: 'Sylvan' },
    { kind: 'acFormula', label: 'Bark Hide', base: 13, addAbilities: ['dex'], dexMax: 2 },
    { kind: 'acBonus', amount: 1 },
    { kind: 'acMin', min: 16 },
    { kind: 'hpPerLevel', amount: 1 },
    { kind: 'maxHpBonus', amount: { f: 'level' } },
    { kind: 'initiativeBonus', amount: { f: 'prof' } },
    { kind: 'speedBonus', amount: 10, unless: 'heavyArmor' },
    { kind: 'speedMultiplier', factor: 2 },
    { kind: 'moveSpeed', mode: 'fly', speed: 'walk' },
    { kind: 'attackBonus', amount: 1, attack: 'spell' },
    { kind: 'damageBonus', scope: 'melee', amount: 2, ability: 'str' },
    { kind: 'damageDie', dice: '1d6', damageType: 'fire' },
    { kind: 'spellDcBonus', amount: 1 },
    { kind: 'saveBonus', amount: 1, abilities: ['con', 'con'] },
    { kind: 'halfProf' },
    { kind: 'checkBonus', amount: 2, skills: ['perception'] },
    { kind: 'passivePerceptionBonus', amount: 5 },
    { kind: 'sense', sense: 'darkvision', range: 60 },
    { kind: 'resist', damageType: 'fire', note: 'only in daylight' },
    { kind: 'immune', damageType: 'poison' },
    { kind: 'vulnerable', damageType: 'cold' },
    { kind: 'conditionImmune', condition: 'charmed' },
    { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } },
    { kind: 'rollOffer', dice: '1d6', on: { rolls: ['check'], skilled: true }, once: true },
    { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'], skills: ['athletics'] } },
    { kind: 'tempHpEachTurn', amount: 5 },
    { kind: 'extraAction', label: 'Dash only' },
    { kind: 'critRange', min: 19 },
    { kind: 'cue', text: 'Glows near orcs.' },
    {
      kind: 'resource',
      key: 'lantern',
      label: 'Lantern',
      max: { f: 'max(1, mod.cha)' },
      reset: 'long',
    },
    { kind: 'resourceRegain', key: 'lantern', amount: 1 },
    {
      kind: 'action',
      label: 'Lantern Flare',
      economy: 'bonus',
      roll: '2d6 + 2',
      save: { targetAbility: 'con', dcAbility: 'cha' },
      cost: { resource: 'lantern', amount: 1 },
      heals: false,
    },
    { kind: 'naturalWeapon', label: 'Horns', dice: '1d6', damageType: 'piercing' },
    { kind: 'unarmedDamage', label: 'Iron Fists', dice: '1d6' },
    { kind: 'grantSpell', spell: 'Light|HB', ability: 'cha' },
    { kind: 'note', text: 'Ask your table about light.' },
  ];

  it('reads one of every kind version 1 takes, with no problems', () => {
    const read = readMechanics({ v: 1, effects: every });
    expect(read.problems).toEqual([]);
    expect(read.effects.map((t) => t.effect.kind)).toEqual(every.map((e) => e.kind));
  });

  it('maps the stored names onto the engine and fills each default', () => {
    const effects = readMechanics({ v: 1, effects: every }).effects;
    const byKind = (k: string) => effects.find((t) => t.effect.kind === k)?.effect;
    expect(byKind('resource')).toEqual({
      kind: 'resource',
      key: 'lantern',
      label: 'Lantern',
      max: 0,
      resetOn: 'long',
    });
    expect(byKind('skillProf')).toEqual({ kind: 'skillProf', skill: 'Stealth', level: 1 });
    expect(byKind('attackBonus')).toEqual({
      kind: 'attackBonus',
      scope: 'all',
      amount: 1,
      attack: 'spell',
    });
    expect(byKind('halfProf')).toEqual({ kind: 'halfProf', round: 'down' });
    expect(byKind('cue')).toEqual({ kind: 'cue', tone: 'info', text: 'Glows near orcs.' });
    expect(byKind('naturalWeapon')).toMatchObject({ ability: 'str' });
    expect(byKind('saveBonus')).toMatchObject({ abilities: ['con'] });
    expect(byKind('checkBonus')).toEqual({ kind: 'checkBonus', amount: 2, skills: ['Perception'] });
    expect(byKind('grantSpell')).toMatchObject({ spell: { name: 'Light', source: 'HB' } });
    // A false flag is the same as none.
    expect(byKind('action')).not.toHaveProperty('heals');
    expect(byKind('action')).toMatchObject({ cost: { resource: 'lantern', amount: 1 } });
  });

  it('keeps each formula for fold time, with a 0 in its field until then', () => {
    const t = readMechanics({ v: 1, effects: every }).effects.find(
      (x) => x.effect.kind === 'resource',
    );
    expect(t?.formulas?.map((f) => f.field)).toEqual(['max']);
    expect(t?.formulas?.[0]?.formula).toBeInstanceOf(Formula);
  });

  it('builds each effect from its known keys only', () => {
    const raw = JSON.parse(
      '{"v":1,"effects":[{"kind":"acBonus","amount":1,"origin":{"type":"active"},"formulas":[1],"__proto__":{"polluted":true},"evil":"x"}]}',
    );
    const [t] = readMechanics(raw).effects;
    expect(t?.effect).toEqual({ kind: 'acBonus', amount: 1 });
    expect(t).not.toHaveProperty('formulas');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('says what keeps an effect from counting, and counts the rest', () => {
    const read = readMechanics({
      v: 1,
      effects: [
        { kind: 'fly' },
        { kind: 'constructor' },
        { kind: '__proto__' },
        { kind: 'acBonus' },
        { kind: 'saveProf', ability: 'luck' },
        { kind: 'rollDie', dice: 'lots', on: { rolls: ['attack'] } },
        { kind: 'abilityBonus', ability: 'str', amount: { f: 'mod.str' } },
        { kind: 'action', label: 'Go', economy: 'action', cost: { resource: 'x', amount: -1 } },
        { kind: 'checkBonus', amount: 1, skills: ['Stealth'], every: true },
        'acBonus',
        { kind: 'acBonus', amount: 2 },
      ],
    });
    expect(read.effects.map((t) => t.effect)).toEqual([{ kind: 'acBonus', amount: 2 }]);
    expect(read.problems).toEqual([
      'effect 1 (fly): has no kind "fly"',
      'effect 2 (constructor): has no kind "constructor"',
      'effect 3 (__proto__): has no kind "__proto__"',
      'effect 4 (acBonus): "amount" is missing',
      'effect 5 (saveProf): "ability" is one of str, dex, con, int, wis, cha',
      'effect 6 (rollDie): "dice" is dice, like 1d6 or 2d8 + 2',
      'effect 7 (abilityBonus): "amount" formula "mod.str": "mod.str" cannot be read here: it changes the ability scores, so it can read only level, classLevel and prof',
      'effect 8 (action): "cost.amount" is a whole number from 0 to 999',
      'effect 9 (checkBonus): names one of "skills", "ability" or "every"',
      'effect 10: is not an effect',
    ]);
  });

  it('reads at most 64 effects an entry', () => {
    const effects = Array.from({ length: 70 }, () => ({ kind: 'acBonus', amount: 1 }));
    const read = readMechanics({ v: 1, effects });
    expect(read.effects).toHaveLength(CAST_GUIDANCE_LIMITS.effectsPerEntry);
    expect(read.problems).toEqual(['only the first 64 of "effects" count']);
  });

  it('reads states an effect holds while, and only on numbers and rolls', () => {
    const read = readMechanics({
      v: 1,
      effects: [
        { kind: 'acBonus', amount: 1, while: 'bloodied' },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['check'] },
          while: [{ effect: 'Rage' }, 'noArmor'],
        },
        { kind: 'saveBonus', amount: 1, while: { condition: 'Prone' } },
        { kind: 'resource', key: 'k', label: 'K', max: 1, reset: 'long', while: 'bloodied' },
        { kind: 'maxHpBonus', amount: 5, while: 'bloodied' },
        { kind: 'acBonus', amount: 1, while: 'raging' },
        { kind: 'acBonus', amount: 1, while: { effect: 'Rage', condition: 'Prone' } },
        { kind: 'acBonus', amount: 1, while: [] },
      ],
    });
    expect(read.effects.map((t) => t.while)).toEqual([
      [{ state: 'bloodied' }],
      [{ state: 'effect', name: 'Rage' }, { state: 'noArmor' }],
      [{ state: 'condition', condition: 'Prone' }],
    ]);
    expect(read.problems).toEqual([
      'effect 4 (resource): "while" holds only for an effect on numbers or rolls',
      'effect 5 (maxHpBonus): "while" bloodied cannot hold for a score or the hit point maximum',
      'effect 6 (acBonus): "while" has no state "raging"',
      'effect 7 (acBonus): "while" is a state word, { "effect": name } or { "condition": name }',
      'effect 8 (acBonus): "while" lists from 1 to 8 states',
    ]);
  });

  it('reads drops, replace and basedOn', () => {
    const read = readMechanics({
      v: 1,
      drop: [{ kind: 'resource', label: 'Rage' }, { kind: 'speedBonus' }, { kind: 'nope' }],
      replace: true,
      basedOn: 'Alert|PHB',
    });
    expect(read).toMatchObject({
      readable: true,
      replace: true,
      basedOn: { name: 'Alert', source: 'PHB' },
      drop: [{ kind: 'resource', label: 'Rage' }, { kind: 'speedBonus' }],
      problems: ['drop 3: has no kind "nope"'],
    });
    expect(readMechanics({ v: 1, basedOn: 'Alert' }).problems).toEqual([
      '"basedOn" is "name|source"',
    ]);
    expect(readMechanics({ v: 1, replace: 'yes' }).problems).toEqual([
      '"replace" is true or false',
    ]);
  });

  it('reads nothing from a file without a version or from a newer one, and says so', () => {
    expect(readMechanics({ effects: [{ kind: 'acBonus', amount: 1 }] })).toMatchObject({
      readable: false,
      effects: [],
      problems: ['its mechanics have no version, so they do not count'],
    });
    expect(readMechanics({ v: 2, effects: [] })).toMatchObject({
      readable: false,
      problems: ['made with a newer Cast Guidance: update to use its mechanics'],
    });
    expect(readMechanics('effects').readable).toBe(false);
    expect(readMechanics([{ v: 1 }]).readable).toBe(false);
  });

  it('reads each stored object once', () => {
    const raw = { v: 1, effects: [{ kind: 'acBonus', amount: { f: 'prof' } }] };
    expect(readMechanics(raw)).toBe(readMechanics(raw));
    expect(readMechanics({ ...raw })).not.toBe(readMechanics(raw));
  });

  it('reads a list of stored effects for a patch or a moment by the same rules', () => {
    expect(readStoredEffects('x', 'add')).toEqual({
      effects: [],
      problems: ['"add" is not a list'],
    });
    expect(readStoredEffects([{ kind: 'acBonus', amount: 1 }]).effects).toHaveLength(1);
  });
});

describe('basedOn and the official entry', () => {
  it('prefers castGuidance basedOn, else a converted file printingOf', () => {
    const copy = { name: 'Watchful', source: 'HB', ...cg({ basedOn: 'Alert|PHB' }) };
    const printed = { name: 'Watchful', source: 'FC', printingOf: ['Alert|XPHB'] };
    expect(basedOn(copy)).toEqual({ name: 'Alert', source: 'PHB' });
    expect(officialOf(printed)).toEqual({ name: 'Alert', source: 'XPHB' });
    expect(officialOf({ ...printed, ...cg({ basedOn: 'Alert|PHB' }) })).toEqual({
      name: 'Alert',
      source: 'PHB',
    });
    expect(entryKeys(copy, 'watchful|hb')).toEqual(['watchful|hb', 'alert|phb']);
    expect(entryKeys({ name: 'Alert', source: 'PHB' }, 'alert|phb')).toEqual(['alert|phb']);
    // A version this build cannot read says nothing about what it copies.
    expect(basedOn({ castGuidance: { v: 9, basedOn: 'Alert|PHB' } })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('mechanicsOf: the layers', () => {
  const inheritedOne = (col: Collector) =>
    vi.fn(() => {
      col.add({ kind: 'resource', key: 'rage', label: 'Rage', max: 2, resetOn: 'long', origin });
      col.add({ kind: 'speedBonus', amount: 10, origin });
    });
  const subject = (col: Collector, entry: DataEntity, inherited = inheritedOne(col)) => {
    mechanicsOf(col, { entry, label: 'Lantern', origin, target: 'Lantern|HB', inherited });
    return inherited;
  };
  const pack = (name: string, patches: unknown[], characters = ['hero']): DataEntity => ({
    name,
    source: name,
    appliesTo: { characters },
    castGuidance: { v: 1, patches },
  });

  it('without castGuidance or packs, collects only what it inherits', () => {
    const col = new Collector(character(), world({}));
    const inherited = subject(col, { name: 'Lantern' });
    expect(inherited).toHaveBeenCalledOnce();
    expect(kinds(col)).toEqual(['resource', 'speedBonus']);
    expect(col.warnings).toEqual([]);
  });

  it('adds its own effects, first, to what it inherits', () => {
    const col = new Collector(character(), world({}));
    const inherited = subject(col, cg({ effects: [{ kind: 'acBonus', amount: 1 }] }));
    expect(inherited).toHaveBeenCalledOnce();
    expect(kinds(col)).toEqual(['acBonus', 'resource', 'speedBonus']);
    expect(col.effects[0]?.origin).toBe(origin);
  });

  it('inherits nothing when it says replace', () => {
    const col = new Collector(character(), world({}));
    const inherited = subject(
      col,
      cg({ replace: true, effects: [{ kind: 'acBonus', amount: 1 }] }),
    );
    expect(inherited).not.toHaveBeenCalled();
    expect(kinds(col)).toEqual(['acBonus']);
  });

  it('drops inherited effects by kind and label, never its own', () => {
    const col = new Collector(character(), world({}));
    subject(
      col,
      cg({
        effects: [{ kind: 'resource', key: 'mine', label: 'Rage', max: 3, reset: 'short' }],
        drop: [{ kind: 'resource', label: 'rage' }],
      }),
    );
    expect(col.effects.map((e) => [e.kind, 'key' in e ? e.key : undefined])).toEqual([
      ['resource', 'mine'],
      ['speedBonus', undefined],
    ]);
    const all = new Collector(character(), world({}));
    subject(all, cg({ drop: [{ kind: 'speedBonus' }] }));
    expect(kinds(all)).toEqual(['resource']);
  });

  it('counts nothing of mechanics it cannot read, says why, and inherits as before', () => {
    const col = new Collector(character(), world({}));
    const inherited = subject(col, {
      castGuidance: { v: 7, effects: [{ kind: 'acBonus', amount: 1 }] },
    });
    expect(inherited).toHaveBeenCalledOnce();
    expect(kinds(col)).toEqual(['resource', 'speedBonus']);
    expect(col.warnings).toEqual([
      'Lantern: made with a newer Cast Guidance: update to use its mechanics',
    ]);
  });

  it("puts a pack's replacement first and nothing else, under the pack's name", () => {
    const ctx = world({
      [RULE_PACK_TYPE]: [
        pack('Gritty', [{ target: 'lantern|hb', effects: [{ kind: 'acBonus', amount: 2 }] }]),
      ],
    });
    const col = new Collector(character(), ctx);
    const inherited = subject(col, cg({ effects: [{ kind: 'acBonus', amount: 1 }] }));
    expect(inherited).not.toHaveBeenCalled();
    expect(col.effects).toEqual([
      { kind: 'acBonus', amount: 2, origin: { ...origin, pack: 'Gritty' } },
    ]);
  });

  it("adds every pack's addition, and the later pack's replacement wins", () => {
    const ctx = world({
      [RULE_PACK_TYPE]: [
        pack('One', [
          { target: 'LANTERN|HB', effects: [{ kind: 'acBonus', amount: 1 }] },
          { target: 'lantern|hb', add: [{ kind: 'cue', text: 'One' }] },
        ]),
        pack('Two', [
          { target: 'lantern|hb', effects: [{ kind: 'acBonus', amount: 2 }] },
          { target: 'lantern|hb', add: [{ kind: 'cue', text: 'Two' }] },
        ]),
      ],
    });
    const col = new Collector(character(), ctx);
    subject(col, { name: 'Lantern' });
    expect(col.effects.map((e) => [e.kind, e.origin.pack])).toEqual([
      ['acBonus', 'Two'],
      ['cue', 'One'],
      ['cue', 'Two'],
    ]);
  });

  it("adds a pack's addition to its own effects and what it inherits", () => {
    const ctx = world({
      [RULE_PACK_TYPE]: [
        pack('Kind', [{ target: 'lantern|hb', add: [{ kind: 'cue', text: 'Hi' }] }]),
      ],
    });
    const col = new Collector(character(), ctx);
    subject(col, cg({ effects: [{ kind: 'acBonus', amount: 1 }] }));
    expect(kinds(col)).toEqual(['cue', 'acBonus', 'resource', 'speedBonus']);
  });

  it('reaches only the characters a pack is applied to', () => {
    const ctx = world({
      [RULE_PACK_TYPE]: [
        pack('Elsewhere', [{ target: 'lantern|hb', effects: [] }], ['someone-else']),
        {
          name: 'No list',
          source: 'X',
          castGuidance: { v: 1, patches: [{ target: 'lantern|hb', effects: [] }] },
        },
      ],
    });
    const col = new Collector(character(), ctx);
    expect(subject(col, { name: 'Lantern' })).toHaveBeenCalledOnce();
    expect(col.warnings).toEqual([]);
  });

  it('says once per sheet what in a pack does not count', () => {
    const ctx = world({
      [RULE_PACK_TYPE]: [
        pack('Broken', [
          { target: '', add: [] },
          { target: 'lantern|hb', add: [{ kind: 'fly' }] },
        ]),
        { name: 'Newer', source: 'N', appliesTo: { characters: ['hero'] }, castGuidance: { v: 3 } },
      ],
    });
    const col = new Collector(character(), ctx);
    subject(col, { name: 'Lantern' });
    subject(col, { name: 'Lantern' });
    expect(col.warnings).toEqual([
      'Broken: patch 1: "target" is the key of the entry it changes',
      'Broken: patch 2 (lantern|hb): effect 1 (fly): has no kind "fly"',
      'Newer: made with a newer Cast Guidance: update to use its mechanics',
    ]);
  });

  it('binds classLevel as collected and copies each effect afresh', () => {
    const entry = cg({
      effects: [{ kind: 'acBonus', amount: { byLevel: { '1': 1, '3': 2 } }, while: 'shield' }],
    });
    const col = new Collector(character(), world({}));
    mechanicsOf(col, { entry, label: 'L', origin, target: 'l', classLevel: 3 });
    mechanicsOf(col, { entry, label: 'L', origin, target: 'l' });
    const [a, b] = col.effects;
    expect(a).not.toBe(b);
    expect(a?.formulas?.[0]?.classLevel).toBe(3);
    // No class level given: the character's level.
    expect(b?.formulas?.[0]?.classLevel).toBe(4);
    expect(a?.while).toEqual([{ state: 'shield' }]);
  });
});

// ---------------------------------------------------------------------------

describe('basedOn reaches the curated row', () => {
  it('for a feat copied from Alert', () => {
    const initiative = (copy: DataEntity) =>
      deriveSheet(withFeats('Watchful'), world({ feat: [copy] })).initiative.parts.find(
        (p) => p.label === 'Watchful',
      )?.amount;
    expect(initiative(feat('Watchful'))).toBeUndefined();
    expect(initiative(feat('Watchful', { basedOn: 'Alert|PHB' }))).toBe(5);
  });

  const brute = (body?: Record<string, unknown>, features: DataEntity[] = []) => {
    const cls: DataEntity = {
      name: 'Brute',
      source: 'HB',
      hd: { number: 1, faces: 12 },
      proficiency: ['str', 'con'],
      classFeatures: features.map((f) => `${f.name}|Brute|HB|1`),
      ...(body !== undefined ? cg(body) : {}),
    };
    const ctx = world({
      class: [cls],
      classFeature: features.map((f) => ({
        source: 'HB',
        className: 'Brute',
        classSource: 'HB',
        level: 1,
        ...f,
      })),
    });
    const doc = character((d) => {
      d.classes = [{ ref: { name: 'Brute', source: 'HB' }, levels: 1, hp: ['avg'] }];
    });
    return deriveSheet(doc, ctx).speedWalk.parts.find((p) => p.amount === 10)?.label;
  };

  it("for a class feature, by the class's basedOn", () => {
    const fast = { name: 'Fast Movement', entries: ['You move fast.'] };
    expect(brute(undefined, [fast])).toBeUndefined();
    expect(brute({ basedOn: 'Barbarian|PHB' }, [fast])).toBe('Fast Movement');
  });

  it("for a class feature, by the feature's own basedOn", () => {
    const stride = {
      name: 'Swift Stride',
      entries: ['You move fast.'],
      ...cg({ basedOn: 'Fast Movement|PHB' }),
    };
    expect(brute(undefined, [stride])).toBeUndefined();
    expect(brute({ basedOn: 'Barbarian|PHB' }, [stride])).toBe('Swift Stride');
  });

  it("for a subclass feature, by the subclass's basedOn", () => {
    const superiority = (body?: Record<string, unknown>) => {
      const ctx = world({
        subclass: [
          {
            name: 'Tactician',
            shortName: 'Tactician',
            source: 'HB',
            className: 'Warrior',
            classSource: 'TST',
            subclassFeatures: ['Combat Superiority|Warrior|TST|Tactician|HB|3'],
            ...(body !== undefined ? cg(body) : {}),
          },
        ],
        subclassFeature: [
          {
            name: 'Combat Superiority',
            source: 'HB',
            className: 'Warrior',
            classSource: 'TST',
            subclassShortName: 'Tactician',
            subclassSource: 'HB',
            level: 3,
            entries: ['You learn tricks.'],
          },
        ],
      });
      const doc = character((d) => {
        d.classes = [
          {
            ref: { name: 'Warrior', source: 'TST' },
            subclass: { name: 'Tactician', source: 'HB' },
            levels: 3,
            hp: [],
          },
        ];
      });
      return deriveSheet(doc, ctx).resources.find((r) => r.key === 'superiority-dice')?.origin;
    };
    expect(superiority()).toBeUndefined();
    expect(superiority({ basedOn: 'Battle Master|PHB' })).toBe('Combat Superiority');
  });

  it("for a species trait, by the trait's basedOn", () => {
    const ac = (body?: Record<string, unknown>) => {
      const race: DataEntity = {
        name: 'Ironkin',
        source: 'HB',
        speed: 30,
        entries: [
          {
            type: 'entries',
            name: 'Plated Hide',
            entries: ['Your hide is hard.'],
            ...(body ? cg(body) : {}),
          },
        ],
      };
      const doc = character((d) => {
        d.race = { name: 'Ironkin', source: 'HB' };
      });
      return deriveSheet(doc, world({ race: [race] })).ac.parts.find((p) => p.label === 'Ironkin')
        ?.amount;
    };
    expect(ac()).toBeUndefined();
    expect(ac({ basedOn: 'Integrated Protection|EFA' })).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('formulas at fold time', () => {
  const sheetWith = (effects: unknown[], edit: (d: CharacterDoc) => void = () => {}) => {
    const doc = withFeats('Gift');
    edit(doc);
    return deriveSheet(doc, world({ feat: [feat('Gift', { effects })] }));
  };
  const part = (v: { parts: Array<{ label: string; amount: number }> }) =>
    v.parts.find((p) => p.label === 'Gift')?.amount;

  it('works out a resource maximum from the final ability modifier', () => {
    const sheet = sheetWith([
      { kind: 'abilityBonus', ability: 'cha', amount: 2 },
      {
        kind: 'resource',
        key: 'gift',
        label: 'Gift',
        max: { f: 'max(1, mod.cha)' },
        reset: 'long',
      },
    ]);
    expect(sheet.abilities.cha.value).toBe(18);
    expect(sheet.resources.find((r) => r.key === 'gift')?.max).toBe(4);
  });

  it('works out an ability bonus from the proficiency bonus before the scores fold', () => {
    const sheet = sheetWith([{ kind: 'abilityBonus', ability: 'str', amount: { f: 'prof - 1' } }]);
    expect(sheet.profBonus.value).toBe(2);
    expect(sheet.abilities.str.value).toBe(15);
  });

  it('works out a hit point bonus from the final Constitution modifier', () => {
    const plain = sheetWith([]);
    const sheet = sheetWith([{ kind: 'maxHpBonus', amount: { f: 'mod.con * level' } }]);
    expect(sheet.maxHp.value - plain.maxHp.value).toBe(8);
  });

  it('reads hit points once the maximum is known', () => {
    const effects = [{ kind: 'acBonus', amount: { f: 'hp <= maxHp / 2 ? 2 : 0' } }];
    expect(part(sheetWith(effects, (d) => (d.play.currentHp = 30)).ac)).toBe(0);
    expect(part(sheetWith(effects, (d) => (d.play.currentHp = 10)).ac)).toBe(2);
    // A sheet still filling its hit points is at full.
    expect(
      part(
        sheetWith(effects, (d) => {
          d.play.hpInitialized = false;
          d.play.currentHp = 0;
        }).ac,
      ),
    ).toBe(0);
  });

  it("reads classLevel as the entry's own class's level, and level as the character's", () => {
    const ctx = world({
      class: [
        {
          name: 'Brute',
          source: 'HB',
          hd: { number: 1, faces: 12 },
          classFeatures: ['Toughness|Brute|HB|1'],
        },
      ],
      classFeature: [
        {
          name: 'Toughness',
          source: 'HB',
          className: 'Brute',
          classSource: 'HB',
          level: 1,
          entries: ['You are tough.'],
          ...cg({
            effects: [
              { kind: 'acBonus', amount: { byLevel: { '1': 1, '3': 2, '5': 3 } } },
              { kind: 'initiativeBonus', amount: { f: 'level * 10 + classLevel' } },
            ],
          }),
        },
      ],
    });
    const doc = character((d) => {
      d.classes = [
        { ref: { name: 'Brute', source: 'HB' }, levels: 3, hp: [] },
        { ref: { name: 'Warrior', source: 'TST' }, levels: 2, hp: [] },
      ];
    });
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.ac.parts.find((p) => p.label === 'Toughness')?.amount).toBe(2);
    expect(sheet.initiative.parts.find((p) => p.label === 'Toughness')?.amount).toBe(53);
  });

  it('never takes a range, a speed or a maximum below 0', () => {
    const sheet = sheetWith([
      { kind: 'sense', sense: 'darkvision', range: { f: '0 - 60' } },
      { kind: 'speedBonus', amount: { f: '0 - 5' } },
    ]);
    expect(sheet.senses.find((s) => s.origin === 'Gift')?.range).toBe(0);
    expect(part(sheet.speedWalk)).toBe(-5);
  });

  it('counts formulas past the per-derive budget as 0, and says so', () => {
    // 99 steps and 2 levels deep, in 200 characters.
    const heavy = { f: `max(1${',0'.repeat(97)})` };
    const names = ['A', 'B', 'C', 'D'];
    const ctx = world({
      feat: names.map((n) =>
        feat(n, {
          effects: Array.from({ length: 64 }, () => ({ kind: 'acBonus', amount: heavy })),
        }),
      ),
    });
    const sheet = deriveSheet(withFeats(...names), ctx);
    const counted = sheet.ac.parts.filter((p) => names.includes(p.label) && p.amount === 1);
    // 202 of them fit in 20,000 steps.
    expect(sheet.warnings.filter((w) => w.includes('formula'))).toHaveLength(1);
    expect(counted).toHaveLength(202);
    expect(sheet.warnings).toContain(
      'This character has too many formulas to work out; the rest count as 0.',
    );
  });

  it('works out nothing a stored document dresses up as a formula', () => {
    const doc = character((d) => {
      d.customEffects = [
        JSON.parse(
          '{"kind":"acBonus","amount":1,"origin":{"label":"Odd","uid":"o","type":"custom"},"formulas":[{"field":"amount","formula":{"evaluate":"x","cost":1},"classLevel":1}]}',
        ),
        JSON.parse(
          '{"kind":"acBonus","amount":2,"origin":{"label":"Odder","uid":"p","type":"custom"},"formulas":7}',
        ),
      ];
    });
    const sheet = deriveSheet(doc, world({}));
    expect(sheet.ac.parts.filter((p) => p.label.startsWith('Odd')).map((p) => p.amount)).toEqual([
      1, 2,
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('while states (H10)', () => {
  const effect = (states: unknown) => [{ kind: 'acBonus', amount: 1, while: states }];
  const counts = (states: unknown, edit: (d: CharacterDoc) => void = () => {}, active = true) => {
    const doc = withFeats('Gift');
    edit(doc);
    const sheet = deriveSheet(doc, world({ feat: [feat('Gift', { effects: effect(states) })] }), {
      active,
    });
    return sheet.ac.parts.some((p) => p.label === 'Gift');
  };

  it('bloodied: at or under half the hit point maximum', () => {
    const max = deriveSheet(withFeats('Gift'), world({ feat: [feat('Gift')] })).maxHp.value;
    expect(counts('bloodied', (d) => (d.play.currentHp = Math.floor(max / 2) + 1))).toBe(false);
    expect(counts('bloodied', (d) => (d.play.currentHp = Math.floor(max / 2)))).toBe(true);
    expect(
      counts('bloodied', (d) => {
        d.play.hpInitialized = false;
        d.play.currentHp = 0;
      }),
    ).toBe(false);
  });

  it('zeroHp, concentrating and a condition', () => {
    expect(counts('zeroHp')).toBe(false);
    expect(counts('zeroHp', (d) => (d.play.currentHp = 0))).toBe(true);
    expect(counts('concentrating')).toBe(false);
    expect(counts('concentrating', (d) => (d.play.concentratingOn = { label: 'Bless' }))).toBe(
      true,
    );
    expect(counts({ condition: 'prone' }, (d) => (d.play.conditions = [{ id: 'Prone' }]))).toBe(
      true,
    );
    expect(
      counts({ condition: 'prone' }, (d) => (d.play.conditions = [{ id: 'Prone', ignored: true }])),
    ).toBe(false);
  });

  it('an effect of that name in play, and only while effects in play count', () => {
    const raging = (d: CharacterDoc) => {
      d.play.activeEffects = [{ id: 'r1', name: 'Rage', parts: [] }];
    };
    expect(counts({ effect: 'rage' })).toBe(false);
    expect(counts({ effect: 'rage' }, raging)).toBe(true);
    expect(counts({ effect: 'rage' }, raging, false)).toBe(false);
    expect(
      counts(
        { effect: 'Haste' },
        (d) =>
          (d.play.activeEffects = [{ id: 'p', name: 'Potion of Speed', same: 'Haste', parts: [] }]),
      ),
    ).toBe(true);
    expect(
      counts(
        { effect: 'rage' },
        (d) => (d.play.activeEffects = [{ id: 'r', name: 'Rage', parts: [], off: true }]),
      ),
    ).toBe(false);
  });

  it('wearing no armor, holding a shield', () => {
    const wear = (name: string) => (d: CharacterDoc) => {
      d.equipment = [
        { id: name, ref: { name, source: 'TST' }, qty: 1, equipped: true, attuned: false },
      ];
    };
    expect(counts('noArmor')).toBe(true);
    expect(counts('noArmor', wear('Leather Armor'))).toBe(false);
    expect(counts('noArmor', wear('Shield'))).toBe(true);
    expect(counts('shield')).toBe(false);
    expect(counts('shield', wear('Shield'))).toBe(true);
  });

  it('holds only while every state does', () => {
    const both = ['concentrating', 'noArmor'];
    expect(counts(both)).toBe(false);
    expect(counts(both, (d) => (d.play.concentratingOn = { label: 'Bless' }))).toBe(true);
  });

  it('never counts a state a stored document makes up, and ignores a list that is no list', () => {
    const custom = (states: unknown): EffectInput =>
      ({
        kind: 'acBonus',
        amount: 1,
        origin: { label: 'Odd', uid: 'o', type: 'custom' },
        while: states,
      }) as EffectInput;
    const ac = (states: unknown) =>
      deriveSheet(
        character((d) => (d.customEffects = [custom(states)])),
        world({}),
      ).ac.parts.some((p) => p.label === 'Odd');
    expect(ac([{ state: 'nope' }])).toBe(false);
    expect(ac([null])).toBe(false);
    expect(ac([{ state: 'effect', name: 7 }])).toBe(false);
    expect(ac('bloodied')).toBe(true);
  });
});
