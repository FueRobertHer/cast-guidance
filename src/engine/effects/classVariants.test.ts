import { describe, expect, it } from 'vitest';
import {
  classVariantDoc,
  makeClassVariantContext,
} from '../../../tests-fixtures/classVariantWorld';
import { deriveSheet } from '../derive';
import type { CharacterDoc, DataEntity, DerivedSheet, EngineContext } from '../types';
import { optionSummary, replacedFeatureName } from './classVariants';

const ctx = makeClassVariantContext();
const derive = (doc: CharacterDoc) => deriveSheet(doc, ctx);
const names = (sheet: DerivedSheet) => sheet.features.map((f) => f.name);
const variantPrompts = (sheet: DerivedSheet) =>
  sheet.pending.filter((p) => p.id.includes(':variant:'));

const RANGER = { name: 'Ranger', source: 'PHB' };
const BEAST_MASTER = { name: 'Beast Master', source: 'PHB' };
const CLERIC = { name: 'Cleric', source: 'PHB' };
const LIFE = { name: 'Life Domain', source: 'PHB' };
const RANGER_2024 = { name: 'Ranger', source: 'XPHB' };

const FOE = 'class:ranger|phb:variant:favored foe:1';
const DEFT = 'class:ranger|phb:variant:deft explorer:1';
const FOCUS = 'class:ranger|phb:variant:spellcasting focus:2';
const PRIMAL = 'class:ranger|phb:variant:primal awareness:3';
const VEIL = "class:ranger|phb:variant:nature's veil:10";
const COMPANION = 'subclass:beast master|phb:variant:primal companion:3';
const BLESSED = 'subclass:life domain|phb:variant:blessed strikes:8';
const PET = 'class:ranger|xphb:variant:pet specialization:6';

const TASHA_RANGER = [
  'Favored Foe',
  'Deft Explorer',
  'Spellcasting Focus',
  'Primal Awareness',
  'Deft Explorer Improvement',
  "Nature's Veil",
  'Primal Companion',
];
const PRINTED_RANGER = [
  'Favored Enemy',
  'Natural Explorer',
  'Primeval Awareness',
  'Favored Enemy and Natural Explorer improvements',
  'Hide in Plain Sight',
  'Natural Explorer improvement',
  'Favored Enemy improvement',
  "Ranger's Companion",
];

describe('optional class features, rule off (the default)', () => {
  it('gives a 2014 Ranger none of Tasha’s, keeps every printed feature, and asks nothing', () => {
    const sheet = derive(classVariantDoc(RANGER, 20, { subclass: BEAST_MASTER }));
    for (const n of TASHA_RANGER) expect(names(sheet)).not.toContain(n);
    for (const n of PRINTED_RANGER) expect(names(sheet)).toContain(n);
    expect(variantPrompts(sheet)).toEqual([]);
    expect(sheet.actions.some((a) => a.label === "Nature's Veil")).toBe(false);
    // Build offers the rule: 7 in the class's list, 1 inside the Beast Master's.
    expect(sheet.classVariantCount).toBe(8);
  });

  it('gives a 2024 Ranger Roving and not Pet Specialization', () => {
    const sheet = derive(classVariantDoc(RANGER_2024, 6));
    expect(names(sheet)).toEqual(['Roving']);
    expect(sheet.classVariantCount).toBe(1);
    // Below the variant's level there is nothing to offer.
    expect(derive(classVariantDoc(RANGER_2024, 5)).classVariantCount).toBe(0);
  });

  it('ignores a pick saved while the rule was on, without a warning', () => {
    const sheet = derive(
      classVariantDoc(RANGER, 20, {
        choices: { [FOE]: ['favored foe'], [VEIL]: ["nature's veil"] },
      }),
    );
    expect(names(sheet)).toContain('Favored Enemy');
    expect(names(sheet)).not.toContain('Favored Foe');
    expect(names(sheet)).not.toContain("Nature's Veil");
    expect(sheet.warnings).toEqual([]);
  });
});

describe('optional class features, rule on', () => {
  it('asks each one as a pick in the list’s order, keeping the class as printed until then', () => {
    const sheet = derive(classVariantDoc(RANGER, 20, { subclass: BEAST_MASTER, rule: true }));
    expect(variantPrompts(sheet).map((p) => [p.id, p.label])).toEqual([
      [FOE, 'Level 1: Favored Enemy or Favored Foe'],
      [DEFT, 'Level 1: Natural Explorer or Deft Explorer'],
      [FOCUS, 'Level 2: Spellcasting Focus (optional)'],
      [PRIMAL, 'Level 3: Primeval Awareness or Primal Awareness'],
      [VEIL, "Level 10: Hide in Plain Sight or Nature's Veil"],
      [COMPANION, "Level 3: Ranger's Companion or Primal Companion"],
    ]);
    for (const n of TASHA_RANGER) expect(names(sheet)).not.toContain(n);
    for (const n of PRINTED_RANGER) expect(names(sheet)).toContain(n);
    expect(sheet.warnings).toEqual([]);
  });

  it('offers the printed feature and the variant, each with its text', () => {
    const sheet = derive(classVariantDoc(RANGER, 1, { rule: true }));
    const prompt = sheet.pending.find((p) => p.id === FOE);
    expect(prompt).toMatchObject({
      kind: 'feature',
      count: 1,
      origin: { type: 'class', uid: 'ranger|phb' },
    });
    expect(prompt?.options.map((o) => [o.id, o.label])).toEqual([
      ['favored enemy', 'Favored Enemy'],
      ['favored foe', 'Favored Foe'],
    ]);
    expect(prompt?.options[1]?.entries).toEqual([
      expect.stringContaining('which replaces the Favored Enemy feature'),
      'Placeholder text.',
    ]);
    // The summary skips the opening note, which the label already says.
    expect(prompt?.options.map((o) => o.description)).toEqual([
      'Placeholder text.',
      'Placeholder text.',
    ]);
  });

  it('takes the picked variants in place of what they replace, improvements included', () => {
    const sheet = derive(
      classVariantDoc(RANGER, 20, {
        subclass: BEAST_MASTER,
        rule: true,
        choices: {
          [FOE]: ['favored foe'],
          [DEFT]: ['deft explorer'],
          [VEIL]: ["nature's veil"],
          [COMPANION]: ['primal companion'],
        },
      }),
    );
    const got = names(sheet);
    for (const n of ['Favored Foe', 'Deft Explorer', "Nature's Veil", 'Primal Companion']) {
      expect(got).toContain(n);
    }
    // Deft Explorer's improvements come with it, at both levels, asking nothing.
    expect(got.filter((n) => n === 'Deft Explorer Improvement')).toHaveLength(2);
    for (const n of [
      'Favored Enemy',
      'Natural Explorer',
      'Hide in Plain Sight',
      "Ranger's Companion",
      'Favored Enemy improvement',
      'Natural Explorer improvement',
      // Both features it improves are replaced.
      'Favored Enemy and Natural Explorer improvements',
    ]) {
      expect(got).not.toContain(n);
    }
    // Unpicked, Primal Awareness stays open and Primeval Awareness stays.
    expect(got).toContain('Primeval Awareness');
    expect(variantPrompts(sheet).map((p) => p.id)).toEqual([FOCUS, PRIMAL]);
    // The variant's effects arrive with it.
    expect(sheet.actions).toContainEqual(
      expect.objectContaining({ label: "Nature's Veil", economy: 'bonus' }),
    );
    expect(sheet.resolvedChoices.map((r) => r.prompt.id)).toEqual(
      expect.arrayContaining([FOE, DEFT, VEIL, COMPANION]),
    );
  });

  it('keeps an improvement while any feature it names is still printed', () => {
    const sheet = derive(
      classVariantDoc(RANGER, 20, { rule: true, choices: { [FOE]: ['favored foe'] } }),
    );
    expect(names(sheet)).not.toContain('Favored Enemy improvement');
    expect(names(sheet)).toContain('Favored Enemy and Natural Explorer improvements');
    expect(names(sheet)).toContain('Natural Explorer improvement');
    expect(names(sheet)).not.toContain('Deft Explorer Improvement');
  });

  it('settles the pick on the printed feature, changing nothing on the sheet', () => {
    const open = derive(classVariantDoc(RANGER, 1, { rule: true }));
    const printed = derive(
      classVariantDoc(RANGER, 1, { rule: true, choices: { [FOE]: ['favored enemy'] } }),
    );
    expect(names(printed)).toEqual(names(open));
    expect(printed.pending.some((p) => p.id === FOE)).toBe(false);
    expect(printed.resolvedChoices).toContainEqual(
      expect.objectContaining({ selected: ['favored enemy'] }),
    );
  });

  it('asks an addition as taken or not', () => {
    const sheet = derive(classVariantDoc(RANGER, 2, { rule: true }));
    expect(
      sheet.pending.find((p) => p.id === FOCUS)?.options.map((o) => [o.id, o.description]),
    ).toEqual([
      ['spellcasting focus', 'Placeholder text.'],
      ['not taken', 'The class as printed, without this optional feature.'],
    ]);
    const without = derive(
      classVariantDoc(RANGER, 2, { rule: true, choices: { [FOCUS]: ['not taken'] } }),
    );
    expect(names(without)).not.toContain('Spellcasting Focus');
    expect(without.pending.some((p) => p.id === FOCUS)).toBe(false);
    const taken = derive(
      classVariantDoc(RANGER, 2, { rule: true, choices: { [FOCUS]: ['spellcasting focus'] } }),
    );
    expect(names(taken)).toContain('Spellcasting Focus');
  });

  it('reopens a saved pick that names neither, with a warning, and keeps the printed one', () => {
    const sheet = derive(
      classVariantDoc(RANGER, 1, { rule: true, choices: { [FOE]: ['favoured foe'] } }),
    );
    expect(sheet.pending.some((p) => p.id === FOE)).toBe(true);
    expect(sheet.warnings).toContainEqual(expect.stringContaining('“favoured foe”'));
    expect(names(sheet)).toContain('Favored Enemy');
    expect(names(sheet)).not.toContain('Favored Foe');
  });

  it('pairs a 2014 domain’s Blessed Strikes with its Divine Strike', () => {
    const open = derive(classVariantDoc(CLERIC, 8, { subclass: LIFE, rule: true }));
    const prompt = open.pending.find((p) => p.id === BLESSED);
    expect(prompt).toMatchObject({
      label: 'Level 8: Divine Strike or Blessed Strikes',
      origin: { type: 'subclass', uid: 'life domain|phb' },
    });
    expect(names(open)).toContain('Divine Strike');
    const taken = derive(
      classVariantDoc(CLERIC, 8, {
        subclass: LIFE,
        rule: true,
        choices: { [BLESSED]: ['blessed strikes'] },
      }),
    );
    expect(names(taken)).toContain('Blessed Strikes');
    expect(names(taken)).not.toContain('Divine Strike');
  });

  it('offers a 2024 Ranger Pet Specialization in place of Roving, from level 6', () => {
    expect(variantPrompts(derive(classVariantDoc(RANGER_2024, 5, { rule: true })))).toEqual([]);
    const open = derive(classVariantDoc(RANGER_2024, 6, { rule: true }));
    expect(variantPrompts(open).map((p) => [p.id, p.label])).toEqual([
      [PET, 'Level 6: Roving or Pet Specialization'],
    ]);
    expect(open.pending.find((p) => p.id === PET)?.options[1]?.description).toBe(
      'Placeholder text.',
    );
    expect(names(open)).toEqual(['Roving']);
    const taken = derive(
      classVariantDoc(RANGER_2024, 6, {
        rule: true,
        choices: { [PET]: ['pet specialization'] },
      }),
    );
    expect(names(taken)).toEqual(['Pet Specialization']);
  });

  it('leaves a ref its class list holds to that list, asking its pick once', () => {
    // A homebrew shape: Favored Foe in the class's list and inside another feature.
    const wanderer: DataEntity = {
      name: 'Wanderer',
      source: 'PHB',
      className: 'Ranger',
      classSource: 'PHB',
      level: 1,
      entries: [
        'Placeholder text.',
        { type: 'refClassFeature', classFeature: 'Favored Enemy|Ranger||1' },
        { type: 'refClassFeature', classFeature: 'Favored Foe|Ranger||1|TCE' },
      ],
    };
    const ranger: DataEntity = {
      ...ctx.get('class', 'Ranger', 'PHB'),
      classFeatures: ['Wanderer|Ranger||1', 'Favored Foe|Ranger||1|TCE'],
    };
    const world: EngineContext = {
      get: (t, n, s) =>
        t === 'class' && n === 'Ranger' && s === 'PHB' ? ranger : ctx.get(t, n, s),
      byType: (t) => (t === 'classFeature' ? [wanderer, ...ctx.byType(t)] : ctx.byType(t)),
    };
    const sheet = deriveSheet(
      classVariantDoc(RANGER, 1, { rule: true, choices: { [FOE]: ['favored foe'] } }),
      world,
    );
    const asked = [
      ...sheet.pending.map((p) => p.id),
      ...sheet.resolvedChoices.map((r) => r.prompt.id),
    ].filter((id) => id === FOE);
    expect(asked).toHaveLength(1);
    expect(sheet.warnings).toEqual([]);
    expect(names(sheet)).toContain('Favored Foe');
  });
});

describe('optionSummary', () => {
  const note = (entries: unknown[], variant = true): DataEntity => ({
    name: 'X',
    ...(variant ? { isClassFeatureVariant: true } : {}),
    entries,
  });

  it('skips Tasha’s italic opening line, on a variant or a printed feature', () => {
    expect(
      optionSummary(
        note([
          '{@i 3rd-level rogue {@variantrule optional class features|tce|optional feature}}',
          'What it does.',
        ]),
      ),
    ).toBe('What it does.');
    expect(
      optionSummary(note(['{@i 8th-level Twilight Domain feature}', 'What it does.'], false)),
    ).toBe('What it does.');
  });

  it('skips a variant’s line naming what it replaces, and nothing else', () => {
    const line = 'This feature replaces the {@classFeature Roving|Ranger|XPHB|6} feature for some.';
    expect(optionSummary(note([line, 'What it does.']))).toBe('What it does.');
    expect(optionSummary(note([line, 'What it does.'], false))).toBe(
      'This feature replaces the Roving feature for some.',
    );
    expect(optionSummary(note(['What it does.', 'More.']))).toBe('What it does.');
    expect(optionSummary(note(['{@i Only line.}']))).toBe('Only line.');
  });
});

describe('replacedFeatureName', () => {
  it('reads Tasha’s italic note and a sentence naming the feature by tag', () => {
    expect(
      replacedFeatureName({
        name: 'Favored Foe',
        entries: [
          '{@i 1st-level ranger {@variantrule optional class features|tce|optional feature}, which replaces the Favored Enemy feature and works with the Foe Slayer feature}',
        ],
      }),
    ).toBe('Favored Enemy');
    expect(
      replacedFeatureName({
        name: 'Pet Specialization',
        entries: [
          'This feature replaces the {@classFeature Roving|Ranger|XPHB|6} feature for some.',
        ],
      }),
    ).toBe('Roving');
  });

  it('reads only the opening line, and nothing when it names no feature', () => {
    expect(
      replacedFeatureName({
        name: 'Cantrip Versatility',
        entries: [
          '{@i 4th-level cleric optional feature}',
          'You can replace one cantrip you learned with another.',
        ],
      }),
    ).toBeUndefined();
    expect(
      replacedFeatureName({
        name: 'Later',
        entries: ['Placeholder.', 'This replaces the Grit feature.'],
      }),
    ).toBeUndefined();
  });
});
