import { describe, expect, it } from 'vitest';
import { deriveSheet } from '../derive';
import { type CharacterDoc, type DataEntity, type EngineContext, newCharacterDoc } from '../types';

/**
 * Feats granted by category: a class's or subclass's `featProgression` (the
 * 2024 Fighting Style at Fighter 1, Paladin and Ranger 2, Champion 7) and a
 * species' `feats` (the 2024 Human's Origin feat, a Variant Human's feat).
 * Shaped as v2.41.0 writes them: `featProgression` entries name a list of
 * categories and a progression by level; a species' `anyFromCategory` names
 * its category as a list. The prose is placeholder.
 */
const feature = (name: string, className: string, level: number): DataEntity => ({
  name,
  source: 'TST',
  className,
  classSource: 'TST',
  level,
  entries: ['Placeholder text.'],
});

const feat = (name: string, category: string, extra: DataEntity = {}): DataEntity => ({
  name,
  source: 'TST',
  category,
  entries: ['Placeholder text.'],
  ...extra,
});

const WORLD: Record<string, DataEntity[]> = {
  class: [
    {
      name: 'Knight',
      source: 'TST',
      hd: { number: 1, faces: 10 },
      proficiency: ['str', 'cha'],
      classFeatures: [
        'Fighting Style|Knight|TST|2',
        'Ability Score Improvement|Knight|TST|4',
        { classFeature: 'Knight Path|Knight|TST|3', gainSubclassFeature: true },
        'Epic Boon|Knight|TST|19',
      ],
      featProgression: [
        { name: 'Fighting Style', category: ['FS', 'FS:K'], progression: { '2': 1 } },
        { name: 'Epic Boon', category: ['EB'], progression: { '19': 1 } },
      ],
    },
    // A homebrew class with an Epic Boon in its progression but no Epic Boon
    // feature: the progression is the only thing that asks.
    {
      name: 'Boonless',
      source: 'TST',
      hd: { number: 1, faces: 8 },
      proficiency: ['wis'],
      classFeatures: [],
      featProgression: [{ name: 'Epic Boon', category: ['EB'], progression: { '19': 1 } }],
    },
    // One whose Epic Boon feature comes a level after its progression's: the
    // feature does not ask for the progression's pick, so both stand.
    {
      name: 'Late',
      source: 'TST',
      hd: { number: 1, faces: 8 },
      proficiency: ['wis'],
      classFeatures: ['Epic Boon|Late|TST|20'],
      featProgression: [{ name: 'Epic Boon', category: ['EB'], progression: { '19': 1 } }],
    },
  ],
  classFeature: [
    feature('Fighting Style', 'Knight', 2),
    feature('Ability Score Improvement', 'Knight', 4),
    feature('Knight Path', 'Knight', 3),
    feature('Epic Boon', 'Knight', 19),
    feature('Epic Boon', 'Late', 20),
  ],
  subclass: [
    {
      name: 'Champion',
      shortName: 'Champion',
      source: 'TST',
      className: 'Knight',
      classSource: 'TST',
      subclassFeatures: [],
      featProgression: [{ name: 'Fighting Style', category: ['FS'], progression: { '7': 1 } }],
    },
  ],
  feat: [
    feat('Defense', 'FS'),
    feat('Dueling', 'FS'),
    feat('Oathsworn', 'FS:K', {
      skillProficiencies: [{ religion: true, choose: { from: ['history', 'insight'] } }],
    }),
    feat('Alert', 'O'),
    feat('Skilled', 'O', { repeatable: true, skillProficiencies: [{ any: 1 }] }),
    feat('Grit', 'G'),
    feat('Boon of Testing', 'EB'),
    feat('Dark Pact', 'DG'),
  ],
  race: [
    {
      name: 'Human',
      source: 'TST',
      size: ['M'],
      speed: 30,
      feats: [{ anyFromCategory: { category: ['O'], count: 1 } }],
      entries: [{ type: 'entries', name: 'Versatile', entries: ['Placeholder text.'] }],
    },
  ],
  subrace: [
    {
      name: 'Variant',
      source: 'TST',
      raceName: 'Human',
      raceSource: 'TST',
      feats: [{ any: 1 }],
      entries: [{ type: 'entries', name: 'Feat', entries: ['Placeholder text.'] }],
    },
  ],
  background: [
    { name: 'Guard', source: 'TST', feats: [{ 'alert|tst': true }], entries: ['Placeholder.'] },
    { name: 'Haunted', source: 'TST', feats: [{ anyFromCategory: { category: ['DG'] } }] },
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

function knight(levels: number, choices: CharacterDoc['choices'] = {}, champion = false) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.rulesVersion = '2024';
  doc.classes = [
    {
      ref: { name: 'Knight', source: 'TST' },
      levels,
      hp: [],
      ...(champion ? { subclass: { name: 'Champion', source: 'TST' } } : {}),
    },
  ];
  doc.choices = choices;
  return doc;
}

const STYLE = 'class:knight|tst:feats:fighting style:feat';
const prompt = (doc: CharacterDoc, id: string) =>
  deriveSheet(doc, ctx).pending.find((p) => p.id === id);

describe('class featProgression', () => {
  it("asks for a Fighting Style feat at the progression's level, and not before", () => {
    expect(prompt(knight(1), STYLE)).toBeUndefined();
    const style = prompt(knight(2), STYLE);
    expect(style?.kind).toBe('feat');
    expect(style?.label).toBe('Level 2: Fighting Style, choose a feat');
    // Every category it lists, the class's own option among them, and no other.
    expect(style?.options.map((o) => o.id)).toEqual([
      'defense|tst',
      'dueling|tst',
      'oathsworn|tst',
    ]);
  });

  it('collects the picked feat, with its own picks under the progression', () => {
    const sheet = deriveSheet(knight(2, { [STYLE]: ['oathsworn|tst'] }), ctx);
    expect(sheet.pending.map((p) => p.id)).not.toContain(STYLE);
    expect(sheet.features.map((f) => f.name)).toContain('Oathsworn');
    expect(sheet.skills.Religion?.prof).toBe(1);
    expect(sheet.pending.map((p) => p.id)).toContain(
      'feat:oathsworn|tst:feats:fighting style@knight|tst:skill:0',
    );
  });

  it("does not let a Champion's second style repeat the class's first", () => {
    const doc = knight(7, { [STYLE]: ['defense|tst'] }, true);
    const second = prompt(doc, 'subclass:champion|tst:feats:fighting style:feat');
    expect(second?.label).toBe('Level 7: Fighting Style, choose a feat');
    expect(second?.options.find((o) => o.id === 'defense|tst')?.disabled).toBeDefined();
    expect(second?.options.find((o) => o.id === 'dueling|tst')?.disabled).toBeUndefined();
  });

  it('leaves the Epic Boon to its feature, which offers every feat', () => {
    const pending = deriveSheet(knight(19), ctx).pending.map((p) => p.id);
    expect(pending).toContain('class:knight|tst:asi:19:feat');
    expect(pending).not.toContain('class:knight|tst:feats:epic boon:feat');
  });

  it('asks for an Epic Boon in the progression when no feature does', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Boonless', source: 'TST' }, levels: 19, hp: [] }];
    const boon = prompt(doc, 'class:boonless|tst:feats:epic boon:feat');
    expect(boon?.options.map((o) => o.id)).toEqual(['boon of testing|tst']);
  });

  it('keeps an Epic Boon progression that no feature at its level asks for', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Late', source: 'TST' }, levels: 20, hp: [] }];
    const pending = deriveSheet(doc, ctx).pending.map((p) => p.id);
    expect(pending).toContain('class:late|tst:feats:epic boon:feat');
    expect(pending).toContain('class:late|tst:asi:20:feat');
  });
});

describe('species feats', () => {
  const human = (choices: CharacterDoc['choices'] = {}, variant = false, levels = 1) => {
    const doc = knight(levels, choices);
    doc.race = { name: 'Human', source: 'TST' };
    if (variant) doc.subrace = { name: 'Variant', source: 'TST' };
    return doc;
  };

  it("asks for a 2024 Human's Origin feat from the category it names in a list", () => {
    const pick = prompt(human(), 'race:human|tst:feat:0');
    expect(pick?.kind).toBe('feat');
    expect(pick?.origin.type).toBe('race');
    expect(pick?.label).toBe('Human: choose an Origin feat');
    expect(pick?.options.map((o) => o.id)).toEqual(['alert|tst', 'skilled|tst']);
  });

  it("collects the picked feat, whose own picks are kept under the species'", () => {
    const sheet = deriveSheet(human({ 'race:human|tst:feat:0': ['skilled|tst'] }), ctx);
    expect(sheet.features.map((f) => f.name)).toContain('Skilled');
    expect(sheet.pending.map((p) => p.id)).toContain('feat:skilled|tst:race:human|tst:skill:0');
  });

  it("asks for a Variant Human's feat from every feat", () => {
    const pick = prompt(human({}, true), 'subrace:variant|tst:feat:0');
    expect(pick?.options).toHaveLength(WORLD.feat?.length ?? 0);
  });

  it('marks a feat the background names as taken, though the background comes later', () => {
    const doc = human();
    doc.background = { name: 'Guard', source: 'TST' };
    const pick = prompt(doc, 'race:human|tst:feat:0');
    expect(pick?.options.find((o) => o.id === 'alert|tst')?.disabled).toBeDefined();
    // Repeatable, so it stays open.
    expect(pick?.options.find((o) => o.id === 'skilled|tst')?.disabled).toBeUndefined();
  });

  it("marks a species' feat as taken at a class's ASI", () => {
    const choices = { 'race:human|tst:feat:0': ['alert|tst'], 'class:knight|tst:asi:4': 'feat' };
    const asi = prompt(human(choices, false, 4), 'class:knight|tst:asi:4:feat');
    expect(asi?.options.find((o) => o.id === 'alert|tst')?.disabled).toBeDefined();
  });
});

describe('background feats by category', () => {
  it('narrows to a category the data names in a list', () => {
    const doc = knight(1);
    doc.background = { name: 'Haunted', source: 'TST' };
    const pick = prompt(doc, 'background:haunted|tst:feat:0');
    expect(pick?.label).toBe('Haunted: choose a Dark Gift feat');
    expect(pick?.options.map((o) => o.id)).toEqual(['dark pact|tst']);
  });
});
