/**
 * SYNTHETIC test world — hand-written entities that mimic the 5etools schema.
 * No real game data lives in this repo (curated-table keys reuse real feature
 * NAMES like "Alert", which are rule facts, not book text).
 */
import type { DataEntity, EngineContext } from '@/engine/types';

const race: DataEntity[] = [
  {
    name: 'Testfolk',
    source: 'TST',
    ability: [{ dex: 2, wis: 1 }],
    speed: 30,
    darkvision: 60,
    skillProficiencies: [{ perception: true }],
    languageProficiencies: [{ common: true, anyStandard: 1 }],
    // Innate spells: guidance always, aid from level 3 (both apply at level 5).
    additionalSpells: [
      {
        ability: 'wis',
        known: { _: ['guidance|tst'], '3': ['aid|tst'], '9': ['flame strike|tst'] },
      },
    ],
    entries: [{ name: 'Keen Senses', type: 'entries', entries: ['You see well.'] }],
  },
];

const spell: DataEntity[] = [
  { name: 'Guidance', source: 'TST', level: 0, school: 'D', entries: ['+1d4 to a check.'] },
  { name: 'Aid', source: 'TST', level: 2, school: 'A', entries: ['Boost max HP.'] },
  { name: 'Flame Strike', source: 'TST', level: 5, school: 'V', entries: ['Fire from the sky.'] },
];

const background: DataEntity[] = [
  {
    name: 'Scholar',
    source: 'TST',
    skillProficiencies: [{ choose: { from: ['arcana', 'history'], count: 2 } }],
    entries: ['You studied.'],
  },
  {
    name: 'Modern Scholar',
    source: 'TS2',
    ability: [{ choose: { weighted: { from: ['int', 'wis', 'cha'], weights: [2, 1] } } }],
    feats: [{ 'alert|phb': true }],
    skillProficiencies: [{ history: true }],
    entries: ['2024-style background.'],
  },
  {
    name: 'Flexible Scholar',
    source: 'TS2',
    // XPHB pattern: two ALTERNATIVE weighted arrangements
    ability: [
      { choose: { weighted: { from: ['int', 'wis', 'cha'], weights: [2, 1] } } },
      { choose: { weighted: { from: ['int', 'wis', 'cha'], weights: [1, 1, 1] } } },
    ],
    entries: ['Pick +2/+1 or +1/+1/+1.'],
  },
];

// Sources 'PHB' here exist only so uids line up with curated-table keys;
// the entity content is synthetic.
const feat: DataEntity[] = [
  {
    name: 'Alert',
    source: 'PHB',
    entries: ['+5 initiative (prose only in real data).'],
  },
  {
    name: 'Tough',
    source: 'PHB',
    entries: ['+2 hp per level.'],
  },
  {
    name: 'Skilled',
    source: 'TST',
    skillProficiencies: [{ any: 3 }],
    entries: ['Pick three skills.'],
  },
];

const cls: DataEntity[] = [
  {
    name: 'Warrior',
    source: 'TST',
    hd: { number: 1, faces: 10 },
    proficiency: ['str', 'con'],
    startingProficiencies: {
      armor: ['light', 'medium', 'heavy', { proficiency: 'shield' }],
      weapons: ['simple', 'martial'],
      skills: [{ choose: { from: ['athletics', 'intimidation', 'survival'], count: 2 } }],
    },
    classFeatures: [
      'Grit|Warrior|TST|1',
      { classFeature: 'Warrior Path|Warrior|TST|3', gainSubclassFeature: true },
      'Ability Score Improvement|Warrior|TST|4',
      'Extra Attack|Warrior|TST|5',
    ],
    optionalfeatureProgression: [
      { name: 'Combat Stance', featureType: ['FS:T'], progression: { '1': 1 } },
    ],
  },
  {
    name: 'Pactcaster',
    source: 'TST',
    hd: { number: 1, faces: 8 },
    proficiency: ['wis', 'cha'],
    casterProgression: 'pact',
    spellcastingAbility: 'cha',
    multiclassing: {
      requirements: { cha: 13 },
      proficienciesGained: { armor: ['light'], weapons: ['simple'] },
    },
    classFeatures: [],
  },
  {
    name: 'Mage',
    source: 'TST',
    hd: { number: 1, faces: 6 },
    proficiency: ['int', 'wis'],
    startingProficiencies: { skills: [{ choose: { from: ['arcana'], count: 1 } }] },
    multiclassing: {
      requirements: { int: 13 },
      proficienciesGained: {},
    },
    casterProgression: 'full',
    spellcastingAbility: 'int',
    cantripProgression: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
    preparedSpells: '<$level$> + <$int_mod$>',
    classFeatures: ['Spellcasting|Mage|TST|1'],
  },
];

const classFeature: DataEntity[] = [
  {
    name: 'Grit',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    level: 1,
    entries: ['You are gritty.'],
  },
  {
    name: 'Warrior Path',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    level: 3,
    entries: ['Choose a path.'],
  },
  {
    name: 'Ability Score Improvement',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    level: 4,
    entries: ['ASI or feat.'],
  },
  {
    name: 'Extra Attack',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    level: 5,
    entries: ['Attack twice.'],
  },
  {
    name: 'Spellcasting',
    source: 'TST',
    className: 'Mage',
    classSource: 'TST',
    level: 1,
    entries: ['You cast spells.'],
  },
];

const subclass: DataEntity[] = [
  {
    name: 'Path of Tests',
    shortName: 'Tests',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    subclassFeatures: ['Path of Tests|Warrior|TST|Tests|TST|3'],
  },
];

const subclassFeature: DataEntity[] = [
  {
    name: 'Path of Tests',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    subclassShortName: 'Tests',
    subclassSource: 'TST',
    level: 3,
    entries: ['Subclass feature text.'],
  },
];

const optionalfeature: DataEntity[] = [
  {
    name: 'Defense',
    source: 'PHB',
    featureType: ['FS:T'],
    entries: ['+1 AC while armored (prose).'],
  },
  {
    name: 'Archery',
    source: 'PHB',
    featureType: ['FS:T'],
    entries: ['+2 ranged attack (prose).'],
  },
];

const baseitem: DataEntity[] = [
  {
    name: 'Longsword',
    source: 'TST',
    type: 'M',
    weaponCategory: 'martial',
    weapon: true,
    dmg1: '1d8',
    dmgType: 'S',
    dmg2: '1d10',
    property: ['V'],
  },
  {
    name: 'Dagger',
    source: 'TST',
    type: 'M',
    weaponCategory: 'simple',
    weapon: true,
    dmg1: '1d4',
    dmgType: 'P',
    property: ['F', 'L', 'T'],
    range: '20/60',
  },
  {
    name: 'Shortbow',
    source: 'TST',
    type: 'R',
    weaponCategory: 'simple',
    weapon: true,
    dmg1: '1d6',
    dmgType: 'P',
    property: ['A', '2H'],
    range: '80/320',
  },
  { name: 'Chain Mail', source: 'TST', type: 'HA', ac: 16, strength: '13' },
  { name: 'Leather Armor', source: 'TST', type: 'LA', ac: 11 },
  { name: 'Scale Mail', source: 'TST', type: 'MA', ac: 14 },
  { name: 'Shield', source: 'TST', type: 'S', ac: 2 },
];

const item: DataEntity[] = [
  {
    name: 'Ring of Shielding',
    source: 'TST',
    type: 'RG',
    bonusAc: '+1',
    entries: ['+1 AC.'],
  },
];

const WORLD: Record<string, DataEntity[]> = {
  race,
  subrace: [],
  background,
  feat,
  class: cls,
  classFeature,
  subclass,
  subclassFeature,
  optionalfeature,
  baseitem,
  item,
  itemGroup: [],
  spell,
};

export function makeTestContext(): EngineContext {
  return {
    get(type, name, source) {
      const list = WORLD[type] ?? [];
      return list.find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      );
    },
    byType(type) {
      return WORLD[type] ?? [];
    },
  };
}
