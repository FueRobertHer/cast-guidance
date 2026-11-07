import { describe, expect, it } from 'vitest';
import type { Entity } from '../copyMod';
import {
  emptyJudgments,
  type JudgmentFile,
  judgmentKey,
  parseJudgments,
  serializeJudgments,
  setTag,
} from './judgments';
import { proseSubjects } from './proseSubjects';
import {
  FREE,
  ONE,
  SPEND_POOLS,
  SPENDS,
  spendCounts,
  spendReport,
  spendRuns,
  spendSet,
} from './spendScope';

// Synthetic prose, invented to name a pool. The names of a few real features stand
// in where a row has to match the table, which is names and amounts, not prose.
const option = (name: string, source: string, ...entries: string[]): Entity => ({
  name,
  source,
  entries,
});
const OPTIONS = [
  option('Trip Attack', 'PHB', 'Roll one of your superiority dice as you shove.'),
  option('Unknown Trick', 'TST', 'You spend one of your superiority dice to shine.'),
  option('Buyback', 'TST', 'Spend a superiority die to use this feature again.'),
  option('Mentions Only', 'TST', 'Your superiority dice glow.'),
  option('Slot Burner', 'TST', 'You can expend a spell slot to deal extra damage.'),
  option('Free Cast', 'TST', 'You cast it without expending a spell slot.'),
];
const FEATS = [option('Martial Adept', 'PHB', 'You gain one superiority die.')];

const registry = {
  byType: (type: string) =>
    type === 'optionalfeature' ? OPTIONS : type === 'feat' ? FEATS : ([] as Entity[]),
};

const poolNamed = (id: string) => {
  const pool = SPEND_POOLS.find((p) => p.id === id);
  if (pool === undefined) throw new Error(id);
  return pool;
};

/** Save answers for a subject in a pool's set. */
function saveAnswers(
  file: JudgmentFile,
  poolId: string,
  subject: { key: string; label: string },
  answers: Record<string, number>,
) {
  const set = spendSet(poolNamed(poolId));
  file.sets[setTag(set)] = set.questions.map((q) => q.id);
  file.judgments[judgmentKey(set, subject.key)] = {
    label: subject.label,
    p: set.questions.map((q) => answers[q.id] ?? 0),
  };
}

/** The same, for a feature in the registry above, by name. */
function withAnswers(
  file: JudgmentFile,
  poolId: string,
  name: string,
  answers: Record<string, number>,
) {
  const subject = proseSubjects(registry).find((s) => s.name === name);
  if (subject === undefined) throw new Error(name);
  saveAnswers(file, poolId, subject, answers);
}

describe('spendRuns', () => {
  it('asks one set per pool, naming the pool in its questions', () => {
    const runs = spendRuns(registry);
    expect(runs.map((r) => r.set.id)).toEqual(SPEND_POOLS.map((p) => `spend-${p.id}`));
    for (const [i, run] of runs.entries()) {
      const pool = SPEND_POOLS[i];
      expect(run.set.questions.find((q) => q.id === SPENDS)?.instructions).toContain(pool?.many);
    }
  });

  it('nets features that name the pool, whatever they then do with it', () => {
    const run = spendRuns(registry).find((r) => r.set.id === 'spend-superiority');
    expect(run?.subjects.map((s) => (s as { name?: string }).name)).toEqual([
      'Martial Adept',
      'Trip Attack',
      'Unknown Trick',
      'Buyback',
      'Mentions Only',
    ]);
  });

  it('leaves out prose that says a slot costs nothing', () => {
    const run = spendRuns(registry).find((r) => r.set.id === 'spend-slots');
    expect(run?.subjects.map((s) => (s as { name?: string }).name)).toEqual(['Slot Burner']);
  });

  it('has a pool with no resource only where a use is a choice of level or die', () => {
    expect(SPEND_POOLS.filter((p) => p.resources.length === 0).map((p) => p.id)).toEqual([
      'slots',
      'hitdice',
    ]);
  });
});

describe('spendCounts', () => {
  const answered = () => {
    const file = emptyJudgments();
    withAnswers(file, 'superiority', 'Trip Attack', { [SPENDS]: 0.95, [ONE]: 0.9 });
    withAnswers(file, 'superiority', 'Unknown Trick', { [SPENDS]: 0.9, [ONE]: 0.9 });
    withAnswers(file, 'superiority', 'Buyback', { [SPENDS]: 0.5, [FREE]: 0.9 });
    withAnswers(file, 'superiority', 'Mentions Only', { [SPENDS]: 0.05 });
    withAnswers(file, 'superiority', 'Martial Adept', { [SPENDS]: 0.85 });
    withAnswers(file, 'slots', 'Slot Burner', { [SPENDS]: 0.9, [ONE]: 0.9 });
    return file;
  };

  it('sorts each answered spender', () => {
    expect(spendCounts(registry, answered())).toEqual({
      linked: 1,
      skipped: 1,
      unlinked: 1,
      noCostYet: 1,
      unasked: 0,
    });
  });

  it('counts a row or a reason the same as the report, however sure Jev was', () => {
    const file = answered();
    withAnswers(file, 'superiority', 'Trip Attack', { [SPENDS]: 0.1 });
    withAnswers(file, 'superiority', 'Martial Adept', { [SPENDS]: 0.1 });
    expect(spendCounts(registry, file)).toMatchObject({ linked: 1, skipped: 1 });
    expect(spendReport(registry, file)).toContain('## Left out, with a reason: 1');
  });

  it('counts what has no saved answers as not asked', () => {
    expect(spendCounts(registry, emptyJudgments()).unasked).toBe(6);
  });

  it('does not count a link for a pool it does not spend', () => {
    const file = emptyJudgments();
    const options = [
      option('Trip Attack', 'PHB', 'You can expend a spell slot and roll a superiority die.'),
    ];
    const both = { byType: (t: string) => (t === 'optionalfeature' ? options : []) };
    const subject = proseSubjects(both)[0];
    if (subject === undefined) throw new Error('no subject');
    saveAnswers(file, 'slots', subject, { [SPENDS]: 0.9 });
    expect(spendCounts(both, file)).toMatchObject({ linked: 0, noCostYet: 1 });
  });

  it('takes a row in one pool and a reason in another for the same feature', () => {
    const file = emptyJudgments();
    const options = [
      option('Twinned Spell', 'XPHB', 'Spend a sorcery point on a higher-level spell slot.'),
    ];
    const both = { byType: (t: string) => (t === 'optionalfeature' ? options : []) };
    const subject = proseSubjects(both)[0];
    if (subject === undefined) throw new Error('no subject');
    saveAnswers(file, 'sorcery', subject, { [SPENDS]: 0.95 });
    saveAnswers(file, 'slots', subject, { [SPENDS]: 0.5 });
    expect(spendCounts(both, file)).toMatchObject({ linked: 1, skipped: 1 });
    const report = spendReport(both, file);
    expect(report).toContain('# sorcery: 1 answered, 0 not asked, 1 linked.');
    expect(report).toContain(
      '## Left out, with a reason: 1\n- 0.50 Twinned Spell (optional feature|XPHB): names the pool in passing',
    );
  });

  it('survives the file format', () => {
    const file = parseJudgments(JSON.parse(serializeJudgments(answered())));
    expect(spendCounts(registry, file).linked).toBe(1);
  });
});

describe('spendReport', () => {
  it('names each spender outside the table, by what it is', () => {
    const file = emptyJudgments();
    withAnswers(file, 'superiority', 'Trip Attack', { [SPENDS]: 0.95 });
    withAnswers(file, 'superiority', 'Unknown Trick', { [SPENDS]: 0.9, [ONE]: 0.9 });
    withAnswers(file, 'superiority', 'Buyback', { [SPENDS]: 0.5, [FREE]: 0.9 });
    withAnswers(file, 'superiority', 'Mentions Only', { [SPENDS]: 0.3, [FREE]: 0.2 });
    withAnswers(file, 'superiority', 'Martial Adept', { [SPENDS]: 0.85 });
    const report = spendReport(registry, file);
    expect(report).toContain('# superiority: 5 answered, 0 not asked, 1 linked.');
    expect(report).toContain(
      '## Spends, with no row: 1\n- 0.90 Unknown Trick (optional feature|TST): 1 none',
    );
    expect(report).toContain(
      '## Left out, with a reason: 1\n- 0.85 Martial Adept (feat|PHB): defines',
    );
    expect(report).toContain('## Looks like buying back its own use: 1\n- 0.50 Buyback');
    expect(report).toContain('## Unsure, read by hand: 1\n- 0.30 Mentions Only');
    expect(report).not.toContain('Trip Attack (optional feature|PHB)');
  });

  it('says which pools no action can spend yet', () => {
    expect(spendReport(registry, emptyJudgments())).toContain(
      '# slots: 0 answered, 1 not asked, 0 linked. No action can spend this pool yet.',
    );
  });
});
