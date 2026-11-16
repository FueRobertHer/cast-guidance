import { describe, expect, it, vi } from 'vitest';
import { BUILT_IN_RULE_SETS, makeTestContext } from '../../../tests-fixtures/testWorld';
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
  builtInRuleIn,
  entryKeys,
  mechanicsOf,
  officialOf,
  readMechanics,
  readRuleSet,
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
    { kind: 'damageDie', dice: '1d6', damageType: 'fire', weaponsOnly: true },
    { kind: 'spellDcBonus', amount: 1 },
    {
      kind: 'spellDamageBonus',
      amount: { f: 'mod.cha' },
      spells: ['Eldritch Blast'],
      className: 'Warlock',
      cantrips: true,
      school: 'V',
      oneRoll: true,
    },
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

  it("takes a maneuver's save DC, the higher of Strength and Dexterity", () => {
    const save = { targetAbility: 'str', dcAbility: 'strOrDex' };
    const read = readMechanics({
      v: 1,
      effects: [{ kind: 'action', economy: 'none', label: 'Trip', save }],
    });
    expect(read.problems).toEqual([]);
    expect(read.effects[0]?.effect).toMatchObject({ save });
  });

  it("reads a pool's die, foretelling and points kept off slots, the proficiency bonus on initiative, and an AC with no label", () => {
    const read = readMechanics({
      v: 1,
      effects: [
        {
          kind: 'resource',
          key: 'omens',
          label: 'Omens',
          max: 2,
          reset: 'long',
          die: '1d8',
          foretell: true,
          noSlotConversion: 1,
        },
        { kind: 'initiativeBonus', profBonus: true },
        { kind: 'acFormula', base: 12, addAbilities: ['dex'] },
      ],
    });
    expect(read.problems).toEqual([]);
    expect(read.effects.map((t) => t.effect)).toEqual([
      {
        kind: 'resource',
        key: 'omens',
        label: 'Omens',
        max: 2,
        resetOn: 'long',
        die: '1d8',
        foretell: true,
        noSlotConversion: 1,
      },
      // The engine's own word for it, which counts once (`deriveSheet`).
      { kind: 'initiativeBonus', amount: 'profBonus' },
      { kind: 'acFormula', base: 12, addAbilities: ['dex'] },
    ]);
    const pool = { kind: 'resource', key: 'omens', label: 'Omens', max: 2, reset: 'long' };
    const bad = readMechanics({
      v: 1,
      effects: [
        { ...pool, die: '2d6' },
        { ...pool, die: 'd6' },
        { ...pool, noSlotConversion: 0 },
        { ...pool, foretell: 'yes' },
        { kind: 'initiativeBonus', profBonus: true, amount: 2 },
        { kind: 'initiativeBonus', profBonus: false },
        { kind: 'initiativeBonus', profBonus: 'yes' },
        { kind: 'initiativeBonus' },
        // A false flag is the same as none.
        { kind: 'initiativeBonus', profBonus: false, amount: 2 },
      ],
    });
    expect(bad.effects.map((t) => t.effect)).toEqual([{ kind: 'initiativeBonus', amount: 2 }]);
    expect(bad.problems).toEqual([
      'effect 1 (resource): "die" is one die, like 1d6',
      'effect 2 (resource): "die" is one die, like 1d6',
      'effect 3 (resource): "noSlotConversion" is a whole number from 1 to 20',
      'effect 4 (resource): "foretell" is true or false',
      'effect 5 (initiativeBonus): names "amount" or "profBonus", not both',
      'effect 6 (initiativeBonus): "amount" is missing',
      'effect 7 (initiativeBonus): "profBonus" is true or false',
      'effect 8 (initiativeBonus): "amount" is missing',
    ]);
  });

  it('reads a spell damage bonus for the spells of the class that gives it', () => {
    const bonus = { kind: 'spellDamageBonus', amount: 2 };
    const read = readMechanics({
      v: 1,
      effects: [
        { ...bonus, ownClass: true, cantrips: true },
        // A false flag is the same as none.
        { ...bonus, ownClass: false, className: 'Bard' },
        { ...bonus, ownClass: true, className: 'Bard' },
        { ...bonus, ownClass: 'yes' },
      ],
    });
    expect(read.effects.map((t) => t.effect)).toEqual([
      { ...bonus, ownClass: true, cantrips: true },
      { ...bonus, className: 'Bard' },
    ]);
    expect(read.problems).toEqual([
      'effect 3 (spellDamageBonus): names "className" or "ownClass", not both',
      'effect 4 (spellDamageBonus): "ownClass" is true or false',
    ]);
  });

  it('reads a spell grant cast with the class that gives it, with its usage by level', () => {
    const grant = { kind: 'grantSpell', spell: 'Hex Bolt|HB' };
    const spell = { name: 'Hex Bolt', source: 'HB' };
    const read = readMechanics({
      v: 1,
      effects: [
        { ...grant, ownClass: true, usage: { byLevel: { '5': '3/day', '1': '2/day' } } },
        // A false flag is the same as none.
        { ...grant, ownClass: false, ability: 'wis', usage: '1/day' },
        { ...grant, ownClass: true, ability: 'wis' },
        { ...grant, ownClass: 'yes' },
        { ...grant, usage: { byLevel: { '1': 2 } } },
      ],
    });
    expect(read.effects.map((t) => t.effect)).toEqual([
      { kind: 'grantSpell', spell, ownClass: true, usage: '2/day' },
      { kind: 'grantSpell', spell, ability: 'wis', usage: '1/day' },
    ]);
    expect(read.effects.map((t) => t.byLevel)).toEqual([
      [
        {
          field: 'usage',
          rows: [
            [1, '2/day'],
            [5, '3/day'],
          ],
        },
      ],
      undefined,
    ]);
    expect(read.problems).toEqual([
      'effect 3 (grantSpell): names "ability" or "ownClass", not both',
      'effect 4 (grantSpell): "ownClass" is true or false',
      'effect 5 (grantSpell): "usage" byLevel: level 1 needs words',
    ]);
  });

  it('reads the rules version an effect counts under beside it, and a pool named for its class', () => {
    const pool = { kind: 'resource', key: 'cd', label: 'Channel Divinity', max: 1, reset: 'short' };
    const read = readMechanics({
      v: 1,
      effects: [
        { ...pool, edition: '2014', ownClass: true },
        { kind: 'acBonus', amount: 1, edition: '2024', while: 'shield' },
        // A false flag is the same as none.
        { ...pool, ownClass: false },
        { ...pool, edition: '5e' },
        { ...pool, edition: 2024 },
        { ...pool, ownClass: 'yes' },
      ],
    });
    const { reset: _, ...readPool } = { ...pool, resetOn: 'short' };
    expect(read.effects.map((t) => [t.effect, t.edition])).toEqual([
      [{ ...readPool, ownClass: true }, '2014'],
      [{ kind: 'acBonus', amount: 1 }, '2024'],
      [readPool, undefined],
    ]);
    expect(read.effects[1]?.while).toEqual([{ state: 'shield' }]);
    expect(read.problems).toEqual([
      'effect 4 (resource): "edition" is one of 2014, 2024',
      'effect 5 (resource): "edition" is one of 2014, 2024',
      'effect 6 (resource): "ownClass" is true or false',
    ]);
  });

  it('reads a pool or action named for its class beside another class, or always', () => {
    const pool = { kind: 'resource', key: 'hdp', label: 'Harness', max: 1, reset: 'long' };
    const act = { kind: 'action', economy: 'bonus', label: 'Harness' };
    const read = readMechanics({
      v: 1,
      effects: [
        { ...pool, ownClassBeside: ['Paladin', 'Paladin', ' Oathsworn '] },
        { ...act, ownClassBeside: ['Cleric'] },
        { ...act, ownClass: true },
        { ...pool, ownClass: true, ownClassBeside: ['Cleric'] },
        { ...act, ownClassBeside: [] },
        { ...act, ownClassBeside: 'Cleric' },
        { ...pool, ownClassBeside: [''] },
        // Only a pool or an action reads it.
        { kind: 'acBonus', amount: 1, ownClassBeside: ['Cleric'] },
      ],
    });
    const { reset: _, ...readPool } = { ...pool, resetOn: 'long' };
    expect(read.effects.map((t) => t.effect)).toEqual([
      { ...readPool, ownClassBeside: ['Paladin', 'Oathsworn'] },
      { ...act, ownClassBeside: ['Cleric'] },
      { ...act, ownClass: true },
      { kind: 'acBonus', amount: 1 },
    ]);
    expect(read.problems).toEqual([
      'effect 4 (resource): names "ownClass" or "ownClassBeside", not both',
      'effect 5 (action): "ownClassBeside" is a list',
      'effect 6 (action): "ownClassBeside" is a list',
      'effect 7 (resource): "ownClassBeside" needs words',
    ]);
  });

  it('reads words by class level on a pool and an action, kept for when it is emitted', () => {
    const pool = {
      kind: 'resource',
      key: 'embers',
      label: { byLevel: { '1': 'Embers (d6)', '9': 'Embers (d8)' } },
      die: { byLevel: { '9': '1d8', '1': '1d6' } },
      max: 2,
      reset: { byLevel: { '1': 'long', '5': 'short' } },
    };
    const act = {
      kind: 'action',
      economy: 'bonus',
      label: 'Flare',
      roll: { byLevel: { '1': '1d6', '11': '2d6' } },
      note: { byLevel: { '6': 'and again' } },
    };
    const read = readMechanics({ v: 1, effects: [pool, act] });
    expect(read.problems).toEqual([]);
    // Each holds its first level's words until it is emitted.
    expect(read.effects.map((t) => t.effect)).toEqual([
      {
        kind: 'resource',
        key: 'embers',
        label: 'Embers (d6)',
        die: '1d6',
        max: 2,
        resetOn: 'long',
      },
      { kind: 'action', economy: 'bonus', label: 'Flare', roll: '1d6', note: 'and again' },
    ]);
    expect(read.effects.map((t) => t.byLevel)).toEqual([
      [
        {
          field: 'label',
          rows: [
            [1, 'Embers (d6)'],
            [9, 'Embers (d8)'],
          ],
          needed: true,
        },
        {
          field: 'resetOn',
          rows: [
            [1, 'long'],
            [5, 'short'],
          ],
          needed: true,
        },
        {
          field: 'die',
          rows: [
            [1, '1d6'],
            [9, '1d8'],
          ],
        },
      ],
      [
        {
          field: 'roll',
          rows: [
            [1, '1d6'],
            [11, '2d6'],
          ],
        },
        { field: 'note', rows: [[6, 'and again']] },
      ],
    ]);
  });

  it('says what keeps words by level from counting', () => {
    const pool = (fields: Record<string, unknown>) => ({
      kind: 'resource',
      key: 'k',
      label: 'K',
      max: 1,
      reset: 'long',
      ...fields,
    });
    const levels = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), 'K']));
    const read = readMechanics({
      v: 1,
      effects: [
        pool({ reset: { byLevel: { '5': 'short' } } }),
        pool({ die: { byLevel: { '1': '1d6', '5': '2d6' } } }),
        pool({ label: { byLevel: { one: 'K' } } }),
        pool({ label: { byLevel: {} } }),
        pool({ label: { byLevel: 'K' } }),
        pool({ reset: { byLevel: { '1': 'dawn' } } }),
        { kind: 'action', economy: 'action', label: { byLevel: { '3': 'Late' } } },
        // Only a pool's and an action's words take a table.
        { kind: 'cue', text: { byLevel: { '1': 'Remember' } } },
        pool({ label: { byLevel: levels(31) } }),
      ],
    });
    expect(read.effects).toEqual([]);
    expect(read.problems).toEqual([
      'effect 1 (resource): "reset" byLevel starts at level 1, since the effect needs it',
      'effect 2 (resource): "die" byLevel: level 5 is one die, like 1d6',
      'effect 3 (resource): "label" byLevel: "one" is not a level',
      'effect 4 (resource): "label" byLevel needs at least one level',
      'effect 5 (resource): "label" is words or a level table ({ "byLevel": ... })',
      'effect 6 (resource): "reset" byLevel: level 1 is one of short, long',
      'effect 7 (action): "label" byLevel starts at level 1, since the effect needs it',
      'effect 8 (cue): "text" needs words',
      'effect 9 (resource): "label" byLevel has at most 30 levels',
    ]);
    // A built-in rule set's reading names a field beside the table; a player's reads past it.
    const extra = [pool({ label: { byLevel: { '1': 'K' }, f: 'x' } })];
    expect(readStoredEffects(extra, 'effects', true).problems).toEqual([
      'effect 1 (resource): "label.f" is not a field a level table reads',
    ]);
    expect(readStoredEffects(extra).effects.map((t) => t.effect.label)).toEqual(['K']);
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

  it('reads when an advantage holds, initiative and death or concentration saves alone, and proficient checks', () => {
    const read = readMechanics({
      v: 1,
      effects: [
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['save'] },
          when: ' Only against being Frightened ',
        },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'], initiative: true } },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], save: 'death' } },
        {
          kind: 'rollDie',
          dice: '1d4',
          on: { rolls: ['save'], abilities: ['con'], save: 'concentration' },
        },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'], initiative: false } },
        { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['save'] }, when: 'Only at night' },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'] }, when: '' },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['attack'], initiative: true } },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'], save: 'death' } },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], save: 'charm' } },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['check'], skills: ['Perception'], initiative: true },
        },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['check'], skilled: true, initiative: true },
        },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['check'], abilities: ['wis'], initiative: true },
        },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['save'], abilities: ['con'], save: 'death' },
        },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['save'], abilities: ['wis'], save: 'concentration' },
        },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['check'], abilities: ['dex', 'wis'], initiative: true },
        },
        { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'check'], proficient: true } },
        { kind: 'rollDie', dice: '1d4', on: { rolls: ['save'], proficient: true } },
        {
          kind: 'rollDie',
          dice: '1d4',
          on: { rolls: ['check'], proficient: true, initiative: true },
        },
        {
          kind: 'rollAdvantage',
          mode: 'adv',
          on: { rolls: ['attack', 'check'], initiative: true },
        },
        { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save', 'check'], save: 'death' } },
      ],
    });
    expect(read.effects.map((t) => t.effect)).toEqual([
      {
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['save'] },
        when: 'Only against being Frightened',
      },
      { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'], initiative: true } },
      { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'], save: 'death' } },
      {
        kind: 'rollDie',
        dice: '1d4',
        on: { rolls: ['save'], abilities: ['con'], save: 'concentration' },
      },
      { kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['check'] } },
      {
        kind: 'rollAdvantage',
        mode: 'adv',
        on: { rolls: ['check'], abilities: ['dex', 'wis'], initiative: true },
      },
      { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'check'], proficient: true } },
    ]);
    expect(read.problems).toEqual([
      'effect 6 (rollAdvantage): "when" goes with "mode": "adv" alone',
      'effect 7 (rollAdvantage): "when" needs words',
      'effect 8 (rollAdvantage): "on.initiative" is a check: "rolls" lists "check" alone',
      'effect 9 (rollAdvantage): "on.save" is a kind of save: "rolls" lists "save" alone',
      'effect 10 (rollAdvantage): "on.save" is one of death, concentration',
      'effect 11 (rollAdvantage): "on.initiative" uses no skill: leave out "skills", "skilled" and "proficient"',
      'effect 12 (rollAdvantage): "on.initiative" uses no skill: leave out "skills", "skilled" and "proficient"',
      'effect 13 (rollAdvantage): "on.initiative" is a Dexterity check: "abilities" lists "dex"',
      'effect 14 (rollAdvantage): "on.abilities" reach no death save, which uses no ability: leave them out',
      'effect 15 (rollAdvantage): "on.abilities" reach no concentration save without "con", a Constitution save',
      'effect 18 (rollDie): "on.proficient" narrows checks: "rolls" lists "check"',
      'effect 19 (rollDie): "on.initiative" uses no skill: leave out "skills", "skilled" and "proficient"',
      'effect 20 (rollAdvantage): "on.initiative" is a check: "rolls" lists "check" alone',
      'effect 21 (rollAdvantage): "on.save" is a kind of save: "rolls" lists "save" alone',
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
    // A copy of the origin: spend links find the inherited action by the object itself.
    expect(col.effects[0]?.origin).toEqual(origin);
    expect(col.effects[0]?.origin).not.toBe(origin);
    expect(col.effects[1]?.origin).toBe(origin);
  });

  it('names an AC formula with no label for what gives it', () => {
    const col = new Collector(character(), world({}));
    subject(
      col,
      cg({
        effects: [
          { kind: 'acFormula', base: 12, addAbilities: ['dex'] },
          { kind: 'acFormula', label: 'Bark Hide', base: 13 },
        ],
      }),
    );
    expect(col.effects.flatMap((e) => (e.kind === 'acFormula' ? [e.label] : []))).toEqual([
      'Lantern',
      'Bark Hide',
    ]);
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

  it('reads "ownClass" as the class the call site gives, on its own effects and a pack’s', () => {
    const bonus = (amount: number) => ({ kind: 'spellDamageBonus', amount, ownClass: true });
    const packs = world({
      [RULE_PACK_TYPE]: [
        pack('Swap', [{ target: 'lantern|hb', effects: [bonus(1)] }]),
        pack('More', [{ target: 'lantern|hb', add: [bonus(2)] }]),
      ],
    });
    const given = (ctx: EngineContext, className?: string) => {
      const col = new Collector(character(), ctx);
      mechanicsOf(col, {
        entry: cg({ effects: [bonus(3)] }),
        label: 'Lantern',
        origin,
        target: 'Lantern|HB',
        ...(className === undefined ? {} : { className }),
      });
      return col.effects.map((e) => [
        e.kind === 'spellDamageBonus' ? e.amount : e.kind,
        'className' in e ? e.className : undefined,
      ]);
    };
    expect(given(packs, 'Bard')).toEqual([
      [1, 'Bard'],
      [2, 'Bard'],
    ]);
    expect(given(world({}), 'Bard')).toEqual([[3, 'Bard']]);
    expect(given(packs)).toEqual([]);
    expect(given(world({}))).toEqual([]);
  });

  it('casts an "ownClass" grant with its class’s ability, and leaves one its class counts to the class', () => {
    const classes: DataEntity[] = [
      { name: 'Hexer', source: 'HB', spellcastingAbility: 'int' },
      // Its own data counts the casts, as a Death Knight's counts Rune Strike's.
      {
        name: 'Counter',
        source: 'HB',
        spellcastingAbility: 'wis',
        additionalSpells: [{ innate: { 3: { daily: { 1: ['hex bolt|hb'] } } } }],
      },
      // It casts no spells.
      { name: 'Brute', source: 'HB' },
    ];
    const ctx = world({ class: classes });
    const pool = (key: string) => ({ kind: 'resource', key, label: key, max: 1, reset: 'long' });
    const row = [
      pool('bolts'),
      pool('other'),
      {
        kind: 'grantSpell',
        spell: 'Hex Bolt|HB',
        ownClass: true,
        usage: { byLevel: { '1': '1/day', '5': '2/day' } },
        resourceKey: 'bolts',
      },
    ];
    const given = (className?: string, classLevel = 3, effects: unknown[] = row) => {
      const doc = character((d) => {
        d.classes = classes.map((c) => ({
          ref: { name: String(c.name), source: 'HB' },
          levels: 1,
          hp: [],
        }));
      });
      const col = new Collector(doc, ctx);
      mechanicsOf(col, {
        entry: cg({ effects }),
        label: 'Bolt',
        origin,
        target: 'bolt|hb',
        classLevel,
        ...(className === undefined ? {} : { className }),
      });
      return col.effects.map(({ origin: _, ...e }) => e);
    };
    const cast = (effects: ReturnType<typeof given>) =>
      effects.find((e) => e.kind === 'grantSpell');
    expect(given('Hexer')).toEqual([
      { kind: 'resource', key: 'bolts', label: 'bolts', max: 1, resetOn: 'long' },
      { kind: 'resource', key: 'other', label: 'other', max: 1, resetOn: 'long' },
      {
        kind: 'grantSpell',
        spell: { name: 'Hex Bolt', source: 'HB' },
        ability: 'int',
        usage: '1/day',
        resourceKey: 'bolts',
      },
    ]);
    expect(cast(given('Hexer', 5))).toMatchObject({ usage: '2/day' });
    // The grant and the pool it spends are the class's own; the other pool stays.
    const named = (effects: ReturnType<typeof given>) =>
      effects.map((e) => (e.kind === 'resource' ? e.key : e.kind));
    expect(named(given('Counter'))).toEqual(['other']);
    // A pool another effect in the list still spends stays, for that one.
    const counted = row[2];
    const flare = { kind: 'action', economy: 'action', label: 'Flare' };
    expect(
      named(
        given('Counter', 3, [
          pool('bolts'),
          counted,
          { ...flare, cost: { resource: 'bolts', amount: 1 } },
        ]),
      ),
    ).toEqual(['bolts', 'action']);
    expect(
      named(
        given('Counter', 3, [
          pool('bolts'),
          counted,
          { kind: 'grantSpell', spell: 'Shield|PHB', resourceKey: 'bolts' },
        ]),
      ),
    ).toEqual(['bolts', 'grantSpell']);
    // One of the other rules version (the character's are 2014) spends nothing.
    expect(
      named(
        given('Counter', 3, [
          pool('bolts'),
          counted,
          { ...flare, cost: { resource: 'bolts', amount: 1 }, edition: '2024' },
        ]),
      ),
    ).toEqual([]);
    // No ability to cast it with: a class that casts none, or no class at all (a feat's).
    for (const effects of [given('Brute'), given()]) {
      expect(effects).toHaveLength(3);
      expect(cast(effects)).not.toHaveProperty('ability');
      expect(cast(effects)).not.toHaveProperty('ownClass');
    }
  });

  it('counts an effect of one rules version under it alone, and names an "ownClass" pool for its class', () => {
    const effects = [
      {
        kind: 'resource',
        edition: '2014',
        key: 'cd',
        label: 'Channel Divinity',
        ownClass: true,
        max: 1,
        reset: 'short',
      },
      {
        kind: 'resource',
        edition: '2024',
        key: 'cd',
        label: { byLevel: { '1': 'Channel', '5': 'Greater Channel' } },
        ownClass: true,
        max: 2,
        reset: 'long',
      },
      { kind: 'action', edition: '2024', economy: 'bonus', label: 'Channel' },
      { kind: 'acBonus', amount: 1 },
    ];
    const given = (version: '2014' | '2024', className?: string, classLevel = 3) => {
      const col = new Collector(
        character((d) => {
          d.rulesVersion = version;
        }),
        world({}),
      );
      mechanicsOf(col, {
        entry: cg({ effects }),
        label: 'Lantern',
        origin,
        target: 'Lantern|HB',
        classLevel,
        ...(className === undefined ? {} : { className }),
      });
      for (const e of col.effects) {
        expect(e).not.toHaveProperty('ownClass');
        expect(e).not.toHaveProperty('className');
        expect(e).not.toHaveProperty('edition');
      }
      return col.effects.map((e) => ('label' in e ? `${e.kind} ${e.label}` : e.kind));
    };
    expect(given('2014', 'Death Knight')).toEqual([
      'resource Channel Divinity (Death Knight)',
      'acBonus',
    ]);
    // The class's name goes after the words for its level.
    expect(given('2024', 'Paladin', 5)).toEqual([
      'resource Greater Channel (Paladin)',
      'action Channel',
      'acBonus',
    ]);
    // No class gives it (a feat's): its own name alone.
    expect(given('2014')).toEqual(['resource Channel Divinity', 'acBonus']);
  });

  it('names a pool and its action for their class only beside a class they list', () => {
    const label = { byLevel: { '1': 'Harness', '6': 'Greater Harness' } };
    const effects = [
      { kind: 'resource', key: 'hdp', label, ownClassBeside: ['Paladin'], max: 1, reset: 'long' },
      // A name it lists matches in any case.
      { kind: 'action', economy: 'bonus', label, ownClassBeside: ['paladin'] },
      // Always, on an action too, so it keeps spending its pool's use.
      { kind: 'action', economy: 'none', label: 'Vow', ownClass: true },
    ];
    const ctx = world({
      class: [
        { name: 'Cleric', source: 'HB' },
        { name: 'Paladin', source: 'HB' },
        { name: 'Death Knight', source: 'HB', reskinOf: ['Paladin|HB'] },
        { name: 'Oathbound', source: 'HB', castGuidance: { v: 1, basedOn: 'Paladin|HB' } },
        { name: 'Ranger', source: 'HB' },
      ],
    });
    const given = (classes: string[], className?: string, classLevel = 2) => {
      const doc = character((d) => {
        d.classes = classes.map((name) => ({ ref: { name, source: 'HB' }, levels: 1, hp: [] }));
      });
      const col = new Collector(doc, ctx);
      mechanicsOf(col, {
        entry: cg({ effects }),
        label: 'Harness',
        origin,
        target: 'harness|hb',
        classLevel,
        ...(className === undefined ? {} : { className }),
      });
      for (const e of col.effects) {
        expect(e).not.toHaveProperty('ownClass');
        expect(e).not.toHaveProperty('ownClassBeside');
        expect(e).not.toHaveProperty('className');
      }
      return col.effects.map((e) => ('label' in e ? `${e.kind} ${e.label}` : e.kind));
    };
    // Alone, or beside a class it does not list: its own name.
    expect(given(['Cleric'], 'Cleric')).toEqual([
      'resource Harness',
      'action Harness',
      'action Vow (Cleric)',
    ]);
    expect(given(['Cleric', 'Ranger'], 'Cleric')).toEqual([
      'resource Harness',
      'action Harness',
      'action Vow (Cleric)',
    ]);
    // Beside a Paladin, the class reskinning one or a copy of one: named for its class,
    // after its words by level.
    for (const other of ['Paladin', 'Death Knight', 'Oathbound']) {
      expect(given(['Cleric', other], 'Cleric', 6)).toEqual([
        'resource Greater Harness (Cleric)',
        'action Greater Harness (Cleric)',
        'action Vow (Cleric)',
      ]);
    }
    // The class that gives it is not beside itself.
    expect(given(['Paladin'], 'Paladin')).toEqual([
      'resource Harness',
      'action Harness',
      'action Vow (Paladin)',
    ]);
    // No class gives it (a feat's): its own name alone.
    expect(given(['Cleric', 'Paladin'])).toEqual([
      'resource Harness',
      'action Harness',
      'action Vow',
    ]);
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

  it('adds the proficiency bonus to initiative once, from 2024 Alert and Hare-Trigger', () => {
    // Warrior 4: proficiency +2, DEX +2.
    const initiative = (feats: DataEntity[], trait: boolean) => {
      const race: DataEntity = {
        name: 'Harefolk',
        source: 'HB',
        speed: 30,
        entries: [{ type: 'entries', name: 'Hare-Trigger', entries: ['You are quick.'] }],
      };
      const doc = character((d) => {
        d.feats = feats.map((f, i) => ({
          ref: { name: String(f.name), source: 'HB' },
          instanceId: `f${i}`,
        }));
        if (trait) d.race = { name: 'Harefolk', source: 'HB' };
      });
      return deriveSheet(doc, world({ feat: feats, race: [race] })).initiative.value;
    };
    const alert = feat('Watchful', { basedOn: 'Alert|XPHB' });
    expect(initiative([], false)).toBe(2);
    expect(initiative([alert], false)).toBe(4);
    expect(initiative([], true)).toBe(4);
    expect(initiative([alert], true)).toBe(4);
    expect(initiative([alert, feat('Wary', { basedOn: 'Alert|XPHB' })], false)).toBe(4);
    // An amount that only comes to the proficiency bonus adds beside it.
    const keen = feat('Keen', { effects: [{ kind: 'initiativeBonus', amount: { f: 'prof' } }] });
    expect(initiative([alert, keen], false)).toBe(6);
    const once = feat('Once', { effects: [{ kind: 'initiativeBonus', profBonus: true }] });
    expect(initiative([once], true)).toBe(4);
  });

  it("names a copied subclass feature's Armor Class for the copy, renamed or not", () => {
    // Draconic Resilience (2024): 10 + DEX + CHA; DEX +2, CHA +3.
    const ac = (name: string) => {
      const ctx = world({
        subclass: [
          {
            name: 'Wyrmblood',
            shortName: 'Wyrmblood',
            source: 'HB',
            className: 'Warrior',
            classSource: 'TST',
            subclassFeatures: [`${name}|Warrior|TST|Wyrmblood|HB|3`],
            ...cg({ basedOn: 'Draconic Sorcery|XPHB' }),
          },
        ],
        subclassFeature: [
          {
            name,
            source: 'HB',
            className: 'Warrior',
            classSource: 'TST',
            subclassShortName: 'Wyrmblood',
            subclassSource: 'HB',
            level: 3,
            entries: ['Scales cover you.'],
            ...cg({ basedOn: 'Draconic Resilience|XPHB' }),
          },
        ],
      });
      const doc = character((d) => {
        d.classes = [
          {
            ref: { name: 'Warrior', source: 'TST' },
            subclass: { name: 'Wyrmblood', source: 'HB' },
            levels: 3,
            hp: [],
          },
        ];
      });
      const sheet = deriveSheet(doc, ctx);
      return [sheet.acFormulaLabel, sheet.ac.value];
    };
    expect(ac('Draconic Resilience')).toEqual(['Draconic Resilience', 15]);
    expect(ac('Scaled Hide')).toEqual(['Scaled Hide', 15]);
  });

  it("finds a feature's row for its printing before the row for every printing", () => {
    // Dread Ambusher: Wisdom on initiative in both printings, and uses in 2024.
    // WIS +2, DEX +2.
    const ambusher = (feature: Record<string, unknown>, subSource = 'HB', wis = 14) => {
      const name = String(feature.name);
      const ctx = world({
        subclass: [
          {
            name: 'Gloom Stalker',
            shortName: 'Gloom Stalker',
            source: subSource,
            className: 'Warrior',
            classSource: 'TST',
            subclassFeatures: [`${name}|Warrior|TST|Gloom Stalker|${subSource}|3`],
          },
        ],
        subclassFeature: [
          {
            source: 'HB',
            className: 'Warrior',
            classSource: 'TST',
            subclassShortName: 'Gloom Stalker',
            subclassSource: subSource,
            level: 3,
            entries: ['You strike first.'],
            ...feature,
          },
        ],
      });
      const doc = character((d) => {
        d.abilities.base.wis = wis;
        d.classes = [
          {
            ref: { name: 'Warrior', source: 'TST' },
            subclass: { name: 'Gloom Stalker', source: subSource },
            levels: 3,
            hp: [],
          },
        ];
      });
      const sheet = deriveSheet(doc, ctx);
      return [sheet.initiative.value, sheet.resources.find((r) => r.key === 'dread-ambusher')?.max];
    };
    // Its own book names no printing a row is for: the row for every printing.
    expect(ambusher({ name: 'Dread Ambusher' })).toEqual([4, undefined]);
    // A copy is the printing it copies, renamed or not.
    expect(ambusher({ name: 'Dread Ambusher', ...cg({ basedOn: 'Dread Ambusher|XPHB' }) })).toEqual(
      [4, 2],
    );
    expect(ambusher({ name: 'Ambush', ...cg({ basedOn: 'Dread Ambusher|XPHB' }) })).toEqual([4, 2]);
    expect(ambusher({ name: 'Ambush', ...cg({ basedOn: 'Dread Ambusher|XGE' }) })).toEqual([
      4,
      undefined,
    ]);
    // A feature of a 2024 subclass reads the 2024 row, whatever book the feature names.
    expect(ambusher({ name: 'Dread Ambusher' }, 'XPHB')).toEqual([4, 2]);
    // No Wisdom below 0 on initiative, and one use at the least (WIS -1 and 0).
    expect(ambusher({ name: 'Dread Ambusher' }, 'XPHB', 8)).toEqual([2, 1]);
    expect(ambusher({ name: 'Dread Ambusher' }, 'XPHB', 10)).toEqual([2, 1]);
  });

  it("finds a feature's standing row for its printing, as its curated row", () => {
    // 2024 Second-Story Work: a climb speed; the 2014 one has none.
    const climbs = (basedOn: string) => {
      const ctx = world({
        subclass: [
          {
            name: 'Thief',
            shortName: 'Thief',
            source: 'HB',
            className: 'Warrior',
            classSource: 'TST',
            subclassFeatures: ['Second-Story Work|Warrior|TST|Thief|HB|3'],
          },
        ],
        subclassFeature: [
          {
            name: 'Second-Story Work',
            source: 'HB',
            className: 'Warrior',
            classSource: 'TST',
            subclassShortName: 'Thief',
            subclassSource: 'HB',
            level: 3,
            entries: ['You climb well.'],
            ...cg({ basedOn }),
          },
        ],
      });
      const doc = character((d) => {
        d.classes = [
          {
            ref: { name: 'Warrior', source: 'TST' },
            subclass: { name: 'Thief', source: 'HB' },
            levels: 3,
            hp: [],
          },
        ];
      });
      return deriveSheet(doc, ctx).otherSpeeds.map((s) => s.mode);
    };
    expect(climbs('Second-Story Work|XPHB')).toEqual(['climb']);
    expect(climbs('Second-Story Work|PHB')).toEqual([]);
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

  it('works out a spell damage bonus from the final ability modifier, with its limits', () => {
    const sheet = sheetWith([
      { kind: 'spellDamageBonus', amount: { f: 'mod.cha' }, spells: ['Hex Bolt'], oneRoll: true },
      { kind: 'spellDamageBonus', amount: 2, className: 'Warlock', cantrips: true, school: 'V' },
    ]);
    expect(sheet.spellDamageBonuses).toEqual([
      { amount: 3, origin: 'Gift', spells: ['Hex Bolt'], oneRoll: true },
      { amount: 2, origin: 'Gift', className: 'Warlock', cantrips: true, school: 'V' },
    ]);
    expect(sheetWith([{ kind: 'spellDamageBonus', amount: 2, school: 'Fire' }]).warnings).toEqual([
      expect.stringContaining('"school"'),
    ]);
  });

  it('limits an "ownClass" bonus to the class that gives it, and leaves it out of a feat', () => {
    const bonus = { kind: 'spellDamageBonus', amount: 2, ownClass: true, cantrips: true };
    const hexer: DataEntity = {
      name: 'Hexer',
      source: 'HB',
      hd: { number: 1, faces: 8 },
      proficiency: ['wis', 'cha'],
      classFeatures: [],
      optionalfeatureProgression: [{ name: 'Hexes', featureType: ['QQ'], progression: { 1: 1 } }],
    };
    const hex: DataEntity = {
      name: 'Bright Hex',
      source: 'HB',
      featureType: ['QQ'],
      entries: ['Your cantrips burn brighter.'],
      ...cg({ effects: [bonus] }),
    };
    // A homebrew subclass for the class `of` names, with a feature that adds it.
    const lanterns = (of: string, ofSource: string): Record<string, DataEntity[]> => ({
      subclass: [
        {
          name: 'Lanternbearer',
          shortName: 'Lanternbearer',
          source: 'HB',
          className: of,
          classSource: ofSource,
          subclassFeatures: [`Bright Cantrips|${of}|${ofSource}|Lanternbearer|HB|3`],
        },
      ],
      subclassFeature: [
        {
          name: 'Bright Cantrips',
          source: 'HB',
          className: of,
          classSource: ofSource,
          subclassShortName: 'Lanternbearer',
          subclassSource: 'HB',
          level: 3,
          entries: ['Your cantrips burn brighter.'],
          ...cg({ effects: [bonus] }),
        },
      ],
    });
    const lantern = { name: 'Lanternbearer', source: 'HB' };
    const at = (name: string, source: string, subclass?: { name: string; source: string }) => ({
      ref: { name, source },
      ...(subclass === undefined ? {} : { subclass }),
      levels: 3,
      hp: [],
    });
    const bonuses = (
      data: Record<string, DataEntity[]>,
      classes: CharacterDoc['classes'],
      choices: Record<string, string[]> = {},
    ) => {
      const doc = character((d) => {
        d.classes = classes;
        d.choices = { ...d.choices, ...choices };
      });
      return deriveSheet(doc, world({ class: [hexer], optionalfeature: [hex], ...data }))
        .spellDamageBonuses;
    };
    const gain = (className: string, origin = 'Bright Cantrips') => ({
      amount: 2,
      origin,
      className,
      cantrips: true,
    });
    // Taken under the class the subclass names or, as a Workshop author may,
    // under another: either way it is the class it is taken under.
    const warrior = at('Warrior', 'TST', lantern);
    expect(bonuses(lanterns('Warrior', 'TST'), [warrior])).toEqual([gain('Warrior')]);
    expect(bonuses(lanterns('Bard', 'PHB'), [warrior])).toEqual([gain('Warrior')]);
    // Taken under two classes, each gives its own.
    expect(bonuses(lanterns('Warrior', 'TST'), [warrior, at('Hexer', 'HB', lantern)])).toEqual([
      gain('Warrior'),
      gain('Hexer'),
    ]);
    // An optional feature's is the class that offers it, here the second.
    const picked = { 'class:hexer|hb:optfeature:QQ': ['bright hex|hb'] };
    expect(bonuses({}, [at('Warrior', 'TST'), at('Hexer', 'HB')], picked)).toEqual([
      gain('Hexer', 'Hexes: Bright Hex'),
    ]);
    // No class gives a feat, so its bonus holds for no class's spells.
    expect(sheetWith([bonus]).spellDamageBonuses).toEqual([]);
    expect(sheetWith([bonus]).warnings).toEqual([]);
  });

  it('reads a spell given as "name|source" by its name, which casts match on', () => {
    const sheet = sheetWith([
      { kind: 'spellDamageBonus', amount: 1, spells: ['Eldritch Blast|PHB', ' Hex Bolt '] },
    ]);
    expect(sheet.spellDamageBonuses).toEqual([
      { amount: 1, origin: 'Gift', spells: ['Eldritch Blast', 'Hex Bolt'] },
    ]);
    expect(sheetWith([{ kind: 'spellDamageBonus', amount: 1, spells: ['|PHB'] }]).warnings).toEqual(
      [expect.stringContaining('"spells"')],
    );
  });

  it('adds a same-named feature’s spell damage bonus once, the highest', () => {
    const sheet = sheetWith([
      { kind: 'spellDamageBonus', amount: 2, cantrips: true },
      { kind: 'spellDamageBonus', amount: { f: 'mod.cha' }, cantrips: true },
      { kind: 'spellDamageBonus', amount: 1, cantrips: true, oneRoll: true },
    ]);
    expect(sheet.spellDamageBonuses).toEqual([
      { amount: 3, origin: 'Gift', cantrips: true },
      { amount: 1, origin: 'Gift', cantrips: true, oneRoll: true },
    ]);
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

describe('words by class level', () => {
  const effects = [
    {
      kind: 'resource',
      key: 'embers',
      label: { byLevel: { '1': 'Embers (d6)', '5': 'Embers (d8)' } },
      die: { byLevel: { '1': '1d6', '5': '1d8' } },
      max: 2,
      reset: { byLevel: { '1': 'long', '5': 'short' } },
    },
    {
      kind: 'action',
      economy: 'bonus',
      label: 'Flare',
      roll: { byLevel: { '1': '1d6', '5': '2d6' } },
      note: { byLevel: { '5': 'and the next turn too' } },
    },
  ];
  const embers: DataEntity = {
    name: 'Embers',
    source: 'HB',
    className: 'Brute',
    classSource: 'HB',
    level: 1,
    entries: ['You smoulder.'],
    ...cg({ effects }),
  };
  const ctx = world({
    class: [
      {
        name: 'Brute',
        source: 'HB',
        hd: { number: 1, faces: 12 },
        classFeatures: ['Embers|Brute|HB|1'],
      },
    ],
    classFeature: [embers],
  });
  const shown = (bruteLevels: number) => {
    const doc = character((d) => {
      d.classes = [
        { ref: { name: 'Brute', source: 'HB' }, levels: bruteLevels, hp: [] },
        { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] },
      ];
    });
    const sheet = deriveSheet(doc, ctx);
    return [
      ...sheet.resources
        .filter((r) => r.key === 'embers')
        .map((r) => `${r.label} ${r.die} ${r.resetOn}`),
      ...sheet.actions
        .filter((a) => a.label === 'Flare')
        .map((a) => `${a.roll} ${a.note ?? 'no note'}`),
    ];
  };

  it('reads the level of the class that gives it, and leaves a field out below its first level', () => {
    // Brute 4 beside Warrior 4 is a level 8 character, still on the first row.
    expect(shown(4)).toEqual(['Embers (d6) 1d6 long', '1d6 no note']);
    expect(shown(5)).toEqual(['Embers (d8) 1d8 short', '2d6 and the next turn too']);
    // Each derive fills a fresh copy, so the entry read once keeps its table.
    expect(shown(4)).toEqual(['Embers (d6) 1d6 long', '1d6 no note']);
    const [pool, flare] = readMechanics(embers.castGuidance).effects;
    expect(pool?.effect).toMatchObject({ label: 'Embers (d6)', die: '1d6', resetOn: 'long' });
    expect(flare?.effect).toMatchObject({ roll: '1d6', note: 'and the next turn too' });
  });

  it("reads the character's level for a feat", () => {
    const labels = (levels: number) => {
      const doc = withFeats('Gift');
      doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels, hp: [] }];
      const gift = feat('Gift', {
        effects: [
          {
            kind: 'action',
            economy: 'action',
            label: { byLevel: { '1': 'Gift', '5': 'Greater Gift' } },
          },
        ],
      });
      return deriveSheet(doc, world({ feat: [gift] }))
        .actions.filter((a) => a.origin === 'Gift')
        .map((a) => a.label);
    };
    expect(labels(4)).toEqual(['Gift']);
    expect(labels(5)).toEqual(['Greater Gift']);
  });
});

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

// ---------------------------------------------------------------------------

describe("an action's price (rule pack port 3a)", () => {
  const read = (cost?: unknown, buyBack?: unknown) =>
    readStoredEffects(
      [
        {
          kind: 'action',
          economy: 'none',
          label: 'Smite',
          ...(cost !== undefined ? { cost } : {}),
          ...(buyBack !== undefined ? { buyBack } : {}),
        },
      ],
      'effects',
      true,
    );

  it('reads a cost paid with a spell slot or a Hit Point Die, and a buy-back', () => {
    const slot = {
      resource: 'spell-slot',
      amount: 1,
      minLevel: 2,
      pactOnly: true,
      slotDice: { die: 8, base: 1, maxDice: 5, heals: true, plus: 'your Charisma modifier' },
      slotRefills: 'points',
    };
    const back = { resource: 'spell-slot', amount: 1, own: 'embers', minLevel: 3, pactOnly: true };
    const die = {
      resource: 'hit-die',
      amount: 1,
      ownUseToo: true,
      hitDieHeals: 'rollPlusCon',
      hitDieAtLeast: 1,
    };
    const pool = { resource: 'focus', amount: 'varies', optional: true };
    for (const [cost, buyBack] of [
      [slot, back],
      [die, undefined],
      [pool, { resource: 'focus', amount: 2 }],
      [{ ...slot, slotDice: { die: 6, base: 0, plain: true } }, undefined],
    ]) {
      const r = read(cost, buyBack);
      expect(r.problems).toEqual([]);
      expect(r.effects[0]?.effect).toEqual({
        kind: 'action',
        economy: 'none',
        label: 'Smite',
        cost,
        ...(buyBack !== undefined ? { buyBack } : {}),
      });
    }
  });

  it('says why a price does not count, field by field', () => {
    const slot = { resource: 'spell-slot', amount: 1 };
    const cases: Array<[unknown, unknown, string]> = [
      [
        { resource: 'focus', amount: 1, minLevel: 2 },
        undefined,
        '"cost.minLevel" is for a price paid with a spell slot',
      ],
      [
        { resource: 'hit-die', amount: 1, pactOnly: true },
        undefined,
        '"cost.pactOnly" is for a price paid with a spell slot',
      ],
      [
        { resource: 'focus', amount: 1, slotDice: { die: 8, base: 1 } },
        undefined,
        '"cost.slotDice" is for a price paid with a spell slot',
      ],
      [
        { resource: 'focus', amount: 1, slotRefills: 'focus' },
        undefined,
        '"cost.slotRefills" is for a price paid with a spell slot',
      ],
      [
        { ...slot, hitDieHeals: 'roll' },
        undefined,
        '"cost.hitDieHeals" is for a price paid with a Hit Point Die',
      ],
      [
        { resource: 'focus', amount: 1, hitDieAtLeast: 1 },
        undefined,
        '"cost.hitDieAtLeast" is for a price paid with a Hit Point Die',
      ],
      [
        { ...slot, slotDice: { die: 8, base: 1, heals: true, plain: true } },
        undefined,
        '"cost.slotDice.plain" or "heals", not both',
      ],
      [
        { ...slot, slotDice: { die: 1, base: 1 } },
        undefined,
        '"cost.slotDice.die" is a whole number from 2 to 100',
      ],
      [{ ...slot, slotDice: { die: 8 } }, undefined, '"cost.slotDice.base" is missing'],
      [{ ...slot, minLevel: 10 }, undefined, '"cost.minLevel" is a whole number from 1 to 9'],
      [
        { resource: 'hit-die', amount: 1, hitDieHeals: 'all' },
        undefined,
        '"cost.hitDieHeals" is one of roll, rollPlusCon',
      ],
      [
        undefined,
        { resource: 'hit-die', amount: 1 },
        '"buyBack.resource" is a pool or a spell slot',
      ],
      [
        undefined,
        { resource: 'focus', amount: 0 },
        '"buyBack.amount" is a whole number from 1 to 999',
      ],
      [
        undefined,
        { resource: 'focus', amount: 'varies' },
        '"buyBack.amount" is a whole number from 1 to 999',
      ],
      [
        undefined,
        { resource: 'focus', amount: 1, pactOnly: true },
        '"buyBack.pactOnly" is for a price paid with a spell slot',
      ],
      [
        undefined,
        { ...slot, slotDice: { die: 8, base: 1 } },
        '"buyBack.slotDice" is not a field this kind reads',
      ],
    ];
    for (const [cost, buyBack, why] of cases) {
      expect(read(cost, buyBack).problems, why).toEqual([`effect 1 (action): ${why}`]);
    }
    // A false flag is the same as none, so it is never in the wrong place.
    expect(read({ resource: 'focus', amount: 1, pactOnly: false }).problems).toEqual([]);
  });

  it('reads every price the spend and slot links give, as they give it', async () => {
    const { codeLinksOf, linkSpend, SPEND_LINKS } = await import('../curated/spendLinks');
    const { SLOT_LINKS } = await import('../curated/slotLinks');
    const shipped = BUILT_IN_RULE_SETS.flatMap((set) =>
      readRuleSet(set).rows.flatMap((r) => (r.part === 'spend' ? r.keys : [])),
    );
    const linked: EffectOrigin = { label: 'Feature', uid: 'feature|hb', type: 'class' };
    const other: EffectOrigin = { label: 'Other', uid: 'other|hb', type: 'class' };
    let prices = 0;
    const keys = new Set([...Object.keys(SPEND_LINKS), ...Object.keys(SLOT_LINKS), ...shipped]);
    for (const key of keys) {
      const col = new Collector(character(), world({}));
      // A slot's buy-back for another feature's use lands only on that feature's chip.
      const links = builtInRuleIn(BUILT_IN_RULE_SETS, 'spend', [key])?.links ?? codeLinksOf(key);
      const onAction = links.find(
        (l) => 'buyBack' in l && l.buyBack.resource === 'spell-slot' && l.onAction !== undefined,
      );
      if (onAction !== undefined && 'onAction' in onAction && onAction.onAction !== undefined) {
        col.add({ kind: 'action', economy: 'bonus', label: onAction.onAction, origin: other });
      }
      linkSpend(col, [key], 'Feature', linked);
      for (const e of col.effects) {
        if (e.kind !== 'action' || (e.cost === undefined && e.buyBack === undefined)) continue;
        const r = read(e.cost, e.buyBack);
        expect(r.problems, key).toEqual([]);
        expect(r.effects[0]?.effect, key).toEqual({
          kind: 'action',
          economy: 'none',
          label: 'Smite',
          ...(e.cost !== undefined ? { cost: e.cost } : {}),
          ...(e.buyBack !== undefined ? { buyBack: e.buyBack } : {}),
        });
        prices += (e.cost !== undefined ? 1 : 0) + (e.buyBack !== undefined ? 1 : 0);
      }
    }
    // Every row of both tables and of the shipped spend rows: 299 pool prices and
    // 57 slot or Hit Point Die prices.
    expect(prices).toBe(299 + 57);
  });

  it("puts a homebrew action's price on the sheet: a slot with dice, a Hit Point Die, buy-backs", () => {
    const lamp = feat('Ember Lamp', {
      effects: [
        { kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long' },
        {
          kind: 'action',
          economy: 'bonus',
          label: 'Searing Smite',
          cost: {
            resource: 'spell-slot',
            amount: 1,
            minLevel: 2,
            slotDice: { die: 8, base: 1, maxDice: 5 },
          },
        },
        {
          kind: 'action',
          economy: 'none',
          label: 'Second Breath',
          cost: { resource: 'hit-die', amount: 1, hitDieHeals: 'rollPlusCon', hitDieAtLeast: 1 },
        },
        // Shares the pool's name, so it gives back a use of Embers.
        {
          kind: 'action',
          economy: 'action',
          label: 'Embers',
          buyBack: { resource: 'spell-slot', amount: 1 },
        },
        {
          kind: 'action',
          economy: 'action',
          label: 'Kindle',
          buyBack: { resource: 'spell-slot', amount: 1, minLevel: 3, own: 'embers' },
        },
      ],
    });
    const mage = (levels: number) =>
      character((d) => {
        d.classes = [
          { ref: { name: 'Mage', source: 'TST' }, levels, hp: Array(levels).fill('avg') },
        ];
        d.feats = [{ ref: { name: 'Ember Lamp', source: 'HB' }, instanceId: 'f0' }];
      });
    const price = (levels: number, label: string) => {
      const a = deriveSheet(mage(levels), world({ feat: [lamp] })).actions.find(
        (x) => x.label === label,
      );
      return a === undefined ? 'no chip' : { cost: a.cost, buyBack: a.buyBack };
    };
    expect(price(5, 'Searing Smite')).toEqual({
      cost: {
        resource: 'spell-slot',
        amount: 1,
        minLevel: 2,
        slotDice: { die: 8, base: 1, maxDice: 5 },
      },
      buyBack: undefined,
    });
    expect(price(5, 'Second Breath')).toEqual({
      cost: { resource: 'hit-die', amount: 1, hitDieHeals: 'rollPlusCon', hitDieAtLeast: 1 },
      buyBack: undefined,
    });
    expect(price(5, 'Embers')).toEqual({
      cost: undefined,
      buyBack: { resource: 'spell-slot', amount: 1 },
    });
    expect(price(5, 'Kindle')).toEqual({
      cost: undefined,
      buyBack: { resource: 'spell-slot', amount: 1, minLevel: 3, own: 'embers' },
    });
    // A Mage 1 has no slot of level 2 or 3, so neither price is offered.
    expect(price(1, 'Searing Smite')).toEqual({ cost: undefined, buyBack: undefined });
    expect(price(1, 'Kindle')).toEqual({ cost: undefined, buyBack: undefined });
  });
});

describe('what a review found', () => {
  it('reads a kind no string can be made of without throwing', () => {
    const raw = JSON.parse(
      '{"v":1,"effects":[{"kind":{"toString":0}}],"drop":[{"kind":{"toString":0}}]}',
    );
    expect(readMechanics(raw).problems).toEqual([
      'effect 1: has no kind "an object"',
      'drop 1: has no kind "an object"',
    ]);
  });

  it('takes plain numbers as whole, and 0 or more outside an amount', () => {
    const read = readMechanics({
      v: 1,
      effects: [
        { kind: 'acBonus', amount: 0.5 },
        { kind: 'sense', sense: 'darkvision', range: -30 },
        { kind: 'speedBonus', amount: -10 },
      ],
    });
    expect(read.effects.map((t) => t.effect.kind)).toEqual(['speedBonus']);
    expect(read.problems).toEqual([
      'effect 1 (acBonus): "amount" is a whole number',
      'effect 2 (sense): "range" is 0 or more',
    ]);
  });

  it("never lets a spend link rewrite the cost an author gave the entry's own action", async () => {
    const { linkSpend } = await import('../curated/spendLinks');
    const col = new Collector(character(), world({}));
    const entry = cg({
      effects: [
        {
          kind: 'action',
          label: 'Flurry',
          economy: 'bonus',
          cost: { resource: 'mine', amount: 2 },
        },
      ],
    });
    mechanicsOf(col, {
      entry,
      label: 'Flurry',
      origin,
      target: 'flurry',
      inherited: () => {
        col.add({ kind: 'action', label: 'Flurry of Blows', economy: 'none', origin });
        linkSpend(col, ['flurry of blows|monk|phb'], 'Flurry of Blows', origin);
      },
    });
    const costs = col.effects.map((e) => (e.kind === 'action' ? [e.label, e.cost?.resource] : []));
    expect(costs).toEqual([
      ['Flurry', 'mine'],
      ['Flurry of Blows', 'focus'],
    ]);
  });

  it('works out nothing, and never throws, for formula slots a stored document makes up', () => {
    const doc = character((d) => {
      d.customEffects = [
        JSON.parse(
          '{"kind":"acBonus","amount":1,"origin":{"label":"Odd","uid":"o","type":"custom"},"formulas":[null, 3, {"field":"amount"}]}',
        ),
      ];
    });
    expect(deriveSheet(doc, world({})).ac.parts.find((p) => p.label === 'Odd')?.amount).toBe(1);
  });

  it('reads effects in play and conditions only as their readers would, whatever play holds', () => {
    const doc = withFeats('Gift');
    doc.play.activeEffects = JSON.parse(
      '[{"id":"a","parts":[]},null,{"id":"r","name":"Rage","parts":[]},{"id":"r","name":"Haste","parts":[]},{"id":"s","name":"Bless","same":7,"parts":[]}]',
    );
    doc.play.conditions = JSON.parse('[{"id":5},null,{"id":"Prone"}]');
    const effects = [
      { kind: 'acBonus', amount: 1, while: { effect: 'Rage' } },
      { kind: 'saveBonus', amount: 1, while: { effect: 'Haste' } },
      { kind: 'initiativeBonus', amount: 1, while: { condition: 'prone' } },
      { kind: 'checkBonus', amount: 1, every: true, while: { effect: 'Bless' } },
    ];
    const sheet = deriveSheet(doc, world({ feat: [feat('Gift', { effects })] }));
    expect(sheet.ac.parts.some((p) => p.label === 'Gift')).toBe(true);
    // The second effect under one id does not count, so it is not in play.
    expect(sheet.saves.str.total.parts.some((p) => p.label === 'Gift')).toBe(false);
    expect(sheet.initiative.parts.some((p) => p.label === 'Gift')).toBe(true);
  });

  it('holds spell save DC and spell attack bonuses to their states too', () => {
    const dc = (concentrating: boolean) => {
      const doc = withFeats('Gift');
      doc.classes = [{ ref: { name: 'Mage', source: 'TST' }, levels: 4, hp: [] }];
      if (concentrating) doc.play.concentratingOn = { label: 'Bless' };
      const effects = [
        { kind: 'spellDcBonus', amount: 2, while: 'concentrating' },
        { kind: 'attackBonus', amount: 3, attack: 'spell', while: 'concentrating' },
      ];
      const block = deriveSheet(doc, world({ feat: [feat('Gift', { effects })] })).spellcasting[0];
      return [block?.saveDc.value, block?.attackMod.value];
    };
    const [dcOff, atkOff] = dc(false);
    expect(dc(true)).toEqual([(dcOff ?? 0) + 2, (atkOff ?? 0) + 3]);
  });

  describe('a pack replacement it cannot read', () => {
    const run = (effects: unknown) => {
      const ctx = world({
        [RULE_PACK_TYPE]: [
          {
            name: 'P',
            source: 'P',
            appliesTo: { characters: ['hero'] },
            castGuidance: { v: 1, patches: [{ target: 'lantern|hb', effects }] },
          },
        ],
      });
      const col = new Collector(character(), ctx);
      const inherited = vi.fn(() => col.add({ kind: 'acBonus', amount: 1, origin }));
      mechanicsOf(col, {
        entry: { name: 'Lantern' },
        label: 'Lantern',
        origin,
        target: 'Lantern|HB',
        inherited,
      });
      return inherited.mock.calls.length;
    };

    it('replaces nothing, so the entry keeps its mechanics', () => {
      expect(run('none')).toBe(1);
      expect(run([{ kind: 'fly' }])).toBe(1);
    });

    it('but an empty list replaces them with nothing, on purpose', () => {
      expect(run([])).toBe(0);
    });
  });
});
