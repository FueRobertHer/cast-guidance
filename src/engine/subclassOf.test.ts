import { describe, expect, it } from 'vitest';
import { deriveSheet } from './derive';
import {
  type CharacterDoc,
  type DataEntity,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
  subclassOf,
} from './types';

/** A book that offers one subclass, Mage of Ash, to the bard and the warlock. */
const SOURCE = 'FCAshCodex';
const mage = (className: string): DataEntity => ({
  name: 'Mage of Ash',
  shortName: 'Mage of Ash',
  source: SOURCE,
  className,
  classSource: SOURCE,
  subclassFeatures: [`${className} Ash|${className}|${SOURCE}|Mage of Ash|${SOURCE}|1`],
});
const WORLD: Record<string, DataEntity[]> = {
  class: ['Bard', 'Warlock'].map((name) => ({
    name,
    source: SOURCE,
    hd: { number: 1, faces: 8 },
    classFeatures: [],
  })),
  subclass: [mage('Bard'), mage('Warlock')],
  subclassFeature: ['Bard', 'Warlock'].map((className) => ({
    name: `${className} Ash`,
    source: SOURCE,
    className,
    classSource: SOURCE,
    subclassShortName: 'Mage of Ash',
    subclassSource: SOURCE,
    level: 1,
    entries: ['Ash.'],
  })),
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
const MAGE: EntityRef = { name: 'Mage of Ash', source: SOURCE };
const entry = (className: string) => ({
  ref: { name: className, source: SOURCE },
  subclass: MAGE,
  levels: 3,
  hp: Array<'avg'>(3).fill('avg'),
});

describe('subclassOf', () => {
  it("finds the subclass on the entry's class among several of one name and book", () => {
    expect(subclassOf(ctx, entry('Bard'))?.className).toBe('Bard');
    expect(subclassOf(ctx, entry('Warlock'))?.className).toBe('Warlock');
  });

  it('falls back to the first of that name and book on a class none is on', () => {
    expect(subclassOf(ctx, entry('Sorcerer'))?.className).toBe('Bard');
    expect(subclassOf(ctx, { ...entry('Bard'), subclass: undefined })).toBeUndefined();
  });

  it("gives a warlock the warlock's features of a subclass the bard has too", () => {
    const doc: CharacterDoc = newCharacterDoc('v1', 'Ash', 'v2.41.0');
    doc.classes = [entry('Warlock')];
    const names = deriveSheet(doc, ctx).features.map((f) => f.name);
    expect(names).toContain('Warlock Ash');
    expect(names).not.toContain('Bard Ash');
  });
});
