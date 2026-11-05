import { describe, expect, it } from 'vitest';
import { normalizeDataset } from '../normalize';
import { answersFor, type JudgmentFile, judgmentKey, runJudgments, setTag } from './judgments';
import { PROSE_SET } from './proseChecks';
import { proseSubjects, readableEntries, textHash } from './proseSubjects';

// Synthetic entities: the wording mimics the shapes the scanner reads, not any book.
const registry = normalizeDataset(
  new Map<string, unknown>(
    Object.entries({
      'races.json': {
        race: [
          {
            name: 'Testfolk',
            source: 'HB',
            entries: [
              {
                name: 'Quick Step',
                entries: [
                  'You can take the Dash action as a {@variantrule Bonus Action|XPHB|Bonus Action}.',
                ],
              },
              // Curated by name (`trait:hare-trigger`), so the engine never scans it.
              { name: 'Hare-Trigger', entries: ['You add a bonus to initiative.'] },
              { name: 'Empty Trait', entries: [] },
              'An unnamed paragraph is not a trait.',
            ],
          },
          // A second printing with the same trait prose shares one subject.
          {
            name: 'Testfolk Reprint',
            source: 'HB2',
            entries: [
              {
                name: 'Quick Step',
                entries: [
                  'You can take the Dash action as a {@variantrule Bonus Action|XPHB|Bonus Action}.',
                ],
              },
            ],
          },
        ],
      },
      'feats.json': {
        feat: [
          // Curated as `alert|phb`.
          { name: 'Alert', source: 'PHB', entries: ['Always on guard.'] },
          {
            name: 'Lucky Charm',
            source: 'HB',
            entries: [
              'You can use this feature twice, and regain its uses when you finish a long rest.',
            ],
          },
        ],
      },
      'class/class-testclass.json': {
        class: [{ name: 'Testclass', source: 'HB' }],
        classFeature: [
          {
            name: 'Surge',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
            level: 2,
            entries: ['As a reaction, you push back.'],
          },
        ],
        subclass: [
          {
            name: 'Path of Tests',
            shortName: 'Tests',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
          },
        ],
        subclassFeature: [
          {
            name: 'Probe',
            source: 'HB',
            className: 'Testclass',
            classSource: 'HB',
            subclassShortName: 'Tests',
            subclassSource: 'HB',
            level: 3,
            entries: ['You notice things.'],
          },
        ],
      },
    }),
  ),
);

describe('readableEntries', () => {
  it('keeps case and leads named sub-entries with their name', () => {
    const text = readableEntries([
      'Choose one:',
      { type: 'list', items: [{ type: 'item', name: 'Longtooth', entries: ['You bite.'] }] },
    ]);
    expect(text).toBe('Choose one:\nLongtooth. You bite.');
  });

  it("leaves tables out by default, since a subject's identity hashes this text", () => {
    const table = { type: 'table', colLabels: ['Roll'], rows: [['1']] };
    expect(readableEntries(['Words.', table])).toBe('Words.');
    expect(readableEntries(['Words.', table], { tables: true })).toBe('Words.\nRoll\n1');
  });

  it('reads tags the given way, in table cells as well', () => {
    const entries = ['{@b A}', { type: 'table', rows: [['{@b B}', 2]] }];
    expect(readableEntries(entries, { tables: true, tagText: (t) => t.toLowerCase() })).toBe(
      '{@b a}\n{@b b} | 2',
    );
  });

  it("reads a name's tags only when a reader asks, since names are part of the hash", () => {
    const entries = [{ type: 'entries', name: '{@b Name}', entries: ['Words.'] }];
    expect(readableEntries(entries)).toBe('{@b Name}. Words.');
    expect(readableEntries(entries, { tagText: (t) => t.toLowerCase() })).toBe('{@b name}. words.');
  });

  it('reads a table cell with no usable roll by its words', () => {
    const table = { type: 'table', rows: [[{ type: 'cell', roll: null, entry: 'Sparks' }]] };
    expect(readableEntries([table], { tables: true })).toBe('Sparks');
  });

  it('shows the third part of a tag laid out as name, source, display, else the first', () => {
    expect(readableEntries(['a {@variantrule Proficiency|XPHB|Proficiency Bonus} b'])).toBe(
      'a Proficiency Bonus b',
    );
    expect(readableEntries(['{@spell bless|phb} and {@dice 1d6}'])).toBe('bless and 1d6');
    expect(readableEntries(['{@item Rope|PHB|}'])).toBe('Rope');
  });

  // The third part of each of these is a target, a chapter or a source: a judge
  // shown it reads "your class=Testclass" or "the SRC" for the words on the page.
  it.each([
    ['{@filter tester spells|spells|class=Testclass}', 'tester spells'],
    ['{@filter tester spells|spells|level=0|class=Testclass}', 'tester spells'],
    ['{@book chapter 9|HB|9}', 'chapter 9'],
    ['{@book Test Manual|HB|6|Some Section}', 'Test Manual'],
    ['{@quickref rough ground||3}', 'rough ground'],
    ['{@quickref Testcover||3||half testcover}', 'half testcover'],
    ['{@deity Testgod|Testheon|HB}', 'Testgod'],
    ['{@classFeature Surge|Testclass|HB|2|HB}', 'Surge'],
    ['{@subclassFeature Probe|Testclass|HB|Tests|HB|3|HB}', 'Probe'],
    ['{@subclass Tests|Testclass|HB|HB}', 'Tests'],
  ])('reads %s by its display text', (tagged, words) => {
    expect(readableEntries([tagged])).toBe(words);
  });

  it('reads a tag inside a tag whole', () => {
    expect(readableEntries(['{@i level 2 {@variantrule test features|hb|test feature}}'])).toBe(
      'level 2 test feature',
    );
  });
});

describe('textHash', () => {
  it('is stable, fixed-width hex, and tells near-identical text apart', () => {
    expect(textHash('abc')).toBe(textHash('abc'));
    expect(textHash('abc')).toMatch(/^[0-9a-f]{14}$/);
    expect(textHash('abc')).not.toBe(textHash('abd'));
  });
});

describe('proseSubjects', () => {
  const subjects = proseSubjects(registry);
  const named = (name: string) => subjects.filter((s) => s.name === name);

  it('lists every scanned kind of trait and feature, labelled by owner', () => {
    expect(subjects.map((s) => s.label)).toEqual([
      'Quick Step (Testfolk|HB)',
      'Hare-Trigger (Testfolk|HB)',
      'Surge (Testclass|HB)',
      'Probe (Testclass: Path of Tests|HB)',
      'Alert (feat|PHB)',
      'Lucky Charm (feat|HB)',
    ]);
  });

  it('collapses identical prose into one subject, counting its owners', () => {
    const [step] = named('Quick Step');
    expect(named('Quick Step')).toHaveLength(1);
    expect(step?.owners).toBe(2);
    expect(step?.state).toBe('Quick Step\nYou can take the Dash action as a Bonus Action.');
    expect(step?.key).toBe(textHash(step?.state ?? ''));
  });

  it('marks what the engine handles from the curated table', () => {
    expect(named('Hare-Trigger')[0]?.curated).toBe(true);
    expect(named('Alert')[0]?.curated).toBe(true);
    expect(named('Lucky Charm')[0]?.curated).toBe(false);
  });

  it("records the scanner's own output", () => {
    expect(named('Quick Step')[0]?.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'bonus' }),
    );
    expect(named('Surge')[0]?.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'reaction' }),
    );
    expect(named('Lucky Charm')[0]?.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', max: 2, resetOn: 'long' }),
    );
    expect(named('Probe')[0]?.effects).toEqual([]);
  });
});

describe('saved answers across a change in how tags read', () => {
  const feat = (name: string, line: string) => ({ name, source: 'HB', entries: [line] });
  const subjects = proseSubjects(
    normalizeDataset(
      new Map<string, unknown>([
        [
          'feats.json',
          {
            feat: [
              feat('Plain Trait', 'You push back with no tags at all.'),
              feat(
                'Same Either Way',
                'As a {@variantrule Bonus Action|XPHB|Bonus Action}, roll {@dice 1d6} and name {@spell testbolt|HB}.',
              ),
              feat('Filter Trait', 'Pick from the {@filter tester spells|spells|class=Testclass}.'),
            ],
          },
        ],
      ]),
    ),
  );
  const subject = (name: string) => {
    const found = subjects.find((s) => s.name === name);
    if (found === undefined) throw new Error(`no subject named ${name}`);
    return found;
  };

  // Literals, taken from the reader that showed a tag's third part. A saved
  // answer is filed under these, so they hold whatever the reader becomes: if
  // one moves, every answer on prose like it goes unread and is asked again.
  const PLAIN_KEY = '10899455b1efc3';
  const SAME_KEY = '1efd76a16f8569';
  const GARBLED_KEY = '0d8e3981190e01';

  it('keeps the key of prose whose words did not change', () => {
    expect(subject('Plain Trait').key).toBe(PLAIN_KEY);
    expect(subject('Same Either Way').key).toBe(SAME_KEY);
  });

  it('moves the key of prose a judge read garbled, so its answer is not reused', () => {
    expect(textHash('Filter Trait\nPick from the class=Testclass.')).toBe(GARBLED_KEY);
    expect(subject('Filter Trait').state).toBe('Filter Trait\nPick from the tester spells.');
    expect(subject('Filter Trait').key).not.toBe(GARBLED_KEY);
  });

  it('asks again about only the prose that moved, and keeps every saved answer', async () => {
    const answer = { label: 'saved', p: PROSE_SET.questions.map(() => 0.5) };
    const file: JudgmentFile = {
      sets: { [setTag(PROSE_SET)]: PROSE_SET.questions.map((q) => q.id) },
      judgments: {
        [judgmentKey(PROSE_SET, PLAIN_KEY)]: answer,
        [judgmentKey(PROSE_SET, SAME_KEY)]: answer,
        [judgmentKey(PROSE_SET, GARBLED_KEY)]: answer,
      },
    };
    expect(answersFor(file, PROSE_SET, subject('Filter Trait').key)).toBeUndefined();

    const asked: string[] = [];
    const result = await runJudgments({
      set: PROSE_SET,
      subjects,
      file,
      ask: async ({ state, questions }) => {
        asked.push(state);
        return Object.fromEntries(questions.map((q) => [q.id, 0.9]));
      },
    });

    expect(asked).toEqual(['Filter Trait\nPick from the tester spells.']);
    expect(result.alreadyJudged).toBe(2);
    expect(answersFor(file, PROSE_SET, subject('Filter Trait').key)?.bonusAction).toBe(0.9);
    expect(file.judgments[judgmentKey(PROSE_SET, PLAIN_KEY)]).toEqual(answer);
    expect(file.judgments[judgmentKey(PROSE_SET, SAME_KEY)]).toEqual(answer);
    // The answer given on the garbled text stays in the file, read by nothing.
    expect(file.judgments[judgmentKey(PROSE_SET, GARBLED_KEY)]).toEqual(answer);
  });
});
