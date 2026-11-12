/**
 * The rows moved out of `CURATED` into the shipped rule set
 * (`src/rules/cast-guidance/curated.json`), end to end through `deriveSheet`, by
 * every route that reached the code row: the official entry, a Workshop copy
 * (`basedOn`), a converted copy (`printingOf`), and the spend links that find
 * the row's action by its origin. The world is synthetic, in the release's shape.
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
const copyOf = (ref: string) => ({ castGuidance: { v: 1, basedOn: ref } });

const WORLD: Record<string, DataEntity[]> = {
  class: [
    {
      name: 'Fighter',
      source: 'PHB',
      hd: { number: 1, faces: 10 },
      classFeatures: [],
      optionalfeatureProgression: [
        { name: 'Fighting Style', featureType: ['FS:F'], progression: { 1: 1 } },
        { name: 'Maneuvers', featureType: ['MV:B'], progression: { 1: 1 } },
      ],
    },
    {
      name: 'Monk',
      source: 'PHB',
      hd: { number: 1, faces: 8 },
      classFeatures: ['Ki|Monk|PHB|2', 'Stunning Strike|Monk|PHB|5'],
    },
    {
      name: 'Monk',
      source: 'TEST',
      hd: { number: 1, faces: 8 },
      classFeatures: ['Ki|Monk|TEST|2', 'Stunning Strike|Monk|TEST|5'],
    },
  ],
  classFeature: [
    { name: 'Ki', source: 'PHB', className: 'Monk', classSource: 'PHB', level: 2 },
    { name: 'Stunning Strike', source: 'PHB', className: 'Monk', classSource: 'PHB', level: 5 },
    { name: 'Ki', source: 'TEST', className: 'Monk', classSource: 'TEST', level: 2 },
    {
      name: 'Stunning Strike',
      source: 'TEST',
      className: 'Monk',
      classSource: 'TEST',
      level: 5,
      printingOf: ['Stunning Strike|PHB'],
    },
  ].map((f) => ({ ...f, entries: PROSE })),
  feat: [
    { name: 'Lucky', source: 'PHB', entries: PROSE },
    { name: 'Lucky', source: 'XPHB', entries: PROSE },
    { name: 'Lucky', source: 'BOOK', entries: PROSE, printingOf: ['Lucky|PHB'] },
    { name: 'Fortune', source: 'HB', entries: PROSE, ...copyOf('Lucky|PHB') },
  ],
  optionalfeature: [
    { name: 'Superior Technique', source: 'TCE', featureType: ['FS:F'], entries: PROSE },
    { name: 'Disarming Attack', source: 'PHB', featureType: ['MV:B'], entries: PROSE },
    { name: 'Disarming Attack', source: 'XPHB', featureType: ['MV:B'], entries: PROSE },
    {
      name: 'Knock Loose',
      source: 'HB',
      featureType: ['MV:B'],
      entries: PROSE,
      ...copyOf('Disarming Attack|PHB'),
    },
  ],
  race: [
    {
      name: 'Warforged',
      source: 'ERLW',
      entries: [{ name: 'Integrated Protection', type: 'entries', entries: PROSE }],
    },
    { name: 'Plain', source: 'HB', entries: [] },
  ],
};

const ctx: EngineContext = {
  get: (type, name, source) =>
    (WORLD[type] ?? []).find(
      (e) =>
        String(e.name).toLowerCase() === name.toLowerCase() &&
        (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
    ),
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : (WORLD[type] ?? [])),
};

/** STR 10, DEX 14 (+2), WIS 14 (+2), the rest 10. */
function build(
  classes: Array<[EntityRef, number]>,
  edit: (d: CharacterDoc) => void = () => {},
): CharacterDoc {
  const doc = newCharacterDoc('b', 'Built-in', 't');
  doc.abilities = {
    method: 'manual',
    base: { str: 10, dex: 14, con: 10, int: 10, wis: 14, cha: 10 },
  };
  doc.classes = classes.map(([ref, levels]) => ({
    ref,
    levels,
    hp: Array<'avg'>(levels).fill('avg'),
  }));
  edit(doc);
  return doc;
}

const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const pool = (sheet: DerivedSheet, key: string) => sheet.resources.find((r) => r.key === key);
const action = (sheet: DerivedSheet, label: string) =>
  sheet.actions.filter((a) => a.label === label);
const FIGHTER = { name: 'Fighter', source: 'PHB' };
const MONK = { name: 'Monk', source: 'PHB' };

describe('Stunning Strike, a class feature row', () => {
  it('rides on a hit at the ki DC, and its spend link still pays 1 ki', () => {
    for (const monk of [MONK, { name: 'Monk', source: 'TEST' }]) {
      const strikes = action(derive(build([[monk, 5]])), 'Stunning Strike');
      // WIS +2 and proficiency +3: 8 + 3 + 2.
      expect(
        strikes.map((a) => [a.save?.targetAbility, a.save?.dc, a.cost]),
        monk.source,
      ).toEqual([['con', 13, expect.objectContaining({ resource: 'ki', amount: 1 })]]);
    }
  });
});

describe('Lucky, a feat row', () => {
  const luck = (feat: EntityRef) => {
    const sheet = derive(
      build([[FIGHTER, 1]], (d) => {
        d.feats = [{ ref: feat, instanceId: 'f0' }];
      }),
    );
    const p = pool(sheet, 'luck');
    return p === undefined ? undefined : [p.label, p.max, p.resetOn];
  };

  it('reaches the official feat, a converted copy and a Workshop copy', () => {
    for (const source of ['PHB', 'BOOK']) {
      expect(luck({ name: 'Lucky', source }), source).toEqual(['Luck', 3, 'long']);
    }
    expect(luck({ name: 'Fortune', source: 'HB' })).toEqual(['Luck', 3, 'long']);
  });

  it('leaves the 2024 printing to its code row, which has not moved', () => {
    // Luck points equal to the proficiency bonus, +2 at level 1.
    expect(luck({ name: 'Lucky', source: 'XPHB' })).toEqual(['Luck Points', 2, 'long']);
  });
});

describe('Disarming Attack, an optional feature row', () => {
  const maneuver = (pick: string) => {
    const sheet = derive(
      build([[FIGHTER, 3]], (d) => {
        d.choices['class:fighter|phb:optfeature:FS:F'] = ['superior technique|tce'];
        d.choices['class:fighter|phb:optfeature:MV:B'] = [pick];
      }),
    );
    return sheet.actions.flatMap((a) =>
      a.label === 'Disarming Attack' || a.label.endsWith('Knock Loose')
        ? [[a.economy, a.save?.targetAbility, a.save?.dc, a.cost?.resource]]
        : [],
    );
  };

  it('saves at the maneuver DC and spends a superiority die, official or copied', () => {
    // The higher of STR and DEX (+2) and proficiency +2: 8 + 2 + 2.
    const expected = [['none', 'str', 12, 'superiority-dice']];
    expect(maneuver('disarming attack|phb')).toEqual(expected);
    expect(maneuver('knock loose|hb')).toEqual(expected);
    // The 2024 printing's row is still in code.
    expect(maneuver('disarming attack|xphb')).toEqual(expected);
  });
});

describe('Integrated Protection, a species trait row', () => {
  it('gives the Warforged +1 AC', () => {
    const ac = (race: EntityRef) =>
      derive(
        build([[FIGHTER, 1]], (d) => {
          d.race = race;
        }),
      ).ac.value;
    expect(ac({ name: 'Warforged', source: 'ERLW' }) - ac({ name: 'Plain', source: 'HB' })).toBe(1);
  });
});
