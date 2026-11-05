import { describe, expect, it } from 'vitest';
import { normalizeDataset } from '../normalize';
import { displayTagText, proseSubjects, readableEntries, textHash } from './proseSubjects';

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

describe('displayTagText', () => {
  it('shows the third part of a tag when it has one, else the first', () => {
    expect(displayTagText('a {@variantrule Proficiency|XPHB|Proficiency Bonus} b')).toBe(
      'a Proficiency Bonus b',
    );
    expect(displayTagText('{@spell bless|phb} and {@dice 1d6}')).toBe('bless and 1d6');
    expect(displayTagText('{@item Rope|PHB|}')).toBe('Rope');
  });
});

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
