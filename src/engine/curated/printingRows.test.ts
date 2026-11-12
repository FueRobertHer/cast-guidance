/**
 * Entries converted from another app's file carry an official entry's text under
 * a book of their own, and name the entry they print in `printingOf`
 * (`Lucky|PHB`). The curated rows, spend links and prose picks written for the
 * official entry reach the copy through it, end to end through `deriveSheet`.
 * The world holds only copies: no official entry is installed, as when the app
 * ships without the official data.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet, pendingChoices } from '../derive';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
} from '../types';

const PROSE = ['Placeholder text.'];
const BOOK = 'FCPlayerSHandbook';

const feat = (name: string, extra: DataEntity = {}): DataEntity => ({
  name,
  source: BOOK,
  entries: PROSE,
  ...extra,
});

/** A homebrew Jack of All Trades, whose printing a test sets. */
const JACK: DataEntity = {
  name: 'Jack of All Trades',
  source: 'TEST',
  className: 'Bard',
  classSource: 'TEST',
  level: 2,
  entries: PROSE,
};

const WORLD: Record<string, DataEntity[]> = {
  class: [
    {
      name: 'Fighter',
      source: 'TEST',
      hd: { number: 1, faces: 10 },
      classFeatures: [],
      optionalfeatureProgression: [
        { name: 'Fighting Style', featureType: ['FS:F'], progression: { 1: 1 } },
      ],
    },
    {
      name: 'Bard',
      source: 'TEST',
      hd: { number: 1, faces: 8 },
      classFeatures: ['Jack of All Trades|Bard|TEST|2'],
    },
    {
      name: 'Monk',
      source: 'TEST',
      hd: { number: 1, faces: 8 },
      // Ki is keyed by the class's name alone, so it opens the pool Flurry spends.
      classFeatures: [
        'Ki|Monk|TEST|2',
        'Flurry of Blows|Monk|TEST|2',
        'Patient Defence|Monk|TEST|2',
      ],
      optionalfeatureProgression: [
        { name: 'Elemental Disciplines', featureType: ['ED'], progression: { 2: 1 } },
      ],
    },
  ],
  classFeature: [
    JACK,
    {
      name: 'Ki',
      source: 'TEST',
      className: 'Monk',
      classSource: 'TEST',
      level: 2,
      entries: PROSE,
    },
    {
      name: 'Flurry of Blows',
      source: 'TEST',
      className: 'Monk',
      classSource: 'TEST',
      level: 2,
      entries: PROSE,
      printingOf: ['Flurry of Blows|PHB'],
    },
    {
      // Fight Club's spelling; the printing is the official one.
      name: 'Patient Defence',
      source: 'TEST',
      className: 'Monk',
      classSource: 'TEST',
      level: 2,
      entries: PROSE,
      printingOf: ['Patient Defense|PHB'],
    },
  ],
  feat: [
    feat('Lucky', { printingOf: ['Lucky|PHB'] }),
    { name: 'Lucky', source: 'TEST', entries: PROSE },
    feat('Elemental Adept', { printingOf: ['Elemental Adept|PHB'] }),
    feat('Eldritch Adept', {
      printingOf: ['Eldritch Adept|TCE'],
      optionalfeatureProgression: [
        { name: 'Eldritch Invocations', featureType: ['EI'], progression: { '*': 1 } },
      ],
    }),
  ],
  optionalfeature: [
    {
      name: 'Superior Technique',
      source: 'FCTashaSCauldronOfEverything',
      featureType: ['FS:F'],
      entries: PROSE,
      printingOf: ['Superior Technique|TCE'],
    },
    {
      name: 'Fist of Unbroken Air',
      source: BOOK,
      featureType: ['ED'],
      entries: PROSE,
      printingOf: ['Unbroken Air|PHB'],
    },
    { name: 'Open Secret', source: 'TEST', featureType: ['EI'], entries: PROSE },
    {
      name: 'Late Secret',
      source: 'TEST',
      featureType: ['EI'],
      prerequisite: [{ level: { level: 5, class: { name: 'Warlock' } } }],
      entries: PROSE,
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
  // As every registry holds them: the rows moved out of `CURATED`.
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : (WORLD[type] ?? [])),
};

/** DEX 14 (+2), the rest 10. */
function build(
  cls: EntityRef,
  levels: number,
  feats: EntityRef[] = [],
  choices: CharacterDoc['choices'] = {},
): CharacterDoc {
  const doc = newCharacterDoc('p', 'Printing', 't');
  doc.abilities = {
    method: 'manual',
    base: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
  };
  doc.classes = [{ ref: cls, levels, hp: Array<'avg'>(levels).fill('avg') }];
  doc.feats = feats.map((ref, i) => ({ ref, instanceId: `f${i}` }));
  doc.choices = choices;
  return doc;
}

const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const pool = (sheet: DerivedSheet, key: string) => sheet.resources.find((r) => r.key === key);
const FIGHTER = { name: 'Fighter', source: 'TEST' };
const MONK = { name: 'Monk', source: 'TEST' };

describe('a copy of an official entry reads its rows', () => {
  it("gives a copied feat the official feat's curated row", () => {
    const copy = derive(build(FIGHTER, 1, [{ name: 'Lucky', source: BOOK }]));
    expect(pool(copy, 'luck')?.max).toBe(3);
    // A homebrew feat of the same name that names no printing gets nothing.
    const own = derive(build(FIGHTER, 1, [{ name: 'Lucky', source: 'TEST' }]));
    expect(pool(own, 'luck')).toBeUndefined();
  });

  it("offers a copied feat the official feat's prose pick, and lets it repeat", () => {
    const adept = { name: 'Elemental Adept', source: BOOK };
    const doc = build(FIGHTER, 1, [adept, adept]);
    const picks = pendingChoices(doc, ctx).filter((c) => c.kind === 'damageType');
    expect(picks).toHaveLength(2);
    expect(derive(doc).warnings.some((w) => w.includes('not a repeatable feat'))).toBe(false);
  });

  it("gives a copied optional feature the official option's curated row", () => {
    const pick = 'class:fighter|test:optfeature:FS:F';
    const sheet = derive(
      build(FIGHTER, 1, [], { [pick]: ['superior technique|fctashascauldronofeverything'] }),
    );
    expect(pool(sheet, 'superiority-dice')?.max).toBe(1);
  });

  it("hangs the official feature's spend link on a copied class feature", () => {
    const sheet = derive(build(MONK, 2));
    const flurry = sheet.actions.find((a) => a.label === 'Flurry of Blows');
    // The row spends Focus, which the sheet finds as a 2014 monk's ki.
    expect(flurry?.cost).toMatchObject({ resource: 'ki', amount: 1 });
    // A copy under another spelling reaches the row by the printed name.
    const patient = sheet.actions.find((a) => a.label === 'Patient Defence');
    expect(patient?.cost).toMatchObject({ resource: 'ki', amount: 1 });
  });

  it("hangs the official option's spend link on a copied option", () => {
    const pick = 'class:monk|test:optfeature:ED';
    const sheet = derive(
      build(MONK, 2, [], { [pick]: [`fist of unbroken air|${BOOK.toLowerCase()}`] }),
    );
    const fist = sheet.actions.find((a) => a.label === 'Fist of Unbroken Air');
    expect(fist?.cost).toMatchObject({ resource: 'ki' });
  });

  it("holds a copied feat's options to the official feat's class prerequisite", () => {
    const doc = build(FIGHTER, 1, [{ name: 'Eldritch Adept', source: BOOK }]);
    const id = `feat:eldritch adept|${BOOK.toLowerCase()}:f0:optfeature:EI`;
    const prompt = derive(doc).pending.find((p) => p.id === id);
    expect(prompt?.options.find((o) => o.id === 'open secret|test')?.disabled).toBeUndefined();
    expect(prompt?.options.find((o) => o.id === 'late secret|test')?.disabled?.reason).toBe(
      'Has a prerequisite, so only a warlock who meets it can take this',
    );
  });

  it('reads a row that depends on the printing as the official printing', () => {
    const bard = { name: 'Bard', source: 'TEST' };
    // 2014 Jack of All Trades adds half proficiency to initiative; 2024 does not.
    const own = derive(build(bard, 2));
    expect(own.initiative.value).toBe(3);
    JACK.printingOf = ['Jack of All Trades|XPHB'];
    try {
      expect(derive(build(bard, 2)).initiative.value).toBe(2);
    } finally {
      delete JACK.printingOf;
    }
  });

  it('reads nothing from a printingOf that names no entry', () => {
    const odd: unknown[] = [
      [123],
      [null],
      '|',
      [' | '],
      ['__proto__'],
      ['constructor|'],
      ['hasOwnProperty'],
      ['toString|x|y'],
      [],
    ];
    for (const printingOf of odd) {
      const copy = WORLD.feat?.[0];
      if (copy === undefined) throw new Error('no Lucky copy');
      const kept = copy.printingOf;
      copy.printingOf = printingOf;
      try {
        const sheet = derive(build(FIGHTER, 1, [{ name: 'Lucky', source: BOOK }]));
        expect(pool(sheet, 'luck')).toBeUndefined();
      } finally {
        copy.printingOf = kept;
      }
    }
  });
});
