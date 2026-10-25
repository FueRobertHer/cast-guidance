import { describe, expect, it } from 'vitest';
import budgetJson from '../../../scripts/data-audit-budget.json';
import { DATA_TAG } from '../config';
import type { AuditReport } from './analyze';
import {
  type AuditBudget,
  type BranchAllow,
  budgetFromReport,
  evaluateAudit,
  parseAuditBudget,
  type TagBudget,
  toMarkdown,
} from './budget';

const TAG = 'v2.32.0';

function makeReport(overrides: Partial<AuditReport> = {}): AuditReport {
  return {
    tag: TAG,
    fileCount: 48,
    entities: { spell: 936, race: 222 },
    warningGroups: { 'versions: replaceArr target not found on "…": "…"': 40 },
    warningExamples: {},
    unresolvedCopies: 0,
    spellCount: 936,
    spellsWithDice: 402,
    generatedRolls: 1000,
    invalidSpellRolls: [],
    tagCounts: { spell: 10 },
    unhandledTags: {},
    underscoreKeys: { _copy: 77, _mod: 64 },
    largestFiles: [],
    oversizedFiles: [],
    maxFileBytes: 4_194_304,
    branchBlocks: [
      { uid: 'the genie|tce', key: 'subclass', names: ['Dao', 'Marid'], choiceWording: false },
      { uid: 'magic initiate|phb', key: 'feat', names: ['Bard', 'Cleric'], choiceWording: true },
    ],
    ...overrides,
  };
}

const genieAllow: BranchAllow = {
  uid: 'the genie|tce',
  key: 'subclass',
  names: ['Marid', 'Dao'],
  verdict: 'choice',
  note: "Genie's Kind",
};

const baseEntry = (): TagBudget => budgetFromReport(makeReport(), [genieAllow]);
const budgetWith = (entry: Partial<TagBudget> = {}): AuditBudget => ({
  tags: { [TAG]: { ...baseEntry(), ...entry } },
});

const judge = (report: Partial<AuditReport>, entry: Partial<TagBudget> = {}) =>
  evaluateAudit(makeReport(report), budgetWith(entry));

describe('the committed budget file', () => {
  it('parses, and has an entry for the pinned DATA_TAG', () => {
    // A DATA_TAG bump without a fresh `--write-budget` entry fails here, in
    // the main CI run, with no network needed.
    const budget = parseAuditBudget(budgetJson);
    expect(budget.tags[DATA_TAG]).toBeDefined();
  });
});

describe('parseAuditBudget', () => {
  const valid = { tags: { [TAG]: baseEntry() } };

  it('keeps a valid file and its comment', () => {
    expect(parseAuditBudget({ $comment: 'hi', ...valid })).toEqual({ $comment: 'hi', ...valid });
    expect(parseAuditBudget(valid)).toEqual(valid);
  });

  it.each([
    ['a non-object', null, 'the file must be an object'],
    ['no tags', {}, 'tags must be an object'],
    ['a negative count', { tags: { [TAG]: { ...baseEntry(), files: -1 } } }, `tags.${TAG}.files`],
    [
      'a fractional entity count',
      { tags: { [TAG]: { ...baseEntry(), entities: { spell: 1.5 } } } },
      `tags.${TAG}.entities.spell`,
    ],
    [
      'a non-string underscore key',
      { tags: { [TAG]: { ...baseEntry(), underscoreKeys: [1] } } },
      'underscoreKeys[0]',
    ],
    [
      'a grant-all verdict',
      { tags: { [TAG]: { ...baseEntry(), branchAllow: [{ ...genieAllow, verdict: 'grant' }] } } },
      'branchAllow[0].verdict',
    ],
    [
      'a one-name allow',
      { tags: { [TAG]: { ...baseEntry(), branchAllow: [{ ...genieAllow, names: ['Dao'] }] } } },
      'branchAllow[0].names must be at least two names',
    ],
    [
      'an allow without a note',
      { tags: { [TAG]: { ...baseEntry(), branchAllow: [{ ...genieAllow, note: '' }] } } },
      'branchAllow[0].note',
    ],
    [
      'no branchAllow list',
      { tags: { [TAG]: { ...baseEntry(), branchAllow: undefined } } },
      'branchAllow must be an array',
    ],
  ])('rejects %s', (_label, raw, message) => {
    expect(() => parseAuditBudget(raw)).toThrow(message);
  });
});

describe('evaluateAudit', () => {
  it('passes a report that matches its budget exactly', () => {
    const result = judge({});
    expect(result.mode).toBe('exact');
    expect(result.budgetTag).toBe(TAG);
    expect(result.failures).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.rows.every((row) => row.status === 'ok')).toBe(true);
  });

  it('fails a tag with no budget entry', () => {
    const result = evaluateAudit(makeReport({ tag: 'v2.33.0' }), budgetWith());
    expect(result.mode).toBe('missing');
    expect(result.failures).toEqual([expect.stringContaining('no budget for v2.33.0')]);
  });

  it('fails any change in the file count or an entity count', () => {
    expect(judge({ fileCount: 47 }).failures).toEqual(['files: expected 48, got 47']);
    expect(judge({ entities: { spell: 937, race: 222 } }).failures).toEqual([
      'entities.spell: expected 936, got 937',
    ]);
    expect(judge({ entities: { spell: 936, race: 221 } }).failures).toEqual([
      'entities.race: expected 222, got 221',
    ]);
    expect(judge({ entities: { spell: 936, race: 222, feat: 1 } }).failures).toEqual([
      'entities.feat: expected 0, got 1',
    ]);
  });

  it('fails fewer spells with dice and only notes more', () => {
    expect(judge({ spellsWithDice: 401 }).failures).toEqual([
      'spellsWithDice: 401, under the floor of 402',
    ]);
    const more = judge({ spellsWithDice: 403 });
    expect(more.failures).toEqual([]);
    expect(more.notes).toEqual(['spellsWithDice: 403, over the floor of 402; raise it']);
  });

  it('fails a new or larger warning group and notes a smaller or stale one', () => {
    const key = 'versions: replaceArr target not found on "…": "…"';
    expect(judge({ warningGroups: { [key]: 40, 'item: new problem': 1 } }).failures).toEqual([
      'warning group: new "item: new problem" (1), not in the budget',
    ]);
    expect(judge({ warningGroups: { [key]: 41 } }).failures).toEqual([
      `warning group "${key}": 41, over the budget of 40`,
    ]);
    const fewer = judge({ warningGroups: { [key]: 39 } });
    expect(fewer.failures).toEqual([]);
    expect(fewer.notes).toEqual([`warning group "${key}": 39, under the budget of 40; lower it`]);
    const gone = judge({ warningGroups: {} });
    expect(gone.failures).toEqual([]);
    expect(gone.notes).toEqual([
      `warning group: "${key}" no longer occurs; remove it from the budget`,
    ]);
  });

  it('fails unresolved copies over budget and notes fewer', () => {
    expect(judge({ unresolvedCopies: 1 }).failures).toEqual([
      'unresolved _copy targets: 1, over the budget of 0',
    ]);
    const fewer = judge({ unresolvedCopies: 0 }, { unresolvedCopies: 2 });
    expect(fewer.failures).toEqual([]);
    expect(fewer.notes).toEqual(['unresolved _copy targets: 0, under the budget of 2; lower it']);
  });

  it('fails invalid spell rolls over budget, quoting them, and notes fewer', () => {
    const result = judge({ invalidSpellRolls: ['Green-Flame Blade|TCE L1: {{spellcasting_mod}}'] });
    expect(result.failures).toEqual([
      'invalid spell rolls: 1, over the budget of 0',
      '  Green-Flame Blade|TCE L1: {{spellcasting_mod}}',
    ]);
    expect(judge({}, { invalidSpellRolls: 3 }).notes).toEqual([
      'invalid spell rolls: 0, under the budget of 3; lower it',
    ]);
  });

  it('fails an unlisted or growing unhandled tag and notes a shrinking one', () => {
    expect(judge({ unhandledTags: { zzz: 1 } }).failures).toEqual([
      'unhandled tag: new "zzz" (1), not in the budget',
    ]);
    expect(judge({ unhandledTags: { zzz: 3 } }, { unhandledTags: { zzz: 2 } }).failures).toEqual([
      'unhandled tag "zzz": 3, over the budget of 2',
    ]);
    const fewer = judge({ unhandledTags: { zzz: 1 } }, { unhandledTags: { zzz: 2 } });
    expect(fewer.failures).toEqual([]);
    expect(fewer.notes).toEqual(['unhandled tag "zzz": 1, under the budget of 2; lower it']);
  });

  it('only notes an underscore key the budget has not seen', () => {
    const result = judge({ underscoreKeys: { _copy: 77, _mod: 64, _new: 1 } });
    expect(result.failures).toEqual([]);
    expect(result.notes).toEqual([
      'underscore key "_new" is new; check the parsers handle or ignore it',
    ]);
  });

  it('fails an unworded branch block with no matching verdict', () => {
    expect(judge({}, { branchAllow: [] }).failures).toEqual([
      expect.stringContaining('branch heuristic: subclass the genie|tce [Dao, Marid]'),
    ]);
    // A verdict for different names is a verdict about different content.
    const changed = judge({}, { branchAllow: [{ ...genieAllow, names: ['Dao', 'Efreeti'] }] });
    expect(changed.failures).toEqual([expect.stringContaining('the genie|tce')]);
    expect(changed.notes).toEqual([expect.stringContaining('matches nothing')]);
    // A verdict filed under another type does not cover it either.
    expect(judge({}, { branchAllow: [{ ...genieAllow, key: 'class' }] }).failures).toHaveLength(1);
  });

  it('never fails a worded block, and notes a verdict that matches nothing', () => {
    const result = judge({
      branchBlocks: [
        { uid: 'magic initiate|phb', key: 'feat', names: ['Bard', 'Cleric'], choiceWording: true },
      ],
    });
    expect(result.failures).toEqual([]);
    expect(result.notes).toEqual([
      'branchAllow subclass the genie|tce [Marid, Dao] matches nothing; remove it',
    ]);
  });

  it('fails an oversized file', () => {
    expect(judge({ oversizedFiles: ['items.json'] }).failures).toEqual([
      'items.json is over 4194304 bytes; plan the size limit now',
    ]);
  });

  describe('drift mode, for a release with no budget yet', () => {
    const drift = (report: Partial<AuditReport>) =>
      evaluateAudit(makeReport({ tag: 'v2.33.0', ...report }), budgetWith(), {
        baselineTag: TAG,
      });

    it('notes count changes a new release is expected to have', () => {
      const result = drift({
        fileCount: 49,
        entities: { spell: 950, race: 222 },
        spellsWithDice: 400,
      });
      expect(result.mode).toBe('drift');
      expect(result.budgetTag).toBe(TAG);
      expect(result.failures).toEqual([]);
      expect(result.notes).toEqual([
        expect.stringContaining('no budget for v2.33.0 yet; checked against v2.32.0'),
        'files: expected 48, got 49',
        'entities.spell: expected 936, got 950',
        'spellsWithDice: 400, under the floor of 402',
      ]);
    });

    it('still fails new problems and a vanished type', () => {
      const result = drift({
        entities: { spell: 936, race: 0 },
        invalidSpellRolls: ['x'],
        unhandledTags: { zzz: 1 },
      });
      expect(result.failures).toEqual([
        'entities.race: expected 222, got 0 (the type vanished)',
        'invalid spell rolls: 1, over the budget of 0',
        '  x',
        'unhandled tag: new "zzz" (1), not in the budget',
      ]);
    });

    it('fails as missing when the baseline has no entry either', () => {
      const result = evaluateAudit(makeReport({ tag: 'v2.33.0' }), budgetWith(), {
        baselineTag: 'v1.0.0',
      });
      expect(result.mode).toBe('missing');
    });
  });
});

describe('budgetFromReport', () => {
  it('copies the report and keeps only verdicts that still match a flagged block', () => {
    const stale: BranchAllow = { ...genieAllow, uid: 'gone|phb' };
    const entry = budgetFromReport(
      makeReport({ underscoreKeys: { _mod: 64, _copy: 77, _a: 64 } }),
      [genieAllow, stale],
    );
    expect(entry.files).toBe(48);
    expect(entry.underscoreKeys).toEqual(['_copy', '_a', '_mod']);
    expect(entry.branchAllow).toEqual([genieAllow]);
    expect(evaluateAudit(makeReport(), { tags: { [TAG]: entry } }).failures).toEqual([]);
  });

  it('writes no verdict for a new block, so it fails until someone reads it', () => {
    const entry = budgetFromReport(makeReport());
    expect(entry.branchAllow).toEqual([]);
    expect(evaluateAudit(makeReport(), { tags: { [TAG]: entry } }).failures).toHaveLength(1);
  });
});

describe('toMarkdown', () => {
  it('renders the table, the failures and the notes', () => {
    const report = makeReport({ invalidSpellRolls: ['bad roll'], spellsWithDice: 403 });
    const markdown = toMarkdown(report, evaluateAudit(report, budgetWith()));
    expect(markdown).toContain('### Data audit: v2.32.0');
    expect(markdown).toContain('| invalid spell rolls | 0 | 1 | FAIL |');
    expect(markdown).toContain('| spells with dice | 402 | 403 | note |');
    expect(markdown).toContain('| files | 48 | 48 | ok |');
    expect(markdown).toContain('**2 failure line(s)**');
    expect(markdown).toContain('- bad roll');
    expect(markdown).toContain('Notes:');
  });

  it('says which budget a drift run used, and when everything passed', () => {
    const report = makeReport({ tag: 'v2.33.0' });
    const markdown = toMarkdown(report, evaluateAudit(report, budgetWith(), { baselineTag: TAG }));
    expect(markdown).toContain('Checked against the v2.32.0 budget (no entry for v2.33.0).');
    expect(markdown).toContain('Every check is within budget.');
  });
});
