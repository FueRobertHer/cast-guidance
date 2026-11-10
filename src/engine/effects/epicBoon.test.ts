import { describe, expect, it } from 'vitest';
import { deriveSheet } from '../derive';
import { type DataEntity, type EngineContext, newCharacterDoc } from '../types';

/**
 * The 2024 Epic Boon (class level 19): "an Epic Boon feat or another feat of your
 * choice for which you qualify". Shaped as v2.41.0 has it: the feature at 19 in
 * the class's list, and Epic Boon feats (category EB) whose `ability` entry is a
 * one-point choose with `max: 30`. The prose is placeholder.
 */
const feature = (name: string, className: string, level: number): DataEntity => ({
  name,
  source: 'TST',
  className,
  classSource: 'TST',
  level,
  entries: ['Placeholder text.'],
});

const classOf = (name: string, features: Array<[string, number]>): DataEntity => ({
  name,
  source: 'TST',
  hd: { number: 1, faces: 10 },
  proficiency: ['str', 'con'],
  classFeatures: features.map(([f, level]) => `${f}|${name}|TST|${level}`),
});

const WORLD: Record<string, DataEntity[]> = {
  class: [
    classOf('Sage', [
      ['Ability Score Improvement', 4],
      ['Epic Boon', 19],
    ]),
    // A homebrew class with an ASI and an Epic Boon at the same level: the ASI
    // holds that level's feat slot.
    classOf('Doubler', [
      ['Ability Score Improvement', 19],
      ['Epic Boon', 19],
    ]),
    // One whose ASI at 19 is listed but missing from the data: the Epic Boon is
    // the only feat slot that level has.
    classOf('Gappy', [
      ['Ability Score Improvement', 19],
      ['Epic Boon', 19],
    ]),
  ],
  classFeature: [
    feature('Ability Score Improvement', 'Sage', 4),
    feature('Epic Boon', 'Sage', 19),
    feature('Ability Score Improvement', 'Doubler', 19),
    feature('Epic Boon', 'Doubler', 19),
    feature('Epic Boon', 'Gappy', 19),
  ],
  feat: [
    {
      name: 'Boon of Testing',
      source: 'TST',
      category: 'EB',
      prerequisite: [{ level: 19 }],
      ability: [{ choose: { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'] }, max: 30 }],
      entries: ['Placeholder text.'],
    },
    {
      name: 'Low Cap',
      source: 'TST',
      category: 'G',
      ability: [{ str: 1, max: 18 }],
      entries: ['Placeholder text.'],
    },
    {
      name: 'Plain Feat',
      source: 'TST',
      category: 'G',
      ability: [{ choose: { from: ['str', 'dex'] } }],
      entries: ['Placeholder text.'],
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
  byType: (type) => WORLD[type] ?? [],
};

function sage(levels: number, str = 20) {
  const doc = newCharacterDoc('c', 'H', 't');
  doc.abilities.base.str = str;
  doc.classes = [{ ref: { name: 'Sage', source: 'TST' }, levels, hp: [] }];
  return doc;
}

describe('Epic Boon', () => {
  it('asks for a feat at 19, and not before', () => {
    expect(deriveSheet(sage(18), ctx).pending.map((p) => p.id)).not.toContain(
      'class:sage|tst:asi:19:feat',
    );
    const prompt = deriveSheet(sage(19), ctx).pending.find(
      (p) => p.id === 'class:sage|tst:asi:19:feat',
    );
    expect(prompt?.kind).toBe('feat');
    expect(prompt?.label).toBe('Level 19: Epic Boon, choose a feat');
    // Any feat, not only Epic Boons, and nothing in it asks ASI-or-feat first.
    expect(prompt?.options.map((o) => o.id)).toEqual([
      'boon of testing|tst',
      'low cap|tst',
      'plain feat|tst',
    ]);
    expect(deriveSheet(sage(19), ctx).pending.map((p) => p.id)).not.toContain(
      'class:sage|tst:asi:19',
    );
  });

  it("collects the picked feat, with its own picks under the ASI's instance", () => {
    const doc = sage(20);
    doc.choices['class:sage|tst:asi:19:feat'] = ['boon of testing|tst'];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.features.map((f) => f.name)).toContain('Boon of Testing');
    expect(sheet.pending.map((p) => p.id)).toContain('feat:boon of testing|tst:asi19:ability:c0');
  });

  it("raises a score past 20 to the boon's maximum of 30", () => {
    const doc = sage(20);
    doc.choices['class:sage|tst:asi:19:feat'] = ['boon of testing|tst'];
    doc.choices['feat:boon of testing|tst:asi19:ability:c0'] = ['str'];
    const str = deriveSheet(doc, ctx).abilities.str;
    expect(str.value).toBe(21);
  });

  it('keeps a feat without a maximum at 20', () => {
    const doc = sage(20);
    doc.choices['class:sage|tst:asi:19:feat'] = ['plain feat|tst'];
    doc.choices['feat:plain feat|tst:asi19:ability:c0'] = ['str'];
    expect(deriveSheet(doc, ctx).abilities.str.value).toBe(20);
  });

  it('never lowers a score with a maximum below it', () => {
    const doc = sage(20, 17);
    doc.choices['class:sage|tst:asi:19:feat'] = ['low cap|tst'];
    expect(deriveSheet(doc, ctx).abilities.str.value).toBe(18);
    doc.abilities.base.str = 20;
    expect(deriveSheet(doc, ctx).abilities.str.value).toBe(20);
  });

  it('opens the pick when the ASI listed at its level never runs', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Gappy', source: 'TST' }, levels: 19, hp: [] }];
    const sheet = deriveSheet(doc, ctx);
    expect(sheet.warnings).toContainEqual(expect.stringMatching(/Class feature not found/));
    expect(sheet.pending.map((p) => p.id)).toContain('class:gappy|tst:asi:19:feat');
  });

  it('leaves the slot to an ASI at the same level', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Doubler', source: 'TST' }, levels: 19, hp: [] }];
    const ids = deriveSheet(doc, ctx).pending.map((p) => p.id);
    expect(ids).toContain('class:doubler|tst:asi:19');
    expect(ids).not.toContain('class:doubler|tst:asi:19:feat');
    doc.choices['class:doubler|tst:asi:19'] = 'feat';
    const prompts = deriveSheet(doc, ctx).pending.filter(
      (p) => p.id === 'class:doubler|tst:asi:19:feat',
    );
    expect(prompts.map((p) => p.label)).toEqual(['Level 19: choose a feat']);
  });
});
