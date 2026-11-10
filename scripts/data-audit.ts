/**
 * Data audit (TEST-005): downloads a REAL 5etools release, runs it through the
 * app's own normalization, and judges what the tolerant parsers could not
 * interpret against `scripts/data-audit-budget.json`.
 *
 *   bun run data:audit                         # the pinned DATA_TAG, exits 1 on failures
 *   bun run data:audit -- --tag latest         # newest compatible release
 *   bun run data:audit -- --tag v2.33.0 --write-budget
 *   bun run data:audit -- --report-only --json audit.json
 *
 * `.github/workflows/data-audit.yml` runs it weekly and on PRs that touch the
 * parsers. The counting lives in `src/data5e/audit/` so it is typechecked,
 * linted and unit tested; this file only fetches, prints and writes.
 *
 * Network-gated by design: no game data ever lands in the repo.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { type AuditReport, analyzeDataset, sortedCounts } from '../src/data5e/audit/analyze';
import {
  type AuditBudget,
  type AuditEvaluation,
  budgetFromReport,
  describeDisagreement,
  evaluateAudit,
  parseAuditBudget,
  toMarkdown,
  unsettledDisagreements,
} from '../src/data5e/audit/budget';
import { describeReprints } from '../src/data5e/audit/reprints';
import { DATA_TAG, isCompatibleTag, MAX_DATA_FILE_BYTES } from '../src/data5e/config';
import { readJudgments } from './data-judgments-file';
import { fetchRelease, resolveLatestTag } from './data-release';

const budgetPath = path.join(import.meta.dirname, 'data-audit-budget.json');

const { values } = parseArgs({
  // `bun run data:audit -- --tag x` can hand the separator through.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    tag: { type: 'string' },
    'report-only': { type: 'boolean', default: false },
    json: { type: 'string' },
    'write-budget': { type: 'boolean', default: false },
  },
});

function appendSummary(markdown: string): void {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${markdown}\n`);
}

function setOutput(name: string, value: string): void {
  const output = process.env.GITHUB_OUTPUT;
  if (output) appendFileSync(output, `${name}=${value}\n`);
}

function die(message: string): never {
  console.error(`data-audit: ${message}`);
  appendSummary(`### Data audit\n\nThe audit could not run: ${message}\n`);
  process.exit(1);
}

function readBudget(): AuditBudget {
  if (!existsSync(budgetPath)) return { tags: {} };
  return parseAuditBudget(JSON.parse(readFileSync(budgetPath, 'utf8')));
}

function printReport(report: AuditReport, budget: AuditBudget): void {
  console.log(`fetched ${report.fileCount} files\n`);

  console.log('## file sizes');
  for (const f of report.largestFiles) console.log(`- ${f.bytes} bytes ${f.path}`);
  console.log(
    report.oversizedFiles.length === 0
      ? `all files under half of MAX_DATA_FILE_BYTES (${report.maxFileBytes} bytes)`
      : `files over half of MAX_DATA_FILE_BYTES (${report.maxFileBytes} bytes): ${report.oversizedFiles.join(', ')}`,
  );

  console.log('\n## entity counts');
  console.log(
    Object.entries(report.entities)
      .map(([k, v]) => `${k}=${v}`)
      .join(' '),
  );

  const warnings = Object.values(report.warningGroups).reduce((a, b) => a + b, 0);
  console.log(`\n## copy/mod warnings (${warnings})`);
  for (const [message, n] of sortedCounts(report.warningGroups)) {
    console.log(`- [${n}x] ${message}`);
    console.log(`    e.g. ${(report.warningExamples[message] ?? []).join(', ')}`);
  }
  console.log(`unresolved _copy targets: ${report.unresolvedCopies}`);

  console.log('\n## spell roll actions');
  console.log(
    `${report.spellsWithDice}/${report.spellCount} spells expose dice; checked ${report.generatedRolls} generated rolls`,
  );
  if (report.invalidSpellRolls.length === 0) console.log('all generated expressions parse');
  else {
    console.log(`invalid expressions (${report.invalidSpellRolls.length})`);
    for (const line of report.invalidSpellRolls.slice(0, 40)) console.log(`- ${line}`);
  }

  console.log('\n## {@tag} histogram (desc)');
  console.log(
    sortedCounts(report.tagCounts)
      .map(([t, n]) => `${t}:${n}`)
      .join(' '),
  );
  const unhandled = sortedCounts(report.unhandledTags);
  console.log(
    unhandled.length === 0
      ? 'every tag is rendered'
      : `rendered as plain text: ${unhandled.map(([t, n]) => `${t}:${n}`).join(' ')}`,
  );

  console.log('\n## underscore keys');
  console.log(
    sortedCounts(report.underscoreKeys)
      .map(([t, n]) => `${t}:${n}`)
      .join(' '),
  );

  console.log('\n## additionalSpells blocks with distinct names');
  for (const b of report.branchBlocks) {
    const proposal = b.choiceP === undefined ? '' : ` (Jev: choice p=${b.choiceP})`;
    console.log(
      `- ${b.choiceWording ? 'worded' : 'UNWORDED'} ${b.key} ${b.uid} [${b.names.join(', ')}]${proposal}`,
    );
  }

  const { prose } = report;
  console.log(`\n## prose scan vs saved judgments`);
  console.log(`${prose.judged}/${prose.subjects} scanned traits and features judged`);
  if (prose.judged > 0) {
    console.log(
      sortedCounts(prose.byCheck)
        .map(([group, n]) => `${group}=${n}`)
        .join(' ') || 'no disagreements',
    );
    const allow = budget.tags[report.tag]?.prose?.allow;
    for (const d of unsettledDisagreements(report, allow).slice(0, 60)) {
      console.log(`- ${describeDisagreement(d)}`);
    }
  }

  console.log('\n## 2014/2024 reprints');
  for (const line of describeReprints(report.reprints)) console.log(line);

  // A count to watch, not a gate. `bun run data:judge -- --report spend` names them.
  const { spend } = report;
  console.log('\n## features that spend a pool');
  console.log(
    `${spend.linked} linked, ${spend.unlinked} unlinked, ${spend.skipped} left out with a reason, ` +
      `${spend.unasked} not asked`,
  );
}

function writeBudget(report: AuditReport, budget: AuditBudget): void {
  const previous = budget.tags[report.tag] ?? budget.tags[DATA_TAG];
  const next: AuditBudget = {
    ...budget,
    tags: {
      ...budget.tags,
      [report.tag]: budgetFromReport(report, previous?.branchAllow, previous?.prose),
    },
  };
  writeFileSync(budgetPath, `${JSON.stringify(next, null, 2)}\n`);
  try {
    // Biome lints this file; leave it formatted the way the linter wants.
    execFileSync('bunx', ['biome', 'format', '--write', budgetPath], { stdio: 'ignore' });
  } catch {
    console.warn('data-audit: could not run biome; run `bun run lint:fix` before committing');
  }
  console.log(`\nwrote the ${report.tag} entry to ${path.relative(process.cwd(), budgetPath)}`);
}

let tag = values.tag ?? DATA_TAG;
if (tag === 'latest') {
  try {
    tag = await resolveLatestTag();
  } catch (error) {
    die(`could not resolve the latest tag: ${error instanceof Error ? error.message : error}`);
  }
}
if (!isCompatibleTag(tag)) die(`${tag} is not compatible with this build (pinned ${DATA_TAG})`);
setOutput('tag', tag);

let budget: AuditBudget;
try {
  budget = readBudget();
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

console.log(`# data-audit against ${tag}${tag === DATA_TAG ? '' : ` (pinned ${DATA_TAG})`}\n`);

let release: Awaited<ReturnType<typeof fetchRelease>>;
try {
  release = await fetchRelease(tag);
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

let judgments: ReturnType<typeof readJudgments>;
try {
  judgments = readJudgments();
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

const report = analyzeDataset({
  tag,
  files: release.files,
  fileBytes: release.fileBytes,
  // Half the app's refusal limit is the line for planning a bump: a release
  // that crosses it is still served, but the next few might not be.
  maxFileBytes: MAX_DATA_FILE_BYTES / 2,
  judgments,
});
printReport(report, budget);

if (values['write-budget']) {
  writeBudget(report, budget);
  budget = readBudget();
}

// A tag other than the pin, with no budget of its own, is judged for new
// problems against the pin's budget rather than failed for having none.
const evaluation: AuditEvaluation = evaluateAudit(report, budget, {
  baselineTag: tag === DATA_TAG ? undefined : DATA_TAG,
});
const markdown = toMarkdown(report, evaluation);
console.log(`\n${markdown}`);
appendSummary(markdown);

if (values.json !== undefined) {
  writeFileSync(values.json, `${JSON.stringify({ report, evaluation }, null, 2)}\n`);
}

const failed = evaluation.failures.length > 0;
setOutput('result', failed ? 'fail' : 'pass');
if (failed && !values['report-only']) process.exit(1);
