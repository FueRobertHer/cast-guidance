/**
 * Spell pools the data writes as daily whose printed text refills them on a
 * short or long rest (the built-in `spellRest` rows, which were the table
 * `SHORT_REST_SPELLS`, rule pack port 5c), end to end through `deriveSheet`.
 * The world has the names, sources and `additionalSpells` blocks of the pinned
 * release, placeholder prose, and the rule sets the app ships.
 */
import { describe, expect, it } from 'vitest';
import spellRestRules from '@/rules/cast-guidance/spell-rests.json';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { builtInRuleIn, readRuleSet, type ShortRestSpells } from './mechanics';

const PROSE = ['Placeholder text.'];

const mark = (name: string, spell: unknown): DataEntity => ({
  name,
  ability: { choose: ['int', 'wis', 'cha'] },
  prepared: { _: { daily: { 1: [spell] } } },
});

const WORLD: Record<string, DataEntity[]> = {
  class: [{ name: 'Fighter', source: 'PHB', hd: { number: 1, faces: 10 }, classFeatures: [] }],
  feat: [
    {
      name: 'Fey Teleportation',
      source: 'XGE',
      additionalSpells: [{ ability: 'int', innate: { _: { daily: { 1: ['misty step'] } } } }],
      entries: PROSE,
    },
    // The same spell on the same kind of block, from an origin the table does not name.
    {
      name: 'Fake Wayfarer',
      source: 'TST',
      additionalSpells: [{ ability: 'int', innate: { _: { daily: { 1: ['misty step'] } } } }],
      entries: PROSE,
    },
    {
      name: 'Boon of Siberys',
      source: 'EFA',
      additionalSpells: [
        mark('Mark of Passage', 'plane shift|xphb'),
        mark('Mark of Warding', 'maze|xphb'),
        mark('Sorcerer Spell', { choose: 'level=1;2;3;4;5;6;7;8|class=Sorcerer' }),
      ],
      entries: PROSE,
    },
  ],
  race: [
    {
      name: 'Tiefling',
      source: 'PHB',
      additionalSpells: [
        {
          innate: { 3: { daily: { 1: ['hellish rebuke#2'] } }, 5: { daily: { 1: ['darkness'] } } },
          ability: 'cha',
          known: { 1: ['thaumaturgy#c'] },
        },
      ],
      entries: [],
    },
  ],
  subrace: [
    {
      name: 'Mammon',
      source: 'MTF',
      raceName: 'Tiefling',
      raceSource: 'PHB',
      additionalSpells: [
        {
          innate: {
            3: { daily: { 1: ["tenser's floating disk"] } },
            5: { daily: { 1: ['arcane lock'] } },
          },
          ability: 'cha',
          known: { 1: ['mage hand#c'] },
        },
      ],
      entries: [{ type: 'entries', name: 'Legacy of Minauros', entries: PROSE }],
    },
  ],
};

const ctx: EngineContext = {
  get: (type, name, source) =>
    (WORLD[type] ?? []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    ),
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : (WORLD[type] ?? [])),
};

function fighter(levels: number): CharacterDoc {
  const doc = newCharacterDoc('r', 'Rests', 't');
  doc.classes = [{ ref: { name: 'Fighter', source: 'PHB' }, levels, hp: [] }];
  return doc;
}

function withFeat(
  name: string,
  source: string,
  choices: CharacterDoc['choices'] = {},
  world: EngineContext = ctx,
) {
  const doc = fighter(5);
  doc.feats = [{ ref: { name, source }, instanceId: 'f1' }];
  doc.choices = choices;
  return deriveSheet(doc, world);
}

/** The pool a spell is cast from, and how often the sheet says it can be. */
function pool(sheet: DerivedSheet, spell: string) {
  const grant = sheet.grantedSpells.find((g) => g.name === spell && g.resourceKey !== undefined);
  const resource = sheet.resources.find((r) => r.key === grant?.resourceKey);
  return { key: resource?.key, resetOn: resource?.resetOn, usage: grant?.usage };
}

describe('spell pools the data writes as daily', () => {
  it("refills Fey Teleportation's misty step on a short rest", () => {
    expect(pool(withFeat('Fey Teleportation', 'XGE'), 'misty step')).toEqual({
      key: 'spell:fey teleportation|xge:misty-step',
      resetOn: 'short',
      usage: '1/rest',
    });
  });

  it('leaves it on a long rest, as its data says, with no rule sets', () => {
    const noSets: EngineContext = {
      ...ctx,
      byType: (type) => (type === RULE_SET_TYPE ? [] : ctx.byType(type)),
    };
    expect(pool(withFeat('Fey Teleportation', 'XGE', {}, noSets), 'misty step')).toEqual({
      key: 'spell:fey teleportation|xge:misty-step',
      resetOn: 'long',
      usage: '1/day',
    });
  });

  it('leaves the same daily spell from another origin on a long rest', () => {
    expect(pool(withFeat('Fake Wayfarer', 'TST'), 'misty step')).toMatchObject({
      resetOn: 'long',
      usage: '1/day',
    });
  });

  describe('Boon of Siberys', () => {
    const BASE = 'feat:boon of siberys|efa:f1';
    const picked = (mark: string, extra: CharacterDoc['choices'] = {}) =>
      withFeat('Boon of Siberys', 'EFA', {
        [`${BASE}:branch`]: [mark],
        [`${BASE}:ability:b:${mark}:0`]: ['cha'],
        ...extra,
      });

    it.each([
      ['mark of passage', 'plane shift'],
      ['mark of warding', 'maze'],
    ])('refills the %s spell on a short rest', (mark, spell) => {
      expect(pool(picked(mark), spell)).toMatchObject({ resetOn: 'short', usage: '1/rest' });
    });

    it('refills the Sorcerer spell picked on a short rest too', () => {
      const sheet = picked('sorcerer spell', {
        [`${BASE}:spell:b:sorcerer spell:0:prepared:_:0`]: ['fireball|xphb'],
      });
      expect(sheet.pending).toEqual([]);
      expect(pool(sheet, 'fireball')).toEqual({
        key: 'spell:boon of siberys|efa:fireball',
        resetOn: 'short',
        usage: '1/rest',
      });
    });
  });

  describe('Legacy of Minauros', () => {
    const mammon = (levels: number) => {
      const doc = fighter(levels);
      doc.race = { name: 'Tiefling', source: 'PHB' };
      doc.subrace = { name: 'Mammon', source: 'MTF' };
      return deriveSheet(doc, ctx);
    };

    it("refills Tenser's floating disk on a short rest, and arcane lock only on a long one", () => {
      const sheet = mammon(5);
      expect(pool(sheet, "tenser's floating disk")).toEqual({
        key: 'spell:mammon|mtf:tenser-s-floating-disk',
        resetOn: 'short',
        usage: '1/rest',
      });
      expect(pool(sheet, 'arcane lock')).toEqual({
        key: 'spell:mammon|mtf:arcane-lock',
        resetOn: 'long',
        usage: '1/day',
      });
    });

    // A plain Tiefling: Mammon's trait replaces Infernal Legacy, so a Mammon
    // tiefling casts none of these once the subrace merge honors that.
    it("leaves the Tiefling's own daily spells on a long rest", () => {
      const doc = fighter(5);
      doc.race = { name: 'Tiefling', source: 'PHB' };
      const sheet = deriveSheet(doc, ctx);
      expect(pool(sheet, 'hellish rebuke')).toMatchObject({ resetOn: 'long', usage: '1/day' });
      expect(pool(sheet, 'darkness')).toMatchObject({ resetOn: 'long', usage: '1/day' });
    });

    describe('with both spells in one bucket, as no printing writes them', () => {
      /** Mammon with `count` uses of both spells, the disk's ref written capitalised. */
      const bucketed = (count: string) => {
        const spells = ["Tenser's Floating Disk|PHB", 'arcane lock'];
        const bucket = [{ ability: 'cha', innate: { _: { daily: { [count]: spells } } } }];
        const doc = fighter(5);
        doc.subrace = { name: 'Mammon', source: 'MTF' };
        return deriveSheet(doc, {
          ...ctx,
          get: (type, name, source) => {
            const found = ctx.get(type, name, source);
            return type === 'subrace' && found ? { ...found, additionalSpells: bucket } : found;
          },
        });
      };

      it('reads each spell of an "each" count as its own pool', () => {
        const sheet = bucketed('1e');
        expect(pool(sheet, "Tenser's Floating Disk")).toMatchObject({ resetOn: 'short' });
        expect(pool(sheet, 'arcane lock')).toMatchObject({ resetOn: 'long' });
      });

      it('leaves a pool shared with a long rest spell on a long rest', () => {
        const sheet = bucketed('1');
        expect(pool(sheet, "Tenser's Floating Disk")).toEqual({
          key: 'spell:mammon|mtf:tenser-s-floating-disk+arcane-lock',
          resetOn: 'long',
          usage: '1/day',
        });
      });
    });
  });
});

/** What each origin's `spellRest` row says, as the table the rows came from said it. */
const EXPECTED: Record<string, ShortRestSpells> = {
  'feat:fey teleportation|xge': { spells: ['misty step'] },
  'feat:boon of siberys|efa': { spells: 'every' },
  'race:mammon|mtf': { spells: ["tenser's floating disk"] },
};

describe('the built-in spell rest rows', () => {
  it('cover the keys the table had, each once, and read with no problem', () => {
    const keys = spellRestRules.rows.flatMap((r) => r.keys);
    expect([...keys].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(readRuleSet(spellRestRules).problems).toEqual([]);
  });

  for (const [key, expected] of Object.entries(EXPECTED)) {
    it(`say which of ${key}'s pools come back on a short rest`, () => {
      expect(builtInRuleIn(BUILT_IN_RULE_SETS, 'spellRest', [key])?.shortRest).toEqual(expected);
    });
  }
});

describe('a spell rest row, read', () => {
  const read = (fields: Record<string, unknown>, more: Record<string, unknown>[] = []) =>
    readRuleSet({
      type: RULE_SET_TYPE,
      v: 1,
      name: 'Test rules',
      rows: [
        { part: 'spellRest', keys: ['feat:tests|tst'], spells: ['shield'], ...fields },
        ...more.map((f) => ({ part: 'spellRest', keys: ['feat:tests|tst'], ...f })),
      ],
    });

  it('keeps every pool, or its spells trimmed and by name in lower case', () => {
    expect(read({ spells: 'every' }).rows[0]?.shortRest).toEqual({ spells: 'every' });
    const set = read({ spells: [' Misty Step ', "Tenser's Floating Disk"] });
    expect(set.problems).toEqual([]);
    expect(set.rows[0]?.shortRest).toEqual({
      spells: ['misty step', "tenser's floating disk"],
    });
    expect(set.rows[0]?.effects).toEqual([]);
  });

  it.each([
    ['no spells', { spells: undefined }, '"spells" is "every", or lists the spells'],
    ['an empty list', { spells: [] }, '"spells" is "every", or lists the spells'],
    ['a word other than every', { spells: 'Every' }, '"spells" is "every", or lists the spells'],
    [
      'more spells than a row lists',
      { spells: Array.from({ length: 21 }, (_, i) => `spell ${i}`) },
      '"spells" lists at most 20 spells',
    ],
    [
      'a spell that is not a name',
      { spells: [{ spell: 'shield' }] },
      "spell 1: is the spell's name",
    ],
    ['a spell with no name', { spells: ['shield', ' '] }, "spell 2: is the spell's name"],
    ['a name longer than a name', { spells: ['x'.repeat(201)] }, "spell 1: is the spell's name"],
    [
      'every in a list',
      { spells: ['misty step', 'Every'] },
      'spell 2: "every" stands alone, not in a list',
    ],
    [
      'a spell named twice, in any case',
      { spells: ['Shield', 'shield'] },
      'spell 2: "shield" is named twice',
    ],
    ['a field a row has not', { level: 3 }, '"level" is not a field a spellRest row has'],
    ['effects', { effects: [] }, '"effects" is not a field a spellRest row has'],
  ])('leaves out a row with %s, and its keys stay free', (_, fields, problem) => {
    const set = read(fields, [{ spells: ['misty step'] }]);
    expect(set.problems.join('; ')).toContain(problem);
    expect(set.rows).toHaveLength(1);
    expect(set.rows[0]?.shortRest).toEqual({ spells: ['misty step'] });
  });

  it('takes as many as 20 spells', () => {
    const spells = Array.from({ length: 20 }, (_, i) => `spell ${i}`);
    const set = read({ spells });
    expect(set.problems).toEqual([]);
    expect(set.rows[0]?.shortRest).toEqual({ spells });
  });

  it('keeps the first of two rows under one key, and says the second is a row already', () => {
    const set = read({ spells: ['shield'] }, [{ spells: ['misty step'] }]);
    expect(set.problems.join('; ')).toContain('"feat:tests|tst" is already a row');
    expect(set.rows.map((r) => r.shortRest)).toEqual([{ spells: ['shield'] }]);
  });
});
