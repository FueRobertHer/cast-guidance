/**
 * Class and species proficiency lists, shaped as the pinned 5etools release
 * (v2.41.0) has them: the strings are copied from it, tags and all. The rest of
 * each entity is cut down to what the tests reach, and everything else comes
 * from the test world (its Longsword and Dagger, its Warrior and Mage).
 */

import type { DataEntity, EngineContext } from '@/engine/types';
import { makeTestContext } from './testWorld';

const CLASSES: DataEntity[] = [
  {
    name: 'Bard',
    source: 'PHB',
    hd: { number: 1, faces: 8 },
    proficiency: ['dex', 'cha'],
    startingProficiencies: {
      armor: ['light'],
      weapons: [
        'simple',
        '{@item hand crossbow|phb|hand crossbows}',
        '{@item longsword|phb|longswords}',
        '{@item rapier|phb|rapiers}',
        '{@item shortsword|phb|shortswords}',
      ],
      tools: ['three {@item musical instrument|PHB|musical instruments} of your choice'],
    },
    multiclassing: {
      proficienciesGained: {
        armor: ['light'],
        tools: ['one {@item musical instrument|PHB} of your choice'],
      },
    },
    classFeatures: [],
  },
  {
    name: 'Wizard',
    source: 'PHB',
    hd: { number: 1, faces: 6 },
    proficiency: ['int', 'wis'],
    startingProficiencies: {
      weapons: [
        '{@item dagger|phb|daggers}',
        '{@item dart|phb|darts}',
        '{@item sling|phb|slings}',
        '{@item quarterstaff|phb|quarterstaffs}',
        '{@item light crossbow|phb|light crossbows}',
      ],
    },
    classFeatures: [],
  },
  {
    name: 'Monk',
    source: 'XPHB',
    hd: { number: 1, faces: 8 },
    proficiency: ['str', 'dex'],
    startingProficiencies: {
      weapons: [
        'simple',
        'Martial weapons that have the {@filter Light|items|type=martial weapon|property=light} property',
      ],
      tools: ["Choose one type of {@item Artisan's Tools|XPHB} or {@item Musical Instrument|XPHB}"],
      weaponProficiencies: [
        { simple: true, all: { fromFilter: 'type=martial weapon|property=light' } },
      ],
    },
    classFeatures: [],
  },
  {
    name: 'Rogue',
    source: 'XPHB',
    hd: { number: 1, faces: 8 },
    proficiency: ['dex', 'int'],
    startingProficiencies: {
      weapons: [
        'simple',
        'Martial weapons that have the {@filter Finesse or Light|items|type=martial weapon|property=finesse;light} property',
      ],
      weaponProficiencies: [
        { simple: true, all: { fromFilter: 'type=martial weapon|property=light;finesse' } },
      ],
    },
    classFeatures: [],
  },
];

/** Martial weapons with the properties those filters ask about, in the 2024 shape. */
const BASE_ITEMS: DataEntity[] = [
  {
    name: 'Shortsword',
    source: 'TST',
    type: 'M|XPHB',
    weaponCategory: 'martial',
    weapon: true,
    dmg1: '1d6',
    dmgType: 'P',
    property: ['F|XPHB', 'L|XPHB'],
  },
  {
    name: 'Rapier',
    source: 'TST',
    type: 'M|XPHB',
    weaponCategory: 'martial',
    weapon: true,
    dmg1: '1d8',
    dmgType: 'P',
    property: ['F|XPHB'],
  },
];

const RACES: DataEntity[] = [
  {
    name: 'Elf (High)',
    source: 'PHB',
    weaponProficiencies: [
      { 'longsword|phb': true, 'shortsword|phb': true, 'shortbow|phb': true, 'longbow|phb': true },
    ],
  },
];

/** The test world, with these classes and species in it. */
export function makeProficiencyContext(): EngineContext {
  const world = makeTestContext();
  const added: Record<string, DataEntity[]> = {
    class: CLASSES,
    race: RACES,
    baseitem: BASE_ITEMS,
  };
  return {
    get(type, name, source) {
      const found = added[type]?.find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      );
      return found ?? world.get(type, name, source);
    },
    byType(type) {
      return [...(added[type] ?? []), ...world.byType(type)];
    },
  };
}
