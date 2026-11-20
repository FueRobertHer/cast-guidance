/**
 * What armor's data says it costs its wearer (ADR-002 D7): 10 feet of speed
 * under its Strength requirement, and disadvantage on Stealth checks, unless
 * an `armorPenaltyLift` spares them (Medium Armor Master, Arcane Armor, a 2014
 * dwarf). The fixture's Chain Mail asks for Strength 13; the rest is invented.
 */
import { describe, expect, it } from 'vitest';
import curatedRules from '@/rules/cast-guidance/curated.json';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { readRuleSet } from '../effects/mechanics';
import { type DataEntity, type DerivedSheet, type EngineContext, newCharacterDoc } from '../types';

const LOUD_SCALE: DataEntity = {
  name: 'Loud Scale',
  source: 'HB',
  type: 'MA',
  ac: 14,
  stealth: true,
};
const LOUD_PLATE: DataEntity = {
  name: 'Loud Plate',
  source: 'HB',
  type: 'HA',
  ac: 18,
  stealth: true,
};
const SHIRT: DataEntity = { name: 'Light Shirt', source: 'HB', type: 'MA', ac: 13, strength: null };
const lifting = (name: string, effect: Record<string, unknown>): DataEntity => ({
  name,
  source: 'HB',
  entries: ['Armor sits easy on you.'],
  castGuidance: { v: 1, effects: [effect] },
});
/** The 2014 feat, under its own name and book, so its built-in row reaches it. */
const MEDIUM_ARMOR_MASTER: DataEntity = {
  name: 'Medium Armor Master',
  source: 'PHB',
  entries: ["Wearing medium armor doesn't impose disadvantage on your Dexterity (Stealth) checks."],
};

/** A race whose Speed trait says what the 2014 dwarf's does, and a limit the prose scan reads. */
const speedy = (name: string, source: string, walk: number): DataEntity => ({
  name,
  source,
  speed: walk,
  entries: [
    {
      type: 'entries',
      name: 'Speed',
      entries: [
        `Your base walking speed is ${walk} feet. Your speed is not reduced by wearing heavy armor. Once you use this trait, you can't use it again until you finish a long rest.`,
      ],
    },
  ],
});
const RACES = [
  speedy('Dwarf', 'PHB', 25),
  speedy('Dwarf (Kaladesh)', 'PSK', 25),
  speedy('Dwarf', 'HB', 25),
  speedy('Human', 'PHB', 30),
];

/** A Warrior subclass named as the Armorer is, whose Arcane Armor the built-in row reaches. */
const ARMORER: DataEntity = {
  name: 'Armorer',
  shortName: 'Armorer',
  source: 'HB',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: ['Arcane Armor|Warrior|TST|Armorer|HB|1'],
};
const ARCANE_ARMOR: DataEntity = {
  name: 'Arcane Armor',
  source: 'HB',
  className: 'Warrior',
  classSource: 'TST',
  subclassShortName: 'Armorer',
  subclassSource: 'HB',
  level: 1,
  entries: [
    'If the armor normally has a Strength requirement, the arcane armor lacks this requirement for you.',
  ],
};

function sheet(
  strength: number,
  armor: string[],
  feats: DataEntity[] = [],
  race?: { name: string; source: string },
  armorer = false,
): DerivedSheet {
  const base = makeTestContext();
  const items = [LOUD_SCALE, LOUD_PLATE, SHIRT];
  const ctx: EngineContext = {
    byType: (t) =>
      t === 'item'
        ? [...base.byType(t), ...items]
        : t === 'feat'
          ? [...base.byType(t), ...feats]
          : t === 'subclass'
            ? [...base.byType(t), ARMORER]
            : t === 'subclassFeature'
              ? [...base.byType(t), ARCANE_ARMOR]
              : base.byType(t),
    get: (t, n, s) =>
      (t === 'item' ? items.find((i) => i.name === n) : undefined) ??
      (t === 'feat' ? feats.find((f) => f.name === n) : undefined) ??
      (t === 'race' ? RACES.find((r) => r.name === n && r.source === s) : undefined) ??
      (t === 'subclass' && n === 'Armorer' ? ARMORER : undefined) ??
      base.get(t, n, s),
  };
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  doc.abilities = {
    method: 'manual',
    base: { str: strength, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  } as typeof doc.abilities;
  doc.classes = [
    {
      ref: { name: 'Warrior', source: 'TST' },
      ...(armorer ? { subclass: { name: 'Armorer', source: 'HB' } } : {}),
      levels: 1,
      hp: ['avg'],
    },
  ];
  if (race !== undefined) doc.race = race;
  doc.equipment = armor.map((name, i) => ({
    id: `a${i}`,
    ref: { name, source: name === 'Chain Mail' ? 'TST' : 'HB' },
    qty: 1,
    equipped: true,
    attuned: false,
  })) as typeof doc.equipment;
  doc.feats = feats.map((f, i) => ({
    ref: { name: String(f.name), source: String(f.source) },
    instanceId: `f${i}`,
  }));
  return deriveSheet(doc, ctx);
}

const stealthDis = (s: DerivedSheet) =>
  s.rollRiders.filter(
    (r) => r.kind === 'advantage' && r.mode === 'dis' && r.on.skills?.includes('Stealth') === true,
  ).length;

describe("armor's Strength requirement", () => {
  it('costs 10 feet under it, and none at it or out of the armor', () => {
    const short = sheet(12, ['Chain Mail']).speedWalk;
    expect(short.value).toBe(20);
    expect(short.parts).toContainEqual({ label: 'Chain Mail (Strength 13)', amount: -10 });
    expect(sheet(13, ['Chain Mail']).speedWalk.value).toBe(30);
    expect(sheet(8, []).speedWalk.value).toBe(30);
  });

  it('costs nothing where the data has none (null)', () => {
    expect(sheet(8, ['Light Shirt']).speedWalk.value).toBe(30);
  });

  it('costs nothing with a lift for that weight of armor, or for any', () => {
    const heavy = lifting('Sure Stride', {
      kind: 'armorPenaltyLift',
      penalty: 'strength',
      armor: 'heavy',
    });
    const any = lifting('Easy Wear', { kind: 'armorPenaltyLift', penalty: 'strength' });
    expect(sheet(8, ['Chain Mail'], [heavy]).speedWalk.value).toBe(30);
    expect(sheet(8, ['Chain Mail'], [any]).speedWalk.value).toBe(30);
  });

  it('still costs its speed with a lift for another weight, or for Stealth alone', () => {
    const medium = lifting('Sure Stride', {
      kind: 'armorPenaltyLift',
      penalty: 'strength',
      armor: 'medium',
    });
    const quiet = lifting('Soft Step', { kind: 'armorPenaltyLift', penalty: 'stealth' });
    expect(sheet(8, ['Chain Mail'], [medium]).speedWalk.value).toBe(20);
    expect(sheet(8, ['Chain Mail'], [quiet]).speedWalk.value).toBe(20);
  });
});

describe("a 2014 dwarf's Speed trait (its built-in row, by race and book)", () => {
  const scanned = (s: DerivedSheet) => s.resources.find((r) => r.label === 'Speed')?.max;

  it('keeps full speed in chain mail under Strength 13, the Kaladesh dwarf too', () => {
    const dwarf = sheet(12, ['Chain Mail'], [], { name: 'Dwarf', source: 'PHB' });
    expect(dwarf.speedWalk.value).toBe(25);
    expect(dwarf.speedWalk.parts.map((p) => p.label)).not.toContain('Chain Mail (Strength 13)');
    const kaladesh = { name: 'Dwarf (Kaladesh)', source: 'PSK' };
    expect(sheet(12, ['Chain Mail'], [], kaladesh).speedWalk.value).toBe(25);
  });

  it('reaches no other race with a Speed trait: a Dwarf of another book, a Human', () => {
    expect(sheet(12, ['Chain Mail'], [], { name: 'Dwarf', source: 'HB' }).speedWalk.value).toBe(15);
    expect(sheet(12, ['Chain Mail'], [], { name: 'Human', source: 'PHB' }).speedWalk.value).toBe(
      20,
    );
  });

  it("keeps every race's prose scan of the trait, the dwarf's too", () => {
    const uses = RACES.map((race) =>
      scanned(sheet(12, [], [], { name: String(race.name), source: String(race.source) })),
    );
    expect(uses).toEqual([1, 1, 1, 1]);
  });
});

describe("the Armorer's Arcane Armor (its built-in row)", () => {
  it('lifts the Strength requirement, and the Stealth disadvantage stays', () => {
    expect(sheet(8, ['Chain Mail'], [], undefined, true).speedWalk.value).toBe(30);
    expect(stealthDis(sheet(8, ['Loud Plate'], [], undefined, true))).toBe(1);
    expect(sheet(8, ['Chain Mail']).speedWalk.value).toBe(20);
  });
});

describe("armor's Stealth disadvantage", () => {
  it('goes with Medium Armor Master (2014) in medium armor, and stays in heavy', () => {
    expect(stealthDis(sheet(10, ['Loud Scale']))).toBe(1);
    expect(stealthDis(sheet(10, ['Loud Scale'], [MEDIUM_ARMOR_MASTER]))).toBe(0);
    expect(stealthDis(sheet(10, ['Loud Plate'], [MEDIUM_ARMOR_MASTER]))).toBe(1);
  });
});

describe('the built-in armor penalty rows', () => {
  const rows = readRuleSet(curatedRules).rows;
  const effectsOf = (key: string) =>
    rows.find((r) => r.part === 'curated' && r.keys.includes(key))?.effects.map((t) => t.effect);

  it('read as the texts say, beside the prose scan', () => {
    expect(effectsOf('medium armor master|phb')).toEqual([
      { kind: 'armorPenaltyLift', penalty: 'stealth', armor: 'medium' },
    ]);
    expect(effectsOf('arcane armor|armorer')).toEqual([
      { kind: 'armorPenaltyLift', penalty: 'strength' },
    ]);
    for (const key of ['medium armor master|phb', 'arcane armor|armorer']) {
      expect(rows.find((r) => r.keys.includes(key))?.scan, key).toBe('keep');
    }
  });

  it('refuse a penalty or a weight of armor the kind does not know', () => {
    const problems = (effect: Record<string, unknown>) =>
      readRuleSet({
        type: 'ruleSet',
        v: 1,
        name: 'T',
        edition: 'both',
        rows: [{ part: 'curated', keys: ['x|y'], effects: [effect] }],
      }).problems;
    expect(problems({ kind: 'armorPenaltyLift', penalty: 'weight' })).toEqual([
      expect.stringMatching(/"penalty" is one of strength, stealth/),
    ]);
    expect(problems({ kind: 'armorPenaltyLift', penalty: 'strength', armor: 'shield' })).toEqual([
      expect.stringMatching(/"armor" is one of light, medium, heavy/),
    ]);
  });
});
