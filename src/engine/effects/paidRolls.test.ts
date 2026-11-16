import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS, makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import type { Formula } from '../formula';
import { rollEffects } from '../playRules';
import {
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  type FormulaScope,
  newCharacterDoc,
} from '../types';
import { Collector } from './base';
import { builtInRuleIn, emitBuiltInRows, readRuleSet } from './mechanics';

// A feature's paid extras and rerolls on the character's own d20 tests: the
// `rollPaid` and `rollReroll` effects of the built-in `rollExtra` rows, which
// were `ROLL_EXTRAS` until rule pack port 3e.

const rules: EngineContext = {
  get: () => undefined,
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : []),
};
const origin: EffectOrigin = { label: 'Feature', uid: 'feature|tst', type: 'feat' };
const SAVES = { rolls: ['save'] };

type Paid = Extract<EffectInput, { kind: 'rollPaid' }>;
type Rerolled = Extract<EffectInput, { kind: 'rollReroll' }>;
const isPaid = (e: EffectInput): e is Paid => e.kind === 'rollPaid';
const isReroll = (e: EffectInput): e is Rerolled => e.kind === 'rollReroll';

/** The rows under the first of `keys` with any, as a call site emits them. */
function emit(keys: string[], featureLevel?: number, classLevel?: number) {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), rules);
  const found = emitBuiltInRows(col, 'rollExtra', keys, origin, { featureLevel, classLevel });
  return { found, effects: col.effects };
}
const paid = (keys: string[], level?: number) => emit(keys, level).effects.filter(isPaid);
const rerolls = (keys: string[], level?: number, classLevel?: number) =>
  emit(keys, level, classLevel).effects.filter(isReroll);

/** Intelligence 8, proficiency +4: what a bonus's formula reads (`fillFormulas`). */
const SCOPE: FormulaScope = {
  level: 12,
  classLevel: 0,
  prof: 4,
  hp: 30,
  maxHp: 60,
  mod: { str: 0, dex: 0, con: 0, int: -1, wis: 0, cha: 0 },
  score: { str: 10, dex: 10, con: 10, int: 8, wis: 10, cha: 10 },
};

/** An effect as the sheet holds it once its formulas are worked out, each at 0 or more. */
function folded(e: EffectInput, scope: FormulaScope = SCOPE): Record<string, unknown> {
  const { formulas, ...out } = e as EffectInput & Record<string, unknown>;
  for (const slot of formulas ?? []) {
    const value = (slot.formula as Formula).evaluate({ ...scope, classLevel: slot.classLevel });
    (out as Record<string, unknown>)[slot.field] = Math.max(0, value);
  }
  return out;
}

const rows = BUILT_IN_RULE_SETS.flatMap((set) => readRuleSet(set).rows).filter(
  (r) => r.part === 'rollExtra',
);
const effectsOf = (kind: 'rollPaid' | 'rollReroll') =>
  rows.flatMap((row) =>
    row.effects.filter((t) => t.effect.kind === kind).map((t) => ({ key: row.keys[0], ...t })),
  );

describe('the paid extras and rerolls in the built-in rows', () => {
  it('are every key the code table held, 75 of them', () => {
    const keys = rows
      .filter((r) => r.effects.some((t) => t.effect.kind !== 'rollDie'))
      .flatMap((r) => r.keys);
    expect(new Set(keys).size).toBe(75);
  });

  it('word when each holds as the prompt reads it', () => {
    const paidRows = effectsOf('rollPaid');
    const rerollRows = effectsOf('rollReroll');
    expect(paidRows.length).toBeGreaterThan(20);
    expect(rerollRows.length).toBeGreaterThan(20);
    for (const { key, effect } of paidRows) {
      if (effect.when === undefined) continue;
      expect(effect.when, key).toMatch(/^Only /);
      expect(effect.when, key).not.toMatch(/[–—.]$/);
    }
    for (const { key, effect } of rerollRows) {
      if (effect.when !== undefined) expect(effect.when, key).not.toMatch(/[–—.]$/);
    }
  });

  it('never sell advantage that a built-in advantage row already gives for the key', () => {
    let held = 0;
    for (const row of rows) {
      for (const key of row.keys) {
        if (builtInRuleIn(BUILT_IN_RULE_SETS, 'rollAdvantage', [key]) === undefined) continue;
        held++;
        expect(
          row.effects.some((t) => t.effect.kind === 'rollPaid' && t.effect.advantage === true),
          key,
        ).toBe(false);
      }
    }
    // Living Legend has both: an advantage to claim and a reroll.
    expect(held).toBeGreaterThan(0);
  });

  it('read a paid row with what it adds and its flags', () => {
    expect(paid(['tactical mind|fighter|xphb'])).toEqual([
      {
        kind: 'rollPaid',
        on: { rolls: ['check'] },
        dice: '1d10',
        ifFailed: true,
        spentOnSuccess: true,
        origin,
      },
    ]);
    expect(paid(['guided strike|war domain|xphb'])[0]).toMatchObject({
      kind: 'rollPaid',
      bonus: 10,
      after: true,
      ifFailed: true,
      reaction: false,
    });
  });

  it('work out a bonus as the words it was written in did', () => {
    const bonus = (key: string, scope?: FormulaScope) =>
      folded(paid([key])[0] as Paid, scope).bonus;
    // Intelligence 8: at least +0 (2014) and at least +1 (2024).
    expect(bonus('flash of genius|artificer|tce')).toBe(0);
    expect(bonus('flash of genius|artificer|efa')).toBe(1);
    const sharp = { ...SCOPE, mod: { ...SCOPE.mod, int: 3 } };
    expect(bonus('flash of genius|artificer|tce', sharp)).toBe(3);
    expect(bonus('flash of genius|artificer|efa', sharp)).toBe(3);
    // A bonus the size of the proficiency bonus.
    expect(bonus('survivor|rhw')).toBe(4);
  });

  it('stop at the first key that has rows, and read all of its rows', () => {
    const { found, effects } = emit(['nothing|tst', 'ambush|tce', 'lucky|xphb']);
    expect(found).toBe(true);
    expect(effects.filter(isPaid).map((r) => r.on)).toEqual([
      { rolls: ['check'], skills: ['Stealth'] },
      { rolls: ['check'], initiative: true },
    ]);
  });

  it('tell two cards of one feature apart by their level', () => {
    const guided = (level: number) =>
      paid(['channel divinity: guided strike|war domain|phb'], level);
    expect(guided(2)).toHaveLength(1);
    expect(guided(6)).toEqual([]);
  });
});

describe('the rerolls in the built-in rows', () => {
  it("read a reroll with its bonus at the feature's class level, on its card alone", () => {
    expect(rerolls(['indomitable|fighter|xphb'], 9, 13).map((e) => folded(e))).toEqual([
      { kind: 'rollReroll', on: SAVES, ifFailed: true, bonus: 13, origin },
    ]);
    // The cards at 13 and 17 add none of their own.
    expect(rerolls(['indomitable|fighter|xphb'], 13, 13)).toEqual([]);
    expect(rerolls(['indomitable|fighter|phb'], 9, 9)[0]).not.toHaveProperty('bonus');
  });

  it('read the rows that set a number: as the d20 lands, offered free, or paid', () => {
    const one = (key: string) => {
      const [r, ...more] = rerolls([key]);
      expect(more, key).toEqual([]);
      const { kind: _kind, origin: _origin, ...row } = r as Rerolled;
      return row;
    };
    const asTen = { to: 10, auto: true, free: true };
    expect(one('reliable talent|rogue|phb')).toEqual({
      on: { rolls: ['check'], proficient: true },
      ...asTen,
    });
    expect(one('reliable talent|rogue|xphb')).toEqual(one('reliable talent|rogue|phb'));
    expect(one('reliable talent|expert sidekick|tce')).toEqual(one('reliable talent|rogue|phb'));
    expect(one('silver tongue|college of eloquence|tce')).toEqual({
      on: { rolls: ['check'], skills: ['Persuasion', 'Deception'] },
      ...asTen,
    });
    expect(one('ear for deceit|inquisitive|xge')).toEqual({
      on: { rolls: ['check'], skills: ['Insight'] },
      to: 8,
      free: true,
      when: 'Only to tell whether a creature is lying',
    });
    const trance = {
      on: { rolls: ['attack', 'check', 'save'] },
      to: 10,
      free: true,
      when: 'Only while Trance of Order lasts',
    };
    expect(one('trance of order|clockwork soul|tce')).toEqual(trance);
    expect(one('trance of order|clockwork sorcery|xphb')).toEqual(trance);
    const dragon = {
      on: { rolls: ['check'], abilities: ['int', 'wis'] },
      to: 10,
      free: true,
      when: 'Only in your Dragon form',
    };
    expect(one('dragon|circle of stars|tce')).toEqual(dragon);
    expect(one('dragon|circle of the stars|xphb')).toEqual(dragon);
    // Paid: a use of the feature's own pool.
    expect(one('adept of the red robes|dsotdq')).toEqual({
      on: { rolls: ['attack', 'check'] },
      to: 10,
    });
    expect(one('stroke of luck|rogue|phb')).toEqual({
      on: { rolls: ['check'] },
      to: 20,
      ifFailed: true,
    });
    expect(one('stroke of luck|rogue|xphb')).toEqual({
      on: { rolls: ['attack', 'check', 'save'] },
      to: 20,
      ifFailed: true,
    });
    const floor = { floorScore: 'str', auto: true, free: true };
    expect(one('indomitable might|barbarian|phb')).toEqual({
      on: { rolls: ['check'], abilities: ['str'] },
      ...floor,
    });
    expect(one('indomitable might|barbarian|xphb')).toEqual({
      on: { rolls: ['check', 'save'], abilities: ['str'] },
      ...floor,
    });
  });

  it("hold Fanatical Focus only while raging, the 2024 one with Rage's damage at each level", () => {
    const [focus2014] = rerolls(['fanatical focus|path of the zealot|xge'], 6, 9);
    expect(focus2014).toMatchObject({ while: [{ state: 'effect', name: 'Rage' }], free: true });
    expect(focus2014).not.toHaveProperty('bonus');
    const rage = (classLevel: number) =>
      folded(rerolls(['fanatical focus|path of the zealot|xphb'], 6, classLevel)[0] as Rerolled);
    expect(rage(9)).toMatchObject({ bonus: 3, while: [{ state: 'effect', name: 'Rage' }] });
    // Rage's damage: +2, then +3 at 9 and +4 at 16.
    expect([6, 8, 9, 15, 16, 20].map((l) => rage(l).bonus)).toEqual([2, 2, 3, 3, 4, 4]);
  });

  it("give a 2014 halfling Luck, never the 2014 Lucky feat's row its fallback key holds", () => {
    expect(rerolls(['lucky|halfling|phb', 'lucky|phb'])).toEqual([
      {
        kind: 'rollReroll',
        on: { rolls: ['attack', 'check', 'save'] },
        die: 'one',
        atMost: 1,
        auto: true,
        free: true,
        origin,
      },
    ]);
    expect(rerolls(['lucky|phb'])[0]).toMatchObject({ die: 'extra' });
  });

  it('keep Survivor’s bonus on a save and add its reroll on initiative', () => {
    const { effects } = emit(['survivor|rhw']);
    expect(effects.map((e) => e.kind)).toEqual(['rollPaid', 'rollReroll']);
    expect(effects[1]).toMatchObject({
      on: { rolls: ['check'], initiative: true },
      die: 'one',
      atMost: 9,
    });
  });
});

describe('paid extras and rerolls on a derived sheet', () => {
  // A rule set of its own for the synthetic world's species traits, class
  // feature, feat and option, so the walks read its rows as they read the shipped ones.
  const ADDED: DataEntity = {
    type: RULE_SET_TYPE,
    v: 1,
    name: 'Test paid extras',
    rows: [
      {
        part: 'rollExtra',
        keys: ['plain lore|prosefolk|tst'],
        effects: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['check'] } }],
      },
      {
        part: 'rollExtra',
        keys: ['test surge|prosefolk|tst'],
        effects: [{ kind: 'rollPaid', on: { rolls: ['check'] }, dice: '1d6' }],
      },
      {
        part: 'rollExtra',
        keys: ['once guard|prosefolk|tst'],
        effects: [
          {
            kind: 'rollPaid',
            on: SAVES,
            bonus: { f: 'prof' },
            after: true,
            reaction: true,
            ifFailed: true,
          },
          {
            kind: 'rollReroll',
            on: { rolls: ['attack'] },
            die: 'one',
            atMost: 1,
            auto: true,
            free: true,
          },
        ],
      },
      {
        part: 'rollExtra',
        keys: ['grit|warrior|tst'],
        effects: [
          { kind: 'rollReroll', on: SAVES, ifFailed: true, bonus: { f: 'classLevel' } },
          {
            kind: 'rollReroll',
            on: { rolls: ['check'], abilities: ['str'] },
            floorScore: 'str',
            auto: true,
            free: true,
          },
          {
            kind: 'rollReroll',
            on: { rolls: ['check'], skills: ['Athletics'] },
            to: 10,
            auto: true,
            free: true,
          },
        ],
      },
      {
        part: 'rollExtra',
        keys: ['alert|phb'],
        effects: [{ kind: 'rollPaid', on: { rolls: ['check'], initiative: true }, dice: '1d8' }],
      },
      {
        part: 'rollExtra',
        keys: ['archery|phb'],
        effects: [{ kind: 'rollPaid', on: { rolls: ['attack'] }, advantage: true }],
      },
    ],
  };
  const world = makeTestContext();
  const ruleSets = [...world.byType(RULE_SET_TYPE), ADDED];
  const ctx: EngineContext = {
    get: (type, name, source) => world.get(type, name, source),
    byType: (type) => (type === RULE_SET_TYPE ? ruleSets : world.byType(type)),
  };

  const sheet = () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: [] }];
    doc.race = { name: 'Prosefolk', source: 'TST' };
    return deriveSheet(doc, ctx);
  };

  it('reads its rows with no problems', () => {
    expect(readRuleSet(ADDED).problems).toEqual([]);
  });

  it('names a trait’s extra for the trait, and counts its bonus as the sheet stands', () => {
    const s = sheet();
    expect(s.rollRiders.filter((r) => r.kind === 'paid')).toEqual([
      { kind: 'paid', on: { rolls: ['check'] }, dice: '1d6', origin: 'Test Surge' },
      {
        kind: 'paid',
        on: SAVES,
        bonus: 3,
        after: true,
        reaction: true,
        ifFailed: true,
        origin: 'Once Guard',
      },
      // Any 2014 character's Inspiration, paid for by spending it.
      {
        kind: 'paid',
        on: { rolls: ['attack', 'check', 'save'] },
        origin: 'Inspiration',
        advantage: true,
        inspiration: true,
      },
    ]);
  });

  it("reads a class feature's reroll with its bonus at the class's level", () => {
    expect(rollEffects(sheet(), { kind: 'save', ability: 'con' }).rerolls).toEqual([
      { source: 'Grit', ifFailed: true, bonus: 5 },
    ]);
  });

  it('reads a floor at the score the sheet has for its ability', () => {
    const strong = newCharacterDoc('c', 'H', 't');
    strong.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: [] }];
    strong.abilities = { ...strong.abilities, base: { ...strong.abilities.base, str: 17 } };
    const sheet17 = deriveSheet(strong, ctx);
    expect(sheet17.abilities.str.value).toBe(17);
    expect(rollEffects(sheet17, { kind: 'check', ability: 'str' }).rerolls).toEqual([
      { source: 'Grit', floor: 17, auto: true, free: true },
    ]);
    // A set reaches the skill it names, its number carried through.
    expect(
      rollEffects(sheet17, { kind: 'check', ability: 'str', skill: 'Athletics' }).rerolls,
    ).toEqual([
      { source: 'Grit', floor: 17, auto: true, free: true },
      { source: 'Grit', to: 10, auto: true, free: true },
    ]);
    // No floor score on the effect itself: it is worked out, and never reaches a save.
    expect(rollEffects(sheet17, { kind: 'save', ability: 'str' }).rerolls).toEqual([
      { source: 'Grit', ifFailed: true, bonus: 5 },
    ]);
  });

  it("reads a trait's reroll made as the d20 lands, with each of its flags", () => {
    const attack = { kind: 'attack', attack: 'weapon', range: 'melee', ability: 'str' } as const;
    expect(rollEffects(sheet(), attack).rerolls).toEqual([
      { source: 'Once Guard', die: 'one', atMost: 1, auto: true, free: true },
    ]);
  });

  it('rolls a free die in, and leaves the paid ones to be priced', () => {
    const check = rollEffects(sheet(), { kind: 'check', ability: 'wis' });
    expect(check.dice).toEqual([{ dice: '1d4', source: 'Plain Lore' }]);
    expect(check.paid?.map((p) => p.source)).toEqual(['Test Surge', 'Inspiration']);
    expect(check.offers).toEqual([]);
  });

  it('reads a feat and a picked optional feature, each named for itself', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: [] }];
    doc.feats = [{ ref: { name: 'Alert', source: 'PHB' }, instanceId: 'f0' }];
    const id = deriveSheet(doc, ctx).pending.find((p) => p.label === 'Combat Stance')?.id;
    expect(id).toBeDefined();
    doc.choices[id ?? ''] = ['archery|phb'];
    const s = deriveSheet(doc, ctx);
    const inspiration = { source: 'Inspiration', advantage: true, inspiration: true };
    expect(rollEffects(s, { kind: 'initiative' }).paid).toEqual([
      { source: 'Alert', dice: '1d8' },
      inspiration,
    ]);
    expect(rollEffects(s, { kind: 'attack' }).paid).toEqual([
      { source: 'Combat Stance: Archery', advantage: true },
      inspiration,
    ]);
  });
});
