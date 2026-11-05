/**
 * Where the saved Jev judgments live, and reading and writing them. The format
 * and its validation are in `src/data5e/audit/judgments.ts`.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  type JudgmentFile,
  parseJudgments,
  serializeJudgments,
} from '../src/data5e/audit/judgments';

export const JUDGMENTS_PATH = path.join(import.meta.dirname, 'data-judgments.json');

/** The saved judgments, or undefined before the first `data:judge` run. */
export function readJudgments(): JudgmentFile | undefined {
  if (!existsSync(JUDGMENTS_PATH)) return undefined;
  return parseJudgments(JSON.parse(readFileSync(JUDGMENTS_PATH, 'utf8')));
}

/** Write through a temporary file, so an interrupted run never leaves half a file. */
export function writeJudgments(file: JudgmentFile): void {
  const temporary = `${JUDGMENTS_PATH}.tmp`;
  writeFileSync(temporary, serializeJudgments(file));
  renameSync(temporary, JUDGMENTS_PATH);
}
