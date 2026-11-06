import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';

// Synthetic: a subclass that picks from its own list as levels pass.
const subclass: DataEntity = {
  name: 'Path of Drills',
  source: 'TST',
  shortName: 'Drills',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: [],
  optionalfeatureProgression: [
    { name: 'Drills', featureType: ['DR'], progression: { '3': 1, '7': 2 } },
  ],
};
const drills: DataEntity[] = [
  { name: 'Low Sweep', source: 'TST', featureType: ['DR'], entries: ['You sweep low.'] },
  { name: 'High Guard', source: 'TST', featureType: ['DR'], entries: ['You guard high.'] },
];

const world = makeTestContext();
const ctx: EngineContext = {
  get: (type, name, source) => {
    if (type === 'subclass' && name === subclass.name) return subclass;
    if (type === 'optionalfeature') {
      const drill = drills.find((d) => String(d.name).toLowerCase() === name.toLowerCase());
      if (drill !== undefined) return drill;
    }
    return world.get(type, name, source);
  },
  byType: (type) =>
    type === 'optionalfeature' ? [...world.byType(type), ...drills] : world.byType(type),
};

function sheetAt(levels: number, picks?: string[]) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.classes = [
    {
      ref: { name: 'Warrior', source: 'TST' },
      subclass: { name: 'Path of Drills', source: 'TST' },
      levels,
      hp: [],
    },
  ];
  const sheet = deriveSheet(doc, ctx);
  const id = sheet.pending.find((p) => p.label === 'Drills')?.id;
  if (picks === undefined || id === undefined) return sheet;
  doc.choices[id] = picks;
  return deriveSheet(doc, ctx);
}

describe('optional feature picks on a subclass', () => {
  it('asks by the level in the subclass class, and no more than the progression gives', () => {
    expect(sheetAt(2).pending.find((p) => p.label === 'Drills')).toBeUndefined();
    expect(sheetAt(3).pending.find((p) => p.label === 'Drills')?.count).toBe(1);
    expect(sheetAt(7).pending.find((p) => p.label === 'Drills')?.count).toBe(2);
  });

  it('files the pick under the subclass, so swapping it away clears the pick', () => {
    expect(sheetAt(3).pending.find((p) => p.label === 'Drills')?.id).toBe(
      'subclass:path of drills|tst:optfeature:DR',
    );
  });

  it('adds what was picked to the sheet', () => {
    const sheet = sheetAt(3, ['low sweep|tst']);
    expect(sheet.pending.find((p) => p.label === 'Drills')).toBeUndefined();
    expect(sheet.features.map((f) => f.name)).toContain('Drills: Low Sweep');
  });

  it('closes an option another prompt of its kind has picked', () => {
    const prompt = sheetAt(3).pending.find((p) => p.label === 'Drills');
    expect(prompt?.distinct).toBe(true);
  });
});
