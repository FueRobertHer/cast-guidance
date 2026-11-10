import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../tests-fixtures/testWorld';
import { countingEffects, countsAs, readActiveEffects } from './activeEffects';
import { deriveSheet } from './derive';
import {
  type ActiveEffect,
  type CharacterDoc,
  type EffectPart,
  newCharacterDoc,
  type RollFilter,
} from './types';

const ctx = makeTestContext();

let nextId = 0;
const fx = (name: string, parts: EffectPart[], more: Partial<ActiveEffect> = {}): ActiveEffect => ({
  id: `fx${++nextId}`,
  name,
  parts,
  ...more,
});

const ATTACKS_AND_SAVES: RollFilter = { rolls: ['attack', 'save'] };
const bless = () => fx('Bless', [{ kind: 'rollDie', dice: '1d4', on: ATTACKS_AND_SAVES }]);
const shieldOfFaith = () => fx('Shield of Faith', [{ kind: 'acBonus', amount: 2 }]);
const haste = (name = 'Haste', same?: string) =>
  fx(
    name,
    [
      { kind: 'acBonus', amount: 2 },
      { kind: 'speedMultiplier', factor: 2 },
      {
        kind: 'extraAction',
        label: 'Haste action',
        note: 'Attack once, Dash, Disengage, Hide or Use an Object',
      },
    ],
    same !== undefined ? { same } : {},
  );
const aid = (amount: number) => fx('Aid', [{ kind: 'maxHpBonus', amount }]);

/**
 * A level-5 warrior in no armor, with a longsword: Testfolk (DEX +2, WIS +1),
 * STR 16, DEX 16, so unarmored AC 13.
 */
function warrior(): CharacterDoc {
  const doc = newCharacterDoc('w', 'Hild', 'test-tag');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 };
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.classes = [
    { ref: { name: 'Warrior', source: 'TST' }, levels: 5, hp: ['avg', 'avg', 'avg', 'avg', 'avg'] },
  ];
  doc.equipment = [
    { id: 'e1', ref: { name: 'Longsword', source: 'TST' }, qty: 1, equipped: true, attuned: false },
    { id: 'e2', ref: { name: 'Shortbow', source: 'TST' }, qty: 1, equipped: true, attuned: false },
  ];
  return doc;
}

/** The same character with these effects in play. */
function withEffects(doc: CharacterDoc, ...effects: ActiveEffect[]): CharacterDoc {
  const copy = structuredClone(doc);
  copy.play.activeEffects = effects;
  return copy;
}

const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const row = (sheet: ReturnType<typeof derive>, label: string) => {
  const found = sheet.attacks.find((a) => a.label === label);
  if (found === undefined) throw new Error(`no ${label} row`);
  return found;
};

describe('readActiveEffects', () => {
  it('reads none, and no problem, when the field is absent', () => {
    expect(readActiveEffects(undefined)).toEqual({ effects: [], problems: [] });
  });

  it('counts nothing from a field that is not a list', () => {
    const read = readActiveEffects({ id: 'x' });
    expect(read.effects).toEqual([]);
    expect(read.problems).toHaveLength(1);
  });

  it('leaves out an effect with no id or name, and a second one under the same id', () => {
    const first = bless();
    const read = readActiveEffects([
      { name: 'No id', parts: [] },
      { id: 'n', parts: [] },
      first,
      { ...shieldOfFaith(), id: first.id },
    ]);
    expect(read.effects.map((e) => e.name)).toEqual(['Bless']);
    expect(read.problems).toHaveLength(3);
  });

  it('leaves out a part it cannot read and keeps the rest of the effect', () => {
    const effect = {
      id: 'p',
      name: 'Odd Potion',
      parts: [
        { kind: 'acBonus', amount: 1 },
        { kind: 'levitate', height: 20 },
        { kind: 'saveBonus', amount: 'abilityMod:cha' },
        { kind: 'rollDie', dice: '1d4', on: { rolls: ['dance'] } },
        { kind: 'skillProf', skill: 'Athletics', level: 1 },
      ],
    };
    const read = readActiveEffects([effect]);
    expect(read.effects[0]?.parts).toEqual([{ kind: 'acBonus', amount: 1 }]);
    expect(read.problems).toEqual([
      'Odd Potion: 4 parts of it this version of the app cannot read, so those do not count.',
    ]);
  });

  it('refuses a die with no count or no sides', () => {
    const read = readActiveEffects([
      {
        id: 'd',
        name: 'Dice',
        parts: [
          { kind: 'rollDie', dice: '0d4', on: ATTACKS_AND_SAVES },
          { kind: 'rollDie', dice: '1d0', on: ATTACKS_AND_SAVES },
          { kind: 'rollDie', dice: 'd8', on: ATTACKS_AND_SAVES },
        ],
      },
    ]);
    expect(read.effects[0]?.parts.map((p) => (p as { dice: string }).dice)).toEqual(['d8']);
  });

  it('never changes what it reads', () => {
    const stored = [
      {
        id: 'a',
        name: 'A',
        parts: [{ kind: 'acBonus', amount: 1 }, { kind: 'newKind' }],
        off: false,
      },
    ];
    const before = structuredClone(stored);
    readActiveEffects(stored);
    expect(stored).toEqual(before);
  });

  it('keeps what it knows about an effect and drops a duration field it cannot read', () => {
    const read = readActiveEffects([
      {
        id: 'h',
        name: 'Potion of Speed',
        same: 'Haste',
        parts: [],
        lasts: { minutes: 1, rest: 'never', concentration: false },
        turnsLeft: 2,
        mine: true,
        off: true,
      },
    ]);
    expect(read.effects[0]).toEqual({
      id: 'h',
      name: 'Potion of Speed',
      same: 'Haste',
      parts: [],
      lasts: { minutes: 1, concentration: false },
      turnsLeft: 2,
      mine: true,
      off: true,
    });
  });

  describe('hostile input', () => {
    const partsOf = (part: unknown) =>
      readActiveEffects([{ id: 'a', name: 'A', parts: [part] }]).effects[0]?.parts;
    /** An object nested `depth` levels down, built without recursion. */
    const nested = (depth: number) => {
      let x: Record<string, unknown> = { end: true };
      for (let i = 0; i < depth; i++) x = { next: x };
      return x;
    };

    it('builds a part from the known fields of its kind only', () => {
      expect(
        partsOf({
          kind: 'acBonus',
          amount: 1,
          origin: { type: 'feat' },
          while: ['bloodied'],
          formulas: [{ field: 'amount', formula: 'x' }],
          label: 'stray',
          extra: nested(10),
        }),
      ).toEqual([{ kind: 'acBonus', amount: 1 }]);
    });

    it('builds a filter from its known fields only, and keeps them', () => {
      const parts = partsOf({
        kind: 'rollDie',
        dice: '1d4',
        same: 'Bless',
        on: {
          rolls: ['attack'],
          abilities: ['str'],
          skilled: true,
          attack: 'weapon',
          range: 'melee',
          className: 'Sorcerer',
          evil: nested(10),
        },
      });
      expect(parts).toEqual([
        {
          kind: 'rollDie',
          dice: '1d4',
          same: 'Bless',
          on: {
            rolls: ['attack'],
            abilities: ['str'],
            skilled: true,
            attack: 'weapon',
            range: 'melee',
            className: 'Sorcerer',
          },
        },
      ]);
    });

    it('copies what it keeps, so the stored part is not shared', () => {
      const stored = {
        kind: 'acFormula',
        label: 'Mage Armor',
        base: 13,
        addAbilities: ['dex'],
      };
      const [part] = partsOf(stored) ?? [];
      expect(part).toEqual(stored);
      expect(part).not.toBe(stored);
      expect((part as typeof stored).addAbilities).not.toBe(stored.addAbilities);
    });

    it('reads a part nested far too deep in an unknown key, and counts it', () => {
      const deep = { kind: 'acBonus', amount: 2, junk: nested(100_000) };
      const read = readActiveEffects([{ id: 'd', name: 'Deep', parts: [deep] }]);
      expect(read.effects[0]?.parts).toEqual([{ kind: 'acBonus', amount: 2 }]);
      expect(() => countingEffects(read.effects)).not.toThrow();
    });

    it('refuses a value nested where a plain one belongs', () => {
      expect(partsOf({ kind: 'acBonus', amount: nested(100_000) })).toEqual([]);
      expect(partsOf({ kind: 'rollDie', dice: '1d4', on: nested(100_000) })).toEqual([]);
      expect(
        partsOf({ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'], skills: [nested(5)] } }),
      ).toEqual([]);
      expect(partsOf({ kind: 'acFormula', label: 'X', base: 10, addAbilities: [['dex']] })).toEqual(
        [],
      );
    });

    it('refuses fields of the wrong type', () => {
      for (const bad of [
        { kind: 'acBonus', amount: '2' },
        { kind: 'acBonus', amount: Number.NaN },
        { kind: 'acBonus', amount: Number.POSITIVE_INFINITY },
        { kind: 'acBonus', amount: 1, same: 3 },
        { kind: 'critRange', min: 19.5 },
        { kind: 'cue', tone: 'help', text: ['x'] },
        { kind: 'rollDie', dice: 4, on: { rolls: ['attack'] } },
        { kind: 'rollDie', dice: '1d4', on: { rolls: 'attack' } },
        { kind: 'rollDie', dice: '1d4', on: [{ rolls: ['attack'] }] },
        { kind: 'saveBonus', amount: 1, abilities: 'str' },
        { kind: 'speedMultiplier', factor: 0 },
        { kind: 'moveSpeed', mode: 'fly', speed: -10 },
        { kind: ['acBonus'], amount: 1 },
        'acBonus',
        null,
        7,
      ]) {
        expect(partsOf(bad), JSON.stringify(bad)).toEqual([]);
      }
    });

    it('reads a gap in a list as a missing value, not as nothing', () => {
      // A structured clone (IndexedDB) keeps an array's gaps, which `every` skips.
      const gappy = ['dex'];
      gappy.length = 3;
      expect(partsOf({ kind: 'acFormula', label: 'X', base: 10, addAbilities: gappy })).toEqual([]);
      const parts: unknown[] = [{ kind: 'acBonus', amount: 1 }];
      parts.length = 2;
      const read = readActiveEffects([{ id: 'g', name: 'Gaps', parts }]);
      expect(read.effects[0]?.parts).toEqual([{ kind: 'acBonus', amount: 1 }]);
      expect(read.problems).toHaveLength(1);
    });

    it('never reads an inherited field', () => {
      const proto = { kind: 'acBonus', amount: 5, id: 'p', name: 'P', parts: [] };
      expect(partsOf(Object.create(proto))).toEqual([]);
      const part = Object.assign(Object.create({ every: true }), { kind: 'checkBonus', amount: 1 });
      expect(partsOf(part)).toEqual([]);
      const read = readActiveEffects([Object.create(proto)]);
      expect(read.effects).toEqual([]);
      expect(read.problems).toHaveLength(1);
      const lasts = Object.create({ minutes: 10 });
      const timed = readActiveEffects([{ id: 't', name: 'T', parts: [], lasts }]);
      expect(timed.effects[0]?.lasts).toEqual({});
    });

    it('takes a __proto__ key as data, never as a prototype', () => {
      const stored = JSON.parse(
        '[{"id":"x","name":"X","__proto__":{"off":true},"parts":[{"kind":"acBonus","amount":1,"__proto__":{"amount":9}}]}]',
      );
      const read = readActiveEffects(stored);
      expect(read.effects).toEqual([
        { id: 'x', name: 'X', parts: [{ kind: 'acBonus', amount: 1 }] },
      ]);
      expect(Object.getPrototypeOf(read.effects[0]?.parts[0])).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).off).toBeUndefined();
    });

    it('compares effects built elsewhere, nested past any depth, without running out of stack', () => {
      const built = (id: string, amount: number) =>
        fx(id, [{ kind: 'acBonus', amount, deep: nested(100_000) } as unknown as EffectPart], {
          same: 'Same',
        });
      const counted = countingEffects([built('one', 1), built('two', 3)]);
      expect(counted.inputs).toHaveLength(1);
      expect(counted.notCounted).toHaveLength(1);
    });
  });

  it('keeps what ends an effect early (Rage), and drops an ending it does not know', () => {
    const read = readActiveEffects([
      { id: 'a', name: 'Rage', parts: [], lasts: { minutes: 1, endsWhen: 'unconscious' } },
      { id: 'b', name: 'Rage', parts: [], lasts: { minutes: 10, endsWhen: 'incapacitated' } },
      { id: 'c', name: 'Odd', parts: [], lasts: { minutes: 10, endsWhen: 'asleep' } },
    ]);
    expect(read.effects.map((e) => e.lasts)).toEqual([
      { minutes: 1, endsWhen: 'unconscious' },
      { minutes: 10, endsWhen: 'incapacitated' },
      { minutes: 10 },
    ]);
  });
});

describe('countingEffects: effects of one name never add up', () => {
  it('counts the first of two Blesses and names the second as not counting', () => {
    const one = bless();
    const two = bless();
    const counted = countingEffects([one, two]);
    expect(counted.inputs).toHaveLength(1);
    expect(counted.inputs[0]?.origin).toEqual({ type: 'active', label: 'Bless', uid: one.id });
    expect(counted.notCounted).toEqual([
      { effectId: two.id, effectName: 'Bless', same: 'Bless', countedFrom: 'Bless' },
    ]);
  });

  it('counts the stronger of two castings that do the same thing', () => {
    const counted = countingEffects([aid(5), aid(10)]);
    expect(counted.inputs).toEqual([expect.objectContaining({ kind: 'maxHpBonus', amount: 10 })]);
  });

  it('measures each kind by its own number: a better Mage Armor, a bigger die', () => {
    const armor = (base: number) =>
      fx('Mage Armor', [{ kind: 'acFormula', label: 'Mage Armor', base, addAbilities: ['dex'] }]);
    expect(countingEffects([armor(13), armor(15)]).inputs).toEqual([
      expect.objectContaining({ base: 15 }),
    ]);
    // The same filter written in another order is the same filter.
    const d4 = fx('Bless', [
      { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'], abilities: ['str'] } },
    ]);
    const d6 = fx('Bless', [
      { kind: 'rollDie', dice: '1d6', on: { abilities: ['str'], rolls: ['attack'] } },
    ]);
    expect(countingEffects([d4, d6]).inputs).toEqual([expect.objectContaining({ dice: '1d6' })]);
  });

  it('counts the larger of two penalties of one name', () => {
    const frost = (amount: number) => fx('Frost', [{ kind: 'acBonus', amount }]);
    expect(countingEffects([frost(-1), frost(-2)]).inputs).toEqual([
      expect.objectContaining({ amount: -2 }),
    ]);
  });

  it('never compares a climb equal to walking with a number, and never by a stray field', () => {
    const walk = fx('Climb', [{ kind: 'moveSpeed', mode: 'climb', speed: 'walk' }]);
    const five = fx('Climb', [{ kind: 'moveSpeed', mode: 'climb', speed: 5 }]);
    expect(countingEffects([walk, five]).inputs).toEqual([
      expect.objectContaining({ speed: 'walk' }),
    ]);
    // Stored by something else: a line has no strength, whatever it carries.
    const stray = (text: string) =>
      readActiveEffects([
        { id: text, name: 'Ward', parts: [{ kind: 'cue', tone: 'info', text, dice: 'x' }] },
      ]).effects;
    expect(
      countingEffects([...stray('first'), ...stray('second')]).inputs.map((e) => e.origin.uid),
    ).toEqual(['first']);
  });

  it('counts the first added when the two do different things', () => {
    const plain = fx('Mystery', [{ kind: 'acBonus', amount: 1 }]);
    const other = fx('Mystery', [{ kind: 'speedBonus', amount: 30 }]);
    expect(countingEffects([plain, other]).inputs).toEqual([
      expect.objectContaining({ kind: 'acBonus', amount: 1 }),
    ]);
  });

  it('meets an effect by the name it counts as: a Potion of Speed is Haste', () => {
    const spell = haste();
    const potion = haste('Potion of Speed', 'Haste');
    const counted = countingEffects([spell, potion]);
    expect(counted.inputs.every((e) => e.origin.uid === spell.id)).toBe(true);
    expect(counted.notCounted).toEqual([
      { effectId: potion.id, effectName: 'Potion of Speed', same: 'Haste', countedFrom: 'Haste' },
    ]);
  });

  it('lets only part of an effect meet another: the Heroism potion is Bless and temp HP', () => {
    const spell = bless();
    const potion = fx('Potion of Heroism', [
      { kind: 'tempHpEachTurn', amount: 0 },
      { kind: 'rollDie', dice: '1d4', on: ATTACKS_AND_SAVES, same: 'Bless' },
      { kind: 'cue', tone: 'help', text: '10 temp HP when you drink it' },
    ]);
    const counted = countingEffects([spell, potion]);
    expect(counted.inputs.map((e) => [e.kind, e.origin.label])).toEqual([
      ['rollDie', 'Bless'],
      ['tempHpEachTurn', 'Potion of Heroism'],
      ['cue', 'Potion of Heroism'],
    ]);
    expect(counted.notCounted.map((n) => n.same)).toEqual(['Bless']);
  });

  it('adds effects of different names that do the same thing', () => {
    const counted = countingEffects([shieldOfFaith(), haste()]);
    expect(counted.inputs.filter((e) => e.kind === 'acBonus')).toHaveLength(2);
  });

  it('counts nothing from an effect switched off, and lets the other one count', () => {
    const off = { ...bless(), off: true };
    const on = bless();
    const counted = countingEffects([off, on]);
    expect(counted.inputs.map((e) => e.origin.uid)).toEqual([on.id]);
    expect(counted.notCounted).toEqual([]);
  });

  it('stores no `same` on what it hands to derive', () => {
    const potion = fx('Potion', [{ kind: 'acBonus', amount: 1, same: 'Ward' }]);
    expect(countingEffects([potion]).inputs[0]).not.toHaveProperty('same');
  });

  it('counts one of a name per weapon: two weapons are two targets', () => {
    const magicWeapon = (weapon: string, amount: number) =>
      fx('Magic Weapon', [
        { kind: 'attackBonus', scope: 'all', amount, weapon },
        { kind: 'damageBonus', scope: 'all', amount, weapon },
      ]);
    const sword = magicWeapon('e1', 1);
    const axe = magicWeapon('e2', 1);
    const both = countingEffects([sword, axe]);
    expect(both.inputs.map((e) => e.origin.uid)).toEqual([sword.id, sword.id, axe.id, axe.id]);
    expect(both.notCounted).toEqual([]);
    // On one weapon twice, the stronger casting counts.
    const stronger = magicWeapon('e1', 2);
    const one = countingEffects([sword, stronger]);
    expect(one.inputs.map((e) => e.origin.uid)).toEqual([stronger.id, stronger.id]);
    expect(one.notCounted.map((n) => n.effectId)).toEqual([sword.id]);
  });

  it('says which groups an effect counts in, by name, the name a part is, and weapon', () => {
    const potion = fx('Potion of Heroism', [
      { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] }, same: 'Bless' },
      { kind: 'cue', tone: 'help', text: 'Ten temporary hit points' },
    ]);
    expect(countsAs(potion)).toEqual(new Set(['bless', 'potion of heroism']));
    const onSword = fx('Magic Weapon', [
      { kind: 'attackBonus', scope: 'all', amount: 1, weapon: 'e1' },
    ]);
    expect(countsAs(onSword)).toEqual(new Set(['magic weapon\u0000e1']));
  });
});

describe('deriveSheet with effects in play', () => {
  const base = derive(warrior());

  it('derives exactly as before when nothing is in play, or when told to leave effects out', () => {
    const doc = withEffects(warrior(), shieldOfFaith(), bless(), aid(5));
    expect(deriveSheet(doc, ctx, { active: false })).toEqual(base);
    expect(derive(withEffects(warrior()))).toEqual(base);
  });

  it('adds Shield of Faith to Armor Class under its own name', () => {
    const sheet = derive(withEffects(warrior(), shieldOfFaith()));
    expect(sheet.ac.value).toBe(base.ac.value + 2);
    expect(sheet.ac.parts).toContainEqual({ label: 'Shield of Faith', amount: 2 });
  });

  it('adds a buff on top of a hand-set Armor Class, max HP, speed and initiative', () => {
    const doc = warrior();
    doc.overrides = {
      ac: { value: 15 },
      maxHp: { value: 30 },
      'speed.walk': { value: 25 },
      initiative: { value: 1 },
    };
    const sheet = derive(
      withEffects(
        doc,
        shieldOfFaith(),
        aid(5),
        fx('Longstrider', [{ kind: 'speedBonus', amount: 10 }]),
        fx('Gift of Alacrity', [{ kind: 'initiativeBonus', amount: 3 }]),
      ),
    );
    expect([sheet.ac, sheet.maxHp, sheet.speedWalk, sheet.initiative].map((v) => v.value)).toEqual([
      17, 35, 35, 4,
    ]);
    expect(sheet.ac.overridden).toBe(true);
  });

  it('counts Mage Armor when it beats the build, and says why when it does not', () => {
    const mage = fx('Mage Armor', [
      { kind: 'acFormula', label: 'Mage Armor', base: 13, addAbilities: ['dex'] },
    ]);
    const wins = derive(withEffects(warrior(), mage));
    expect(wins.ac.value).toBe(16);
    expect(wins.acFormulaLabel).toBe('Mage Armor');
    expect(wins.acNotCounted).toEqual([]);

    const tough = warrior();
    tough.customEffects = [
      {
        kind: 'acFormula',
        label: 'Natural Armor',
        base: 17,
        addAbilities: [],
        origin: { type: 'custom', label: 'Natural Armor', uid: 'n' },
      },
    ];
    const loses = derive(withEffects(tough, mage));
    expect(loses.ac.value).toBe(17);
    expect(loses.acNotCounted).toEqual([{ label: 'Mage Armor', value: 16, why: 'lower' }]);

    const set = warrior();
    set.overrides = { ac: { value: 12 } };
    const aside = derive(withEffects(set, mage));
    expect(aside.ac.value).toBe(12);
    expect(aside.acNotCounted).toEqual([{ label: 'Mage Armor', value: 16, why: 'override' }]);
  });

  it("raises Armor Class to Barkskin's floor after every bonus, and only then", () => {
    const barkskin = fx('Barkskin', [{ kind: 'acMin', min: 16 }]);
    const raised = derive(withEffects(warrior(), barkskin));
    expect(raised.ac.value).toBe(16);
    expect(raised.ac.parts.at(-1)).toEqual({ label: 'Barkskin (minimum)', amount: 3 });

    // 13 + 2 + 2 is 17, over the floor, so the floor adds nothing and says so.
    const over = derive(withEffects(warrior(), barkskin, shieldOfFaith(), haste()));
    expect(over.ac.value).toBe(17);
    expect(over.acNotCounted).toEqual([{ label: 'Barkskin', value: 16, why: 'floor' }]);
  });

  it('holds Barkskin over a hand-set Armor Class, and a build floor under it', () => {
    const set = warrior();
    set.overrides = { ac: { value: 15 } };
    const barkskin = fx('Barkskin', [{ kind: 'acMin', min: 16 }]);
    const sheet = derive(withEffects(set, barkskin));
    expect(sheet.ac.value).toBe(16);
    // The breakdown calls `base` computed, right under the parts.
    expect(sheet.ac.base).toBe(sheet.ac.parts.reduce((n, p) => n + p.amount, 0));

    // A floor from the build is part of what the override corrects.
    set.customEffects = [
      { kind: 'acMin', min: 18, origin: { type: 'custom', label: 'Stone Body', uid: 's' } },
    ];
    const built = derive(set);
    expect(built.ac.value).toBe(15);
    expect(built.ac.base).toBe(18);
    expect(built.acNotCounted).toEqual([]);
  });

  it('adds Longstrider to walking speed and leaves doubling and other speeds for later', () => {
    const sheet = derive(
      withEffects(
        warrior(),
        fx('Longstrider', [{ kind: 'speedBonus', amount: 10 }]),
        haste(),
        fx('Fly', [{ kind: 'moveSpeed', mode: 'fly', speed: 60 }]),
        fx('Spider Climb', [{ kind: 'moveSpeed', mode: 'climb', speed: 'walk' }]),
      ),
    );
    expect(sheet.speedWalk.value).toBe(base.speedWalk.value + 10);
    expect(sheet.speedMultiplier).toEqual({ factor: 2, sources: ['Haste'] });
    expect(sheet.otherSpeeds).toEqual([
      { mode: 'fly', value: 60, origin: 'Fly' },
      { mode: 'climb', value: base.speedWalk.value + 10, origin: 'Spider Climb' },
    ]);
    expect(base.speedMultiplier).toEqual({ factor: 1, sources: [] });
  });

  it('counts Haste once beside a Potion of Speed', () => {
    const sheet = derive(withEffects(warrior(), haste(), haste('Potion of Speed', 'Haste')));
    expect(sheet.ac.value).toBe(base.ac.value + 2);
    expect(sheet.extraActions).toHaveLength(1);
    expect(sheet.effectsNotCounted.map((n) => n.effectName)).toEqual(['Potion of Speed']);
  });

  it("raises the hit point maximum by Aid's amount", () => {
    expect(derive(withEffects(warrior(), aid(5))).maxHp.value).toBe(base.maxHp.value + 5);
  });

  it('lowers the maximum and speed for a drain or a slow, never under the floors', () => {
    const sheet = derive(
      withEffects(
        warrior(),
        fx('Life Drain', [{ kind: 'maxHpBonus', amount: -400 }]),
        fx('Ray of Frost', [{ kind: 'speedBonus', amount: -400 }]),
      ),
    );
    expect(sheet.maxHp.value).toBe(1);
    expect(sheet.speedWalk.value).toBe(0);
    for (const v of [sheet.maxHp, sheet.speedWalk]) {
      expect(v.base).toBe(v.parts.reduce((n, p) => n + p.amount, 0));
    }
  });

  it('adds an aura to every save, and a narrower bonus to its abilities only', () => {
    const sheet = derive(
      withEffects(
        warrior(),
        fx('Aura of Protection', [{ kind: 'saveBonus', amount: 3 }]),
        fx('Rage', [{ kind: 'saveBonus', amount: 1, abilities: ['str'] }]),
      ),
    );
    expect(sheet.saves.str.total.value).toBe(base.saves.str.total.value + 4);
    expect(sheet.saves.wis.total.value).toBe(base.saves.wis.total.value + 3);
  });

  it("adds Rage's damage to Strength attacks only", () => {
    const sheet = derive(
      withEffects(
        warrior(),
        fx('Rage', [{ kind: 'damageBonus', scope: 'melee', amount: 2, ability: 'str' }]),
      ),
    );
    expect(row(base, 'Longsword').damage).toBe('1d8+3');
    expect(row(sheet, 'Longsword').damage).toBe('1d8+5');
    expect(row(sheet, 'Shortbow').damage).toBe(row(base, 'Shortbow').damage);
    // The row names what added to its damage, for the sheet to say.
    expect(row(sheet, 'Longsword').damageFrom).toEqual(['Rage']);
    expect(row(base, 'Longsword')).not.toHaveProperty('damageFrom');
    expect(row(sheet, 'Shortbow')).not.toHaveProperty('damageFrom');
  });

  it('adds a weapon bonus to weapons, never to spell attacks, and a spell bonus the other way', () => {
    const doc = warrior();
    doc.classes = [{ ref: { name: 'Mage', source: 'TST' }, levels: 1, hp: ['avg'] }];
    const plain = derive(doc);
    const sheet = derive(
      withEffects(
        doc,
        fx('Magic Weapon', [{ kind: 'attackBonus', scope: 'all', amount: 1 }]),
        fx('Spell Focus', [{ kind: 'attackBonus', scope: 'all', amount: 2, attack: 'spell' }]),
        fx('Melee Spell Focus', [
          { kind: 'attackBonus', scope: 'melee', amount: 5, attack: 'spell' },
        ]),
      ),
    );
    expect(row(sheet, 'Longsword').toHit.value).toBe(row(plain, 'Longsword').toHit.value + 1);
    const block = (s: typeof sheet) => s.spellcasting[0]?.attackMod.value ?? Number.NaN;
    expect(block(sheet)).toBe(block(plain) + 2);
  });

  it('adds a spell save DC bonus to the class it names only', () => {
    const doc = warrior();
    doc.classes = [
      { ref: { name: 'Mage', source: 'TST' }, levels: 1, hp: ['avg'] },
      { ref: { name: 'Sorcerer', source: 'TST' }, levels: 1, hp: ['avg'] },
    ];
    const plain = derive(doc);
    const sheet = derive(
      withEffects(
        doc,
        fx('Innate Sorcery', [{ kind: 'spellDcBonus', amount: 1, className: 'Sorcerer' }]),
      ),
    );
    const dc = (s: typeof sheet, name: string) =>
      s.spellcasting.find((b) => b.className === name)?.saveDc.value;
    expect(dc(sheet, 'Sorcerer')).toBe((dc(plain, 'Sorcerer') ?? 0) + 1);
    expect(dc(sheet, 'Mage')).toBe(dc(plain, 'Mage'));
  });

  it('adds a spell save DC bonus that names a subclass caster', () => {
    const doc = warrior();
    doc.classes = [
      {
        ref: { name: 'Warrior', source: 'TST' },
        subclass: { name: 'Spell Knight', source: 'TST' },
        levels: 3,
        hp: ['avg', 'avg', 'avg'],
      },
    ];
    const plain = derive(doc);
    const dc = (s: typeof plain) => s.spellcasting[0]?.saveDc.value ?? Number.NaN;
    for (const className of ['Spell Knight', 'Warrior', ' spell knight ']) {
      const sheet = derive(
        withEffects(doc, fx('Focus', [{ kind: 'spellDcBonus', amount: 1, className }])),
      );
      expect(dc(sheet)).toBe(dc(plain) + 1);
    }
  });

  it('rolls an extra damage die on every weapon hit it reaches, named', () => {
    const sheet = derive(
      withEffects(
        warrior(),
        fx('Elemental Weapon', [
          { kind: 'damageDie', scope: 'melee', dice: '1d4', damageType: 'fire' },
        ]),
        fx('Enlarge', [{ kind: 'damageDie', scope: 'all', dice: '1d4' }]),
      ),
    );
    expect(row(sheet, 'Longsword').extraDamage).toEqual([
      { dice: '1d4', damageType: 'fire', label: 'Elemental Weapon' },
      { dice: '1d4', label: 'Enlarge' },
    ]);
    expect(row(sheet, 'Shortbow').extraDamage).toEqual([{ dice: '1d4', label: 'Enlarge' }]);
  });

  it('lists defenses, rolls, actions and lines each under its effect', () => {
    const blessing = bless();
    const sheet = derive(
      withEffects(
        warrior(),
        blessing,
        fx('Warding Bond', [
          { kind: 'resist', damageType: 'all' },
          { kind: 'cue', tone: 'info', text: 'The caster takes the same damage you do' },
        ]),
        fx('Stoneskin', [{ kind: 'resist', damageType: 'slashing', note: 'nonmagical' }]),
        fx("Heroes' Feast", [
          { kind: 'immune', damageType: 'poison' },
          { kind: 'conditionImmune', condition: 'frightened' },
        ]),
        fx('Curse', [{ kind: 'vulnerable', damageType: 'piercing' }]),
        fx('Guidance', [{ kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] }, once: true }]),
        fx('Reckless Attack', [
          {
            kind: 'rollAdvantage',
            mode: 'adv',
            on: { rolls: ['attack'], attack: 'weapon', range: 'melee', abilities: ['str'] },
          },
        ]),
        fx('Heroism', [{ kind: 'tempHpEachTurn', amount: 3 }]),
        fx('Inspiring Song', [{ kind: 'tempHpEachTurn', amount: 5 }]),
        fx("Hexblade's Curse", [{ kind: 'critRange', min: 19 }]),
        haste(),
      ),
    );
    expect(sheet.resists).toEqual([
      { damageType: 'all', origin: 'Warding Bond' },
      { damageType: 'slashing', origin: 'Stoneskin', note: 'nonmagical' },
    ]);
    expect(sheet.immunities).toEqual([{ damageType: 'poison', origin: "Heroes' Feast" }]);
    expect(sheet.vulnerabilities).toEqual([{ damageType: 'piercing', origin: 'Curse' }]);
    expect(sheet.conditionImmunities).toEqual([
      { condition: 'frightened', origin: "Heroes' Feast" },
    ]);
    expect(sheet.rollRiders).toEqual([
      { kind: 'die', dice: '1d4', on: ATTACKS_AND_SAVES, origin: 'Bless', effectId: blessing.id },
      expect.objectContaining({ kind: 'offer', dice: '1d4', once: true, origin: 'Guidance' }),
      expect.objectContaining({ kind: 'advantage', mode: 'adv', origin: 'Reckless Attack' }),
    ]);
    expect(sheet.tempHpEachTurn).toEqual({ amount: 5, origin: 'Inspiring Song' });
    expect(sheet.critRange).toEqual({ min: 19, origin: "Hexblade's Curse" });
    expect(sheet.extraActions).toEqual([
      {
        label: 'Haste action',
        note: 'Attack once, Dash, Disengage, Hide or Use an Object',
        origin: 'Haste',
      },
    ]);
    expect(sheet.cues).toEqual([
      { tone: 'info', text: 'The caster takes the same damage you do', origin: 'Warding Bond' },
    ]);
  });

  it('counts nothing from an effect switched off', () => {
    const sheet = derive(withEffects(warrior(), { ...shieldOfFaith(), off: true }));
    expect(sheet).toEqual(base);
  });

  it('holds a Potion of Giant Strength over a hand-set Strength', () => {
    const doc = warrior();
    doc.overrides = { 'ability.str': { value: 17 } };
    const potion = fx('Potion of Hill Giant Strength', [
      { kind: 'abilityMin', ability: 'str', min: 21 },
    ]);
    const sheet = derive(withEffects(doc, potion));
    expect(sheet.abilities.str.value).toBe(21);
    expect(sheet.abilities.str.mod).toBe(5);
    const str = sheet.abilities.str;
    expect(str.base).toBe(str.parts.reduce((n, p) => n + p.amount, 0));
    expect(derive(withEffects(warrior(), potion)).abilities.str.value).toBe(21);
  });

  it('adds a check bonus over a hand-set skill total', () => {
    const doc = warrior();
    doc.overrides = { 'skill.Athletics.bonus': { value: 4 } };
    const sheet = derive(
      withEffects(
        doc,
        fx('Giant Grip', [{ kind: 'checkBonus', amount: 2, skills: ['Athletics'] }]),
      ),
    );
    expect(sheet.skills.Athletics?.total.value).toBe(6);
  });

  it('adds a bonus to every check to each skill, each plain check and initiative, once', () => {
    const before = derive(warrior());
    const sheet = derive(
      withEffects(
        warrior(),
        fx('Ember blessing', [{ kind: 'checkBonus', amount: 2, every: true }]),
      ),
    );
    expect(sheet.skills.Athletics?.total.value).toBe(
      (before.skills.Athletics?.total.value ?? 0) + 2,
    );
    expect(sheet.skills.Arcana?.total.value).toBe((before.skills.Arcana?.total.value ?? 0) + 2);
    expect(sheet.checks.wis.total.value).toBe(before.checks.wis.total.value + 2);
    expect(sheet.initiative.value).toBe(before.initiative.value + 2);
  });

  it('reads a bonus to every check only when it names nothing else', () => {
    const read = (part: unknown) =>
      readActiveEffects([{ id: 'a', name: 'A', parts: [part] }]).effects[0]?.parts;
    expect(read({ kind: 'checkBonus', amount: 1, every: true })).toEqual([
      { kind: 'checkBonus', amount: 1, every: true },
    ]);
    expect(read({ kind: 'checkBonus', amount: 1, every: true, ability: 'str' })).toEqual([]);
    expect(read({ kind: 'checkBonus', amount: 1, every: false })).toEqual([]);
  });

  it('reads a speed bonus that holds only out of armor, and no other condition', () => {
    const read = (part: unknown) =>
      readActiveEffects([{ id: 'a', name: 'A', parts: [part] }]).effects[0]?.parts;
    const out = { kind: 'speedBonus', amount: 10, unless: 'armorOrShield' };
    expect(read(out)).toEqual([out]);
    expect(read({ kind: 'speedBonus', amount: 10, unless: 'raining' })).toEqual([]);
  });

  it('says on Build what it could not read, and leaves the document alone', () => {
    const doc = warrior();
    const stored = [{ id: 'z', name: 'Future Buff', parts: [{ kind: 'timeStop' }] }];
    doc.play.activeEffects = stored as unknown as ActiveEffect[];
    const before = structuredClone(doc);
    const sheet = derive(doc);
    expect(sheet.warnings).toContain(
      'Future Buff: one part of it this version of the app cannot read, so that part does not count.',
    );
    expect(doc).toEqual(before);
  });
});
