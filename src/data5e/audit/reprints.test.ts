import { describe, expect, it } from 'vitest';
import type { Entity } from '../copyMod';
import { normalizeDataset } from '../normalize';
import {
  emptyJudgments,
  type JudgmentFile,
  judgmentKey,
  parseJudgments,
  runJudgments,
  serializeJudgments,
  setTag,
} from './judgments';
import { CONFIDENT_NO, CONFIDENT_YES } from './proseChecks';
import {
  auditReprints,
  changedFields,
  describeReprints,
  labelReprint,
  REPRINT_SET,
  type ReprintPair,
  reprintPairs,
  reprintSubjects,
} from './reprints';

const registry = (files: Record<string, unknown>) =>
  normalizeDataset(new Map(Object.entries(files)));

/** A 2014 spell and its 2024 printing, identical unless a field is overridden. */
const spell = (fields: Entity = {}): Entity => ({
  name: 'Test Bolt',
  source: 'PHB',
  level: 1,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  range: { type: 'point', distance: { type: 'feet', amount: 60 } },
  components: { v: true, s: true },
  duration: [{ type: 'instant' }],
  entries: ['A test bolt deals {@damage 1d4} test damage.'],
  ...fields,
});

const reprinted = (fields: Entity = {}) => spell({ source: 'XPHB', ...fields });

const spells = (...list: Entity[]) => ({ 'spells/spells-test.json': { spell: list } });

const onePair = (from: Entity, to: Entity) => {
  const { pairs } = reprintPairs(
    registry(spells({ ...from, reprintedAs: ['Test Bolt|XPHB'] }, to)),
  );
  const pair = pairs[0];
  if (pair === undefined) throw new Error('no pair found');
  return pair;
};

describe('reprintPairs', () => {
  it('pairs a 2014 printing with its 2024 printing, labelling both in the state', () => {
    const pair = onePair(spell(), reprinted({ entries: ['A test bolt deals 1d6 test damage.'] }));
    expect(pair).toMatchObject({
      type: 'spell',
      from: 'test bolt|phb',
      to: 'test bolt|xphb',
      label: 'spell Test Bolt|PHB -> Test Bolt|XPHB',
      prose: 'differs',
      changedFields: [],
    });
    expect(pair.state).toBe(
      '2014 printing: Test Bolt\nA test bolt deals 1d4 test damage.\n\n2024 printing: Test Bolt\nA test bolt deals 1d6 test damage.',
    );
  });

  it('counts a link within one rules edition and leaves it out', () => {
    const found = reprintPairs(
      registry(
        spells({ ...spell(), reprintedAs: ['Test Bolt|XGE'] }, { ...spell(), source: 'XGE' }),
      ),
    );
    expect(found.pairs).toEqual([]);
    expect(found.skipped).toEqual({ notAcrossEditions: 1, targetNotFound: 0 });
  });

  it('leaves out a 2024 printing that links to another 2024 printing', () => {
    const found = reprintPairs(
      registry(
        spells(
          { ...reprinted(), reprintedAs: ['Test Bolt|LATER'] },
          { ...reprinted(), source: 'LATER', edition: 'one' },
        ),
      ),
    );
    expect(found.pairs).toEqual([]);
    expect(found.skipped).toEqual({ notAcrossEditions: 1, targetNotFound: 0 });
  });

  it("lets an entity's own `classic` mark outweigh its book's `one` mark", () => {
    const found = reprintPairs(
      registry(
        spells(
          { ...spell(), reprintedAs: ['Test Bolt|LATER'] },
          { ...spell(), source: 'LATER', edition: 'classic' },
          { name: 'Marked Spell', source: 'LATER', edition: 'one', entries: ['Words.'] },
        ),
      ),
    );
    expect(found.pairs).toEqual([]);
    expect(found.skipped).toEqual({ notAcrossEditions: 1, targetNotFound: 0 });
  });

  it('counts a link the registry cannot look up', () => {
    const found = reprintPairs(registry(spells({ ...spell(), reprintedAs: ['Gone|XPHB'] })));
    expect(found.pairs).toEqual([]);
    expect(found.skipped).toEqual({ notAcrossEditions: 0, targetNotFound: 1 });
  });

  it('reads a book as 2024 rules when anything in it is marked, not only what is', () => {
    const found = reprintPairs(
      registry(
        spells(
          { ...spell(), reprintedAs: ['Test Bolt|LATER'] },
          { ...spell({ entries: ['New words.'] }), source: 'LATER' },
          { name: 'Marked Spell', source: 'LATER', edition: 'one', entries: ['Words.'] },
        ),
      ),
    );
    expect(found.pairs.map((p) => p.to)).toEqual(['test bolt|later']);
  });

  it('follows a tag to a target of another type', () => {
    const { pairs } = reprintPairs(
      registry({
        'optionalfeatures.json': {
          optionalfeature: [
            {
              name: 'Test Style',
              source: 'PHB',
              entries: ['Old words.'],
              reprintedAs: [{ uid: 'Test Style|XPHB', tag: 'feat' }],
            },
          ],
        },
        'feats.json': { feat: [{ name: 'Test Style', source: 'XPHB', entries: ['New words.'] }] },
      }),
    );
    expect(pairs.map((p) => [p.type, p.from, p.to])).toEqual([
      ['optionalfeature', 'test style|phb', 'test style|xphb'],
    ]);
  });

  it('compares no fields across schemas: a feat stating a prerequisite is not a change', () => {
    const { pairs } = reprintPairs(
      registry({
        'optionalfeatures.json': {
          optionalfeature: [
            {
              name: 'Test Style',
              source: 'PHB',
              entries: ['Words.'],
              reprintedAs: [{ uid: 'Test Style|XPHB', tag: 'feat' }],
            },
          ],
        },
        'feats.json': {
          feat: [
            {
              name: 'Test Style',
              source: 'XPHB',
              entries: ['Words.'],
              prerequisite: [{ feature: ['Test Feature'] }],
            },
          ],
        },
      }),
    );
    expect(pairs[0]).toMatchObject({ changedFields: [], prose: 'identical' });
  });

  it('compares fields between an item and a base item, which share a schema', () => {
    const { pairs } = reprintPairs(
      registry({
        'items-base.json': {
          baseitem: [
            {
              name: 'Test Blade',
              source: 'PHB',
              dmg1: '1d6',
              reprintedAs: [{ uid: 'Test Blade|XPHB', tag: 'item' }],
            },
          ],
        },
        'items.json': { item: [{ name: 'Test Blade', source: 'XPHB', dmg1: '1d8' }] },
      }),
    );
    expect(pairs[0]?.changedFields).toEqual(['dmg1']);
  });

  it("reads tags in a named entry's name, so Jev never sees one", () => {
    const named = (words: string) => [
      { type: 'entries', name: '{@creature griffon||Test Griffon}', entries: [words] },
    ];
    const pair = onePair(spell({ entries: named('Old.') }), reprinted({ entries: named('New.') }));
    expect(pair.state).toContain('Test Griffon. Old.');
    expect(pair.state).not.toContain('{@');
  });

  it('leaves subclasses and subraces out, whatever they link to', () => {
    const found = reprintPairs(
      registry({
        'class/class-test.json': {
          subclass: [
            {
              name: 'Test Path',
              shortName: 'Test',
              source: 'PHB',
              className: 'Tester',
              reprintedAs: ['Test|Tester|XPHB|XPHB'],
            },
            { name: 'Test Path', shortName: 'Test', source: 'XPHB', className: 'Tester' },
          ],
        },
        'races.json': {
          race: [{ name: 'Testfolk', source: 'XPHB', entries: ['Words.'] }],
          subrace: [{ name: 'Hill', source: 'PHB', raceName: 'X', reprintedAs: ['Testfolk|XPHB'] }],
        },
      }),
    );
    expect(found.pairs).toEqual([]);
    expect(found.skipped).toEqual({ notAcrossEditions: 0, targetNotFound: 0 });
  });

  describe('the text a judge reads', () => {
    it('includes how a spell scales, its trigger and its material', () => {
      const { state } = onePair(
        spell({
          time: [{ number: 1, unit: 'reaction', condition: 'when a test happens' }],
          components: { v: true, m: { text: 'a test pebble', cost: 100 } },
          entriesHigherLevel: [
            {
              type: 'entries',
              name: 'At Higher Levels',
              entries: ['It deals {@scaledamage 1d4|1-9|1d6} more per level.'],
            },
          ],
        }),
        reprinted(),
      );
      expect(state).toContain('Casting trigger: when a test happens');
      expect(state).toContain('Material component: a test pebble');
      expect(state).toContain('At Higher Levels. It deals 1d6 more per level.');
    });

    it('reads a filter by its words, not its filter expression, and a DC as a DC', () => {
      const { state } = onePair(
        spell({
          entries: ['Pick from {@filter test spells|spells|class=Tester}, then make a {@dc 15}.'],
        }),
        reprinted(),
      );
      expect(state).toContain('Pick from test spells, then make a DC 15.');
      expect(state).not.toContain('class=Tester');
    });

    it('reads tables, rolls included', () => {
      const { state } = onePair(
        spell({
          entries: [
            {
              type: 'table',
              colLabels: ['d6', 'Effect'],
              rows: [
                [{ type: 'cell', roll: { min: 1, max: 3 } }, 'Sparks'],
                [{ type: 'cell', roll: { exact: 4 } }, 'Smoke'],
              ],
            },
          ],
        }),
        reprinted(),
      );
      expect(state).toContain('d6 | Effect\n1-3 | Sparks\n4 | Smoke');
    });

    it('reads a class from its features, in level order', () => {
      const feature = (name: string, level: number, source: string, entries: string[]) => ({
        name,
        source,
        className: 'Tester',
        classSource: source,
        level,
        entries,
      });
      const { pairs } = reprintPairs(
        registry({
          'class/class-tester.json': {
            class: [
              { name: 'Tester', source: 'PHB', reprintedAs: ['Tester|XPHB'] },
              { name: 'Tester', source: 'XPHB', edition: 'one' },
            ],
            classFeature: [
              feature('Later', 5, 'PHB', ['Later words.']),
              feature('First', 1, 'PHB', ['First words.']),
              feature('First', 1, 'XPHB', ['Newer words.']),
            ],
          },
        }),
      );
      expect(pairs[0]?.prose).toBe('differs');
      expect(pairs[0]?.state).toBe(
        '2014 printing: Tester\nLevel 1: First. First words.\nLevel 5: Later. Later words.\n\n2024 printing: Tester\nLevel 1: First. Newer words.',
      );
    });
  });

  describe('prose code can settle', () => {
    it('treats a change of case and spacing as reading the same', () => {
      const pair = onePair(
        spell({ entries: ['Make a dexterity saving throw.'] }),
        reprinted({ entries: ['Make a  Dexterity Saving Throw.'] }),
      );
      expect(pair.prose).toBe('identical');
    });

    it('treats an item with no text on either side as reading the same', () => {
      const { pairs } = reprintPairs(
        registry({
          'items-base.json': {
            baseitem: [
              { name: 'Test Pole', source: 'PHB', reprintedAs: ['Test Pole|XPHB'] },
              { name: 'Test Pole', source: 'XPHB' },
            ],
          },
        }),
      );
      expect(pairs[0]?.prose).toBe('identical');
    });

    it('cannot compare text that one printing does not have', () => {
      const { pairs } = reprintPairs(
        registry({
          'items-base.json': {
            baseitem: [
              {
                name: 'Test Mail',
                source: 'PHB',
                entries: ['Old words.'],
                reprintedAs: ['Test Mail|XPHB'],
              },
              { name: 'Test Mail', source: 'XPHB' },
            ],
          },
        }),
      );
      expect(pairs[0]?.prose).toBe('unreadable');
    });

    it('cannot call a class unchanged because it found no text for it', () => {
      const { pairs } = reprintPairs(
        registry({
          'class/class-tester.json': {
            class: [
              { name: 'Tester', source: 'PHB', reprintedAs: ['Tester|XPHB'] },
              { name: 'Tester', source: 'XPHB', edition: 'one' },
            ],
          },
        }),
      );
      expect(pairs[0]?.prose).toBe('unreadable');
    });
  });
});

describe('changedFields', () => {
  const spellChange = (from: Entity, to: Entity) =>
    changedFields('spell', spell(from), reprinted(to));

  it('finds nothing between printings that only differ by source', () => {
    expect(spellChange({}, {})).toEqual([]);
  });

  it.each([
    ['level', { level: 1 }, { level: 2 }],
    ['school', { school: 'V' }, { school: 'A' }],
    [
      'castingTime',
      { time: [{ number: 1, unit: 'action' }] },
      { time: [{ number: 1, unit: 'bonus' }] },
    ],
    [
      'range',
      { range: { type: 'point', distance: { type: 'feet', amount: 60 } } },
      { range: { type: 'point', distance: { type: 'feet', amount: 30 } } },
    ],
    ['components', { components: { v: true } }, { components: { v: true, s: true } }],
    ['components', { components: { m: 'a pebble' } }, { components: {} }],
    [
      'components',
      { components: { m: { text: 'a gem', cost: 100 } } },
      { components: { m: { text: 'a gem', cost: 500 } } },
    ],
    [
      'components',
      { components: { m: { text: 'a gem', cost: 100 } } },
      { components: { m: { text: 'a gem', cost: 100, consume: true } } },
    ],
    [
      'duration',
      { duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 } }] },
      { duration: [{ type: 'instant' }] },
    ],
    ['ritual', { meta: { ritual: true } }, {}],
  ])('flags %s', (field, from, to) => {
    expect(spellChange(from, to)).toEqual([field]);
  });

  it('flags concentration apart from the duration it sits on', () => {
    const timed = { type: 'timed', duration: { type: 'minute', amount: 1 } };
    expect(
      spellChange({ duration: [{ ...timed, concentration: true }] }, { duration: [timed] }),
    ).toEqual(['concentration']);
  });

  it("leaves a material's description and a reaction's trigger to the prose", () => {
    expect(
      spellChange(
        {
          time: [{ number: 1, unit: 'reaction', condition: 'when you see a test' }],
          components: { m: 'a tiny pebble' },
        },
        {
          time: [{ number: 1, unit: 'reaction', condition: 'when a test starts' }],
          components: { m: 'a pebble' },
        },
      ),
    ).toEqual([]);
  });

  it('does not read a change of term for an area around the caster as a new range', () => {
    const area = (type: string) => ({ range: { type, distance: { type: 'feet', amount: 30 } } });
    const self = { range: { type: 'point', distance: { type: 'self' } } };
    expect(spellChange(area('radius'), area('emanation'))).toEqual([]);
    expect(spellChange(area('sphere'), area('emanation'))).toEqual([]);
    expect(spellChange(area('hemisphere'), area('emanation'))).toEqual([]);
    expect(spellChange(self, area('emanation'))).toEqual([]);
    // A shape cast away from the caster is a real change.
    expect(spellChange(area('radius'), area('cone'))).toEqual(['range']);
  });

  it('ignores a duration losing `upTo`', () => {
    const lasting = (extra: Entity) => ({
      duration: [{ type: 'timed', duration: { type: 'hour', amount: 1, ...extra } }],
    });
    expect(spellChange(lasting({ upTo: true }), lasting({}))).toEqual([]);
  });

  it('reads item values through the `|XPHB` the 2024 data adds', () => {
    expect(
      changedFields(
        'baseitem',
        { property: ['F', 'L'], dmg1: '1d4' },
        { property: ['L|XPHB', 'F|XPHB'], dmg1: '1d4' },
      ),
    ).toEqual([]);
    expect(changedFields('baseitem', { dmg1: '1d6' }, { dmg1: '1d8' })).toEqual(['dmg1']);
  });

  it('treats a weapon gaining a mastery as a change', () => {
    expect(changedFields('baseitem', {}, { mastery: ['Sap|XPHB'] })).toEqual(['mastery']);
  });

  it('does not treat a weight or price printed on one side as a change', () => {
    expect(changedFields('item', {}, { weight: 1, value: 5000 })).toEqual([]);
    expect(changedFields('item', { weight: 15, value: 100 }, { weight: 5, value: 200 })).toEqual([
      'weight',
      'value',
    ]);
  });

  it("compares a mount's or vehicle's numbers and a weapon's category", () => {
    expect(
      changedFields(
        'item',
        { carryingCapacity: 480, speed: 50, weaponCategory: 'simple' },
        { carryingCapacity: 450, speed: 60, weaponCategory: 'martial' },
      ),
    ).toEqual(['weaponCategory', 'speed', 'carryingCapacity']);
  });

  it("compares an item's type only when both sides print one, through the `|XPHB`", () => {
    expect(changedFields('item', {}, { type: 'M|XPHB' })).toEqual([]);
    expect(changedFields('item', { type: 'M' }, { type: 'M|XPHB' })).toEqual([]);
    expect(changedFields('item', { type: 'M' }, { type: 'R|XPHB' })).toEqual(['type']);
  });

  it('treats attunement appearing or going as a change, but not its case', () => {
    expect(changedFields('item', { reqAttune: true }, {})).toEqual(['reqAttune']);
    expect(
      changedFields('item', { reqAttune: 'by a Wizard' }, { reqAttune: 'by a wizard' }),
    ).toEqual([]);
  });

  it('reads a prerequisite without how it cites the class', () => {
    const cited = (extra: Entity) => [{ level: { level: 5, class: { name: 'Tester', ...extra } } }];
    expect(
      changedFields(
        'optionalfeature',
        { prerequisite: cited({}) },
        { prerequisite: cited({ source: 'XPHB', visibleStats: true }) },
      ),
    ).toEqual([]);
    expect(changedFields('feat', {}, { prerequisite: [{ level: 4 }] })).toEqual(['prerequisite']);
  });

  it('compares what a class states outside its features', () => {
    expect(
      changedFields(
        'class',
        { hd: { number: 1, faces: 8 }, startingProficiencies: { skills: [{ any: 2 }] } },
        { hd: { number: 1, faces: 10 }, startingProficiencies: { skills: [{ any: 3 }] } },
      ),
    ).toEqual(['hd', 'skills']);
  });

  it("compares a class's armor, weapon and tool lists, but not their sentences", () => {
    const starting = (startingProficiencies: Entity) => ({ startingProficiencies });
    expect(
      changedFields(
        'class',
        starting({
          armorProficiencies: [{ light: true }],
          weapons: ['simple', 'test blade'],
          weaponProficiencies: [{ simple: true }, { 'test blade': true }],
          toolProficiencies: [{ anyMusicalInstrument: 3 }],
        }),
        starting({
          armorProficiencies: [{ medium: true }],
          weapons: ['simple'],
          weaponProficiencies: [{ simple: true }],
          toolProficiencies: [{ anyMusicalInstrument: 1 }],
        }),
      ),
    ).toEqual(['armorProficiencies', 'weapons', 'weaponProficiencies', 'toolProficiencies']);
    expect(
      changedFields(
        'class',
        starting({ armor: ['light', 'a sentence about shields'], tools: ['some sentence'] }),
        starting({ armor: ['light', 'other words'], tools: ['other words'] }),
      ),
    ).toEqual([]);
  });

  it('has nothing to compare on a condition', () => {
    expect(changedFields('condition', { rarity: 'a' }, { rarity: 'b' })).toEqual([]);
  });
});

describe('labelReprint', () => {
  const differs = { changedFields: [], prose: 'differs' } as const;
  const fieldChanged = { changedFields: ['range'], prose: 'differs' } as const;

  /** A clear "only the wording changed", to vary one answer at a time. */
  const wordingAnswers = {
    sameRules: 0.95,
    wordingOnly: 0.95,
    changesNumber: 0.05,
    differentFeature: 0.05,
  };

  describe('without asking Jev', () => {
    it('calls identical prose and no field change the same', () => {
      expect(labelReprint({ changedFields: [], prose: 'identical' }, undefined)).toBe('same');
    });

    it('calls identical prose with a field change changed', () => {
      expect(labelReprint({ changedFields: ['weight'], prose: 'identical' }, undefined)).toBe(
        'changed',
      );
    });

    it('never calls text it could not compare the same', () => {
      expect(labelReprint({ changedFields: [], prose: 'unreadable' }, undefined)).toBe('uncertain');
      expect(labelReprint({ changedFields: ['ac'], prose: 'unreadable' }, undefined)).toBe(
        'changed',
      );
    });

    it('leaves differing prose uncertain until it is judged, unless a field already changed', () => {
      expect(labelReprint(differs, undefined)).toBe('uncertain');
      expect(labelReprint(fieldChanged, undefined)).toBe('changed');
    });
  });

  describe('with answers', () => {
    it('calls a confident "only wording" wording only', () => {
      expect(labelReprint(differs, wordingAnswers)).toBe('wording');
    });

    it('does not let "only wording" outrank a changed field Jev never saw', () => {
      expect(labelReprint(fieldChanged, wordingAnswers)).toBe('changed');
    });

    it('calls a changed number changed', () => {
      expect(
        labelReprint(differs, {
          sameRules: 0.5,
          wordingOnly: 0.5,
          changesNumber: 0.9,
          differentFeature: 0.1,
        }),
      ).toBe('changed');
    });

    it('calls a confident "not the same rules" changed', () => {
      expect(
        labelReprint(differs, {
          sameRules: 0.1,
          wordingOnly: 0.1,
          changesNumber: 0.5,
          differentFeature: 0.5,
        }),
      ).toBe('changed');
    });

    it('calls a different feature different, over a changed field too', () => {
      const answers = {
        sameRules: 0.05,
        wordingOnly: 0.05,
        changesNumber: 0.9,
        differentFeature: 0.9,
      };
      expect(labelReprint(differs, answers)).toBe('different');
      expect(labelReprint(fieldChanged, answers)).toBe('different');
    });

    it('stays uncertain when nothing is confident', () => {
      const unsure = {
        sameRules: 0.5,
        wordingOnly: 0.5,
        changesNumber: 0.5,
        differentFeature: 0.5,
      };
      expect(labelReprint(differs, unsure)).toBe('uncertain');
      expect(labelReprint(fieldChanged, unsure)).toBe('changed');
    });

    it('does not read "not only wording" alone as a change: added flavor is not only wording', () => {
      expect(
        labelReprint(differs, {
          sameRules: 0.6,
          wordingOnly: 0.1,
          changesNumber: 0.1,
          differentFeature: 0.1,
        }),
      ).toBe('uncertain');
    });

    it.each([
      ['same rules and a changed number', { sameRules: 0.9, changesNumber: 0.9 }],
      ['only wording and a changed number', { wordingOnly: 0.9, changesNumber: 0.9 }],
      ['same rules and a different feature', { sameRules: 0.9, differentFeature: 0.9 }],
      ['only wording but not the same rules', { wordingOnly: 0.9, sameRules: 0.1 }],
    ])('reads %s as no answer at all', (_, answers) => {
      const contradiction = {
        sameRules: 0.5,
        wordingOnly: 0.5,
        changesNumber: 0.5,
        differentFeature: 0.5,
        ...answers,
      };
      expect(labelReprint(differs, contradiction)).toBe('uncertain');
      expect(labelReprint(fieldChanged, contradiction)).toBe('changed');
    });

    it('needs every answer confident before calling it wording', () => {
      for (const id of Object.keys(wordingAnswers)) {
        expect(labelReprint(differs, { ...wordingAnswers, [id]: 0.5 })).toBe('uncertain');
      }
    });

    it('treats a missing answer as not confident', () => {
      expect(labelReprint(differs, { sameRules: 0.95, wordingOnly: 0.95 })).toBe('uncertain');
    });

    it('uses the same thresholds as the prose audit, boundaries included', () => {
      const at = (yes: number, no: number) => ({
        sameRules: yes,
        wordingOnly: yes,
        changesNumber: no,
        differentFeature: no,
      });
      expect(labelReprint(differs, at(CONFIDENT_YES, CONFIDENT_NO))).toBe('wording');
      expect(labelReprint(differs, at(CONFIDENT_YES - 0.01, CONFIDENT_NO))).toBe('uncertain');
      expect(labelReprint(differs, at(CONFIDENT_YES, CONFIDENT_NO + 0.01))).toBe('uncertain');
    });
  });
});

describe('a judgment run over reprint subjects', () => {
  it('saves answers the audit reads back, with no rules text in the file', async () => {
    const found = reprintPairs(
      registry(
        spells(
          { ...spell(), reprintedAs: ['Test Bolt|XPHB'] },
          reprinted({ entries: ['Distinctive replacement sentence.'] }),
        ),
      ),
    );
    const file = emptyJudgments();
    const asked: string[] = [];
    const result = await runJudgments({
      set: REPRINT_SET,
      subjects: reprintSubjects(found.pairs),
      file,
      ask: async (request) => {
        asked.push(request.state);
        return { sameRules: 0.1, wordingOnly: 0.1, changesNumber: 0.9, differentFeature: 0.1 };
      },
    });
    expect(result.answered).toBe(1);
    expect(asked[0]).toContain('2024 printing: Test Bolt\nDistinctive replacement sentence.');

    const text = serializeJudgments(file);
    expect(text).toContain('reprint@1');
    expect(text).not.toContain('Distinctive replacement sentence');
    expect(auditReprints(found, parseJudgments(JSON.parse(text))).labels.changed).toBe(1);
  });
});

describe('reprintSubjects', () => {
  const pair = (key: string, prose: ReprintPair['prose']): ReprintPair => ({
    key,
    label: `label ${key}`,
    state: `state ${key}`,
    type: 'item',
    from: 'a|dmg',
    to: 'a|xdmg',
    changedFields: [],
    prose,
  });

  it('asks only about prose code could not settle, each comparison once', () => {
    expect(
      reprintSubjects([
        pair('one', 'differs'),
        pair('one', 'differs'),
        pair('two', 'identical'),
        pair('three', 'unreadable'),
      ]),
    ).toEqual([{ key: 'one', label: 'label one', state: 'state one' }]);
  });
});

describe('auditReprints', () => {
  const found = reprintPairs(
    registry(
      spells(
        // Prose code cannot settle, with a saved "only wording".
        { ...spell({ name: 'Worded' }), reprintedAs: ['Worded|XPHB'] },
        reprinted({ name: 'Worded', entries: ['Other words.'] }),
        // Prose code cannot settle, with no answer yet.
        { ...spell({ name: 'Waiting' }), reprintedAs: ['Waiting|XPHB'] },
        reprinted({ name: 'Waiting', entries: ['Still other words.'] }),
        // Reads the same, and its school moved.
        { ...spell({ name: 'Moved' }), reprintedAs: ['Moved|XPHB'] },
        reprinted({ name: 'Moved', school: 'A' }),
        // Nothing differs at all.
        { ...spell({ name: 'Twin' }), reprintedAs: ['Twin|XPHB'] },
        reprinted({ name: 'Twin' }),
      ),
    ),
  );

  const judged = (): JudgmentFile => {
    const worded = found.pairs.find((p) => p.from === 'worded|phb');
    if (worded === undefined) throw new Error('no pair');
    const file = emptyJudgments();
    file.sets[setTag(REPRINT_SET)] = REPRINT_SET.questions.map((q) => q.id);
    file.judgments[judgmentKey(REPRINT_SET, worded.key)] = {
      label: worded.label,
      p: [0.9, 0.9, 0.1, 0.1],
    };
    return file;
  };

  it('gives every pair one label, and reads saved answers', () => {
    const audit = auditReprints(found, judged());
    expect(audit.pairs).toBe(4);
    expect(audit.byType).toEqual({ spell: 4 });
    expect(audit.labels).toEqual({ same: 1, wording: 1, changed: 1, different: 0, uncertain: 1 });
    expect(audit.toJudge).toBe(2);
    expect(audit.judged).toBe(1);
    expect(audit.notJudged).toBe(1);
    expect(audit.changedFields).toEqual({ school: 1 });
  });

  it('settles what it can without any judgments', () => {
    const audit = auditReprints(found, undefined);
    expect(audit.labels).toEqual({ same: 1, wording: 0, changed: 1, different: 0, uncertain: 2 });
    expect(audit.judged).toBe(0);
    expect(audit.notJudged).toBe(2);
  });

  it('describes its counts as lines of text', () => {
    const lines = describeReprints(auditReprints(found, judged()));
    expect(lines).toEqual([
      '4 2014/2024 pairs: spell 4',
      'labels: same=1 wording=1 changed=1 different=0 uncertain=1; pairs waiting on Jev: 1',
      'prose comparisons for Jev: 1/2 judged',
      'structured fields that differ: school=1',
      'left out: 0 links within one rules edition, 0 to a target the registry cannot look up, such as a magic variant',
    ]);
  });
});
