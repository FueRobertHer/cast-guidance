/**
 * One-off scoping question sets. Each asks Jev about a wide net of prose once,
 * then prints a ranked list that becomes the backlog for a piece of work in
 * FUTURE_WORK.md. Unlike `prose` and `branch`, the data audit never reads these
 * answers and no check depends on them, and `data:judge` only asks when a set is
 * named with `--set`.
 *
 * A report joins today's subjects with the saved answers rather than reading the
 * saved labels alone, so what has been curated or given a capability line since
 * the run drops off the list by itself.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */
import {
  answersFor,
  type JudgeSet,
  type JudgeSubject,
  type JudgmentFile,
  setTag,
} from './judgments';
import { CONFIDENT_NO, CONFIDENT_YES } from './proseChecks';
import type { ByType } from './proseSubjects';

export interface Scope {
  set: JudgeSet;
  subjects(registry: ByType): JudgeSubject[];
  /** The ranked list from saved answers. Never asks Jev. */
  report(registry: ByType, file: JudgmentFile): string;
}

export type Answers = Readonly<Record<string, number>>;

export interface Answered<S> {
  subject: S;
  answers: Answers;
}

/** The subjects that have saved answers, in the order given. */
export function answeredSubjects<S extends JudgeSubject>(
  set: JudgeSet,
  subjects: readonly S[],
  file: JudgmentFile,
): Answered<S>[] {
  const out: Answered<S>[] = [];
  for (const subject of subjects) {
    const answers = answersFor(file, set, subject.key);
    if (answers !== undefined) out.push({ subject, answers });
  }
  return out;
}

export const pOf = (answers: Answers, id: string) => answers[id] ?? 0;
export const saysYes = (answers: Answers, id: string) => pOf(answers, id) >= CONFIDENT_YES;
export const saysNo = (answers: Answers, id: string) => pOf(answers, id) <= CONFIDENT_NO;
export const showP = (p: number) => p.toFixed(2);

/** The title and how much of the net has answers, which is the first thing to trust or not. */
export function reportHead(set: JudgeSet, title: string, total: number, answered: number): string {
  const missing = total - answered;
  const hint = missing > 0 ? ` (bun run data:judge -- --set ${set.id})` : '';
  return [
    `# ${setTag(set)}: ${title}`,
    `${total} subjects, ${answered} answered, ${missing} not asked yet${hint}.`,
    '',
  ].join('\n');
}

/** For a report that sorts by yes and no, rather than ranking one probability. */
export const YES_MEANS = `Yes means p >= ${CONFIDENT_YES}.`;

export function reportSection(title: string, rows: readonly string[]): string {
  return [`## ${title}: ${rows.length}`, ...rows, ''].join('\n');
}
