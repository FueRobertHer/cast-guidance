import { describe, expect, it, vi } from 'vitest';
import type { AskJev } from './jev';
import {
  answersFor,
  emptyJudgments,
  type JudgeSet,
  type JudgmentFile,
  judgmentKey,
  parseJudgments,
  pendingSubjects,
  runJudgments,
  serializeJudgments,
} from './judgments';

const SET: JudgeSet = {
  id: 'test',
  version: 2,
  questions: [
    { id: 'a', instructions: 'A?' },
    { id: 'b', instructions: 'B?' },
  ],
};

const subject = (key: string) => ({ key, label: `Label ${key}`, state: `State ${key}` });

const filled = (): JudgmentFile => ({
  sets: { 'test@2': ['a', 'b'] },
  judgments: { 'test@2:k1': { label: 'Label k1', p: [0.9, 0.1] } },
});

describe('the judgments file', () => {
  it('round-trips through its text form, one judgment per line', () => {
    const file = filled();
    file.judgments['test@2:k0'] = { label: 'Label k0', p: [0, 1] };
    const text = serializeJudgments(file);
    expect(parseJudgments(JSON.parse(text))).toEqual(file);
    // Sorted, so a refresh diffs line by line.
    const lines = text.split('\n');
    expect(lines.findIndex((l) => l.includes('test@2:k0'))).toBeLessThan(
      lines.findIndex((l) => l.includes('test@2:k1')),
    );
    expect(lines.filter((l) => l.includes('"p":'))).toHaveLength(2);
    expect(serializeJudgments(emptyJudgments())).toContain('"judgments": {}');
  });

  it('names the field it refuses', () => {
    const bad = (patch: Record<string, unknown>) => () => parseJudgments({ ...filled(), ...patch });
    expect(bad({ sets: { prose: ['a'] } })).toThrow('sets.prose must be named like "prose@1"');
    expect(bad({ sets: { 'test@2': [] } })).toThrow('non-empty array');
    expect(bad({ judgments: { 'other@1:k': { label: 'x', p: [1] } } })).toThrow(
      'filed under a set listed in "sets"',
    );
    expect(bad({ judgments: { 'test@2:k': { label: 'x', p: [1] } } })).toThrow(
      '2 probabilities between 0 and 1',
    );
    expect(bad({ judgments: { 'test@2:k': { label: 'x', p: [1, 1.5] } } })).toThrow(
      'between 0 and 1',
    );
    expect(bad({ judgments: { 'test@2:k': { p: [1, 0] } } })).toThrow('label must be a string');
    expect(() => parseJudgments([])).toThrow('the file must be an object');
  });

  it('reads answers by question id, and nothing for another version', () => {
    const file = filled();
    expect(answersFor(file, SET, 'k1')).toEqual({ a: 0.9, b: 0.1 });
    expect(answersFor(file, SET, 'k2')).toBeUndefined();
    expect(answersFor(file, { ...SET, version: 3 }, 'k1')).toBeUndefined();
  });
});

describe('pendingSubjects', () => {
  it('skips judged and repeated subjects', () => {
    const subjects = [subject('k1'), subject('k2'), subject('k2'), subject('k3')];
    expect(pendingSubjects(SET, subjects, filled()).map((s) => s.key)).toEqual(['k2', 'k3']);
  });
});

describe('runJudgments', () => {
  const ask: AskJev = async ({ state }) => ({ a: state.length / 100, b: 0.123456 });

  it('asks only about unjudged subjects, saves as it goes, and rounds', async () => {
    const file = filled();
    const save = vi.fn();
    const result = await runJudgments({
      set: SET,
      subjects: ['k1', 'k2', 'k3', 'k4'].map(subject),
      file,
      ask,
      save,
      saveEvery: 2,
      concurrency: 2,
    });
    expect(result).toEqual({ alreadyJudged: 1, asked: 3, answered: 3, failed: [], deferred: 0 });
    expect(file.judgments[judgmentKey(SET, 'k2')]).toEqual({ label: 'Label k2', p: [0.08, 0.12] });
    expect(Object.keys(file.judgments)).toHaveLength(4);
    // Once after two answers, and once at the end.
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('stops at the limit and leaves the rest for later', async () => {
    const file = emptyJudgments();
    const result = await runJudgments({
      set: SET,
      subjects: ['k1', 'k2', 'k3'].map(subject),
      file,
      ask,
      limit: 1,
    });
    expect(result).toMatchObject({ asked: 1, answered: 1, deferred: 2 });
    expect(file.sets).toEqual({ 'test@2': ['a', 'b'] });
  });

  it('collects failures without losing the answers that came back', async () => {
    const file = emptyJudgments();
    const flaky: AskJev = async ({ state }): Promise<Record<string, number>> => {
      if (state.endsWith('k2')) throw new Error('HTTP 500');
      if (state.endsWith('k3')) return { a: 0.5 };
      return { a: 1, b: 0 };
    };
    const result = await runJudgments({
      set: SET,
      subjects: ['k1', 'k2', 'k3'].map(subject),
      file,
      ask: flaky,
    });
    expect(result.answered).toBe(1);
    expect(result.failed).toEqual([
      { label: 'Label k2', error: 'HTTP 500' },
      { label: 'Label k3', error: 'the answer is missing a probability' },
    ]);
    expect(Object.keys(file.judgments)).toEqual([judgmentKey(SET, 'k1')]);
  });

  it('saves nothing when no answer came back', async () => {
    const save = vi.fn();
    const down: AskJev = async () => {
      throw new Error('offline');
    };
    const result = await runJudgments({
      set: SET,
      subjects: [subject('k1')],
      file: emptyJudgments(),
      ask: down,
      save,
    });
    expect(result.failed).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses to mix answers to different questions under one version', async () => {
    const file = { sets: { 'test@2': ['a', 'c'] }, judgments: {} };
    await expect(runJudgments({ set: SET, subjects: [], file, ask })).rejects.toThrow(
      "bump the set's version",
    );
  });
});
