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
  staleCheck,
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
 * When the run was not narrowed (no grep, shard or line filter) and every
 * axe test ran to an end, passed or skipped, a baseline state that no scan
 * covered fails the run: a state renamed or dropped from the spec, or one a
 * skipped test no longer checks. So the baseline cannot keep allowing
 * violations for a state nothing checks. An update run in which every axe
 * test passed prunes such states instead (see `staleCheck`).
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
    const stale = staleCheck({
      narrowed: this.narrowed,
      statuses: [...this.axeTests.values()],
      updating: UPDATING,
    });
    const previous: Baseline = existsSync(BASELINE_PATH)
      ? parseBaseline(readFileSync(BASELINE_PATH, 'utf8'))
      : {};
    if (UPDATING) {
      const next = nextBaseline(previous, this.recordable, { prune: stale === 'prune' });
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
        stale,
      }),
    );
    const unscanned = stale === 'fail' ? staleStates(previous, this.scans) : [];
    if (unscanned.length === 0) return undefined;
    console.error(
      `\naxe baseline: every axe test ran or was skipped, and these baseline states were ` +
        `not scanned: ${unscanned.join(', ')}. Unskip the test that scans them, or run ` +
        `\`${UPDATE_COMMAND}\` to prune states that are gone, and commit the baseline.\n`,
    );
    return { status: 'failed' };
  }

  printsToStdio(): boolean {
    return false;
  }
}
