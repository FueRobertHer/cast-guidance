/**
 * Optional class features (`isClassFeatureVariant`), shaped as the 5etools
 * release v2.41.0 has them: names, levels, ref strings, flags and where each
 * variant sits (beside the feature it replaces, in a class's list, a
 * subclass's list, or the refs inside one feature) are copied from it. The
 * prose is placeholder (no book text lives in this repo), except that each
 * variant's opening line keeps the shape the data gives "replaces the X
 * feature" in, which is what the engine reads.
 */

import type { CharacterDoc, DataEntity, EngineContext, EntityRef } from '@/engine/types';
import { newCharacterDoc } from '@/engine/types';

function classFeature(
  name: string,
  className: string,
  classSource: string,
  level: number,
  opts: { source?: string; variant?: boolean; entries?: unknown[] } = {},
): DataEntity {
  return {
    name,
    source: opts.source ?? classSource,
    className,
    classSource,
    level,
    ...(opts.variant === true ? { isClassFeatureVariant: true } : {}),
    entries: opts.entries ?? ['Placeholder text.'],
  };
}

function subclassFeature(
  name: string,
  sub: { className: string; classSource: string; shortName: string; subclassSource: string },
  level: number,
  opts: { source?: string; variant?: boolean; entries?: unknown[] } = {},
): DataEntity {
  return {
    name,
    source: opts.source ?? sub.subclassSource,
    className: sub.className,
    classSource: sub.classSource,
    subclassShortName: sub.shortName,
    subclassSource: sub.subclassSource,
    level,
    ...(opts.variant === true ? { isClassFeatureVariant: true } : {}),
    entries: opts.entries ?? ['Placeholder text.'],
  };
}

/** Tasha's opening line: an italic note naming the feature it replaces. */
const tce = (level: string, cls: string, replaced?: string) =>
  `{@i ${level}-level ${cls} {@variantrule optional class features|tce|optional feature}${replaced === undefined ? '' : `, which replaces the ${replaced} feature`}}`;

// --- 2014 Ranger: Tasha's optional features beside the printed ones ---------

const RANGER: DataEntity = {
  name: 'Ranger',
  source: 'PHB',
  hd: { number: 1, faces: 10 },
  proficiency: ['str', 'dex'],
  classFeatures: [
    'Favored Enemy|Ranger||1',
    'Favored Foe|Ranger||1|TCE',
    'Natural Explorer|Ranger||1',
    'Deft Explorer|Ranger||1|TCE',
    'Spellcasting Focus|Ranger||2|TCE',
    { classFeature: 'Ranger Archetype|Ranger||3', gainSubclassFeature: true },
    'Primeval Awareness|Ranger||3',
    'Primal Awareness|Ranger||3|TCE',
    'Favored Enemy and Natural Explorer improvements|Ranger||6',
    'Deft Explorer Improvement|Ranger||6|TCE',
    'Hide in Plain Sight|Ranger||10',
    "Nature's Veil|Ranger||10|TCE",
    'Natural Explorer improvement|Ranger||10',
    'Deft Explorer Improvement|Ranger||10|TCE',
    'Favored Enemy improvement|Ranger||14',
  ],
};

const rangerFeatures: DataEntity[] = [
  classFeature('Favored Enemy', 'Ranger', 'PHB', 1),
  classFeature('Favored Foe', 'Ranger', 'PHB', 1, {
    source: 'TCE',
    variant: true,
    entries: [tce('1st', 'ranger', 'Favored Enemy'), 'Placeholder text.'],
  }),
  classFeature('Natural Explorer', 'Ranger', 'PHB', 1),
  classFeature('Deft Explorer', 'Ranger', 'PHB', 1, {
    source: 'TCE',
    variant: true,
    entries: [tce('1st', 'ranger', 'Natural Explorer'), 'Placeholder text.'],
  }),
  classFeature('Spellcasting Focus', 'Ranger', 'PHB', 2, {
    source: 'TCE',
    variant: true,
    entries: [tce('2nd', 'ranger'), 'Placeholder text.'],
  }),
  classFeature('Ranger Archetype', 'Ranger', 'PHB', 3),
  classFeature('Primeval Awareness', 'Ranger', 'PHB', 3),
  classFeature('Primal Awareness', 'Ranger', 'PHB', 3, {
    source: 'TCE',
    variant: true,
    entries: [tce('3rd', 'ranger', 'Primeval Awareness'), 'Placeholder text.'],
  }),
  classFeature('Favored Enemy and Natural Explorer improvements', 'Ranger', 'PHB', 6),
  classFeature('Deft Explorer Improvement', 'Ranger', 'PHB', 6, { source: 'TCE', variant: true }),
  classFeature('Hide in Plain Sight', 'Ranger', 'PHB', 10),
  classFeature("Nature's Veil", 'Ranger', 'PHB', 10, {
    source: 'TCE',
    variant: true,
    entries: [
      tce('10th', 'ranger', 'Hide in Plain Sight'),
      'As a bonus action, you turn invisible until your next turn starts.',
    ],
  }),
  classFeature('Natural Explorer improvement', 'Ranger', 'PHB', 10),
  classFeature('Deft Explorer Improvement', 'Ranger', 'PHB', 10, { source: 'TCE', variant: true }),
  classFeature('Favored Enemy improvement', 'Ranger', 'PHB', 14),
];

// The 2014 Beast Master holds both companions as refs inside its first feature.
const BEAST_MASTER_SUB = {
  className: 'Ranger',
  classSource: 'PHB',
  shortName: 'Beast Master',
  subclassSource: 'PHB',
};

const BEAST_MASTER: DataEntity = {
  name: 'Beast Master',
  shortName: 'Beast Master',
  source: 'PHB',
  className: 'Ranger',
  classSource: 'PHB',
  subclassFeatures: ['Beast Master|Ranger||Beast Master||3'],
};

const beastMasterFeatures: DataEntity[] = [
  subclassFeature('Beast Master', BEAST_MASTER_SUB, 3, {
    entries: [
      'Placeholder text.',
      {
        type: 'refSubclassFeature',
        subclassFeature: "Ranger's Companion|Ranger||Beast Master||3",
      },
      {
        type: 'refSubclassFeature',
        subclassFeature: 'Primal Companion|Ranger||Beast Master||3|TCE',
      },
    ],
  }),
  subclassFeature("Ranger's Companion", BEAST_MASTER_SUB, 3),
  subclassFeature('Primal Companion', BEAST_MASTER_SUB, 3, {
    source: 'TCE',
    variant: true,
    entries: [
      "{@i 3rd-level Beast Master variant feature, which replaces the Ranger's Companion feature}",
      'Placeholder text.',
    ],
  }),
];

// --- 2014 Cleric: Blessed Strikes beside a domain's Divine Strike ------------

const CLERIC: DataEntity = {
  name: 'Cleric',
  source: 'PHB',
  hd: { number: 1, faces: 8 },
  proficiency: ['wis', 'cha'],
  classFeatures: [{ classFeature: 'Divine Domain|Cleric||1', gainSubclassFeature: true }],
};

const LIFE_SUB = {
  className: 'Cleric',
  classSource: 'PHB',
  shortName: 'Life',
  subclassSource: 'PHB',
};

const LIFE: DataEntity = {
  name: 'Life Domain',
  shortName: 'Life',
  source: 'PHB',
  className: 'Cleric',
  classSource: 'PHB',
  subclassFeatures: [
    'Life Domain|Cleric||Life||1',
    'Divine Strike|Cleric||Life||8',
    'Blessed Strikes|Cleric||Life||8|TCE',
  ],
};

const lifeFeatures: DataEntity[] = [
  subclassFeature('Life Domain', LIFE_SUB, 1),
  subclassFeature('Divine Strike', LIFE_SUB, 8),
  subclassFeature('Blessed Strikes', LIFE_SUB, 8, {
    source: 'TCE',
    variant: true,
    entries: [tce('8th', 'cleric', 'Divine Strike'), 'Placeholder text.'],
  }),
];

// --- 2024 Ranger: World of Warcraft's Pet Specialization beside Roving -------

const RANGER_2024: DataEntity = {
  name: 'Ranger',
  source: 'XPHB',
  edition: 'one',
  hd: { number: 1, faces: 10 },
  proficiency: ['str', 'dex'],
  classFeatures: ['Roving|Ranger|XPHB|6', 'Pet Specialization|Ranger|XPHB|6|WoW'],
};

const ranger2024Features: DataEntity[] = [
  classFeature('Roving', 'Ranger', 'XPHB', 6),
  classFeature('Pet Specialization', 'Ranger', 'XPHB', 6, {
    source: 'WoW',
    variant: true,
    entries: [
      'This feature replaces the {@classFeature Roving|Ranger|XPHB|6} feature for some characters.',
      'Placeholder text.',
    ],
  }),
];

const WORLD: Record<string, DataEntity[]> = {
  class: [RANGER, CLERIC, RANGER_2024],
  subclass: [BEAST_MASTER, LIFE],
  classFeature: [...rangerFeatures, ...ranger2024Features],
  subclassFeature: [...beastMasterFeatures, ...lifeFeatures],
};

export function makeClassVariantContext(): EngineContext {
  return {
    get(type, name, source) {
      return (WORLD[type] ?? []).find(
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

/** A one-class character with the optional-features rule as given. */
export function classVariantDoc(
  cls: EntityRef,
  levels: number,
  opts: { subclass?: EntityRef; rule?: boolean; choices?: CharacterDoc['choices'] } = {},
): CharacterDoc {
  const doc = newCharacterDoc('v1', 'Variant', 'v2.41.0');
  doc.rulesVersion = cls.source === 'XPHB' ? '2024' : '2014';
  doc.classes = [
    { ref: cls, subclass: opts.subclass, levels, hp: Array<'avg'>(levels).fill('avg') },
  ];
  if (opts.rule === true) doc.optionalClassFeatures = true;
  doc.choices = { ...opts.choices };
  return doc;
}
