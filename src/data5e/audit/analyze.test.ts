import { describe, expect, it } from 'vitest';
import { VALID_BODIES } from '../../../tests-fixtures/dataMirror';
import { normalizeDataset } from '../normalize';
import { analyzeDataset, groupWarningKey, sortedCounts } from './analyze';
import { BRANCH_SET, branchSubjects } from './branches';
import { type JudgmentFile, judgmentKey, setTag } from './judgments';
import { PROSE_SET } from './proseChecks';
import { proseSubjects } from './proseSubjects';

/** A version whose `_mod` replaces an entry the base does not have. */
const brokenVersion = (target: string) => ({
  name: `Version of ${target}`,
  source: 'PHB',
  _mod: {
    entries: { mode: 'replaceArr', replace: target, items: { type: 'entries', entries: [] } },
  },
});

const bodies: Record<string, unknown> = {
  ...VALID_BODIES,
  'races.json': {
    race: [
      { name: 'Elf', source: 'PHB', entries: ['Knows {@spell fire bolt}.'] },
      // Copies a race that does not exist: one unresolved _copy.
      { name: 'Ghost Elf', source: 'HB', _copy: { name: 'Nope', source: 'PHB' } },
      {
        name: 'Dwarf',
        source: 'PHB',
        entries: ['Speaks {@zzz Dwarvish}.', { type: 'entries', entries: ['{@zzz again}'] }],
        _versions: [brokenVersion('Stone'), brokenVersion('Iron')],
      },
    ],
    subrace: [{ name: 'High', source: 'PHB', raceName: 'Elf', raceSource: 'PHB' }],
  },
  'spells/spells-phb.json': {
    spell: [
      { name: 'Fireball', source: 'PHB', level: 3, entries: ['Takes {@damage 8d6} fire damage.'] },
      { name: 'Shield', source: 'PHB', level: 1, entries: ['+5 to AC.'] },
      {
        name: 'Broken Roll',
        source: 'PHB',
        level: 1,
        entries: ['Takes {@damage 1d6+{{caster_level}}} acid damage.'],
      },
    ],
  },
};

const files = new Map(Object.entries(bodies));
const fileBytes = new Map([
  ['items.json', 900],
  ['races.json', 400],
  ['feats.json', 100],
]);
const report = analyzeDataset({ tag: 'v9.9.9', files, fileBytes, maxFileBytes: 500 });

describe('analyzeDataset', () => {
  it('counts files and entities per normalized type', () => {
    expect(report.tag).toBe('v9.9.9');
    expect(report.fileCount).toBe(files.size);
    // Elf, Ghost Elf and Dwarf, plus Dwarf's two versions.
    expect(report.entities.race).toBe(5);
    expect(report.entities.subrace).toBe(1);
    expect(report.entities.spell).toBe(3);
    expect(report.entities.class).toBe(1);
  });

  it('counts an unresolved _copy and groups warnings by shape', () => {
    expect(report.unresolvedCopies).toBe(1);
    expect(report.warningGroups).toEqual({
      'race: unresolved _copy target Nope|PHB': 1,
      'versions: replaceArr target not found on "…": "…"': 2,
    });
    expect(report.warningExamples['versions: replaceArr target not found on "…": "…"']).toEqual([
      'dwarf|phb',
      'dwarf|phb',
    ]);
  });

  it('checks every generated spell roll against the dice parser', () => {
    expect(report.spellCount).toBe(3);
    expect(report.spellsWithDice).toBe(2);
    expect(report.generatedRolls).toBeGreaterThan(0);
    expect(report.invalidSpellRolls.length).toBeGreaterThan(0);
    expect(report.invalidSpellRolls.every((line) => line.startsWith('Broken Roll|PHB'))).toBe(true);
    expect(report.invalidSpellRolls[0]).toContain('modifier undefined: 1d6+{{caster_level');
    // Character levels 0 (no class yet) to 20, slots 1 to 9, and four
    // modifiers: none known, -1, 0 and 5.
    expect(report.invalidSpellRolls).toHaveLength(21 * 9 * 4);
    expect(report.invalidSpellRolls).toContainEqual(
      expect.stringContaining('character L0, slot L1, modifier 0:'),
    );
  });

  it('counts tags and flags only the ones the renderer does not draw', () => {
    expect(report.tagCounts.spell).toBe(1);
    expect(report.tagCounts.zzz).toBe(2);
    expect(report.tagCounts.damage).toBe(2);
    expect(report.unhandledTags).toEqual({ zzz: 2 });
  });

  it('counts underscore keys in the raw files', () => {
    expect(report.underscoreKeys).toEqual({ _copy: 1, _versions: 1, _mod: 2 });
  });

  it('lists the largest files and the oversized ones', () => {
    expect(report.largestFiles.map((f) => f.path)).toEqual([
      'items.json',
      'races.json',
      'feats.json',
    ]);
    expect(report.oversizedFiles).toEqual(['items.json']);
    expect(report.maxFileBytes).toBe(500);
  });

  it('finds no branch blocks in data without additionalSpells', () => {
    expect(report.branchBlocks).toEqual([]);
  });
});

describe('groupWarningKey', () => {
  it('blanks quoted text and a trailing JSON object', () => {
    expect(groupWarningKey('versions: replaceArr target not found on "entries": "Foo"')).toBe(
      'versions: replaceArr target not found on "…": "…"',
    );
    expect(groupWarningKey('item: bad mod {"mode":"x"}')).toBe('item: bad mod {…}');
  });
});

describe('sortedCounts', () => {
  it('sorts by count, then by name', () => {
    expect(sortedCounts({ b: 1, a: 1, c: 5 })).toEqual([
      ['c', 5],
      ['a', 1],
      ['b', 1],
    ]);
  });
});

describe('analyzeDataset with saved judgments', () => {
  const judgedBodies: Record<string, unknown> = {
    ...VALID_BODIES,
    'feats.json': {
      feat: [
        {
          name: 'Steady Hands',
          source: 'HB',
          entries: [
            'You can steady yourself a number of times equal to your {@variantrule Proficiency|XPHB|Proficiency Bonus}, regaining all uses on a long rest.',
          ],
        },
      ],
    },
    'class/class-fighter.json': {
      class: [{ name: 'Fighter', source: 'PHB' }],
      subclass: [
        {
          name: 'Test Knight',
          shortName: 'Knight',
          source: 'HB',
          className: 'Fighter',
          classSource: 'PHB',
          additionalSpells: [
            { name: 'Sun', known: { _: ['light'] } },
            { name: 'Moon', known: { _: ['darkness'] } },
          ],
        },
      ],
    },
  };
  const judgedFiles = new Map(Object.entries(judgedBodies));
  const reg = normalizeDataset(judgedFiles);
  const [steady] = proseSubjects(reg).filter((s) => s.name === 'Steady Hands');
  const [knight] = branchSubjects(reg);
  const ids = PROSE_SET.questions.map((q) => q.id);
  const sureOf = new Set(['limitedUses', 'usesProficiency', 'reaction']);
  const judgments: JudgmentFile = {
    sets: { [setTag(PROSE_SET)]: ids, [setTag(BRANCH_SET)]: ['choice'] },
    judgments: {
      [judgmentKey(PROSE_SET, steady?.key ?? '')]: {
        label: 'Steady Hands (feat|HB)',
        p: ids.map((id) => (sureOf.has(id) ? 0.95 : 0.05)),
      },
      [judgmentKey(BRANCH_SET, knight?.key ?? '')]: { label: 'knight', p: [0.91] },
    },
  };
  const judged = analyzeDataset({
    tag: 'v9.9.9',
    files: judgedFiles,
    fileBytes: new Map(),
    maxFileBytes: 500,
    judgments,
  });

  it('compares the scanner with the saved answers', () => {
    // Both read the uses and their Proficiency Bonus, so those stay out. The
    // prose names no Reaction, so the scanner draws none, and the answer is sure.
    expect(judged.prose.judged).toBe(1);
    expect(judged.prose.disagreements).toEqual([
      expect.objectContaining({
        label: 'Steady Hands (feat|HB)',
        check: 'reaction',
        kind: 'missed',
      }),
    ]);
  });

  it('attaches the saved answer to an unworded branch block', () => {
    expect(judged.branchBlocks).toEqual([
      expect.objectContaining({ uid: 'test knight|hb', choiceP: 0.91 }),
    ]);
  });

  it('reports nothing judged without the file', () => {
    expect(report.prose.judged).toBe(0);
    expect(report.branchBlocks.every((b) => b.choiceP === undefined)).toBe(true);
  });
});
