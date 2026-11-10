/**
 * Telekinetic Master buys back the Telekinesis it grants with a Psionic Energy
 * die, end to end through `deriveSheet`: for both printings of Psi Warrior, and
 * for a renamed copy of each (the Workshop's subclass editor), whose granted
 * spell's pool is keyed by the copy. The world has the names, levels, ref
 * strings and `additionalSpells` of the pinned release (v2.41.0), and
 * placeholder prose.
 */
import { describe, expect, it } from 'vitest';
import { deriveSheet } from '../derive';
import { type DataEntity, type EngineContext, type EntityRef, newCharacterDoc } from '../types';

const PROSE = ['Placeholder text.'];
const ref = (subclassFeature: string) => ({ type: 'refSubclassFeature', subclassFeature });

/** Where a printing's features live: its class's book in refs, and its own book. */
const PRINTINGS = {
  TCE: { classSource: 'PHB', refClassSource: '', telekinesis: 'telekinesis', rules: '2014' },
  XPHB: {
    classSource: 'XPHB',
    refClassSource: 'XPHB',
    telekinesis: 'telekinesis|xphb',
    rules: '2024',
  },
} as const;
type Printing = keyof typeof PRINTINGS;

const featureRef = (name: string, source: Printing, level: number) =>
  `${name}|Fighter|${PRINTINGS[source].refClassSource}|Psi Warrior|${source}|${level}`;

const feature = (
  name: string,
  source: Printing,
  level: number,
  entries: unknown[] = PROSE,
): DataEntity => ({
  name,
  source,
  className: 'Fighter',
  classSource: PRINTINGS[source].classSource,
  subclassShortName: 'Psi Warrior',
  subclassSource: source,
  level,
  entries,
});

const psiWarrior = (source: Printing): DataEntity => ({
  name: 'Psi Warrior',
  shortName: 'Psi Warrior',
  source,
  className: 'Fighter',
  classSource: PRINTINGS[source].classSource,
  additionalSpells: [{ innate: { 18: { daily: { 1: [PRINTINGS[source].telekinesis] } } } }],
  subclassFeatures: [
    featureRef('Psi Warrior', source, 3),
    featureRef('Telekinetic Master', source, 18),
  ],
});

/** A copy saved by the Workshop with nothing changed but its name, as the data resolves it. */
const renamed = (source: Printing): DataEntity => ({
  ...psiWarrior(source),
  name: `Psi Lantern ${source}`,
  source: 'MyHomebrew',
  castGuidance: { v: 1, basedOn: `Psi Warrior|${source}` },
});

const fighter = (source: string): DataEntity => ({
  name: 'Fighter',
  source,
  hd: { number: 1, faces: 10 },
  classFeatures: [
    { classFeature: `Fighter Subclass|Fighter|${source}|3`, gainSubclassFeature: true },
  ],
});

const WORLD: Record<string, DataEntity[]> = {
  class: [fighter('PHB'), fighter('XPHB')],
  classFeature: (['PHB', 'XPHB'] as const).map((source) => ({
    name: 'Fighter Subclass',
    source,
    className: 'Fighter',
    classSource: source,
    level: 3,
    entries: PROSE,
  })),
  subclass: [psiWarrior('TCE'), psiWarrior('XPHB'), renamed('TCE'), renamed('XPHB')],
  subclassFeature: (['TCE', 'XPHB'] as const).flatMap((source) => [
    feature('Psi Warrior', source, 3, [ref(featureRef('Psionic Power', source, 3))]),
    feature('Psionic Power', source, 3),
    feature('Telekinetic Master', source, 18),
  ]),
  spell: [
    { name: 'Telekinesis', source: 'PHB', level: 5, entries: PROSE },
    { name: 'Telekinesis', source: 'XPHB', level: 5, entries: PROSE },
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

function sheetAt18(source: Printing, subclass: EntityRef) {
  const doc = newCharacterDoc('p', 'Psi', 't');
  doc.rulesVersion = PRINTINGS[source].rules;
  doc.classes = [
    {
      ref: { name: 'Fighter', source: PRINTINGS[source].classSource },
      subclass,
      levels: 18,
      hp: Array<'avg'>(18).fill('avg'),
    },
  ];
  return deriveSheet(doc, ctx);
}

describe("Telekinetic Master's buy-back", () => {
  it.each([
    ['TCE', { name: 'Psi Warrior', source: 'TCE' }, 'spell:psi warrior|tce:telekinesis'],
    ['XPHB', { name: 'Psi Warrior', source: 'XPHB' }, 'spell:psi warrior|xphb:telekinesis'],
    [
      'TCE',
      { name: 'Psi Lantern TCE', source: 'MyHomebrew' },
      'spell:psi lantern tce|myhomebrew:telekinesis',
    ],
    [
      'XPHB',
      { name: 'Psi Lantern XPHB', source: 'MyHomebrew' },
      'spell:psi lantern xphb|myhomebrew:telekinesis',
    ],
  ] as const)('restores the Telekinesis it grants, for %s %o', (source, subclass, own) => {
    const sheet = sheetAt18(source, subclass);
    const master = sheet.actions.find((a) => a.label === 'Telekinetic Master');
    expect(master?.buyBack).toEqual({ resource: 'psi-warrior-dice', amount: 1, own });
    // The use it restores and the dice it spends are both on the sheet.
    expect(sheet.resources.map((r) => r.key)).toEqual(
      expect.arrayContaining(['psi-warrior-dice', own]),
    );
  });
});
