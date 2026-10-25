import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import {
  assertUpdateAllowed,
  BASELINE_PATH,
  type Baseline,
  isNarrowedRun,
  nextBaseline,
  parseBaseline,
  renderSummary,
  SCAN_ATTACHMENT,
  type ScanRecord,
  serializeBaseline,
  staleStates,
  UPDATE_COMMAND,
  UPDATING,
} from './baseline.ts';

const SUMMARY_PATH = path.resolve(import.meta.dirname, '../../test-results/a11y-summary.md');

/** The spec whose tests between them scan every baseline state. */
const AXE_SPEC = path.join('a11y', 'axe.spec.ts');

/**
 * Collects every axe scan of the run (the specs attach one per state), then
 * writes `test-results/a11y-summary.md` for the CI step summary and, with
 * `A11Y_BASELINE_UPDATE=1`, rewrites the baseline. Here rather than in a spec
 * because only the runner sees every worker's scans.
 *
 * A state is only taken from a test that passed, so an update run never
 * writes the half-scanned state of a test that broke part way.
 *
 * When the run was complete (no grep, shard or line filter, and every axe
 * test ran and passed), a baseline state that no scan covered is stale: a
 * state renamed or dropped from the spec. That fails the run, so the
 * baseline cannot keep allowing violations for a state nothing checks; an
 * update run prunes it instead.
 */
export default class A11yReporter implements Reporter {
  private readonly scans: ScanRecord[] = [];
  /** Scans from passing tests: the only ones an update may record. */
  private readonly recordable: ScanRecord[] = [];
  private readonly axeTests = new Map<string, TestResult['status'] | undefined>();
  private narrowed = true;

  constructor() {
    assertUpdateAllowed(process.env);
  }

  onBegin(config: FullConfig, suite: Suite): void {
    // A summary left by an earlier run must not pass for this one's.
    rmSync(SUMMARY_PATH, { force: true });
    for (const t of suite.allTests()) {
      if (t.location.file.endsWith(AXE_SPEC)) this.axeTests.set(t.id, undefined);
    }
    this.narrowed = isNarrowedRun({
      grep: config.grep,
      grepInvert: config.grepInvert,
      shard: config.shard,
      projects: config.projects,
      argv: config.argv,
    });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this.axeTests.has(test.id)) this.axeTests.set(test.id, result.status);
    for (const a of result.attachments) {
      if (a.name !== SCAN_ATTACHMENT || a.body === undefined) continue;
      const scan = JSON.parse(a.body.toString('utf8')) as ScanRecord;
      // A failed test's scans still show in the summary, which is where a
      // regression is explained.
      this.scans.push(scan);
      if (result.status === 'passed') this.recordable.push(scan);
    }
  }

  async onEnd(): Promise<{ status?: FullResult['status'] } | undefined> {
    if (this.scans.length === 0) return undefined;
    const complete =
      !this.narrowed &&
      this.axeTests.size > 0 &&
      [...this.axeTests.values()].every((status) => status === 'passed');
    const previous: Baseline = existsSync(BASELINE_PATH)
      ? parseBaseline(readFileSync(BASELINE_PATH, 'utf8'))
      : {};
    if (UPDATING) {
      const next = nextBaseline(previous, this.recordable, { prune: complete });
      writeFileSync(BASELINE_PATH, serializeBaseline(next));
    }
    mkdirSync(path.dirname(SUMMARY_PATH), { recursive: true });
    writeFileSync(
      SUMMARY_PATH,
      renderSummary({
        scans: this.scans,
        baseline: previous,
        updated: UPDATING,
        updateCommand: UPDATE_COMMAND,
        complete,
      }),
    );
    const stale = complete && !UPDATING ? staleStates(previous, this.scans) : [];
    if (stale.length === 0) return undefined;
    console.error(
      `\naxe baseline: every axe test ran, and these baseline states were not scanned: ` +
        `${stale.join(', ')}. Run \`${UPDATE_COMMAND}\` to prune them, and commit the baseline.\n`,
    );
    return { status: 'failed' };
  }

  printsToStdio(): boolean {
    return false;
  }
}
