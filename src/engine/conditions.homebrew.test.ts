import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { readActiveEffects } from './activeEffects';
import {
  type ActiveCondition,
  BUILT_IN_CONDITIONS,
  builtInConditionParts,
  conditionEntries,
  conditionMechanics,
  homebrewConditionEffects,
  isBuiltInCondition,
} from './conditions';
import { deriveSheet } from './derive';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from './types';

const dazed = (effects: unknown, more: Record<string, unknown> = {}) => ({
  name: 'Dazed',
  source: 'MyHomebrew',
  entries: ['You reel.'],
  castGuidance: { v: 1, effects, ...more },
});

const DIS_ATTACKS = { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['attack'] } };

describe('conditionMechanics', () => {
  it('reads nothing, and no problem, from an entry that says nothing', () => {
    expect(conditionMechanics({ name: 'Dazed', entries: [] })).toEqual({ parts: [], problems: [] });
    expect(conditionMechanics(undefined)).toEqual({ parts: [], problems: [] });
    expect(conditionMechanics(dazed(undefined))).toEqual({ parts: [], problems: [] });
  });

  it('reads the numbers and rolls a condition changes', () => {
    const read = conditionMechanics(
      dazed([DIS_ATTACKS, { kind: 'acBonus', amount: -2 }, { kind: 'speedBonus', amount: -10 }]),
    );
    expect(read.problems).toEqual([]);
    expect(read.parts).toEqual([
      DIS_ATTACKS,
      { kind: 'acBonus', amount: -2 },
      { kind: 'speedBonus', amount: -10 },
    ]);
  });

  it('names each effect that does not count by its place, and keeps the rest', () => {
    const read = conditionMechanics(
      dazed([
        { kind: 'acBonus', amount: -1 },
        { kind: 'skillProf', skill: 'Stealth', level: 1 },
        { kind: 'acBonus', amount: 1, while: 'bloodied' },
        { kind: 'acBonus', amount: { f: 'prof' } },
        { kind: 'teleport' },
        { kind: 'rollDie', dice: '1d6+2', on: { rolls: ['save'] } },
      ]),
    );
    expect(read.parts).toEqual([{ kind: 'acBonus', amount: -1 }]);
    expect(read.problems.map((p) => p.place)).toEqual([2, 3, 4, 5, 6]);
    expect(read.problems[0]?.why).toMatch(/only numbers and rolls/);
    expect(read.problems[1]?.why).toMatch(/"When"/);
    expect(read.problems[2]?.why).toMatch(/plain number/);
  });

  it('counts none of it without a version, or from a newer app', () => {
    const none = conditionMechanics({ name: 'Dazed', castGuidance: { effects: [DIS_ATTACKS] } });
    expect(none.parts).toEqual([]);
    expect(none.problems).toHaveLength(1);
    const newer = conditionMechanics(dazed([DIS_ATTACKS], { v: 99 }));
    expect(newer.parts).toEqual([]);
    expect(newer.problems[0]?.why).toMatch(/newer/);
  });

  describe('hostile input', () => {
    const nested = (depth: number) => {
      let x: Record<string, unknown> = { end: true };
      for (let i = 0; i < depth; i++) x = { next: x };
      return x;
    };

    it('never throws, whatever the entry holds', () => {
      for (const bad of [
        { castGuidance: 'v1' },
        { castGuidance: [] },
        { castGuidance: { v: 1, effects: 'all of them' } },
        { castGuidance: { v: 1, effects: [null, 7, 'acBonus', [], nested(100_000)] } },
        { castGuidance: { v: 1, effects: [{ ...DIS_ATTACKS, on: nested(100_000) }] } },
        { castGuidance: { v: '1', effects: [DIS_ATTACKS] } },
        { castGuidance: nested(100_000) },
      ]) {
        expect(() => conditionMechanics(bad), JSON.stringify(bad).slice(0, 80)).not.toThrow();
        expect(conditionMechanics(bad).parts).toEqual([]);
      }
    });

    it('builds each part from known fields only', () => {
      const read = conditionMechanics(
        dazed([{ kind: 'acBonus', amount: -1, evil: nested(100_000), origin: { type: 'feat' } }]),
      );
      expect(read.parts).toEqual([{ kind: 'acBonus', amount: -1 }]);
    });

    it('reads no more than an entry may hold', () => {
      const many = Array.from({ length: 500 }, () => ({ kind: 'acBonus', amount: 1 }));
      const read = conditionMechanics(dazed(many));
      expect(read.parts).toHaveLength(64);
      expect(read.problems).toHaveLength(1);
    });

    it('reads an inherited castGuidance as nothing, and a __proto__ key as data', () => {
      const inherited = Object.create({ castGuidance: { v: 1, effects: [DIS_ATTACKS] } });
      expect(conditionMechanics(inherited).parts).toEqual([]);
      const parsed = JSON.parse(
        '{"name":"Dazed","castGuidance":{"v":1,"__proto__":{"effects":[]},"effects":[{"kind":"acBonus","amount":-1,"__proto__":{"amount":5}}]}}',
      );
      expect(conditionMechanics(parsed).parts).toEqual([{ kind: 'acBonus', amount: -1 }]);
    });
  });
});

describe('homebrewConditionEffects', () => {
  const entries: Record<string, unknown> = {
    dazed: dazed([DIS_ATTACKS, { kind: 'teleport' }]),
    poisoned: dazed([{ kind: 'acBonus', amount: -5 }]),
    hollow: { name: 'Hollow', entries: ['Words only.'] },
  };
  const entryOf = (name: string) => entries[name.trim().toLowerCase()];

  it('turns a homebrew condition in force into an effect in play, named for it', () => {
    const { effects, problems } = homebrewConditionEffects([{ id: 'Dazed' }], entryOf);
    expect(effects).toEqual([{ id: 'condition:Dazed', name: 'Dazed', parts: [DIS_ATTACKS] }]);
    expect(problems).toEqual(['Dazed: effect 2 does not count: has no kind "teleport".']);
    expect(readActiveEffects(effects).effects).toEqual(effects);
  });

  it('leaves a built-in condition to the app, whatever an entry of its name says', () => {
    expect(homebrewConditionEffects([{ id: 'Poisoned' }], entryOf).effects).toEqual([]);
    expect(homebrewConditionEffects([{ id: 'poisoned' }], entryOf).effects).toEqual([]);
  });

  it('counts nothing from one switched off, held off, unknown or with nothing to count', () => {
    const none = (conditions: Array<{ id: string; ignored?: boolean }>, immune: string[] = []) =>
      homebrewConditionEffects(conditions, entryOf, {
        immune: immune.map((condition) => ({ condition, origin: 'Amulet' })),
      }).effects;
    expect(none([{ id: 'Dazed', ignored: true }])).toEqual([]);
    expect(none([{ id: 'Dazed' }], ['dazed'])).toEqual([]);
    // A stored id with spaces round it is the same condition.
    expect(none([{ id: ' Dazed ' }])).toHaveLength(1);
    expect(none([{ id: ' Dazed ' }], ['Dazed'])).toEqual([]);
    expect(none([{ id: 'Bewildered' }])).toEqual([]);
    expect(none([{ id: 'Hollow' }])).toEqual([]);
  });

  it('lets one homebrew condition hold another off, only while it counts itself', () => {
    const immuneTo = (name: string, to: string) => ({
      ...dazed([
        { kind: 'acBonus', amount: 1 },
        { kind: 'conditionImmune', condition: to },
      ]),
      name,
    });
    const world: Record<string, unknown> = {
      dazed: dazed([{ kind: 'acBonus', amount: -2 }]),
      steeled: immuneTo('Steeled', 'dazed'),
      calm: immuneTo('Calm', 'Steeled'),
      hot: immuneTo('Hot', 'Cold'),
      cold: immuneTo('Cold', 'Hot'),
    };
    const names = (...ids: string[]) =>
      homebrewConditionEffects(
        ids.map((id) => ({ id })),
        (n) => world[n.toLowerCase()],
      ).effects.map((e) => e.name);
    expect(names('Dazed', 'Steeled')).toEqual(['Steeled']);
    expect(names('Steeled', 'Dazed')).toEqual(['Steeled']);
    // Calm holds Steeled off, so Steeled holds nothing off.
    expect(names('Dazed', 'Steeled', 'Calm')).toEqual(['Dazed', 'Calm']);
    // A ring: the first in play counts.
    expect(names('Cold', 'Hot')).toEqual(['Cold']);
    expect(names('Hot', 'Cold')).toEqual(['Hot']);
  });

  it('refuses what only an effect in play can use', () => {
    const read = conditionMechanics(
      dazed([
        { kind: 'tempHpEachTurn', amount: 3 },
        { kind: 'maxHpBonus', amount: -5 },
        { kind: 'rollOffer', dice: '1d4', on: { rolls: ['attack'] }, once: true },
        { kind: 'rollOffer', dice: '1d4', on: { rolls: ['save'] } },
      ]),
    );
    expect(read.parts).toEqual([{ kind: 'rollOffer', dice: '1d4', on: { rolls: ['save'] } }]);
    expect(read.problems).toEqual([
      { place: 1, why: 'a condition gives no temporary hit points at the start of a turn' },
      { place: 2, why: 'a condition cannot change the hit point maximum' },
      { place: 3, why: 'a condition cannot offer a die just once, only on every roll' },
    ]);
  });

  it('counts one of a name once', () => {
    const { effects } = homebrewConditionEffects([{ id: 'Dazed' }, { id: 'dazed' }], entryOf);
    expect(effects).toHaveLength(1);
  });

  it('reads a stored list it cannot trust without throwing', () => {
    for (const bad of [undefined, null, 'Dazed', { id: 'Dazed' }, 7]) {
      expect(homebrewConditionEffects(bad, entryOf).effects).toEqual([]);
    }
    const mixed = [null, 'Dazed', { id: 7 }, { id: '  ' }, { level: 2 }, { id: 'Dazed' }];
    expect(homebrewConditionEffects(mixed, entryOf).effects).toHaveLength(1);
    const inherited = [Object.create({ id: 'Dazed' })];
    expect(homebrewConditionEffects(inherited, entryOf).effects).toEqual([]);
  });
});

describe('conditionEntries', () => {
  const printing = (source: string, edition?: string) => ({
    name: 'Dazed',
    source,
    ...(edition !== undefined ? { edition } : {}),
  });

  it('finds an entry by name in any case, the printing for the edition first', () => {
    const old = printing('MyHomebrew', 'classic');
    const fresh = printing('MyHomebrew', 'one');
    const find = conditionEntries([old, fresh, 7, null, { name: 3 }], '2024');
    expect(find('dazed')).toBe(fresh);
    expect(conditionEntries([old, fresh], '2014')('DAZED')).toBe(old);
    expect(conditionEntries([old], '2024')('Dazed')).toBe(old);
    expect(find('Bewildered')).toBeUndefined();
  });

  it('never finds a built-in condition, whatever the data says', () => {
    const find = conditionEntries([{ name: 'Poisoned', source: 'MyHomebrew' }], '2024');
    expect(find('Poisoned')).toBeUndefined();
  });
});

describe('builtInConditionParts', () => {
  it('knows the fifteen built-in conditions, in any case', () => {
    expect(BUILT_IN_CONDITIONS).toHaveLength(15);
    expect(isBuiltInCondition('exhaustion')).toBe(true);
    expect(isBuiltInCondition(' Prone ')).toBe(true);
    expect(isBuiltInCondition('Dazed')).toBe(false);
  });

  it('starts a copy of Poisoned with its two disadvantages', () => {
    expect(builtInConditionParts('Poisoned', '2024')).toEqual([
      { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['attack'] } },
      { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['check'] } },
    ]);
  });

  it('says what the sheet cannot count as reminders (Restrained)', () => {
    expect(builtInConditionParts('restrained', '2014')).toEqual([
      { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['attack'] } },
      { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['save'], abilities: ['dex'] } },
      { kind: 'cue', tone: 'warn', text: 'Your speed is 0' },
      { kind: 'cue', tone: 'info', text: 'Attack rolls against you have advantage' },
    ]);
  });

  it('brings what a condition brings with it, once (2024 Paralyzed is Incapacitated)', () => {
    const parts = builtInConditionParts('Paralyzed', '2024');
    expect(parts).toContainEqual({
      kind: 'cue',
      tone: 'warn',
      text: 'You fail Strength and Dexterity saving throws',
    });
    expect(parts).toContainEqual({ kind: 'cue', tone: 'warn', text: 'Disadvantage on initiative' });
    expect(parts).toContainEqual({
      kind: 'cue',
      tone: 'warn',
      text: "You can't take actions or reactions",
    });
    expect(new Set(parts.map((p) => JSON.stringify(p))).size).toBe(parts.length);
  });

  it('has nothing for Exhaustion, counted by level, or a name not built in', () => {
    expect(builtInConditionParts('Exhaustion', '2014')).toEqual([]);
    expect(builtInConditionParts('Dazed', '2014')).toEqual([]);
  });

  it.each(['2014', '2024'] as const)('gives only parts a %s copy can count', (edition) => {
    for (const name of BUILT_IN_CONDITIONS) {
      const parts = builtInConditionParts(name, edition);
      const read = conditionMechanics(dazed(parts));
      expect(read.problems, name).toEqual([]);
      expect(read.parts, name).toEqual(parts);
    }
  });
});

describe('deriveSheet with a homebrew condition', () => {
  const world = makeTestContext();
  /** The test world, with a homebrew condition, counting its reads of the conditions. */
  const withConditions = (...entries: unknown[]) => {
    const reads = { condition: 0 };
    const ctx: EngineContext = {
      get: world.get,
      byType: (type) => {
        if (type !== 'condition') return world.byType(type);
        reads.condition += 1;
        return entries as DataEntity[];
      },
    };
    return { ctx, reads };
  };

  /** A level-5 warrior in no armor: AC 12 from DEX 14. */
  function warrior(conditions: ActiveCondition[] = []): CharacterDoc {
    const doc = newCharacterDoc('w', 'Hild', 'test-tag');
    doc.abilities.method = 'manual';
    doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
    doc.race = { name: 'Testfolk', source: 'TST' };
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: ['avg'] }];
    doc.play.conditions = conditions;
    return doc;
  }

  it('changes the sheet while it is on the character', () => {
    const { ctx } = withConditions(dazed([{ kind: 'acBonus', amount: -2 }, DIS_ATTACKS]));
    const before = deriveSheet(warrior(), ctx);
    const after = deriveSheet(warrior([{ id: 'Dazed' }]), ctx);
    expect(after.ac.value).toBe(before.ac.value - 2);
    expect(after.ac.parts.at(-1)).toMatchObject({ label: 'Dazed', amount: -2 });
    expect(after.rollRiders).toEqual(
      expect.arrayContaining([expect.objectContaining({ origin: 'Dazed', mode: 'dis' })]),
    );
    expect(after.warnings).toEqual(before.warnings);
  });

  it('counts nothing switched off, held off by an immunity, or with effects not counted', () => {
    const { ctx } = withConditions(dazed([{ kind: 'acBonus', amount: -2 }]));
    const base = deriveSheet(warrior(), ctx).ac.value;
    expect(deriveSheet(warrior([{ id: 'Dazed', ignored: true }]), ctx).ac.value).toBe(base);
    const immune = warrior([{ id: 'dazed' }]);
    immune.play.activeEffects = [
      { id: 'w1', name: 'Clear Mind', parts: [{ kind: 'conditionImmune', condition: 'Dazed' }] },
    ];
    expect(deriveSheet(immune, ctx).ac.value).toBe(base);
    expect(deriveSheet(warrior([{ id: 'Dazed' }]), ctx, { active: false }).ac.value).toBe(base);
  });

  it('never adds up with an effect in play of its name', () => {
    const { ctx } = withConditions(dazed([{ kind: 'acBonus', amount: -2 }]));
    const base = deriveSheet(warrior(), ctx).ac.value;
    const both = warrior([{ id: 'Dazed' }]);
    both.play.activeEffects = [
      { id: 'd1', name: 'Dazed', parts: [{ kind: 'acBonus', amount: -2 }] },
    ];
    const sheet = deriveSheet(both, ctx);
    expect(sheet.ac.value).toBe(base - 2);
    expect(sheet.effectsNotCounted).toHaveLength(1);
  });

  it('is held off by another homebrew condition, as the sheet lists it', () => {
    const { ctx } = withConditions(dazed([{ kind: 'acBonus', amount: -2 }]), {
      ...dazed([{ kind: 'conditionImmune', condition: 'Dazed' }]),
      name: 'Steeled',
    });
    const base = deriveSheet(warrior(), ctx).ac.value;
    const sheet = deriveSheet(warrior([{ id: 'Dazed' }, { id: 'Steeled' }]), ctx);
    expect(sheet.ac.value).toBe(base);
    expect(sheet.conditionImmunities).toEqual([{ condition: 'Dazed', origin: 'Steeled' }]);
  });

  it('warns about what does not count, and counts the rest', () => {
    const { ctx } = withConditions(
      dazed([
        { kind: 'acBonus', amount: -2 },
        { kind: 'skillProf', skill: 'Stealth', level: 1 },
      ]),
    );
    const sheet = deriveSheet(warrior([{ id: 'Dazed' }]), ctx);
    expect(sheet.warnings).toContain(
      'Dazed: effect 2 does not count: a condition changes only numbers and rolls, not proficiencies, uses or actions.',
    );
    expect(sheet.ac.parts.at(-1)).toMatchObject({ label: 'Dazed', amount: -2 });
  });

  it('never reads the data, and derives as before, with only built-in conditions in play', () => {
    const { ctx, reads } = withConditions(dazed([{ kind: 'acBonus', amount: -2 }]), {
      name: 'Poisoned',
      source: 'MyHomebrew',
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: -5 }] },
    });
    const doc = warrior([{ id: 'Poisoned' }, { id: 'Prone' }]);
    expect(deriveSheet(doc, ctx)).toEqual(deriveSheet(doc, world));
    expect(reads.condition).toBe(0);
  });
});
