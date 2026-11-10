import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { Collector } from '../effects/base';
import { weaponKindName, weaponMasteryOptions } from '../effects/readers';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { emitCuratedEffects } from './curatedEffects';

// Invented classes and weapons, shaped like the 2024 ones: a class table with a
// Weapon Mastery column, and one without.
const masteryTable = (counts: number[]) => [
  { colLabels: ['{@variantrule Weapon Mastery|XTS}'], rows: counts.map((n) => [String(n)]) },
];
const classes: DataEntity[] = [
  {
    name: 'Fighter',
    source: 'XTS',
    classTableGroups: masteryTable([3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6]),
  },
  {
    name: 'Barbarian',
    source: 'XTS',
    classTableGroups: masteryTable([2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]),
  },
  { name: 'Rogue', source: 'XTS', classTableGroups: [{ colLabels: ['Sneak Attack'], rows: [] }] },
  // An older printing of the Fighter, with no Weapon Mastery column.
  { name: 'Fighter', source: 'OLD', classTableGroups: [] },
];
const weapon = (name: string, category: string, type: string): DataEntity => ({
  name,
  source: 'XTS',
  type,
  weaponCategory: category,
  dmg1: '1d6',
  dmgType: 'S',
  mastery: ['Nick|XTS'],
});
const weapons = [
  weapon('Knife', 'simple', 'M'),
  { ...weapon('Quickblade', 'martial', 'M'), property: ['F|XTS'] },
  weapon('Warblade', 'martial', 'M'),
  weapon('Warbow', 'martial', 'R'),
];
const ctx: EngineContext = {
  get: (type, name, source) =>
    (type === 'class' ? classes : type === 'baseitem' ? weapons : []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    ),
  byType: (type) => (type === 'baseitem' ? weapons : type === 'class' ? classes : []),
};

function masteryAt(
  className: string,
  levels: number,
  picks?: string[],
  profs: string[] = [],
  opts: { filter?: string; later?: string; before?: CharacterDoc['classes'] } = {},
) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.classes = [
    ...(opts.before ?? []),
    { ref: { name: className, source: 'XTS' }, levels, hp: [] },
  ];
  const origin: EffectOrigin = {
    label: 'Weapon Mastery',
    uid: `${className.toLowerCase()}|xts`,
    type: 'class',
  };
  if (picks !== undefined) doc.choices[`class:${origin.uid}:weapon-mastery`] = picks;
  const col = new Collector(doc, ctx);
  for (const name of profs) col.add({ kind: 'weaponProf', name, origin });
  if (opts.filter !== undefined) col.add({ kind: 'weaponProfFilter', filter: opts.filter, origin });
  emitCuratedEffects(col, `weapon mastery|${className.toLowerCase()}`, origin);
  // A proficiency the build gains after the feature (a feat at a later level).
  if (opts.later !== undefined) col.add({ kind: 'weaponProf', name: opts.later, origin });
  for (const ask of col.afterAll) ask();
  return col;
}
const prompt = (col: Collector) => col.pending.find((p) => p.label === 'Weapon Mastery');

describe('the 2024 Weapon Mastery', () => {
  it("counts the kinds by the class table's column", () => {
    expect([1, 4, 10, 16].map((l) => prompt(masteryAt('Fighter', l))?.count)).toEqual([3, 4, 5, 6]);
    expect([1, 4, 10].map((l) => prompt(masteryAt('Barbarian', l))?.count)).toEqual([2, 3, 4]);
  });

  it('counts two where the table has no column', () => {
    expect(prompt(masteryAt('Rogue', 1, undefined, ['simple weapons']))?.count).toBe(2);
  });

  it('offers a Barbarian melee kinds alone', () => {
    expect(prompt(masteryAt('Barbarian', 1))?.options.map((o) => o.id)).toEqual([
      'Knife',
      'Quickblade',
      'Warblade',
    ]);
  });

  it('offers a Rogue the kinds it is proficient with', () => {
    expect(
      prompt(masteryAt('Rogue', 1, undefined, ['simple weapons']))?.options.map((o) => o.id),
    ).toEqual(['Knife']);
  });

  it("offers the martial kinds a Rogue's filter makes it proficient with", () => {
    const col = masteryAt('Rogue', 1, undefined, ['simple weapons'], {
      filter: 'type=martial weapon|property=light;finesse',
    });
    expect(prompt(col)?.options.map((o) => o.id)).toEqual(['Knife', 'Quickblade']);
  });

  it('offers a kind the build is proficient with only after the feature', () => {
    const col = masteryAt('Rogue', 4, undefined, ['simple weapons'], { later: 'martial weapons' });
    expect(prompt(col)?.options.map((o) => o.id)).toContain('Warblade');
  });

  it("counts by its own class's table when another class shares the name", () => {
    const col = masteryAt('Fighter', 10, undefined, [], {
      before: [{ ref: { name: 'Fighter', source: 'OLD' }, levels: 3, hp: [] }],
    });
    expect(prompt(col)?.count).toBe(5);
  });

  it('masters each kind picked', () => {
    const col = masteryAt('Fighter', 1, ['Warblade', 'Warbow', 'Knife']);
    expect(col.pending).toEqual([]);
    expect(col.effects.flatMap((e) => (e.kind === 'weaponMastery' ? [e.name] : []))).toEqual([
      'Warblade',
      'Warbow',
      'Knife',
    ]);
  });
});

describe('the kinds of weapon a mastery pick offers', () => {
  const kinds: DataEntity[] = [
    weapon('Quarterstaff', 'simple', 'M'),
    // The arcane focus that is wielded as a Quarterstaff.
    { ...weapon('Focus Staff', 'simple', 'M'), scfType: 'arcane' },
  ];
  const items: DataEntity[] = [
    // A magic staff with no base item: a Quarterstaff all the same.
    { ...weapon('Staff of Bonking', 'simple', 'M'), staff: true },
    // A weapon no base item names: a kind of its own.
    weapon('Odd Kukri', 'simple', 'M'),
    // A mastery anyone can use needs no pick.
    { ...weapon('Mind Edge', 'simple', 'M'), mastery: [{ uid: 'Vex|XTS', note: 'Free.' }] },
  ];
  const world: EngineContext = {
    get: () => undefined,
    byType: (type) => (type === 'baseitem' ? kinds : type === 'item' ? items : []),
  };

  it('reads a staff or a focus as a Quarterstaff, and a weapon with no base as its own', () => {
    expect([...kinds, ...items].map(weaponKindName)).toEqual([
      'quarterstaff',
      'quarterstaff',
      'quarterstaff',
      'odd kukri',
      'mind edge',
    ]);
    expect(weaponKindName({ name: 'Bright Blade', baseItem: 'longsword|xphb', staff: true })).toBe(
      'longsword',
    );
  });

  it('offers each kind once, by its own name', () => {
    expect(weaponMasteryOptions(world).map((o) => o.id)).toEqual(['Odd Kukri', 'Quarterstaff']);
  });
});

describe('the Weapon Mastery feature on a derived sheet', () => {
  // A Fighter whose level 1 feature is named as the 2024 one is.
  const fighter: DataEntity = {
    name: 'Fighter',
    source: 'XTS',
    hd: { number: 1, faces: 10 },
    classFeatures: ['Weapon Mastery|Fighter|XTS|1'],
    classTableGroups: masteryTable([3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6]),
    startingProficiencies: { weapons: ['simple', 'martial'] },
  };
  const feature: DataEntity = {
    name: 'Weapon Mastery',
    source: 'XTS',
    className: 'Fighter',
    classSource: 'XTS',
    level: 1,
    entries: ['Your training with weapons lets you use their mastery properties.'],
  };
  const world = makeTestContext();
  const derived: EngineContext = {
    get: (type, name, source) =>
      type === 'class' && name === 'Fighter'
        ? fighter
        : type === 'baseitem'
          ? weapons.find((w) => String(w.name).toLowerCase() === name.toLowerCase())
          : world.get(type, name, source),
    byType: (type) =>
      type === 'classFeature'
        ? [...world.byType(type), feature]
        : type === 'baseitem'
          ? weapons
          : world.byType(type),
  };
  const fighterDoc = () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Fighter', source: 'XTS' }, levels: 1, hp: [] }];
    doc.equipment = [
      {
        id: 'e1',
        ref: { name: 'Warblade', source: 'XTS' },
        qty: 1,
        equipped: true,
        attuned: false,
      },
    ];
    return doc;
  };
  const id = 'class:fighter|xts:weapon-mastery';

  it('asks the pick, and the attack with a kind picked uses its mastery', () => {
    const doc = fighterDoc();
    const before = deriveSheet(doc, derived);
    expect(before.pending.find((p) => p.id === id)?.count).toBe(3);
    expect(before.attacks.find((a) => a.label === 'Warblade')?.properties).toEqual([]);
    doc.choices[id] = ['Warblade', 'Knife', 'Warbow'];
    const after = deriveSheet(doc, derived);
    expect(after.pending.find((p) => p.id === id)).toBeUndefined();
    expect(after.attacks.find((a) => a.label === 'Warblade')?.properties).toEqual([
      'mastery: nick',
    ]);
  });
});
