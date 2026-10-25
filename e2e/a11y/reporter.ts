import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  BASELINE_PATH,
  type Baseline,
  nextBaseline,
  parseBaseline,
  renderSummary,
  SCAN_ATTACHMENT,
  type ScanRecord,
  serializeBaseline,
  UPDATE_COMMAND,
  UPDATING,
} from './baseline.ts';

const SUMMARY_PATH = path.resolve(import.meta.dirname, '../../test-results/a11y-summary.md');

/**
 * Collects every axe scan of the run (the specs attach one per state), then
 * writes `test-results/a11y-summary.md` for the CI step summary and, with
 * `A11Y_BASELINE_UPDATE=1`, rewrites the baseline. Here rather than in a spec
 * because only the runner sees every worker's scans.
 *
 * A state is only taken from a test that passed, so an update run never
 * writes the half-scanned state of a test that broke part way.
 */
export default class A11yReporter implements Reporter {
  private readonly scans: ScanRecord[] = [];
  /** Scans from passing tests: the only ones an update may record. */
  private readonly recordable: ScanRecord[] = [];

  onBegin(): void {
    // A summary left by an earlier run must not pass for this one's.
    rmSync(SUMMARY_PATH, { force: true });
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const a of result.attachments) {
      if (a.name !== SCAN_ATTACHMENT || a.body === undefined) continue;
      const scan = JSON.parse(a.body.toString('utf8')) as ScanRecord;
      // A failed test's scans still show in the summary, which is where a
      // regression is explained.
      this.scans.push(scan);
      if (result.status === 'passed') this.recordable.push(scan);
    }
  }

  onEnd(): void {
    if (this.scans.length === 0) return;
    const previous: Baseline = existsSync(BASELINE_PATH)
      ? parseBaseline(readFileSync(BASELINE_PATH, 'utf8'))
      : {};
    if (UPDATING) {
      writeFileSync(BASELINE_PATH, serializeBaseline(nextBaseline(previous, this.recordable)));
    }
    mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
    writeFileSync(
      SUMMARY_PATH,
      renderSummary({
        scans: this.scans,
        baseline: previous,
        updated: UPDATING,
        updateCommand: UPDATE_COMMAND,
      }),
    );
  }

  printsToStdio(): boolean {
    return false;
  }
}
