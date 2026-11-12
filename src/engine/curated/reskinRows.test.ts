/**
 * Classes that reskin another (the World of Warcraft Warrior is a Fighter, its
 * Shaman a Barbarian) and the rows for what those classes add, end to end through
 * `deriveSheet`. The world has the names, levels, ref strings and `reskinOf` of the
 * pinned release (v2.41.0, after its copies resolve), and placeholder prose.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
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

const ref = (subclassFeature: string) => ({ type: 'refSubclassFeature', subclassFeature });

const classFeature = (
  name: string,
  className: string,
  classSource: string,
  level: number,
  entries: unknown[] = PROSE,
): DataEntity => ({ name, source: classSource, className, classSource, level, entries });

/** A subclass feature, printed in the subclass's own source. */
const subFeature = (
  name: string,
  [className, classSource, shortName, source]: readonly [string, string, string, string],
  level: number,
  entries: unknown[] = PROSE,
): DataEntity => ({
  name,
  source,
  className,
  classSource,
  subclassShortName: shortName,
  subclassSource: source,
  level,
  entries,
});

const featureRef = (
  name: string,
  [className, classSource, shortName, source]: readonly [string, string, string, string],
  level: number,
) => `${name}|${className}|${classSource}|${shortName}|${source}|${level}`;

const gain = (classFeature: string) => ({ classFeature, gainSubclassFeature: true });

const FIGHTER_FEATURES = [
  'Second Wind|Fighter|XPHB|1',
  'Action Surge|Fighter|XPHB|2',
  'Tactical Mind|Fighter|XPHB|2',
  gain('Fighter Subclass|Fighter|XPHB|3'),
];

// Where each subclass's features live: [class, class source, short name, printing].
const BATTLE_MASTER = ['Fighter', 'XPHB', 'Battle Master', 'XPHB'] as const;
const CHAMPION = ['Fighter', 'XPHB', 'Champion', 'XPHB'] as const;
const EBON_BLADE = ['Death Knight', 'WoW', 'Ebon Blade', 'WoW'] as const;
const DEMON_HUNTER = ['Demon Hunter', 'WoW', 'Demon Hunter', 'WoW'] as const;
const MYSTIC_BREWS = ['Monk', 'XPHB', 'Mystic Brews', 'WoW'] as const;
const DISCIPLINE = ['Cleric', 'XPHB', 'Discipline', 'WoW'] as const;

/** A WoW subclass: its card under the class that offers it, its features where they live. */
const subclass = (
  name: string,
  className: string,
  classSource: string,
  at: readonly [string, string, string, string],
  features: Array<[string, number]>,
  extra: DataEntity = {},
): DataEntity => ({
  name,
  shortName: at[2],
  source: 'WoW',
  className,
  classSource,
  subclassFeatures: features.map(([feature, level]) => featureRef(feature, at, level)),
  ...extra,
});

const WORLD: Record<string, DataEntity[]> = {
  class: [
    {
      name: 'Fighter',
      source: 'XPHB',
      hd: { number: 1, faces: 10 },
      classFeatures: FIGHTER_FEATURES,
    },
    {
      name: 'Warrior',
      source: 'WoW',
      reskinOf: ['Fighter|XPHB'],
      hd: { number: 1, faces: 10 },
      classFeatures: FIGHTER_FEATURES,
    },
    {
      name: 'Barbarian',
      source: 'XPHB',
      hd: { number: 1, faces: 12 },
      classFeatures: ['Rage|Barbarian|XPHB|1', 'Unarmored Defense|Barbarian|XPHB|1'],
    },
    {
      name: 'Shaman',
      source: 'WoW',
      reskinOf: ['Barbarian|XPHB'],
      hd: { number: 1, faces: 12 },
      classFeatures: [
        'Rage|Barbarian|XPHB|1',
        'Unarmored Defense|Barbarian|XPHB|1',
        gain('Shaman Subclass|Shaman|WoW|3'),
        'Totems|Shaman|WoW|3',
      ],
    },
    {
      name: 'Death Knight',
      source: 'WoW',
      reskinOf: ['Paladin|XPHB'],
      hd: { number: 1, faces: 10 },
      spellcastingAbility: 'cha',
      casterProgression: 'artificer',
      classFeatures: [
        'Death Coil|Death Knight|WoW|1',
        'Channel Divinity|Paladin|XPHB|3',
        gain('Death Knight Subclass|Death Knight|WoW|3'),
      ],
    },
    { name: 'Ranger', source: 'XPHB', hd: { number: 1, faces: 10 }, classFeatures: [] },
    {
      name: 'Demon Hunter',
      source: 'WoW',
      reskinOf: ['Ranger|XPHB'],
      hd: { number: 1, faces: 10 },
      classFeatures: [gain('Demon Hunter Subclass|Demon Hunter|WoW|3')],
    },
    {
      name: 'Monk',
      source: 'XPHB',
      hd: { number: 1, faces: 8 },
      startingProficiencies: {
        skills: [
          {
            choose: {
              from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
              count: 2,
            },
          },
        ],
      },
      classFeatures: ["Monk's Focus|Monk|XPHB|2", gain('Monk Subclass|Monk|XPHB|3')],
    },
    {
      name: 'Priest',
      source: 'WoW',
      reskinOf: ['Cleric|XPHB'],
      hd: { number: 1, faces: 8 },
      classFeatures: ['Channel Divinity|Cleric|XPHB|2', gain('Cleric Subclass|Cleric|XPHB|3')],
    },
  ],
  classFeature: [
    classFeature('Fighter Subclass', 'Fighter', 'XPHB', 3),
    classFeature('Second Wind', 'Fighter', 'XPHB', 1),
    classFeature('Action Surge', 'Fighter', 'XPHB', 2),
    classFeature('Tactical Mind', 'Fighter', 'XPHB', 2),
    classFeature('Rage', 'Barbarian', 'XPHB', 1),
    classFeature('Unarmored Defense', 'Barbarian', 'XPHB', 1),
    classFeature('Shaman Subclass', 'Shaman', 'WoW', 3),
    // The four totems, as in the release, with the one limit that is only the
    // Primal Knowledge Totem's in a sentence the scanner reads as the feature's.
    classFeature('Totems', 'Shaman', 'WoW', 3, [
      ...['Earthbind Totem', 'Primal Knowledge Totem', 'Tremor Totem', 'Wind Rush Totem'].map(
        (name) => ({ type: 'entries', name, entries: PROSE }),
      ),
      'Once you use this feature, you can’t use it again until you finish a Long Rest.',
    ]),
    classFeature('Death Coil', 'Death Knight', 'WoW', 1),
    classFeature('Channel Divinity', 'Paladin', 'XPHB', 3),
    classFeature('Death Knight Subclass', 'Death Knight', 'WoW', 3),
    classFeature('Demon Hunter Subclass', 'Demon Hunter', 'WoW', 3),
    classFeature("Monk's Focus", 'Monk', 'XPHB', 2),
    classFeature('Monk Subclass', 'Monk', 'XPHB', 3),
    classFeature('Channel Divinity', 'Cleric', 'XPHB', 2),
    classFeature('Cleric Subclass', 'Cleric', 'XPHB', 3),
  ],
  subclass: [
    // The WoW copies of 2024 subclasses keep the 2024 features' refs.
    {
      ...subclass('Battle Master', 'Warrior', 'WoW', BATTLE_MASTER, [['Battle Master', 3]]),
      optionalfeatureProgression: [
        { name: 'Maneuvers', featureType: ['MV:B'], progression: { 3: 3, 7: 5, 10: 7, 15: 9 } },
      ],
    },
    subclass('Champion', 'Warrior', 'WoW', CHAMPION, [['Champion', 3]]),
    subclass('Oath of the Ebon Blade', 'Death Knight', 'WoW', EBON_BLADE, [
      ['Oath of the Ebon Blade', 3],
      ['Runic Mastery', 15],
    ]),
    subclass('Demon Hunter', 'Demon Hunter', 'WoW', DEMON_HUNTER, [
      ['Demon Hunter', 3],
      ['Illidari Knowledge', 11],
    ]),
    subclass('Warrior of Mystic Brews', 'Monk', 'XPHB', MYSTIC_BREWS, [
      ['Warrior of Mystic Brews', 3],
      ['Tipsy Sway', 6],
    ]),
    subclass('Discipline Domain', 'Priest', 'WoW', DISCIPLINE, [['Discipline Domain', 3]]),
  ],
  subclassFeature: [
    subFeature('Battle Master', BATTLE_MASTER, 3, [
      ref(featureRef('Combat Superiority', BATTLE_MASTER, 3)),
    ]),
    subFeature('Combat Superiority', BATTLE_MASTER, 3),
    subFeature('Champion', CHAMPION, 3, [ref(featureRef('Remarkable Athlete', CHAMPION, 3))]),
    subFeature('Remarkable Athlete', CHAMPION, 3),
    subFeature('Oath of the Ebon Blade', EBON_BLADE, 3, [
      ref(featureRef('Runic Power', EBON_BLADE, 3)),
    ]),
    subFeature('Runic Power', EBON_BLADE, 3),
    subFeature('Runic Mastery', EBON_BLADE, 15, [
      ...['Blood', 'Frost', 'Unholy'].map((name) => ({ type: 'entries', name, entries: PROSE })),
    ]),
    subFeature('Demon Hunter', DEMON_HUNTER, 3, [
      ref(featureRef('Soul Fragments', DEMON_HUNTER, 3)),
    ]),
    subFeature('Soul Fragments', DEMON_HUNTER, 3, [
      ref(featureRef('Double Jump', DEMON_HUNTER, 3)),
      ref(featureRef('Soul Cleave', DEMON_HUNTER, 3)),
    ]),
    subFeature('Double Jump', DEMON_HUNTER, 3),
    subFeature('Soul Cleave', DEMON_HUNTER, 3),
    subFeature('Illidari Knowledge', DEMON_HUNTER, 11, [
      {
        type: 'entries',
        entries: [
          ref(featureRef('Disrupt', DEMON_HUNTER, 11)),
          ref(featureRef('Warglaive Mastery', DEMON_HUNTER, 11)),
        ],
      },
    ]),
    subFeature('Disrupt', DEMON_HUNTER, 11),
    subFeature('Warglaive Mastery', DEMON_HUNTER, 11),
    subFeature('Warrior of Mystic Brews', MYSTIC_BREWS, 3, [
      ref(featureRef('Bonus Proficiencies', MYSTIC_BREWS, 3)),
    ]),
    subFeature('Bonus Proficiencies', MYSTIC_BREWS, 3),
    subFeature('Tipsy Sway', MYSTIC_BREWS, 6, [
      { type: 'entries', entries: [ref(featureRef('Redirect Attack', MYSTIC_BREWS, 6))] },
    ]),
    subFeature('Redirect Attack', MYSTIC_BREWS, 6),
    subFeature('Discipline Domain', DISCIPLINE, 3, [ref(featureRef('Holy Bolt', DISCIPLINE, 3))]),
    subFeature('Holy Bolt', DISCIPLINE, 3),
  ],
  optionalfeature: [
    { name: 'Heroic Leap', source: 'WoW', featureType: ['MV:B'], entries: PROSE },
    { name: 'Battle Shout', source: 'WoW', featureType: ['MV:B'], entries: PROSE },
    { name: 'Mortal Strike', source: 'WoW', featureType: ['MV:B'], entries: PROSE },
  ],
  background: [
    { name: 'Entertainer', source: 'TEST', skillProficiencies: [{ performance: true }] },
  ],
};

const ctx: EngineContext = {
  get: (type, name, source) =>
    (WORLD[type] ?? []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    ),
  // As every registry holds them: the rows moved out of `CURATED`.
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : (WORLD[type] ?? [])),
};

const FIGHTER = { name: 'Fighter', source: 'XPHB' };
const WARRIOR = { name: 'Warrior', source: 'WoW' };
const BARBARIAN = { name: 'Barbarian', source: 'XPHB' };
const SHAMAN = { name: 'Shaman', source: 'WoW' };
const DEATH_KNIGHT = { name: 'Death Knight', source: 'WoW' };
const DH = { name: 'Demon Hunter', source: 'WoW' };
const RANGER = { name: 'Ranger', source: 'XPHB' };
const MONK = { name: 'Monk', source: 'XPHB' };
const PRIEST = { name: 'Priest', source: 'WoW' };
const wow = (name: string) => ({ name, source: 'WoW' });

const MANEUVERS = 'subclass:battle master|wow:optfeature:MV:B';
const MYSTIC_PICK = 'subclass:warrior of mystic brews|wow:skill:bonus proficiencies';

/** STR 14, DEX 14, CON 14, INT 10, WIS 16, CHA 16 unless `scores` says otherwise. */
function build(
  cls: EntityRef,
  levels: number,
  opts: {
    subclass?: EntityRef;
    background?: string;
    choices?: CharacterDoc['choices'];
    scores?: Partial<CharacterDoc['abilities']['base']>;
    /** A class taken first, at these levels, before `cls`. */
    after?: { cls: EntityRef; levels: number };
  } = {},
): CharacterDoc {
  const doc = newCharacterDoc('r', 'Reskin', 't');
  doc.rulesVersion = '2024';
  doc.abilities = {
    method: 'manual',
    base: { str: 14, dex: 14, con: 14, int: 10, wis: 16, cha: 16, ...opts.scores },
  };
  const first = opts.after;
  doc.classes = [
    ...(first !== undefined
      ? [{ ref: first.cls, levels: first.levels, hp: Array<'avg'>(first.levels).fill('avg') }]
      : []),
    { ref: cls, subclass: opts.subclass, levels, hp: Array<'avg'>(levels).fill('avg') },
  ];
  if (opts.background !== undefined) doc.background = { name: opts.background, source: 'TEST' };
  doc.choices = { ...opts.choices };
  return doc;
}

const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const pool = (sheet: DerivedSheet, key: string) => sheet.resources.find((r) => r.key === key);
const action = (sheet: DerivedSheet, label: string) => sheet.actions.find((a) => a.label === label);
/** What the class rows gave, without the card that names the class. */
const rows = (sheet: DerivedSheet) => ({
  resources: sheet.resources,
  actions: sheet.actions,
  ac: sheet.ac.value,
});

describe('a class that reskins another', () => {
  it('reads the Warrior as the Fighter it is', () => {
    for (const level of [2, 4, 10, 17]) {
      const warrior = derive(build(WARRIOR, level));
      expect(rows(warrior), `level ${level}`).toEqual(rows(derive(build(FIGHTER, level))));
    }
    const warrior = derive(build(WARRIOR, 17));
    expect(pool(warrior, 'second-wind')?.max).toBe(4);
    expect(pool(warrior, 'action-surge')?.max).toBe(2);
    expect(action(warrior, 'Second Wind')?.roll).toBe('1d10+17');
    // A Fighter's spend row reaches the same feature walked under the Warrior.
    expect(action(warrior, 'Tactical Mind')?.cost).toMatchObject({ resource: 'second-wind' });
  });

  it("keeps a Fighter 17's two Action Surges beside a Warrior taken first", () => {
    // The row reads the Fighter's level, not the level of the class walked first:
    // a level table in a built-in row would read the Warrior's 2 here.
    const both = derive(build(FIGHTER, 17, { after: { cls: WARRIOR, levels: 2 } }));
    expect(pool(both, 'action-surge')?.max).toBe(2);
  });

  it('reads the Shaman as the Barbarian it is', () => {
    const shaman = derive(build(SHAMAN, 2));
    expect(rows(shaman)).toEqual(rows(derive(build(BARBARIAN, 2))));
    expect(pool(shaman, 'rage')).toMatchObject({ max: 2, regainOnShort: 1 });
    // Unarmored Defense: 10, DEX +2 and CON +2.
    expect(shaman.ac.value).toBe(14);
  });

  it('reads a 2024 subclass copied under it by the 2024 printing of its features', () => {
    const scores = { str: 14 };
    // 2024 Remarkable Athlete is advantage, not half proficiency on checks.
    const champion = derive(build(WARRIOR, 3, { subclass: wow('Champion'), scores }));
    expect(champion.checks.str.halfProf).toBe(false);
    const master = derive(build(WARRIOR, 10, { subclass: wow('Battle Master') }));
    expect(pool(master, 'superiority-dice')).toMatchObject({
      label: 'Superiority Dice (d10)',
      max: 5,
    });
  });

  it('reads the level of the class that reskins, not of another class beside it', () => {
    const sheet = derive(build(SHAMAN, 3, { after: { cls: WARRIOR, levels: 10 } }));
    // Rage at Shaman 3, not at the Warrior's 10; Action Surge at the Warrior's 10.
    expect(pool(sheet, 'rage')?.max).toBe(3);
    expect(pool(sheet, 'second-wind')?.max).toBe(4);
    expect(action(sheet, 'Second Wind')?.roll).toBe('1d10+10');
  });
});

describe('Death Knight', () => {
  it('has Death Coil, a d8 pool of one plus the Charisma modifier', () => {
    const sheet = derive(build(DEATH_KNIGHT, 1));
    expect(pool(sheet, 'death-coil')).toMatchObject({
      label: 'Death Coil (d8 pool)',
      max: 4,
      resetOn: 'long',
    });
    expect(action(sheet, 'Death Coil')).toMatchObject({
      economy: 'bonus',
      save: { targetAbility: 'con' },
      cost: { resource: 'death-coil', amount: 'varies' },
    });
  });

  it('keeps at least one die whatever the Charisma', () => {
    const sheet = derive(build(DEATH_KNIGHT, 1, { scores: { cha: 6 } }));
    expect(pool(sheet, 'death-coil')?.max).toBe(1);
  });

  it("names the paladin's Channel Divinity for the Death Knight", () => {
    const sheet = derive(build(DEATH_KNIGHT, 3, { subclass: wow('Oath of the Ebon Blade') }));
    expect(pool(sheet, 'channel-divinity-paladin')).toMatchObject({
      label: 'Channel Divinity (Death Knight)',
      max: 2,
    });
    expect(action(sheet, 'Runic Power')).toMatchObject({
      economy: 'none',
      cost: { resource: 'channel-divinity-paladin', amount: 1 },
    });
  });

  it('spends one Runic Mastery use on any of its three runes', () => {
    expect(
      pool(
        derive(build(DEATH_KNIGHT, 14, { subclass: wow('Oath of the Ebon Blade') })),
        'runic-mastery',
      ),
    ).toBeUndefined();
    const sheet = derive(build(DEATH_KNIGHT, 15, { subclass: wow('Oath of the Ebon Blade') }));
    expect(pool(sheet, 'runic-mastery')).toMatchObject({ max: 1, resetOn: 'long' });
    const cost = { resource: 'runic-mastery', amount: 1 };
    expect(action(sheet, 'Runic Mastery: Blood')).toMatchObject({ economy: 'reaction', cost });
    expect(action(sheet, 'Runic Mastery: Unholy')).toMatchObject({ economy: 'none', cost });
    // A Dexterity save against the spell save DC: 8, proficiency +5 and CHA +3.
    expect(action(sheet, 'Runic Mastery: Frost')).toMatchObject({
      economy: 'none',
      roll: '8d6',
      save: { targetAbility: 'dex', dc: 16 },
      cost,
    });
  });
});

describe('Shaman Totems', () => {
  it('is a bonus action at will, and only the Primal Knowledge Totem waits for a rest', () => {
    const sheet = derive(build(SHAMAN, 3));
    expect(pool(sheet, 'totems')).toBeUndefined();
    expect(action(sheet, 'Totems')).toMatchObject({ economy: 'bonus' });
    expect(pool(sheet, 'primal-knowledge-totem')).toMatchObject({ max: 1, resetOn: 'long' });
    expect(action(sheet, 'Primal Knowledge Totem')).toMatchObject({
      economy: 'bonus',
      buyBack: { resource: 'rage', amount: 1 },
    });
  });
});

describe('Demon Hunter Soul Fragments', () => {
  const at = (level: number, wis = 16) =>
    derive(build(DH, level, { subclass: wow('Demon Hunter'), scores: { wis } }));

  it('holds the Wisdom modifier, one more at 13 and two more at 17', () => {
    expect(pool(at(12), 'soul-fragments')?.max).toBe(3);
    expect(pool(at(13), 'soul-fragments')?.max).toBe(4);
    expect(pool(at(17), 'soul-fragments')?.max).toBe(5);
    expect(pool(at(3, 8), 'soul-fragments')?.max).toBe(1);
  });

  it("counts the Demon Hunter's levels, not a Ranger's beside them", () => {
    const sheet = derive(
      build(DH, 3, { subclass: wow('Demon Hunter'), after: { cls: RANGER, levels: 17 } }),
    );
    expect(pool(sheet, 'soul-fragments')?.max).toBe(3);
  });

  it('regains one by reaction without spending one', () => {
    expect(action(at(3), 'Soul Fragments')).toMatchObject({
      economy: 'reaction',
      regains: { resource: 'soul-fragments', amount: 1 },
      spendsNoUse: true,
    });
  });

  it('pays for its features from the fragments', () => {
    const sheet = at(11);
    const spend = (amount: number) => ({ resource: 'soul-fragments', amount });
    expect(action(sheet, 'Double Jump')?.cost).toEqual(spend(1));
    expect(action(sheet, 'Soul Cleave')).toMatchObject({ economy: 'none', cost: spend(1) });
    expect(action(sheet, 'Disrupt')).toMatchObject({ economy: 'reaction', cost: spend(2) });
    expect(action(sheet, 'Warglaive Mastery')?.cost).toEqual(spend(1));
  });
});

describe('Warrior of Mystic Brews', () => {
  it("grants Performance and Brewer's Supplies", () => {
    const sheet = derive(build(MONK, 3, { subclass: wow('Warrior of Mystic Brews') }));
    expect(sheet.skills.Performance?.prof).toBe(1);
    expect(sheet.toolProfs).toContain("Brewer's Supplies");
    expect(sheet.pending.map((p) => p.id)).not.toContain(MYSTIC_PICK);
  });

  it('offers a Monk skill in place of Performance already held', () => {
    const subclass = wow('Warrior of Mystic Brews');
    const sheet = derive(build(MONK, 3, { subclass, background: 'Entertainer' }));
    const prompt = sheet.pending.find((p) => p.id === MYSTIC_PICK);
    expect(prompt).toMatchObject({ label: 'Skill in place of Performance', count: 1 });
    expect(prompt?.options.map((o) => o.id)).toEqual([
      'Acrobatics',
      'Athletics',
      'History',
      'Insight',
      'Religion',
      'Stealth',
    ]);
    const picked = derive(
      build(MONK, 3, {
        subclass,
        background: 'Entertainer',
        choices: { [MYSTIC_PICK]: ['History'] },
      }),
    );
    expect(picked.skills.History?.prof).toBe(1);
  });

  it('spends Focus on Redirect Attack', () => {
    const sheet = derive(build(MONK, 6, { subclass: wow('Warrior of Mystic Brews') }));
    expect(action(sheet, 'Redirect Attack')?.cost).toMatchObject({ resource: 'focus', amount: 1 });
  });
});

describe('the WoW cleric and fighter options', () => {
  it("spends the Priest's Channel Divinity on Holy Bolt", () => {
    // Three uses from level 6: the Priest's level is the Cleric's.
    const sheet = derive(build(PRIEST, 6, { subclass: wow('Discipline Domain') }));
    expect(pool(sheet, 'channel-divinity')?.max).toBe(3);
    expect(action(sheet, 'Holy Bolt')?.cost).toEqual({ resource: 'channel-divinity', amount: 1 });
  });

  it('gives the WoW maneuvers their save and their die', () => {
    const sheet = derive(
      build(WARRIOR, 3, {
        subclass: wow('Battle Master'),
        choices: { [MANEUVERS]: ['heroic leap|wow', 'battle shout|wow', 'mortal strike|wow'] },
      }),
    );
    const die = { resource: 'superiority-dice', amount: 1 };
    // The maneuver DC is Combat Superiority's, which the chip leaves to the player.
    expect(action(sheet, 'Heroic Leap')).toMatchObject({
      economy: 'bonus',
      save: { targetAbility: 'str' },
      cost: die,
    });
    expect(action(sheet, 'Battle Shout')?.cost).toEqual(die);
    expect(action(sheet, 'Mortal Strike')).toMatchObject({ economy: 'none', cost: die });
  });
});

describe('a class copied in the Workshop', () => {
  // As the copy resolves: the original's fields, its own name and book, and
  // `castGuidance.basedOn` naming the original. A copy of a reskin keeps the
  // reskin's `reskinOf`, so both count.
  const copyOf = (original: EntityRef, name: string): DataEntity => {
    const cls = ctx.get('class', original.name, original.source);
    if (cls === undefined) throw new Error(`no ${original.name} in the world`);
    return {
      ...cls,
      name,
      source: 'HB',
      castGuidance: { v: 1, basedOn: `${original.name}|${original.source}` },
    };
  };
  const copies = [
    copyOf(FIGHTER, 'Warden'),
    copyOf(DH, 'Felblade'),
    copyOf(DEATH_KNIGHT, 'Deathlord'),
    // A class of the player's own made from the Paladin, with no reskin.
    {
      name: 'Oathkeeper',
      source: 'HB',
      hd: { number: 1, faces: 10 },
      castGuidance: { v: 1, basedOn: 'Paladin|XPHB' },
      classFeatures: ['Channel Divinity|Paladin|XPHB|3'],
    },
  ];
  const withCopies: EngineContext = {
    get: (type, name, source) =>
      (type === 'class'
        ? copies.find(
            (e) =>
              String(e.name).toLowerCase() === name.toLowerCase() &&
              (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
          )
        : undefined) ?? ctx.get(type, name, source),
    byType: (type) => [...ctx.byType(type), ...(type === 'class' ? copies : [])],
  };
  const deriveCopy = (doc: CharacterDoc) => deriveSheet(doc, withCopies);
  const hb = (name: string) => ({ name, source: 'HB' });

  it("reads a copy of the Fighter at the copy's level", () => {
    for (const level of [1, 4, 10, 17]) {
      const warden = deriveCopy(build(hb('Warden'), level));
      expect(rows(warden), `level ${level}`).toEqual(rows(derive(build(FIGHTER, level))));
    }
    const warden = deriveCopy(build(hb('Warden'), 17));
    expect(pool(warden, 'second-wind')?.max).toBe(4);
    expect(action(warden, 'Second Wind')?.roll).toBe('1d10+17');
  });

  it('reads a copy of a reskin as both the class it copies and the one that class reskins', () => {
    // Soul Fragments read the Demon Hunter's level: the copy's, through basedOn.
    const felblade = deriveCopy(build(hb('Felblade'), 13, { subclass: wow('Demon Hunter') }));
    expect(pool(felblade, 'soul-fragments')?.max).toBe(4);
    // Channel Divinity reads the Paladin's: the copy's, through the Death Knight's reskinOf.
    const deathlord = deriveCopy(
      build(hb('Deathlord'), 11, { subclass: wow('Oath of the Ebon Blade') }),
    );
    expect(pool(deathlord, 'channel-divinity-paladin')).toMatchObject({
      label: 'Channel Divinity (Deathlord)',
      max: 3,
    });
  });

  it('reads a class that reskins before one that copies, whichever was taken first', () => {
    const sheet = deriveCopy(
      build(DEATH_KNIGHT, 11, {
        subclass: wow('Oath of the Ebon Blade'),
        after: { cls: hb('Oathkeeper'), levels: 5 },
      }),
    );
    expect(pool(sheet, 'channel-divinity-paladin')).toMatchObject({
      label: 'Channel Divinity (Death Knight)',
      max: 3,
    });
  });
});
