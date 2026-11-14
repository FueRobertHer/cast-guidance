import { describe, expect, it } from 'vitest';
import { BUILT_IN_RULE_SETS, makeTestContext } from '../../../tests-fixtures/testWorld';
import { RULE_SET_TYPE } from '../castGuidance';
import { deriveSheet } from '../derive';
import { Collector } from '../effects/base';
import { builtInRowsFor, emitRuleRows } from '../effects/mechanics';
import {
  type CharacterDoc,
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { emitStandingEffects, hasStandingRow } from './standingEffects';

const empty: EngineContext = {
  get: () => undefined,
  byType: (type) => (type === RULE_SET_TYPE ? BUILT_IN_RULE_SETS : []),
};
const sub = (uid: string, label = 'Feature'): EffectOrigin => ({ label, uid, type: 'subclass' });

/**
 * A feature's standing row, as the call sites emit it: the code row, or the
 * built-in rule set's (`src/rules/cast-guidance/standing.json`) once it moved.
 */
function emit(key: string, origin: EffectOrigin, opts: { from?: string; level?: number } = {}) {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), empty);
  const level = opts.level ?? 20;
  if (emitStandingEffects(col, key, origin, opts.from, level)) return col;
  const rows = builtInRowsFor(col, 'standing', [key], hasStandingRow);
  if (rows === undefined) throw new Error(`No standing row under ${key}`);
  emitRuleRows(col, rows, origin, level, level);
  return col;
}
const of = <K extends EffectInput['kind']>(col: Collector, kind: K) =>
  col.effects.filter((e): e is Extract<EffectInput, { kind: K }> => e.kind === kind);

describe('standing rows', () => {
  it('has no row for an unknown key, and adds nothing', () => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), empty);
    expect(emitStandingEffects(col, 'nothing|here', sub('x'), undefined, 1)).toBe(false);
    expect(builtInRowsFor(col, 'standing', ['nothing|here'], hasStandingRow)).toBeUndefined();
    expect(col.effects).toEqual([]);
  });

  it('adds a built-in row with the origin itself, which spend links find actions by', () => {
    const origin = sub('storm sorcery|xge');
    const col = emit('heart of the storm|storm sorcery', origin);
    expect(col.effects.length).toBeGreaterThan(0);
    for (const e of col.effects) expect(e.origin).toBe(origin);
  });

  it('resists what the feature names', () => {
    const col = emit('heart of the storm|storm sorcery', sub('storm sorcery|xge'));
    expect(of(col, 'resist').map((e) => e.damageType)).toEqual(['lightning', 'thunder']);
  });

  it('says "nonmagical" on the 2014 printing alone', () => {
    const notes = (uid: string) =>
      of(emit('avatar of battle|war domain', sub(uid)), 'resist').map((e) => [
        e.damageType,
        e.note,
      ]);
    expect(notes('war domain|phb')).toEqual([
      ['bludgeoning', 'nonmagical'],
      ['piercing', 'nonmagical'],
      ['slashing', 'nonmagical'],
    ]);
    expect(notes('war domain|xphb')).toEqual([
      ['bludgeoning', undefined],
      ['piercing', undefined],
      ['slashing', undefined],
    ]);
  });

  it('tells option features of one name apart by the level they come at', () => {
    const fire = (level: number) =>
      of(
        emit('desert|path of the storm herald', sub('path of the storm herald|xge'), { level }),
        'resist',
      );
    expect(fire(3)).toEqual([]);
    expect(fire(6).map((e) => e.damageType)).toEqual(['fire']);
    expect(fire(14)).toEqual([]);
  });

  it("asks for Tiger's two skills at level 6 alone, and grants them", () => {
    const tiger = sub('path of the totem warrior|phb', 'Tiger');
    const asked = (level: number) =>
      emit('tiger|path of the totem warrior', tiger, { level }).pending.map((p) => [
        p.id,
        p.count,
        p.options.map((o) => o.id),
      ]);
    expect(asked(3)).toEqual([]);
    expect(asked(6)).toEqual([
      [
        'subclass:path of the totem warrior|phb:skill:tiger',
        2,
        ['Athletics', 'Acrobatics', 'Stealth', 'Survival'],
      ],
    ]);
    expect(asked(14)).toEqual([]);
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices['subclass:path of the totem warrior|phb:skill:tiger'] = ['Stealth', 'Survival'];
    const col = new Collector(doc, empty);
    emitStandingEffects(col, 'tiger|path of the totem warrior', tiger, undefined, 6);
    expect(of(col, 'skillProf').map((e) => [e.skill, e.level])).toEqual([
      ['Stealth', 1],
      ['Survival', 1],
    ]);
  });

  it('holds a raging feature only while Rage is in play', () => {
    const col = emit('mindless rage|path of the berserker', sub('path of the berserker|phb'));
    expect(of(col, 'conditionImmune').map((e) => [e.condition, e.while])).toEqual([
      ['charmed', [{ state: 'effect', name: 'Rage' }]],
      ['frightened', [{ state: 'effect', name: 'Rage' }]],
    ]);
  });

  it('reads the branch picked for a resistance that follows it', () => {
    const resisted = (key: string, uid: string, branch?: string) => {
      const doc = newCharacterDoc('c', 'H', 't');
      if (branch !== undefined) doc.choices[`subclass:${uid}:branch`] = [branch];
      const col = new Collector(doc, empty);
      emitStandingEffects(col, key, sub(uid), undefined, 10);
      return of(col, 'resist').map((e) => e.damageType);
    };
    expect(resisted('elemental gift|the genie', 'the genie|tce', 'marid')).toEqual(['cold']);
    expect(resisted('elemental gift|the genie', 'the genie|tce')).toEqual([]);
    expect(
      resisted("nature's ward|circle of the land", 'circle of the land|xphb', 'polar land'),
    ).toEqual(['cold']);
  });

  it('gives the 2014 Land druid poison and disease, and the 2024 one the Poisoned condition', () => {
    const phb = emit("nature's ward|circle of the land", sub('circle of the land|phb'));
    expect(of(phb, 'immune').map((e) => e.damageType)).toEqual(['poison']);
    // Charmed or frightened by elementals or fey alone: said, not held off.
    expect(of(phb, 'conditionImmune').map((e) => e.condition)).toEqual(['poisoned', 'disease']);
    expect(of(phb, 'cue').map((e) => e.text)).toEqual([
      "Can't be charmed or frightened by elementals or fey.",
    ]);
    const xphb = emit("nature's ward|circle of the land", sub('circle of the land|xphb'));
    expect(of(xphb, 'immune')).toEqual([]);
    expect(of(xphb, 'conditionImmune').map((e) => e.condition)).toEqual(['poisoned']);
  });

  it('puts the paladin in its own aura while the aura holds', () => {
    const notes = (uid: string) =>
      of(emit('aura of warding|oath of the ancients', sub(uid)), 'resist').map((e) => [
        e.damageType,
        e.note,
      ]);
    // The 2014 aura prints no condition.
    expect(notes('oath of the ancients|phb')).toEqual([['all', 'from spells']]);
    expect(notes('oath of the ancients|xphb')).toEqual([
      ['necrotic', 'not while incapacitated'],
      ['psychic', 'not while incapacitated'],
      ['radiant', 'not while incapacitated'],
    ]);
  });

  it('reads a 2024 feature another book lends as 2024', () => {
    const types = of(
      emit('aura of warding|oath of the ancients', sub('oath of the ancients|wow'), {
        from: 'xphb',
      }),
      'resist',
    ).map((e) => e.damageType);
    expect(types).toEqual(['necrotic', 'psychic', 'radiant']);
  });

  it("keeps the aura's note on a picked resistance", () => {
    const doc = newCharacterDoc('c', 'H', 't');
    const uid = 'oath of the noble genies|xphb';
    doc.choices[`subclass:${uid}:elemental-shielding`] = ['fire'];
    const col = new Collector(doc, empty);
    emitStandingEffects(
      col,
      'aura of elemental shielding|oath of the noble genies',
      sub(uid),
      undefined,
      7,
    );
    expect(of(col, 'resist').map((e) => [e.damageType, e.note])).toEqual([
      ['fire', 'not while incapacitated'],
    ]);
  });

  it('names the skills as the data does', () => {
    const col = emit('beguiling influence|phb', {
      label: 'Beguiling Influence',
      uid: 'beguiling influence|phb',
      type: 'class',
    });
    expect(of(col, 'skillProf').map((e) => e.skill)).toEqual(['Deception', 'Persuasion']);
  });

  it('gives the speed Bestial Soul picks, and none for the jump', () => {
    const speeds = (pick?: string) => {
      const doc = newCharacterDoc('c', 'H', 't');
      const uid = 'path of the beast|tce';
      if (pick !== undefined) doc.choices[`subclass:${uid}:bestial-soul`] = [pick];
      const col = new Collector(doc, empty);
      emitStandingEffects(col, 'bestial soul|path of the beast', sub(uid), undefined, 6);
      return { modes: of(col, 'moveSpeed').map((e) => e.mode), open: col.pending.length };
    };
    expect(speeds()).toEqual({ modes: [], open: 1 });
    expect(speeds('swim')).toEqual({ modes: ['swim'], open: 0 });
    expect(speeds('climb')).toEqual({ modes: ['climb'], open: 0 });
    expect(speeds('jump')).toEqual({ modes: [], open: 0 });
  });

  it("resists the type of the god whose cantrip Dread Allegiance's subclass picked", () => {
    const uid = 'scion of the three|frhof';
    const resisted = (cantrip?: string, fromUid = uid) => {
      const col = new Collector(newCharacterDoc('c', 'H', 't'), empty);
      if (cantrip !== undefined)
        col.add({
          kind: 'grantSpell',
          spell: { name: cantrip, source: 'XPHB' },
          origin: { label: 'Scion', uid: fromUid, type: 'subclass' },
        });
      emitStandingEffects(col, 'dread allegiance|scion of the three', sub(uid), undefined, 3);
      return of(col, 'resist').map((e) => e.damageType);
    };
    expect(resisted('Chill Touch')).toEqual(['necrotic']);
    expect(resisted('blade ward')).toEqual(['poison']);
    expect(resisted('Minor Illusion')).toEqual(['psychic']);
    expect(resisted()).toEqual([]);
    expect(resisted('Chill Touch', 'other|x')).toEqual([]);
  });

  it('asks the Fiend which type to resist, with 2024 leaving out force', () => {
    const options = (key: string, uid: string) => {
      const col = emit(key, sub(uid));
      return col.pending.map((p) => p.options.map((o) => o.id).includes('force'));
    };
    expect(options('fiendish resilience|the fiend', 'the fiend|phb')).toEqual([true]);
    expect(options('fiendish resilience|fiend patron', 'fiend patron|xphb')).toEqual([false]);
  });
});

describe('darkvision that grows on darkvision already had', () => {
  const had = (range: number, type: EffectOrigin['type'], sense = 'darkvision') => {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), empty);
    if (range > 0)
      col.add({
        kind: 'sense',
        sense,
        range,
        origin: { label: 'Before', uid: 'b', type },
      });
    return col;
  };
  const umbral = (col: Collector, uid: string) => {
    emitStandingEffects(col, 'umbral sight|gloom stalker', sub(uid), undefined, 3);
    return of(col, 'sense').at(-1)?.range;
  };

  it('gives 60 feet to a character with none', () => {
    expect(umbral(had(0, 'race'), 'gloom stalker|xge')).toBe(60);
    expect(umbral(had(0, 'race'), 'gloom stalker|xphb')).toBe(60);
  });

  it('adds 30 to a race’s in 2014 and 60 to any in 2024', () => {
    expect(umbral(had(60, 'race'), 'gloom stalker|xge')).toBe(90);
    expect(umbral(had(60, 'race'), 'gloom stalker|xphb')).toBe(120);
    expect(umbral(had(60, 'feat'), 'gloom stalker|xphb')).toBe(120);
  });

  it('does not add to darkvision that is not the race’s in 2014', () => {
    expect(umbral(had(60, 'feat'), 'gloom stalker|xge')).toBe(60);
  });

  it('reads darkvision however it is spelled', () => {
    expect(umbral(had(60, 'race', 'Darkvision'), 'gloom stalker|xge')).toBe(90);
  });
});

describe('a save proficiency, or a pick when it is had already', () => {
  const withSave = (has: boolean, stored?: string) => {
    const doc = newCharacterDoc('c', 'H', 't');
    const origin = sub('gloom stalker|xge', 'Iron Mind');
    if (stored !== undefined) doc.choices[`subclass:gloom stalker|xge:save:iron mind`] = [stored];
    const col = new Collector(doc, empty);
    if (has)
      col.add({
        kind: 'saveProf',
        ability: 'wis',
        origin: { label: 'Class', uid: 'c', type: 'class' },
      });
    emitStandingEffects(col, 'iron mind|gloom stalker', origin, undefined, 7);
    return col;
  };

  it('gives Wisdom saves to a character without them', () => {
    const col = withSave(false);
    expect(of(col, 'saveProf').map((e) => e.ability)).toEqual(['wis']);
    expect(col.pending).toEqual([]);
  });

  it('asks Intelligence or Charisma of a character that has them', () => {
    const col = withSave(true);
    expect(col.pending.map((p) => [p.label, p.options.map((o) => o.id)])).toEqual([
      ['Iron Mind: saving throw', ['int', 'cha']],
    ]);
    const picked = withSave(true, 'cha');
    expect(of(picked, 'saveProf').map((e) => e.ability)).toEqual(['wis', 'cha']);
  });
});

// Through the class walker and the optional feature reader, on the test world.
const subclass: DataEntity = {
  name: 'Gloom Stalker',
  shortName: 'Gloom',
  source: 'TSX',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: ['Umbral Sight|Warrior|TST|Gloom|TSX|3', 'Iron Mind|Warrior|TST|Gloom|TSX|7'],
  optionalfeatureProgression: [{ name: 'Gifts', featureType: ['GF'], progression: { '3': 1 } }],
};
const subclassFeatures: DataEntity[] = [
  ['Umbral Sight', 3],
  ['Iron Mind', 7],
].map(([name, level]) => ({
  name,
  source: 'TSX',
  className: 'Warrior',
  classSource: 'TST',
  subclassShortName: 'Gloom',
  subclassSource: 'TSX',
  level,
  entries: ['Prose the scan has nothing to read in.'],
}));
// Two features of one name, as Storm Aura's and Storm Soul's options are.
const herald: DataEntity = {
  name: 'Path of the Storm Herald',
  shortName: 'Storm',
  source: 'TSX',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: ['Desert|Warrior|TST|Storm|TSX|3', 'Desert|Warrior|TST|Storm|TSX|6'],
};
const deserts: DataEntity[] = [3, 6].map((level) => ({
  name: 'Desert',
  source: 'TSX',
  className: 'Warrior',
  classSource: 'TST',
  subclassShortName: 'Storm',
  subclassSource: 'TSX',
  level,
  entries: [`The desert, at ${level}.`],
}));
// Elegant Courtier has a curated row (its Persuasion bonus) and a standing one (its
// save); Guarded Mind has prose the scan reads into uses, and a standing resistance.
const samurai: DataEntity = {
  name: 'Samurai',
  shortName: 'Samurai',
  source: 'TSX',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: ['Elegant Courtier|Warrior|TST|Samurai|TSX|7'],
};
const psi: DataEntity = {
  name: 'Psi Warrior',
  shortName: 'Psi',
  source: 'TSX',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: ['Guarded Mind|Warrior|TST|Psi|TSX|10'],
};
const courtly: DataEntity[] = [
  {
    name: 'Elegant Courtier',
    source: 'TSX',
    className: 'Warrior',
    classSource: 'TST',
    subclassShortName: 'Samurai',
    subclassSource: 'TSX',
    level: 7,
    entries: ['Prose the scan has nothing to read in.'],
  },
  {
    name: 'Guarded Mind',
    source: 'TSX',
    className: 'Warrior',
    classSource: 'TST',
    subclassShortName: 'Psi',
    subclassSource: 'TSX',
    level: 10,
    entries: [
      'You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.',
    ],
  },
];
// The Storm Herald copied: in the Workshop under new names (`basedOn`), and
// converted from another file under its own (`printingOf`).
const squall: DataEntity = {
  name: 'Path of the Squall',
  shortName: 'Squall',
  source: 'HB',
  className: 'Warrior',
  classSource: 'TST',
  subclassFeatures: ['Dune|Warrior|TST|Squall|HB|3', 'Dune|Warrior|TST|Squall|HB|6'],
  castGuidance: { v: 1, basedOn: 'Path of the Storm Herald|TSX' },
};
const dunes: DataEntity[] = [3, 6].map((level) => ({
  name: 'Dune',
  source: 'HB',
  className: 'Warrior',
  classSource: 'TST',
  subclassShortName: 'Squall',
  subclassSource: 'HB',
  level,
  entries: [`The dunes, at ${level}.`],
  castGuidance: { v: 1, basedOn: 'Desert|TSX' },
}));
// Named otherwise, so only `printingOf` leads to the official feature's row.
const convertedHerald: DataEntity = {
  ...herald,
  source: 'CNV',
  subclassFeatures: ['Sandstorm|Warrior|TST|Storm|CNV|3', 'Sandstorm|Warrior|TST|Storm|CNV|6'],
};
const convertedDeserts: DataEntity[] = deserts.map((d) => ({
  ...d,
  name: 'Sandstorm',
  source: 'CNV',
  subclassSource: 'CNV',
  printingOf: ['Desert|TSX'],
}));
const sight: DataEntity = {
  name: "Devil's Sight",
  source: 'PHB',
  featureType: ['GF'],
  entries: ['You see in darkness.'],
};
const sights: DataEntity[] = [
  sight,
  {
    ...sight,
    name: 'Night Eyes',
    source: 'HB',
    castGuidance: { v: 1, basedOn: "Devil's Sight|PHB" },
  },
  { ...sight, source: 'CNV', printingOf: ["Devil's Sight|PHB"] },
];
const SUBCLASSES = [subclass, herald, samurai, psi, squall, convertedHerald];
const FEATURES = [...subclassFeatures, ...deserts, ...courtly, ...dunes, ...convertedDeserts];
const named = (list: DataEntity[], name: string, source?: string) =>
  list.find(
    (e) =>
      String(e.name).toLowerCase() === name.toLowerCase() &&
      (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
  );
const world = makeTestContext();
const ctx: EngineContext = {
  get: (type, name, source) =>
    (type === 'subclass'
      ? named(SUBCLASSES, name, source)
      : type === 'subclassFeature'
        ? named(FEATURES, name, source)
        : type === 'optionalfeature'
          ? named(sights, name, source)
          : undefined) ?? world.get(type, name, source),
  byType: (type) =>
    type === 'optionalfeature'
      ? [...world.byType(type), ...sights]
      : type === 'subclassFeature'
        ? [...world.byType(type), ...FEATURES]
        : world.byType(type),
};

function stalker(levels: number): CharacterDoc {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.classes = [
    {
      ref: { name: 'Warrior', source: 'TST' },
      subclass: { name: 'Gloom Stalker', source: 'TSX' },
      levels,
      hp: [],
    },
  ];
  return doc;
}

describe('standing rows on a derived sheet', () => {
  it('adds to the race’s darkvision, shown once at its longest', () => {
    const sheet = deriveSheet(stalker(3), ctx);
    expect(sheet.senses).toEqual([{ sense: 'darkvision', range: 90, origin: 'Umbral Sight' }]);
  });

  it('gives a save proficiency at the level the feature comes', () => {
    expect(deriveSheet(stalker(6), ctx).saves.wis.prof).toBe(false);
    expect(deriveSheet(stalker(7), ctx).saves.wis.prof).toBe(true);
  });

  it('passes each feature the level it comes at', () => {
    const fire = (levels: number) => {
      const doc = stalker(levels);
      const [cls] = doc.classes;
      if (cls !== undefined) cls.subclass = { name: 'Path of the Storm Herald', source: 'TSX' };
      return deriveSheet(doc, ctx).resists.map((r) => r.damageType);
    };
    expect(fire(5)).toEqual([]);
    expect(fire(6)).toEqual(['fire']);
  });

  const asSubclass = (name: string, levels: number, source = 'TSX') => {
    const doc = stalker(levels);
    const [cls] = doc.classes;
    if (cls !== undefined) cls.subclass = { name, source };
    return deriveSheet(doc, ctx);
  };

  it("reads the copied feature's row at the level the copy comes at", () => {
    for (const [name, source] of [
      ['Path of the Squall', 'HB'],
      ['Path of the Storm Herald', 'CNV'],
    ] as const) {
      const fire = (levels: number) =>
        asSubclass(name, levels, source).resists.map((r) => r.damageType);
      expect(fire(5), source).toEqual([]);
      expect(fire(6), source).toEqual(['fire']);
      expect(fire(14), source).toEqual(['fire']);
    }
  });

  it('adds to a curated row on the same feature', () => {
    const sheet = asSubclass('Samurai', 7);
    expect(sheet.saves.wis.prof).toBe(true);
    expect(sheet.skills.Persuasion?.total.parts.map((p) => p.label)).toContain('Elegant Courtier');
  });

  it('adds to what the scan reads in the same feature', () => {
    const sheet = asSubclass('Psi Warrior', 10);
    expect(sheet.resists.map((r) => r.damageType)).toEqual(['psychic']);
    expect(sheet.resources.map((r) => r.label)).toContain('Guarded Mind');
  });

  it("reads a picked optional feature's row, official or copied", () => {
    for (const uid of ["devil's sight|phb", 'night eyes|hb', "devil's sight|cnv"]) {
      const doc = stalker(3);
      const id = deriveSheet(doc, ctx).pending.find((p) => p.label === 'Gifts')?.id;
      expect(id).toBeDefined();
      doc.choices[id ?? ''] = [uid];
      expect(
        deriveSheet(doc, ctx).senses.map((s) => [s.sense, s.range]),
        uid,
      ).toContainEqual(["devil's sight", 120]);
    }
  });
});
