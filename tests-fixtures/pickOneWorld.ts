/**
 * Pick-one class and subclass features, shaped as the pinned 5etools release
 * (v2.41.0) has them: names, levels, ref strings, `options` nodes and their
 * `count` are copied from it. The prose is placeholder (no book text lives in
 * this repo), written only to trip the prose scan where a test wants an effect,
 * and each class's feature list is cut down to what the tests reach.
 */

import { RULE_SET_TYPE } from '@/engine/castGuidance';
import type { CharacterDoc, DataEntity, EngineContext, EntityRef } from '@/engine/types';
import { newCharacterDoc } from '@/engine/types';
import { BUILT_IN_RULE_SETS } from './testWorld';

const classRef = (classFeature: string) => ({ type: 'refClassFeature', classFeature });
const subRef = (subclassFeature: string) => ({ type: 'refSubclassFeature', subclassFeature });
const pickOne = (...entries: unknown[]) => ({ type: 'options', count: 1, entries });

function classFeature(
  name: string,
  className: string,
  classSource: string,
  level: number,
  entries: unknown[] = ['Placeholder text.'],
  source = classSource,
): DataEntity {
  return { name, source, className, classSource, level, entries };
}

function subclassFeature(
  name: string,
  sub: { className: string; classSource: string; shortName: string; source: string },
  level: number,
  entries: unknown[] = ['Placeholder text.'],
): DataEntity {
  return {
    name,
    source: sub.source,
    className: sub.className,
    classSource: sub.classSource,
    subclassShortName: sub.shortName,
    subclassSource: sub.source,
    level,
    entries,
  };
}

// --- 2024 Cleric: Divine Order (1) and Blessed Strikes (7) -------------------

const CLERIC: DataEntity = {
  name: 'Cleric',
  source: 'XPHB',
  hd: { number: 1, faces: 8 },
  proficiency: ['wis', 'cha'],
  classFeatures: [
    'Divine Order|Cleric|XPHB|1',
    'Blessed Strikes|Cleric|XPHB|7',
    'Improved Blessed Strikes|Cleric|XPHB|14',
  ],
};

const clericFeatures: DataEntity[] = [
  classFeature('Divine Order', 'Cleric', 'XPHB', 1, [
    'You have dedicated yourself to one of these roles.',
    {
      type: 'entries',
      entries: [
        pickOne(
          classRef('Protector|Cleric|XPHB|1|XPHB'),
          classRef('Thaumaturge|Cleric|XPHB|1|XPHB'),
        ),
      ],
    },
  ]),
  classFeature('Protector', 'Cleric', 'XPHB', 1, ['Trained for battle.']),
  classFeature('Thaumaturge', 'Cleric', 'XPHB', 1, ['Steeped in the divine.']),
  classFeature('Blessed Strikes', 'Cleric', 'XPHB', 7, [
    'Divine power infuses you in battle. You gain one of these options.',
    {
      type: 'entries',
      entries: [
        pickOne(
          classRef('Divine Strike|Cleric|XPHB|7'),
          classRef('Potent Spellcasting|Cleric|XPHB|7'),
        ),
      ],
    },
  ]),
  classFeature('Divine Strike', 'Cleric', 'XPHB', 7, [
    'Once on each of your turns, a weapon hit deals an extra 1d8 radiant damage.',
  ]),
  // Its curated row adds Wisdom to Cleric cantrips' damage, so a test can see
  // a branch's effects arrive with its card.
  classFeature('Potent Spellcasting', 'Cleric', 'XPHB', 7, [
    'Add your Wisdom modifier to the damage you deal with any Cleric cantrip.',
  ]),
  classFeature('Improved Blessed Strikes', 'Cleric', 'XPHB', 14, [
    'The option you chose grows stronger.',
    {
      type: 'entries',
      entries: [
        { type: 'entries', name: 'Divine Strike', entries: ['2d8.'] },
        { type: 'entries', name: 'Potent Spellcasting', entries: ['More.'] },
      ],
    },
  ]),
];

// --- 2014 Ranger: Hunter -----------------------------------------------------

const RANGER: DataEntity = {
  name: 'Ranger',
  source: 'PHB',
  hd: { number: 1, faces: 10 },
  proficiency: ['str', 'dex'],
  classFeatures: [{ classFeature: 'Ranger Archetype|Ranger||3', gainSubclassFeature: true }],
};

const HUNTER = { className: 'Ranger', classSource: 'PHB', shortName: 'Hunter', source: 'PHB' };

const hunterFeatures: DataEntity[] = [
  subclassFeature('Hunter', HUNTER, 3, [
    'You accept your place as a bulwark.',
    subRef("Hunter's Prey|Ranger||Hunter||3"),
  ]),
  subclassFeature("Hunter's Prey", HUNTER, 3, [
    'You gain one of the following features of your choice.',
    pickOne(
      subRef('Colossus Slayer|Ranger||Hunter||3'),
      subRef('Giant Killer|Ranger||Hunter||3'),
      subRef('Horde Breaker|Ranger||Hunter||3'),
    ),
  ]),
  subclassFeature('Colossus Slayer', HUNTER, 3, ['Extra 1d8 damage once per turn.']),
  subclassFeature('Giant Killer', HUNTER, 3, [
    'When a Large or larger creature attacks you, you can use your reaction to attack it.',
  ]),
  subclassFeature('Horde Breaker', HUNTER, 3, ['One extra attack against a second creature.']),
];

// --- 2014 Barbarian: Totem Warrior and Storm Herald --------------------------

const BARBARIAN: DataEntity = {
  name: 'Barbarian',
  source: 'PHB',
  hd: { number: 1, faces: 12 },
  proficiency: ['str', 'con'],
  classFeatures: [{ classFeature: 'Primal Path|Barbarian||3', gainSubclassFeature: true }],
};

const TOTEM = {
  className: 'Barbarian',
  classSource: 'PHB',
  shortName: 'Totem Warrior',
  source: 'PHB',
};
const ANIMALS = [
  ['Bear', ''],
  ['Eagle', ''],
  ['Elk', 'SCAG'],
  ['Tiger', 'SCAG'],
  ['Wolf', ''],
] as const;
/** The five animals at one level, as the options node lists them. */
const animalRefs = (level: number) =>
  ANIMALS.map(([name, scag]) =>
    subRef(
      scag === ''
        ? `${name}|Barbarian||Totem Warrior||${level}`
        : `${name}|Barbarian|PHB|Totem Warrior||${level}|SCAG`,
    ),
  );
const animalFeatures = (level: number) =>
  ANIMALS.map(([name, scag]) => ({
    ...subclassFeature(name, TOTEM, level, [`The ${name.toLowerCase()} at level ${level}.`]),
    ...(scag !== '' && { source: 'SCAG' }),
  }));

const totemFeatures: DataEntity[] = [
  subclassFeature('Path of the Totem Warrior', TOTEM, 3, [
    'A spiritual journey.',
    subRef('Spirit Seeker|Barbarian||Totem Warrior||3'),
    subRef('Totem Spirit|Barbarian||Totem Warrior||3'),
  ]),
  subclassFeature('Spirit Seeker', TOTEM, 3),
  subclassFeature('Totem Spirit', TOTEM, 3, [
    'Choose a totem spirit.',
    'Your totem animal.',
    pickOne(...animalRefs(3)),
  ]),
  ...animalFeatures(3),
  subclassFeature('Aspect of the Beast', TOTEM, 6, [
    'A magical benefit based on a totem animal of your choice.',
    pickOne(...animalRefs(6)),
  ]),
  ...animalFeatures(6),
];

const STORM = {
  className: 'Barbarian',
  classSource: 'PHB',
  shortName: 'Storm Herald',
  source: 'XGE',
};
const ENVIRONMENTS = ['Desert', 'Sea', 'Tundra'] as const;
const environmentRefs = (level: number) =>
  ENVIRONMENTS.map((name) => subRef(`${name}|Barbarian|PHB|Storm Herald|XGE|${level}`));
const environmentFeatures = (level: number) =>
  ENVIRONMENTS.map((name) =>
    subclassFeature(name, STORM, level, [`The ${name.toLowerCase()} at level ${level}.`]),
  );

const stormFeatures: DataEntity[] = [
  subclassFeature('Path of the Storm Herald', STORM, 3, [
    'A storm rages within you.',
    'It hums.',
    subRef('Storm Aura|Barbarian||Storm Herald|XGE|3'),
  ]),
  subclassFeature('Storm Aura', STORM, 3, [
    'Choose an environment.',
    'An aura.',
    'It lasts while you rage.',
    pickOne(...environmentRefs(3)),
  ]),
  ...environmentFeatures(3),
  subclassFeature('Storm Soul', STORM, 6, [
    'Benefits based on the environment you chose for your Storm Aura.',
    pickOne(...environmentRefs(6)),
  ]),
  ...environmentFeatures(6),
];

// --- Artificer: Armorer (TCE and EFA), whose Armor Model has no options node --

const ARTIFICER_TCE: DataEntity = {
  name: 'Artificer',
  source: 'TCE',
  hd: { number: 1, faces: 8 },
  proficiency: ['con', 'int'],
  classFeatures: [
    { classFeature: 'Artificer Specialist|Artificer|TCE|3', gainSubclassFeature: true },
  ],
};
const ARTIFICER_EFA: DataEntity = {
  ...ARTIFICER_TCE,
  source: 'EFA',
  classFeatures: [
    { classFeature: 'Artificer Subclass|Artificer|EFA|3', gainSubclassFeature: true },
  ],
};

const ARMORER_TCE = {
  className: 'Artificer',
  classSource: 'TCE',
  shortName: 'Armorer',
  source: 'TCE',
};
const ARMORER_EFA = { ...ARMORER_TCE, classSource: 'EFA', source: 'EFA' };

const armorerTceFeatures: DataEntity[] = [
  subclassFeature('Armorer', ARMORER_TCE, 3, [
    'Armor as a second skin.',
    subRef('Arcane Armor|Artificer|TCE|Armorer|TCE|3'),
    subRef('Armor Model|Artificer|TCE|Armorer|TCE|3'),
  ]),
  subclassFeature('Arcane Armor', ARMORER_TCE, 3),
  subclassFeature('Armor Model', ARMORER_TCE, 3, [
    'Choose one of the following armor models: Guardian or Infiltrator.',
    'Each model includes a special weapon.',
    'You can change the model on a rest.',
    {
      type: 'entries',
      entries: [
        {
          type: 'entries',
          name: 'Guardian',
          entries: [
            'You design your armor for the front line.',
            {
              type: 'list',
              style: 'list-hang-notitle',
              items: [
                subRef('Thunder Gauntlets|Artificer|TCE|Armorer|TCE|3'),
                subRef('Defensive Field|Artificer|TCE|Armorer|TCE|3'),
              ],
            },
          ],
        },
        {
          type: 'entries',
          name: 'Infiltrator',
          entries: [
            'You customize your armor for subtle undertakings.',
            {
              type: 'list',
              style: 'list-hang-notitle',
              items: [
                subRef('Lightning Launcher|Artificer|TCE|Armorer|TCE|3'),
                subRef('Powered Steps|Artificer|TCE|Armorer|TCE|3'),
                subRef('Dampening Field|Artificer|TCE|Armorer|TCE|3'),
              ],
            },
          ],
        },
      ],
    },
  ]),
  subclassFeature('Thunder Gauntlets', ARMORER_TCE, 3, ['Gauntlets deal 1d8 thunder damage.']),
  subclassFeature('Defensive Field', ARMORER_TCE, 3, [
    'As a bonus action, you gain temporary hit points.',
  ]),
  subclassFeature('Lightning Launcher', ARMORER_TCE, 3, ['A launcher deals 1d6 lightning damage.']),
  subclassFeature('Powered Steps', ARMORER_TCE, 3, ['Your walking speed increases.']),
  subclassFeature('Dampening Field', ARMORER_TCE, 3, ['Stealth comes easier.']),
];

const armorerEfaFeatures: DataEntity[] = [
  subclassFeature('Armorer', ARMORER_EFA, 3, [
    'Armor as a second skin.',
    'It is enhanced.',
    subRef('Arcane Armor|Artificer|EFA|Armorer|EFA|3|EFA'),
    subRef('Armor Model|Artificer|EFA|Armorer|EFA|3|EFA'),
  ]),
  subclassFeature('Arcane Armor', ARMORER_EFA, 3),
  subclassFeature('Armor Model', ARMORER_EFA, 3, [
    'Choose one of the following armor models.',
    'Each model includes a special weapon.',
    'You can change the model on a rest.',
    subRef('Dreadnaught|Artificer|EFA|Armorer|EFA|3|EFA'),
    subRef('Guardian|Artificer|EFA|Armorer|EFA|3|EFA'),
    subRef('Infiltrator|Artificer|EFA|Armorer|EFA|3|EFA'),
  ]),
  subclassFeature('Dreadnaught', ARMORER_EFA, 3, ['A towering juggernaut.']),
  subclassFeature('Guardian', ARMORER_EFA, 3, ['The front line of conflict.']),
  subclassFeature('Infiltrator', ARMORER_EFA, 3, ['Subtle undertakings.']),
];

// --- 2014 Fighter: Psi Warrior, an `options` node with no count -------------

const FIGHTER: DataEntity = {
  name: 'Fighter',
  source: 'PHB',
  hd: { number: 1, faces: 10 },
  proficiency: ['str', 'con'],
  classFeatures: [{ classFeature: 'Martial Archetype|Fighter||3', gainSubclassFeature: true }],
};

const PSI = { className: 'Fighter', classSource: 'PHB', shortName: 'Psi Warrior', source: 'TCE' };

const psiFeatures: DataEntity[] = [
  subclassFeature('Psi Warrior', PSI, 3, [
    'You awaken the power of your mind.',
    'It is a source of strength.',
    subRef('Psionic Power|Fighter||Psi Warrior|TCE|3'),
  ]),
  subclassFeature('Psionic Power', PSI, 3, [
    'You harbor a wellspring of psionic energy.',
    {
      type: 'options',
      style: 'list-hang-notitle',
      entries: [
        subRef('Protective Field|Fighter|PHB|Psi Warrior|TCE|3'),
        subRef('Psionic Strike|Fighter|PHB|Psi Warrior|TCE|3'),
        subRef('Telekinetic Movement|Fighter|PHB|Psi Warrior|TCE|3'),
      ],
    },
  ]),
  subclassFeature('Protective Field', PSI, 3),
  subclassFeature('Psionic Strike', PSI, 3),
  subclassFeature('Telekinetic Movement', PSI, 3),
];

// --- Synthetic: a pick inside a branch, which no release has yet ------------

const NESTLING: DataEntity = {
  name: 'Nestling',
  source: 'TST',
  hd: { number: 1, faces: 8 },
  proficiency: ['wis'],
  classFeatures: ['Outer Pick|Nestling|TST|1'],
};

const nestlingFeatures: DataEntity[] = [
  classFeature('Outer Pick', 'Nestling', 'TST', 1, [
    pickOne(classRef('Path A|Nestling|TST|1'), classRef('Path B|Nestling|TST|1')),
  ]),
  classFeature('Path A', 'Nestling', 'TST', 1, [
    pickOne(classRef('Leaf One|Nestling|TST|1'), classRef('Leaf Two|Nestling|TST|1')),
  ]),
  classFeature('Path B', 'Nestling', 'TST', 1),
  classFeature('Leaf One', 'Nestling', 'TST', 1),
  classFeature('Leaf Two', 'Nestling', 'TST', 1),
];

// --- Synthetic: a branch above its pick's level, and two of one name ---------

const ODDLING: DataEntity = {
  name: 'Oddling',
  source: 'TST',
  hd: { number: 1, faces: 8 },
  proficiency: ['wis'],
  classFeatures: ['Gated Pick|Oddling|TST|1', 'Twin Pick|Oddling|TST|1'],
};

const oddlingFeatures: DataEntity[] = [
  classFeature('Gated Pick', 'Oddling', 'TST', 1, [
    pickOne(classRef('Low Road|Oddling|TST|1'), classRef('High Road|Oddling|TST|5')),
  ]),
  classFeature('Low Road', 'Oddling', 'TST', 1),
  classFeature('High Road', 'Oddling', 'TST', 5),
  classFeature('Twin Pick', 'Oddling', 'TST', 1, [
    pickOne(classRef('Twin|Oddling|TST|1|TST'), classRef('Twin|Oddling|TST|1|XTST')),
  ]),
  classFeature('Twin', 'Oddling', 'TST', 1, ['The first twin.']),
  classFeature('Twin', 'Oddling', 'TST', 1, ['The second twin.'], 'XTST'),
];

const WORLD: Record<string, DataEntity[]> = {
  class: [CLERIC, RANGER, BARBARIAN, ARTIFICER_TCE, ARTIFICER_EFA, FIGHTER, NESTLING, ODDLING],
  classFeature: [
    ...clericFeatures,
    classFeature('Ranger Archetype', 'Ranger', 'PHB', 3),
    classFeature('Primal Path', 'Barbarian', 'PHB', 3),
    classFeature('Artificer Specialist', 'Artificer', 'TCE', 3),
    classFeature('Artificer Subclass', 'Artificer', 'EFA', 3),
    classFeature('Martial Archetype', 'Fighter', 'PHB', 3),
    ...nestlingFeatures,
    ...oddlingFeatures,
  ],
  subclass: [
    {
      name: 'Hunter',
      source: 'PHB',
      className: 'Ranger',
      classSource: 'PHB',
      shortName: 'Hunter',
      subclassFeatures: ['Hunter|Ranger||Hunter||3'],
    },
    {
      name: 'Path of the Totem Warrior',
      source: 'PHB',
      className: 'Barbarian',
      classSource: 'PHB',
      shortName: 'Totem Warrior',
      subclassFeatures: [
        'Path of the Totem Warrior|Barbarian||Totem Warrior||3',
        'Aspect of the Beast|Barbarian||Totem Warrior||6',
      ],
    },
    {
      name: 'Path of the Storm Herald',
      source: 'XGE',
      className: 'Barbarian',
      classSource: 'PHB',
      shortName: 'Storm Herald',
      subclassFeatures: [
        'Path of the Storm Herald|Barbarian||Storm Herald|XGE|3',
        'Storm Soul|Barbarian||Storm Herald|XGE|6',
      ],
    },
    {
      name: 'Armorer',
      source: 'TCE',
      className: 'Artificer',
      classSource: 'TCE',
      shortName: 'Armorer',
      subclassFeatures: ['Armorer|Artificer|TCE|Armorer|TCE|3'],
    },
    {
      name: 'Armorer',
      source: 'EFA',
      className: 'Artificer',
      classSource: 'EFA',
      shortName: 'Armorer',
      subclassFeatures: ['Armorer|Artificer|EFA|Armorer|EFA|3|EFA'],
    },
    {
      name: 'Psi Warrior',
      source: 'TCE',
      className: 'Fighter',
      classSource: 'PHB',
      shortName: 'Psi Warrior',
      subclassFeatures: ['Psi Warrior|Fighter||Psi Warrior|TCE|3'],
    },
  ],
  subclassFeature: [
    ...hunterFeatures,
    ...totemFeatures,
    ...stormFeatures,
    ...armorerTceFeatures,
    ...armorerEfaFeatures,
    ...psiFeatures,
  ],
};

export function makePickOneContext(): EngineContext {
  return {
    get(type, name, source) {
      return (WORLD[type] ?? []).find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      );
    },
    // The shipped rule sets, as every registry holds them.
    byType(type) {
      return type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : (WORLD[type] ?? []);
    },
  };
}

/** A one-class character, its subclass and picks as a save would hold them. */
export function pickOneDoc(
  cls: EntityRef,
  levels: number,
  opts: {
    subclass?: EntityRef;
    choices?: CharacterDoc['choices'];
    rulesVersion?: CharacterDoc['rulesVersion'];
  } = {},
): CharacterDoc {
  const doc = newCharacterDoc('p1', 'Picker', 'v2.39.0');
  doc.rulesVersion = opts.rulesVersion ?? (cls.source === 'XPHB' ? '2024' : '2014');
  doc.classes = [
    { ref: cls, subclass: opts.subclass, levels, hp: Array<'avg'>(levels).fill('avg') },
  ];
  doc.choices = { ...opts.choices };
  return doc;
}
