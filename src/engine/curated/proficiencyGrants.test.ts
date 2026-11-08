/**
 * Class and subclass features that grant armor, weapons, tools or an unarmored
 * AC in prose alone, end to end through `deriveSheet`. The world has the names,
 * sources, levels and ref shapes of the pinned release, placeholder prose, and
 * made-up weapons and backgrounds.
 */
import { describe, expect, it } from 'vitest';
import { deriveSheet } from '../derive';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
} from '../types';

const PROSE = ['Placeholder text.'];

const cls = (name: string, source: string, extra: DataEntity = {}): DataEntity => ({
  name,
  source,
  hd: { number: 1, faces: 8 },
  classFeatures: [],
  ...extra,
});

const classFeature = (
  name: string,
  className: string,
  classSource: string,
  level: number,
  entries: unknown[] = PROSE,
): DataEntity => ({ name, className, classSource, source: classSource, level, entries });

/** A subclass and the features it lists, with the ref strings the release uses. */
function subclassWith(
  name: string,
  shortName: string,
  source: string,
  className: string,
  classSource: string,
  features: Array<[feature: string, level: number]>,
): DataEntity[] {
  return [
    {
      name,
      shortName,
      source,
      className,
      classSource,
      subclassFeatures: features.map(
        ([f, level]) => `${f}|${className}|${classSource}|${shortName}|${source}|${level}`,
      ),
    },
    ...features.map(([f, level]) => ({
      name: f,
      source,
      className,
      classSource,
      subclassShortName: shortName,
      subclassSource: source,
      level,
      entries: PROSE,
    })),
  ];
}

const SUBCLASSES: DataEntity[][] = [
  subclassWith('War Domain', 'War', 'PHB', 'Cleric', 'PHB', [['Bonus Proficiencies', 1]]),
  // Another subclass's feature of the same name grants nothing.
  subclassWith('Light Domain', 'Light', 'PHB', 'Cleric', 'PHB', [['Bonus Proficiencies', 1]]),
  subclassWith('Order Domain', 'Order', 'TCE', 'Cleric', 'PHB', [['Bonus Proficiencies', 1]]),
  subclassWith('Knowledge Domain', 'Knowledge', 'PHB', 'Cleric', 'PHB', [
    ['Blessings of Knowledge', 1],
  ]),
  subclassWith('Knowledge Domain', 'Knowledge', 'FRHoF', 'Cleric', 'XPHB', [
    ['Blessings of Knowledge', 3],
  ]),
  subclassWith('College of Valor', 'Valor', 'XPHB', 'Bard', 'XPHB', [['Martial Training', 3]]),
  subclassWith('College of Lore', 'Lore', 'XPHB', 'Bard', 'XPHB', [['Martial Training', 3]]),
  subclassWith('College of Swords', 'Swords', 'XGE', 'Bard', 'PHB', [['Bonus Proficiencies', 3]]),
  subclassWith('Battle Smith', 'Battle Smith', 'TCE', 'Artificer', 'TCE', [
    ['Tool Proficiency', 3],
    ['Battle Ready', 3],
  ]),
  subclassWith('Alchemist', 'Alchemist', 'EFA', 'Artificer', 'EFA', [['Tools of the Trade', 3]]),
  subclassWith('Artillerist', 'Artillerist', 'EFA', 'Artificer', 'EFA', [
    ['Tools of the Trade', 3],
  ]),
  subclassWith('Reanimator', 'Reanimator', 'RHW', 'Artificer', 'EFA', [
    ["Reanimator's Skill Set", 3],
  ]),
  subclassWith('Battle Master', 'Battle Master', 'PHB', 'Fighter', 'PHB', [['Student of War', 3]]),
  subclassWith('Mastermind', 'Mastermind', 'XGE', 'Rogue', 'PHB', [['Master of Intrigue', 3]]),
  subclassWith('Way of the Drunken Master', 'Drunken Master', 'XGE', 'Monk', 'PHB', [
    ['Bonus Proficiencies', 3],
  ]),
  subclassWith('Bladesinging', 'Bladesinging', 'TCE', 'Wizard', 'PHB', [
    ['Training in War and Song (Bladesinging)', 2],
  ]),
  subclassWith('Bladesinger', 'Bladesinger', 'FRHoF', 'Wizard', 'XPHB', [
    ['Training in War and Song', 3],
  ]),
  subclassWith('Draconic Bloodline', 'Draconic', 'PHB', 'Sorcerer', 'PHB', [
    ['Draconic Resilience', 1],
  ]),
  subclassWith('Wild Magic', 'Wild', 'PHB', 'Sorcerer', 'PHB', [['Draconic Resilience', 1]]),
  subclassWith('Draconic Sorcery', 'Draconic', 'XPHB', 'Sorcerer', 'XPHB', [
    ['Draconic Resilience', 3],
  ]),
  subclassWith('Oath of the Noble Genies', 'Noble Genies', 'FRHoF', 'Paladin', 'XPHB', [
    ["Genie's Splendor", 3],
  ]),
];

const weapon = (name: string, type: string, category: string, property: string[]) => ({
  name,
  source: 'TEST',
  type,
  weaponCategory: category,
  dmg1: '1d8',
  dmgType: 'S',
  property,
});

const WORLD: Record<string, DataEntity[]> = {
  class: [
    cls('Cleric', 'PHB', { startingProficiencies: { armor: ['light'], weapons: ['simple'] } }),
    cls('Cleric', 'XPHB', {
      classFeatures: ['Divine Order|Cleric|XPHB|1'],
      startingProficiencies: { armor: ['light'], weapons: ['simple'] },
    }),
    cls('Bard', 'PHB', { startingProficiencies: { armor: ['light'], weapons: ['simple'] } }),
    cls('Bard', 'XPHB', { startingProficiencies: { armor: ['light'], weapons: ['simple'] } }),
    cls('Artificer', 'TCE', {
      startingProficiencies: { tools: ["thieves' tools", 'one kind of tool of your choice'] },
    }),
    cls('Artificer', 'EFA'),
    cls('Fighter', 'PHB'),
    cls('Rogue', 'PHB'),
    cls('Monk', 'PHB'),
    cls('Wizard', 'PHB', { startingProficiencies: { weapons: ['daggers'] } }),
    cls('Wizard', 'XPHB', { startingProficiencies: { weapons: ['simple'] } }),
    cls('Sorcerer', 'PHB'),
    cls('Sorcerer', 'XPHB'),
    cls('Paladin', 'XPHB'),
    cls('Warrior Sidekick', 'TCE', {
      classFeatures: ['Bonus Proficiencies|Warrior Sidekick|TCE|1'],
    }),
  ],
  classFeature: [
    classFeature('Divine Order', 'Cleric', 'XPHB', 1, [
      {
        type: 'options',
        count: 1,
        entries: [
          { type: 'refClassFeature', classFeature: 'Protector|Cleric|XPHB|1|XPHB' },
          { type: 'refClassFeature', classFeature: 'Thaumaturge|Cleric|XPHB|1|XPHB' },
        ],
      },
    ]),
    classFeature('Protector', 'Cleric', 'XPHB', 1),
    classFeature('Thaumaturge', 'Cleric', 'XPHB', 1),
    classFeature('Bonus Proficiencies', 'Warrior Sidekick', 'TCE', 1),
  ],
  subclass: SUBCLASSES.map(([sub]) => sub as DataEntity),
  subclassFeature: SUBCLASSES.flatMap(([, ...features]) => features),
  baseitem: [
    weapon('Longsword', 'M', 'martial', ['V']),
    weapon('Scimitar', 'M', 'martial', ['F', 'L']),
    weapon('Greatsword', 'M', 'martial', ['H', '2H']),
    weapon('Longbow', 'R', 'martial', ['A', 'H', '2H']),
    weapon('Dagger', 'M', 'simple', ['F', 'L', 'T']),
    // Two-Handed without Heavy, and Heavy without Two-Handed.
    weapon('Double Blade', 'M', 'martial', ['2H']),
    weapon('Heavy Pick', 'M', 'martial', ['H']),
  ],
  background: [
    { name: 'Smith', source: 'TEST', toolProficiencies: [{ "smith's tools": true }] },
    { name: 'Chemist', source: 'TEST', toolProficiencies: [{ "alchemist's supplies": true }] },
    {
      name: 'Spy',
      source: 'TEST',
      toolProficiencies: [{ choose: { from: ['disguise kit', 'forgery kit'] } }],
    },
    {
      name: 'Apothecary',
      source: 'TEST',
      toolProficiencies: [{ "alchemist's supplies": true, 'herbalism kit': true }],
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
  byType: (type) => WORLD[type] ?? [],
};

/** STR 10, DEX 14, CON 12, INT 10, WIS 10, CHA 16, holding every weapon in the world. */
function build(
  ref: EntityRef,
  levels: number,
  opts: { subclass?: EntityRef; background?: string; choices?: CharacterDoc['choices'] } = {},
): CharacterDoc {
  const doc = newCharacterDoc('p', 'Proficiencies', 't');
  doc.abilities = {
    method: 'manual',
    base: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 16 },
  };
  doc.classes = [{ ref, subclass: opts.subclass, levels, hp: Array<'avg'>(levels).fill('avg') }];
  if (opts.background !== undefined) doc.background = { name: opts.background, source: 'TEST' };
  doc.choices = { ...opts.choices };
  doc.equipment = (WORLD.baseitem ?? []).map((w, i) => ({
    id: `w${i}`,
    ref: { name: String(w.name), source: 'TEST' },
    qty: 1,
    equipped: true,
    attuned: false,
  }));
  return doc;
}

const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const toHit = (sheet: DerivedSheet, weaponName: string) =>
  sheet.attacks.find((a) => a.label === weaponName)?.toHit.value;
const prompt = (sheet: DerivedSheet, id: string) => sheet.pending.find((p) => p.id === id);

const CLERIC = { name: 'Cleric', source: 'PHB' };
const CLERIC_2024 = { name: 'Cleric', source: 'XPHB' };
const BARD_2024 = { name: 'Bard', source: 'XPHB' };
const ARTIFICER = { name: 'Artificer', source: 'TCE' };
const ARTIFICER_2024 = { name: 'Artificer', source: 'EFA' };
const WIZARD = { name: 'Wizard', source: 'PHB' };
const WIZARD_2024 = { name: 'Wizard', source: 'XPHB' };
const SORCERER = { name: 'Sorcerer', source: 'PHB' };

const DIVINE_ORDER = 'class:cleric|xphb:feature:divine order:1';
const SMITH_SWAP = 'subclass:battle smith|tce:tool:tool proficiency';
const ALCHEMIST_SWAP = 'subclass:alchemist|efa:tool:tools of the trade';
const STUDENT_TOOL = 'subclass:battle master|phb:tool:student of war';
const INTRIGUE_TOOL = 'subclass:mastermind|xge:tool:master of intrigue';
const BLESSINGS_TOOL = 'subclass:knowledge domain|frhof:tool:blessings of knowledge';
const BLADESONG_WEAPON = 'subclass:bladesinging|tce:weapon:training in war and song (bladesinging)';

describe('armor and weapons a subclass grants in prose', () => {
  it('puts the War Domain on heavy armor and martial weapons, and its attacks take proficiency', () => {
    const sheet = derive(build(CLERIC, 1, { subclass: { name: 'War Domain', source: 'PHB' } }));
    expect(sheet.armorProfs).toEqual(['light', 'heavy']);
    expect(sheet.weaponProfs).toEqual(['simple', 'martial']);
    expect(toHit(sheet, 'Longsword')).toBe(2);
  });

  it("gives another domain's feature of the same name nothing", () => {
    const sheet = derive(build(CLERIC, 1, { subclass: { name: 'Light Domain', source: 'PHB' } }));
    expect(sheet.armorProfs).toEqual(['light']);
    expect(sheet.weaponProfs).toEqual(['simple']);
    expect(toHit(sheet, 'Longsword')).toBe(0);
  });

  it('keeps the Order Domain skill pick beside its heavy armor', () => {
    const sheet = derive(build(CLERIC, 1, { subclass: { name: 'Order Domain', source: 'TCE' } }));
    expect(sheet.armorProfs).toContain('heavy');
    expect(prompt(sheet, 'subclass:order domain|tce:skill:bonus proficiencies')).toBeDefined();
  });

  it('waits for the 2024 College of Valor at bard 3, and stays out of the College of Lore', () => {
    const valor = { name: 'College of Valor', source: 'XPHB' };
    expect(derive(build(BARD_2024, 2, { subclass: valor })).armorProfs).toEqual(['light']);
    const sheet = derive(build(BARD_2024, 3, { subclass: valor }));
    expect(sheet.armorProfs).toEqual(['light', 'medium', 'shield']);
    expect(sheet.weaponProfs).toEqual(['simple', 'martial']);
    const lore = derive(
      build(BARD_2024, 3, { subclass: { name: 'College of Lore', source: 'XPHB' } }),
    );
    expect(lore.armorProfs).toEqual(['light']);
    expect(lore.weaponProfs).toEqual(['simple']);
  });

  it('names the one weapon the College of Swords grants, and no other', () => {
    const sheet = derive(
      build({ name: 'Bard', source: 'PHB' }, 3, {
        subclass: { name: 'College of Swords', source: 'XGE' },
      }),
    );
    expect(sheet.weaponProfs).toEqual(['simple', 'scimitar']);
    // DEX 14 for a finesse weapon, plus a proficiency bonus of 2.
    expect(toHit(sheet, 'Scimitar')).toBe(4);
    expect(toHit(sheet, 'Longsword')).toBe(0);
  });

  it('gives a warrior sidekick every armor, and nothing that depends on its stat block', () => {
    const sheet = derive(build({ name: 'Warrior Sidekick', source: 'TCE' }, 1));
    expect(sheet.armorProfs).toEqual(['light', 'medium', 'heavy']);
    expect(sheet.weaponProfs).toEqual([]);
  });
});

describe('the 2024 Divine Order', () => {
  it('trains a Protector for heavy armor and martial weapons', () => {
    const sheet = derive(build(CLERIC_2024, 1, { choices: { [DIVINE_ORDER]: ['protector'] } }));
    expect(sheet.armorProfs).toEqual(['light', 'heavy']);
    expect(sheet.weaponProfs).toEqual(['simple', 'martial']);
  });

  it('gives a Thaumaturge, or an order not yet chosen, neither', () => {
    const orders: CharacterDoc['choices'][] = [{ [DIVINE_ORDER]: ['thaumaturge'] }, {}];
    for (const choices of orders) {
      const sheet = derive(build(CLERIC_2024, 1, { choices }));
      expect(sheet.armorProfs).toEqual(['light']);
      expect(sheet.weaponProfs).toEqual(['simple']);
    }
  });
});

describe('tools a subclass grants in prose', () => {
  it("gives the Drunken Master brewer's supplies beside its Performance", () => {
    const sheet = derive(
      build({ name: 'Monk', source: 'PHB' }, 3, {
        subclass: { name: 'Way of the Drunken Master', source: 'XGE' },
      }),
    );
    expect(sheet.toolProfs).toEqual(["Brewer's Supplies"]);
    expect(sheet.skills.Performance?.prof).toBe(1);
  });

  it('gives the Mastermind two kits and a pick of a gaming set', () => {
    const sub = { name: 'Mastermind', source: 'XGE' };
    const open = derive(build({ name: 'Rogue', source: 'PHB' }, 3, { subclass: sub }));
    expect(open.toolProfs).toEqual(['Disguise Kit', 'Forgery Kit']);
    expect(prompt(open, INTRIGUE_TOOL)).toMatchObject({ kind: 'tool', count: 1 });
    expect(prompt(open, INTRIGUE_TOOL)?.options.map((o) => o.id)).toEqual([
      'dice set',
      'dragonchess set',
      'playing card set',
      'three-dragon ante set',
    ]);
    const picked = derive(
      build({ name: 'Rogue', source: 'PHB' }, 3, {
        subclass: sub,
        choices: { [INTRIGUE_TOOL]: ['dice set'] },
      }),
    );
    expect(picked.toolProfs).toEqual(['Disguise Kit', 'Forgery Kit', 'Dice Set']);
  });

  it('lists a kit once when a background pick spells it in lower case', () => {
    const sub = { name: 'Mastermind', source: 'XGE' };
    const rogue = { name: 'Rogue', source: 'PHB' };
    const open = derive(build(rogue, 3, { subclass: sub, background: 'Spy' }));
    const kit = open.pending.find((p) => p.origin.type === 'background' && p.kind === 'tool');
    expect(kit?.options.map((o) => o.id)).toEqual(['disguise kit', 'forgery kit']);
    const picked = derive(
      build(rogue, 3, {
        subclass: sub,
        background: 'Spy',
        choices: { [kit?.id ?? '']: ['disguise kit'] },
      }),
    );
    expect(picked.toolProfs).toEqual(['disguise kit', 'Forgery Kit']);
  });

  it("opens the 2014 Student of War's artisan's tool pick, and no skill pick", () => {
    const sub = { name: 'Battle Master', source: 'PHB' };
    const open = derive(build({ name: 'Fighter', source: 'PHB' }, 3, { subclass: sub }));
    expect(prompt(open, STUDENT_TOOL)?.options.map((o) => o.id)).toContain("smith's tools");
    expect(open.pending.filter((p) => p.kind === 'skill')).toEqual([]);
    const picked = derive(
      build({ name: 'Fighter', source: 'PHB' }, 3, {
        subclass: sub,
        choices: { [STUDENT_TOOL]: ["smith's tools"] },
      }),
    );
    expect(picked.toolProfs).toEqual(["Smith's Tools"]);
  });

  it('asks the FRHoF Knowledge Domain for a tool, and the 2014 printing for none', () => {
    const frhof = derive(
      build(CLERIC_2024, 3, { subclass: { name: 'Knowledge Domain', source: 'FRHoF' } }),
    );
    expect(prompt(frhof, BLESSINGS_TOOL)).toMatchObject({ kind: 'tool', count: 1 });
    const phb = derive(build(CLERIC, 1, { subclass: { name: 'Knowledge Domain', source: 'PHB' } }));
    expect(phb.pending.filter((p) => p.kind === 'tool')).toEqual([]);
  });

  it("keeps the Reanimator's uses, which the scanner read before the row", () => {
    const sheet = derive(
      build(ARTIFICER_2024, 3, { subclass: { name: 'Reanimator', source: 'RHW' } }),
    );
    expect(sheet.toolProfs).toEqual(["Alchemist's Supplies"]);
    expect(sheet.resources.map((r) => r.key)).toContain('reanimator-s-skill-set');
  });
});

describe('a tool the character already has', () => {
  const BATTLE_SMITH = { name: 'Battle Smith', source: 'TCE' };

  it("grants the Battle Smith's tool outright when it is new", () => {
    const sheet = derive(build(ARTIFICER, 3, { subclass: BATTLE_SMITH }));
    expect(sheet.toolProfs).toEqual([
      "thieves' tools",
      'one kind of tool of your choice',
      "Smith's Tools",
    ]);
    expect(prompt(sheet, SMITH_SWAP)).toBeUndefined();
  });

  it('turns a tool from the background into a pick of another, with that tool off', () => {
    const sheet = derive(build(ARTIFICER, 3, { subclass: BATTLE_SMITH, background: 'Smith' }));
    expect(sheet.toolProfs).toEqual([
      "Smith's Tools",
      "thieves' tools",
      'one kind of tool of your choice',
    ]);
    const swap = prompt(sheet, SMITH_SWAP);
    expect(swap).toMatchObject({ kind: 'tool', count: 1, label: "Tool in place of Smith's Tools" });
    expect(swap?.options.find((o) => o.id === "smith's tools")?.disabled).toBeDefined();
    expect(swap?.options.find((o) => o.id === "tinker's tools")?.disabled).toBeUndefined();
    const picked = derive(
      build(ARTIFICER, 3, {
        subclass: BATTLE_SMITH,
        background: 'Smith',
        choices: { [SMITH_SWAP]: ["tinker's tools"] },
      }),
    );
    expect(picked.toolProfs).toContain("Tinker's Tools");
  });

  it('counts each tool already held when the feature grants two', () => {
    const sub = { name: 'Alchemist', source: 'EFA' };
    const both = derive(build(ARTIFICER_2024, 3, { subclass: sub, background: 'Apothecary' }));
    expect(prompt(both, ALCHEMIST_SWAP)).toMatchObject({ count: 2 });
    const neither = derive(build(ARTIFICER_2024, 3, { subclass: sub, background: 'Smith' }));
    expect(neither.toolProfs).toEqual(["Smith's Tools", "Alchemist's Supplies", 'Herbalism Kit']);
    expect(prompt(neither, ALCHEMIST_SWAP)).toBeUndefined();
  });

  it('grants the tool not yet held and swaps only the one that is', () => {
    const sub = { name: 'Alchemist', source: 'EFA' };
    const sheet = derive(build(ARTIFICER_2024, 3, { subclass: sub, background: 'Chemist' }));
    expect(sheet.toolProfs).toEqual(["Alchemist's Supplies", 'Herbalism Kit']);
    expect(prompt(sheet, ALCHEMIST_SWAP)).toMatchObject({
      count: 1,
      label: "Tool in place of Alchemist's Supplies",
    });
  });

  it('waits for the subclass level', () => {
    const sheet = derive(build(ARTIFICER, 2, { subclass: BATTLE_SMITH }));
    expect(sheet.toolProfs).not.toContain("Smith's Tools");
  });
});

describe('weapons no category or name can say', () => {
  it('gives the FRHoF Bladesinger martial melee weapons without Two-Handed or Heavy', () => {
    const sheet = derive(
      build(WIZARD_2024, 3, { subclass: { name: 'Bladesinger', source: 'FRHoF' } }),
    );
    expect(sheet.weaponProfs).toEqual([
      'simple',
      'Melee Martial weapons without Two-Handed or Heavy',
    ]);
    expect(toHit(sheet, 'Longsword')).toBe(2);
    expect(toHit(sheet, 'Scimitar')).toBe(4);
    expect(toHit(sheet, 'Greatsword')).toBe(0);
    expect(toHit(sheet, 'Double Blade')).toBe(0);
    expect(toHit(sheet, 'Heavy Pick')).toBe(0);
    expect(toHit(sheet, 'Longbow')).toBe(2); // DEX 14, no proficiency
  });

  it("gives the EFA Artillerist martial ranged weapons and woodcarver's tools", () => {
    const sheet = derive(
      build(ARTIFICER_2024, 3, { subclass: { name: 'Artillerist', source: 'EFA' } }),
    );
    expect(sheet.weaponProfs).toEqual(['Martial Ranged weapons']);
    expect(sheet.toolProfs).toEqual(["Woodcarver's Tools"]);
    expect(toHit(sheet, 'Longbow')).toBe(4);
    expect(toHit(sheet, 'Longsword')).toBe(0);
  });
});

describe('the TCE Bladesinging weapon pick', () => {
  const sub = { name: 'Bladesinging', source: 'TCE' };

  it('offers one-handed melee weapons only, beside light armor and Performance', () => {
    const sheet = derive(build(WIZARD, 2, { subclass: sub }));
    expect(prompt(sheet, BLADESONG_WEAPON)?.options.map((o) => o.id)).toEqual([
      'Dagger',
      'Heavy Pick',
      'Longsword',
      'Scimitar',
    ]);
    expect(sheet.armorProfs).toEqual(['light']);
    expect(sheet.skills.Performance?.prof).toBe(1);
  });

  it('makes the weapon picked proficient', () => {
    const sheet = derive(
      build(WIZARD, 2, { subclass: sub, choices: { [BLADESONG_WEAPON]: ['Longsword'] } }),
    );
    expect(sheet.weaponProfs).toEqual(['daggers', 'Longsword']);
    expect(toHit(sheet, 'Longsword')).toBe(2);
  });

  it('waits for wizard 2', () => {
    expect(prompt(derive(build(WIZARD, 1, { subclass: sub })), BLADESONG_WEAPON)).toBeUndefined();
  });
});

describe('unarmored AC in prose', () => {
  it('gives the 2014 Draconic Bloodline 13 + DEX and keeps its hit point per level', () => {
    const sheet = derive(
      build(SORCERER, 1, { subclass: { name: 'Draconic Bloodline', source: 'PHB' } }),
    );
    expect(sheet.ac.value).toBe(15);
    expect(sheet.acFormulaLabel).toBe('Draconic Resilience');
    expect(sheet.maxHp.parts).toContainEqual({ label: 'Draconic Resilience × level', amount: 1 });
  });

  it("gives another subclass's feature of the same name no AC", () => {
    const sheet = derive(build(SORCERER, 1, { subclass: { name: 'Wild Magic', source: 'PHB' } }));
    expect(sheet.ac.value).toBe(12);
    expect(sheet.acFormulaLabel).toBe('Unarmored');
  });

  it('gives the 2024 Draconic Sorcery 10 + DEX + CHA from sorcerer 3', () => {
    const sub = { name: 'Draconic Sorcery', source: 'XPHB' };
    const sorcerer = { name: 'Sorcerer', source: 'XPHB' };
    expect(derive(build(sorcerer, 2, { subclass: sub })).ac.value).toBe(12);
    expect(derive(build(sorcerer, 3, { subclass: sub })).ac.value).toBe(15);
  });

  it("gives Genie's Splendor 10 + DEX + CHA, and keeps its skill pick", () => {
    const sheet = derive(
      build({ name: 'Paladin', source: 'XPHB' }, 3, {
        subclass: { name: 'Oath of the Noble Genies', source: 'FRHoF' },
      }),
    );
    expect(sheet.ac.value).toBe(15);
    expect(sheet.acFormulaLabel).toBe("Genie's Splendor");
    expect(
      prompt(sheet, "subclass:oath of the noble genies|frhof:skill:genie's splendor"),
    ).toBeDefined();
  });
});
