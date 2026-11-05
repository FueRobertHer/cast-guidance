/**
 * Saved judgments: what Jev answered about each piece of prose, kept in
 * `scripts/data-judgments.json` so the data audit can compare the scanner
 * against them without calling a model. CI stays deterministic and offline
 * from the model: only `bun run data:judge` asks, and only about prose that
 * has no saved answer yet.
 *
 * A judgment is filed under `<set>@<version>:<text hash>`. Changing a set's
 * questions means bumping its version, which leaves every old answer unused
 * rather than misread. The file keeps answers and a short label per subject,
 * never the prose itself, so no game text lands in the repository.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import type { AskJev, JevQuestion } from './jev';

export interface JudgeSet {
  id: string;
  /**
   * Bump when any question's wording or meaning changes. Not when a subject's
   * text changes: its hash already re-keys what moved and nothing else.
   */
  version: number;
  questions: readonly JevQuestion[];
}

export interface JudgeSubject {
  key: string;
  label: string;
  state: string;
}

export interface Judgment {
  label: string;
  /** Probability of "yes", in the order the set's header lists its questions. */
  p: number[];
}

export interface JudgmentFile {
  /** Question ids per `<set>@<version>`, in the order each `p` follows. */
  sets: Record<string, string[]>;
  judgments: Record<string, Judgment>;
}

export const emptyJudgments = (): JudgmentFile => ({ sets: {}, judgments: {} });

export const setTag = (set: JudgeSet) => `${set.id}@${set.version}`;
export const judgmentKey = (set: JudgeSet, subjectKey: string) => `${setTag(set)}:${subjectKey}`;

// ---------------------------------------------------------------------------
// Parsing and writing
// ---------------------------------------------------------------------------

function fail(path: string, expected: string): never {
  throw new Error(`data judgments: ${path} must be ${expected}`);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Validate the judgments file. Throws on any malformed field, naming it. */
export function parseJudgments(raw: unknown): JudgmentFile {
  if (!isRecord(raw)) fail('the file', 'an object');
  if (!isRecord(raw.sets)) fail('sets', 'an object of question id lists');
  if (!isRecord(raw.judgments)) fail('judgments', 'an object');
  const sets: Record<string, string[]> = {};
  for (const [tag, ids] of Object.entries(raw.sets)) {
    if (!/^[a-z][a-z0-9-]*@\d+$/.test(tag)) fail(`sets.${tag}`, 'named like "prose@1"');
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      fail(`sets.${tag}`, 'a non-empty array of question ids');
    }
    sets[tag] = ids as string[];
  }
  const judgments: Record<string, Judgment> = {};
  for (const [key, value] of Object.entries(raw.judgments)) {
    const path = `judgments.${key}`;
    const ids = sets[key.slice(0, key.indexOf(':'))];
    if (ids === undefined) fail(path, 'filed under a set listed in "sets"');
    if (!isRecord(value)) fail(path, 'an object');
    if (typeof value.label !== 'string') fail(`${path}.label`, 'a string');
    const p = value.p;
    if (
      !Array.isArray(p) ||
      p.length !== ids.length ||
      p.some((n) => typeof n !== 'number' || !(n >= 0 && n <= 1))
    ) {
      fail(`${path}.p`, `${ids.length} probabilities between 0 and 1`);
    }
    judgments[key] = { label: value.label, p: p as number[] };
  }
  return { sets, judgments };
}

const FILE_COMMENT =
  'Saved Jev judgments for the data audit, written by `bun run data:judge`. Each entry is filed under <set>@<version>:<prose hash> and holds a label and one probability of "yes" per question, in the order "sets" lists them. No rules text is stored. Generated: do not edit by hand.';

/**
 * Stable text: keys sorted, one judgment per line, so a refresh reads as a
 * diff of added and changed lines rather than a reflowed file.
 */
export function serializeJudgments(file: JudgmentFile): string {
  const sets = Object.keys(file.sets)
    .sort()
    .map((tag) => `    ${JSON.stringify(tag)}: ${JSON.stringify(file.sets[tag])}`);
  const judgments = Object.keys(file.judgments)
    .sort()
    .map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(file.judgments[key])}`);
  const block = (lines: string[]) => (lines.length === 0 ? '{}' : `{\n${lines.join(',\n')}\n  }`);
  return `{\n  "$comment": ${JSON.stringify(FILE_COMMENT)},\n  "sets": ${block(sets)},\n  "judgments": ${block(judgments)}\n}\n`;
}

// ---------------------------------------------------------------------------
// Reading answers
// ---------------------------------------------------------------------------

/** The saved answers for one subject, by question id, or undefined when it has none. */
export function answersFor(
  file: JudgmentFile,
  set: JudgeSet,
  subjectKey: string,
): Record<string, number> | undefined {
  const judgment = file.judgments[judgmentKey(set, subjectKey)];
  const ids = file.sets[setTag(set)];
  if (judgment === undefined || ids === undefined) return undefined;
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    const p = judgment.p[i];
    if (p !== undefined) out[id] = p;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

/** Subjects of a set with no saved judgment, first seen first. */
export function pendingSubjects<S extends JudgeSubject>(
  set: JudgeSet,
  subjects: readonly S[],
  file: JudgmentFile,
): S[] {
  const seen = new Set<string>();
  return subjects.filter((s) => {
    const key = judgmentKey(set, s.key);
    if (seen.has(key) || file.judgments[key] !== undefined) return false;
    seen.add(key);
    return true;
  });
}

export interface RunOptions {
  set: JudgeSet;
  subjects: readonly JudgeSubject[];
  /** Updated in place as answers arrive. */
  file: JudgmentFile;
  ask: AskJev;
  /** Ask about at most this many subjects (a trial run). */
  limit?: number;
  concurrency?: number;
  /**
   * Called every `saveEvery` answers and once at the end when anything was
   * answered, so a crash keeps what was paid for.
   */
  save?: (file: JudgmentFile) => void | Promise<void>;
  saveEvery?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface RunResult {
  /** Subjects that already had a judgment. */
  alreadyJudged: number;
  asked: number;
  answered: number;
  failed: Array<{ label: string; error: string }>;
  /** Pending subjects left for a later run by `limit`. */
  deferred: number;
}

/** Two decimals is finer than any threshold the audit uses, and halves the file. */
const round = (p: number) => Math.round(p * 100) / 100;

/**
 * Ask about every subject that has no saved judgment. Failures are collected,
 * not thrown: one bad answer must not throw away the hundreds already saved.
 */
export async function runJudgments(options: RunOptions): Promise<RunResult> {
  const { set, subjects, file, ask, limit, concurrency = 4, save, saveEvery = 25 } = options;
  const ids = set.questions.map((q) => q.id);
  const tag = setTag(set);
  const known = file.sets[tag];
  if (known !== undefined && known.join('|') !== ids.join('|')) {
    throw new Error(
      `the saved ${tag} lists questions [${known.join(', ')}], not [${ids.join(', ')}]; bump the set's version`,
    );
  }
  file.sets[tag] = [...ids];

  const pending = pendingSubjects(set, subjects, file);
  const unique = new Set(subjects.map((s) => s.key)).size;
  const queue = limit !== undefined ? pending.slice(0, Math.max(0, limit)) : [...pending];
  const total = queue.length;
  const result: RunResult = {
    alreadyJudged: unique - pending.length,
    asked: total,
    answered: 0,
    failed: [],
    deferred: pending.length - total,
  };

  let sinceSave = 0;
  const worker = async () => {
    for (;;) {
      const subject = queue.shift();
      if (subject === undefined) return;
      try {
        const answers = await ask({ state: subject.state, questions: set.questions });
        const p = ids.map((id) => answers[id]);
        if (p.some((n) => typeof n !== 'number' || !(n >= 0 && n <= 1))) {
          throw new Error('the answer is missing a probability');
        }
        file.judgments[judgmentKey(set, subject.key)] = {
          label: subject.label,
          p: (p as number[]).map(round),
        };
        result.answered++;
        if (save !== undefined && ++sinceSave >= saveEvery) {
          sinceSave = 0;
          await save(file);
        }
      } catch (error) {
        result.failed.push({
          label: subject.label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      options.onProgress?.(result.answered + result.failed.length, total);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  // A run that got nothing back leaves the file as it was.
  if (save !== undefined && result.answered > 0) await save(file);
  return result;
}
