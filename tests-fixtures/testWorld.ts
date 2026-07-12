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
    entries: [
      { name: 'Keen Senses', type: 'entries', entries: ['You see well.'] },
      // Curated-trait hook: real races carry this mechanic in prose only.
      {
        name: 'Relentless Endurance',
        type: 'entries',
        entries: ['Drop to 1 HP instead of 0 once per long rest.'],
      },
    ],
  },
  {
    // PHB-shaped Dragonborn: the racial resistance is a `choose` the subrace
    // pre-answers, and the Breath Weapon mechanics live in prose (the typed
    // damage/area/save comes from the curated ancestry table in race.ts).
    name: 'Dragonborn',
    source: 'TST',
    ability: [{ str: 2, cha: 1 }],
    speed: 30,
    resist: [{ choose: { from: ['acid', 'cold', 'fire', 'lightning', 'poison'] } }],
    languageProficiencies: [{ common: true, draconic: true }],
    entries: [
      {
        name: 'Breath Weapon',
        type: 'entries',
        entries: [
          'You can use your action to exhale destructive energy. Each creature in the area of the exhalation must make a saving throw. The DC for this saving throw equals 8 + your Constitution modifier + your proficiency bonus. A creature takes 2d6 damage on a failed save. The damage increases to 3d6 at 6th level, 4d6 at 11th level, and 5d6 at 16th level. After you use your breath weapon, you can’t use it again until you complete a short or long rest.',
        ],
      },
    ],
  },
  {
    // 2024-style versioned Dragonborn: the ancestry color is baked into the
    // race NAME (no subrace), the breath weapon "replaces an attack", scales in
    // "levels 5 (2d10)" form, and states the DC as "8 plus … and …".
    name: 'Dragonborn (Blue)',
    source: 'XTST',
    ability: [{ str: 2, cha: 1 }],
    speed: 30,
    resist: ['lightning'],
    entries: [
      {
        name: 'Breath Weapon',
        type: 'entries',
        entries: [
          'When you take the Attack action on your turn, you can replace one of your attacks with an exhalation of magical energy in either a 15-foot cone or a 30-foot line that is 5 feet wide. Each creature in that area must make a Dexterity saving throw (8 plus your Constitution modifier and proficiency bonus). On a failed save, a creature takes 1d10 damage. This damage increases by 1d10 when you reach character levels 5 (2d10), 11 (3d10), and 17 (4d10). You can use this Breath Weapon a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.',
        ],
      },
    ],
  },
  {
    // Exercises the generic prose scanner (no curated entries match these).
    name: 'Prosefolk',
    source: 'TST',
    speed: 30,
    entries: [
      {
        name: 'Test Surge',
        type: 'entries',
        entries: [
          'As a bonus action, you surge. You can use this trait a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.',
        ],
      },
      {
        name: 'Once Guard',
        type: 'entries',
        entries: [
          'As a reaction, you guard an ally. Once you use this trait, you can’t do so again until you finish a short or long rest.',
        ],
      },
      {
        name: 'Test Toughness',
        type: 'entries',
        entries: [
          'Your hit point maximum increases by 1, and it increases by 1 every time you gain a level.',
        ],
      },
      {
        name: 'Plain Lore',
        type: 'entries',
        entries: ['You know things. This trait has no usage limits at all.'],
      },
    ],
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
    // Open language picks — exercises the "already known" dedup.
    name: 'Linguist',
    source: 'TST',
    languageProficiencies: [{ anyStandard: 2 }],
    entries: ['You collect tongues.'],
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
  {
    name: 'Lucky',
    source: 'PHB',
    entries: ['3 luck points (prose only in real data).'],
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
    name: 'Sneak',
    source: 'TST',
    hd: { number: 1, faces: 8 },
    proficiency: ['dex', 'int'],
    startingProficiencies: {
      skills: [{ choose: { from: ['stealth', 'acrobatics', 'perception'], count: 2 } }],
    },
    // Expertise is prose-only in real data — the engine emits the choice.
    classFeatures: ['Expertise|Sneak|TST|1'],
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
    name: 'Expertise',
    source: 'TST',
    className: 'Sneak',
    classSource: 'TST',
    level: 1,
    entries: ['Choose two of your skill proficiencies to gain Expertise.'],
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
  subrace: [
    {
      name: 'Dragonborn (Blue)',
      source: 'TST',
      raceName: 'Dragonborn',
      raceSource: 'TST',
      resist: ['lightning'],
    },
  ],
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
