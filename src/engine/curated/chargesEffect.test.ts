// An item's own `charges` effect (O1): how it is read, where it may stand, which
// of a built-in row, the item's own effect and a pack's patch says an item's
// charges (`itemChargesOf`), and the pool a derive makes of them.
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_PACK_TYPE, RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { readMechanics, readPack, readRuleSet, readStoredEffects } from '../effects/mechanics';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from '../types';
import { idleChargePools, itemChargesOf, regainRollOf } from './itemCharges';

const WAND = {
  kind: 'charges',
  charges: 7,
  regain: '1d6+1',
  spells: [{ spell: 'Fireball|XPHB', cost: 1, upTo: 5 }],
};

const item = (name: string, source: string, effects?: unknown[], more = {}): DataEntity => ({
  name,
  source,
  type: 'WD',
  rarity: 'rare',
  ...(effects === undefined ? {} : { castGuidance: { v: 1, effects } }),
  ...more,
});

const pack = (name: string, patches: unknown[], characters = ['hero']): DataEntity => ({
  name,
  source: name,
  appliesTo: { characters },
  castGuidance: { v: 1, patches },
});

function world(
  items: DataEntity[],
  packs: DataEntity[] = [],
  sets: readonly DataEntity[] = BUILT_IN_RULE_SETS,
): EngineContext {
  const of: Record<string, readonly DataEntity[]> = {
    item: items,
    [RULE_SET_TYPE]: sets,
    [RULE_PACK_TYPE]: packs,
  };
  return {
    get: (type, name, source) =>
      of[type]?.find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      ),
    byType: (type) => of[type] ?? [],
  };
}

function carrying(...entries: Array<{ id: string; name: string; source: string; on?: boolean }>) {
  const doc: CharacterDoc = newCharacterDoc('hero', 'Hero', 't');
  doc.equipment = entries.map((e) => ({
    id: e.id,
    ref: { name: e.name, source: e.source },
    qty: 1,
    equipped: e.on ?? true,
    attuned: true,
  }));
  return doc;
}

describe('an item\'s own "charges" effect, read', () => {
  it('is read apart from its other effects, which keep their places', () => {
    const read = readMechanics({ v: 1, effects: [WAND, { kind: 'acBonus', amount: 1 }] });
    expect(read.problems).toEqual([]);
    expect(read.charges).toEqual({
      charges: 7,
      regain: '1d6+1',
      spells: [{ spell: 'fireball', cost: 1, upTo: 5, ref: { name: 'Fireball', source: 'XPHB' } }],
    });
    expect(read.effects.map((t) => t.effect.kind)).toEqual(['acBonus']);
    const list = readStoredEffects([WAND, { kind: 'acBonus', amount: 1 }], 'effects', {
      strict: false,
      builtIn: false,
      inPick: false,
      holdsCharges: true,
    });
    expect(list.places).toEqual([2]);
  });

  it('takes a whole number, "all" and "none", in any case, and the ability its spells cast with', () => {
    const regain = (r: unknown) =>
      readMechanics({ v: 1, effects: [{ ...WAND, regain: r }] }).charges?.regain;
    expect(regain(3)).toBe('3');
    expect(regain(7)).toBe('7');
    expect(regain(' All ')).toBe('all');
    expect(regain('NONE')).toBe('none');
    const wis = readMechanics({ v: 1, effects: [{ ...WAND, ability: 'wis' }] });
    expect(wis.charges?.ability).toBe('wis');
  });

  it.each([
    ['a spell without its book', { spells: [{ spell: 'Fireball', cost: 1 }] }, '"name|source"'],
    ['no charges back', { regain: 0 }, '"regain" is what comes back'],
    ['more back than it holds', { regain: 8 }, '"regain" is what comes back'],
    ['part of a charge back', { regain: 1.5 }, '"regain" is what comes back'],
    ['a word it does not know', { regain: 'half' }, '"regain" is what comes back'],
    ['an ability it does not know', { ability: 'luck' }, '"ability" is the ability'],
    ['a "while"', { while: 'bloodied' }, 'no "while" or "edition"'],
    ['an "edition"', { edition: '2024' }, 'no "while" or "edition"'],
  ])('leaves out one with %s, and says so', (_, fields, problem) => {
    const read = readMechanics({ v: 1, effects: [{ ...WAND, ...fields }] });
    expect(read.charges).toBe(undefined);
    expect(read.problems.join('; ')).toContain('effect 1 (charges): ');
    expect(read.problems.join('; ')).toContain(problem);
  });

  it('says the charges once: a second is a problem, and the first counts', () => {
    const read = readMechanics({ v: 1, effects: [WAND, { ...WAND, charges: 3 }] });
    expect(read.problems).toEqual([
      "effect 2 (charges): says the item's charges again: effect 1 says them",
    ]);
    expect(read.charges?.charges).toBe(7);
    // A first that cannot be read still says them first.
    const bad = readMechanics({ v: 1, effects: [{ ...WAND, charges: 0 }, WAND] });
    expect(bad.charges).toBe(undefined);
    expect(bad.problems.join('; ')).toContain('effect 2 (charges): says the item');
  });

  it('counts nothing when the item cannot be read at all', () => {
    const read = readMechanics({ v: 99, effects: [WAND] });
    expect(read.readable).toBe(false);
    expect(read.charges).toBe(undefined);
  });

  it("is an item's own: in a moment's list, a pick's gives or a built-in row, a problem", () => {
    expect(readStoredEffects([WAND]).problems).toEqual([
      "effect 1 (charges): is an item's own, in its effects or a pack's patch of them",
    ]);
    const picked = readMechanics({
      v: 1,
      effects: [{ kind: 'pick', id: 'gem', ask: 'damage', gives: [WAND] }],
    });
    expect(picked.charges).toBe(undefined);
    expect(picked.problems.join('; ')).toContain("is an item's own");
    const set = readRuleSet({
      type: RULE_SET_TYPE,
      v: 1,
      name: 'Built-in rules',
      rows: [{ part: 'curated', keys: ['wand|hb'], effects: [WAND] }],
    });
    expect(set.problems.join('; ')).toContain("is an item's own");
  });

  it('a built-in row takes a whole number back, but no book and no ability', () => {
    const row = (fields: Record<string, unknown>) =>
      readRuleSet({
        type: RULE_SET_TYPE,
        v: 1,
        name: 'Test rules',
        rows: [
          {
            part: 'charges',
            keys: ['rod|tst'],
            charges: 5,
            regain: '1d4',
            spells: [{ spell: 'shield', cost: 1 }],
            ...fields,
          },
        ],
      });
    expect(row({ regain: 4 }).rows[0]?.charges?.regain).toBe('4');
    expect(row({ ability: 'wis' }).problems.join('; ')).toContain(
      '"ability" is not a field a charges row has',
    );
    expect(row({}).rows[0]?.charges?.spells[0]?.ref).toBe(undefined);
  });
});

describe("a pack's patch of an item's charges", () => {
  it('reads them in its effects and in what it adds', () => {
    const read = readPack(
      pack('P', [
        { target: 'Wand|HB', effects: [WAND] },
        { target: 'Rod|HB', add: [{ ...WAND, charges: 3 }] },
      ]),
    );
    expect(read.problems).toEqual([]);
    // Effects holding only the charges still replace the item's own.
    expect(read.patches[0]).toEqual({
      target: 'wand|hb',
      replace: [],
      replaceCharges: expect.objectContaining({ charges: 7 }),
    });
    expect(read.patches[1]).toEqual({
      target: 'rod|hb',
      addCharges: expect.objectContaining({ charges: 3 }),
    });
  });
});

describe('itemChargesOf: which says the charges', () => {
  const ref = { name: 'Wand of Fireballs', source: 'XDMG' };
  const own = item('Wand of Fireballs', 'XDMG', [{ ...WAND, charges: 4 }]);
  const charges = (ctx: EngineContext, id = 'hero') => {
    const held = itemChargesOf(ctx, id, ref);
    return held === undefined ? undefined : [held.from, held.charges.charges];
  };

  it("the built-in row, then the item's own, then a pack's addition, then its replacement", () => {
    expect(charges(world([item('Wand of Fireballs', 'XDMG')]))).toEqual(['row', 7]);
    expect(charges(world([own]))).toEqual(['own', 4]);
    const adds = pack('Adds', [
      { target: 'Wand of Fireballs|XDMG', add: [{ ...WAND, charges: 5 }] },
    ]);
    expect(charges(world([own], [adds]))).toEqual(['pack', 5]);
    const replaces = pack('Replaces', [
      { target: 'wand of fireballs|xdmg', effects: [{ ...WAND, charges: 6 }] },
    ]);
    expect(charges(world([own], [replaces, adds]))).toEqual(['pack', 6]);
    expect(charges(world([own], [adds, replaces]))).toEqual(['pack', 6]);
  });

  it("only a pack applied to the character, and none without the rule sets' row", () => {
    const adds = pack('Adds', [
      { target: 'Wand of Fireballs|XDMG', add: [{ ...WAND, charges: 5 }] },
    ]);
    expect(charges(world([own], [adds]), 'someone else')).toEqual(['own', 4]);
    expect(charges(world([item('Wand of Fireballs', 'XDMG')], [], []))).toBe(undefined);
  });

  it("a replacement that says none hides the item's own, not the row", () => {
    const replaces = pack('Replaces', [
      { target: 'Wand of Fireballs|XDMG', effects: [{ kind: 'acBonus', amount: 1 }] },
    ]);
    expect(charges(world([own], [replaces]))).toEqual(['row', 7]);
    const later = pack('Adds', [
      { target: 'Wand of Fireballs|XDMG', add: [{ ...WAND, charges: 2 }] },
    ]);
    expect(charges(world([own], [replaces, later]))).toEqual(['pack', 2]);
    // A later pack's replacement wins, saying none.
    const first = pack('First', [{ target: 'Wand of Fireballs|XDMG', effects: [WAND] }]);
    expect(charges(world([own], [first, replaces]))).toEqual(['row', 7]);
  });

  it('a long rest rolls the dice or number back, all of them back as any pool, and none never', () => {
    const at = (regain: string) => regainRollOf({ charges: 7, regain, spells: [] });
    expect(at('1d6+1')).toBe('1d6+1');
    expect(at('3')).toBe('3');
    expect(at('all')).toBe(undefined);
    expect(at('none')).toBe('0');
  });
});

describe("the pool a homebrew item's charges make", () => {
  const rod = (effect: Record<string, unknown> = {}) =>
    item('Rod of Sparks', 'HB', [{ ...WAND, ...effect }], { reqAttune: true });

  it('is one per carried copy, under its entry, while its magic works', () => {
    const doc = carrying(
      { id: 'a', name: 'Rod of Sparks', source: 'HB' },
      { id: 'b', name: 'Rod of Sparks', source: 'HB' },
    );
    const sheet = deriveSheet(doc, world([rod()]));
    expect(sheet.warnings).toEqual([]);
    expect(sheet.resources.filter((r) => r.key.startsWith('item-charges:'))).toEqual([
      expect.objectContaining({
        key: 'item-charges:a',
        label: 'Rod of Sparks charges',
        max: 7,
        resetOn: 'long',
        regainRoll: '1d6+1',
      }),
      expect.objectContaining({ key: 'item-charges:b' }),
    ]);
    doc.equipment = doc.equipment.map((e) => ({ ...e, attuned: false }));
    const off = deriveSheet(doc, world([rod()]));
    expect(off.resources.some((r) => r.key.startsWith('item-charges:'))).toBe(false);
  });

  it('comes back whole with "all", and never with "none"', () => {
    const doc = carrying({ id: 'a', name: 'Rod of Sparks', source: 'HB' });
    const all = deriveSheet(doc, world([rod({ regain: 'all' })]));
    const pool = all.resources.find((r) => r.key === 'item-charges:a');
    expect(pool?.max).toBe(7);
    expect(pool !== undefined && 'regainRoll' in pool).toBe(false);
    const none = deriveSheet(doc, world([rod({ regain: 'none' })]));
    expect(none.resources.find((r) => r.key === 'item-charges:a')?.regainRoll).toBe('0');
  });

  it('is idle while the item is put away, with the same roll', () => {
    const doc = carrying({ id: 'a', name: 'Rod of Sparks', source: 'HB', on: false });
    const ctx = world([rod()]);
    const sheet = deriveSheet(doc, ctx);
    expect(idleChargePools(doc, sheet.resources, ctx)).toEqual([
      {
        key: 'item-charges:a',
        label: 'Rod of Sparks charges',
        max: 7,
        resetOn: 'long',
        origin: 'Rod of Sparks',
        regainRoll: '1d6+1',
      },
    ]);
  });

  it('says a charges effect on what is not an item counts for nothing', () => {
    const feat: DataEntity = {
      name: 'Sparky',
      source: 'HB',
      castGuidance: { v: 1, effects: [WAND] },
    };
    const doc = newCharacterDoc('hero', 'Hero', 't');
    doc.feats = [{ ref: { name: 'Sparky', source: 'HB' }, instanceId: 'f0' }];
    const ctx = world([]);
    const withFeat: EngineContext = {
      get: (type, name, source) =>
        type === 'feat' && name.toLowerCase() === 'sparky' ? feat : ctx.get(type, name, source),
      byType: (type) => (type === 'feat' ? [feat] : ctx.byType(type)),
    };
    const sheet = deriveSheet(doc, withFeat);
    expect(sheet.warnings.join('; ')).toContain(
      'only an item holds charges, so its "charges" effect counts for nothing',
    );
  });
});
