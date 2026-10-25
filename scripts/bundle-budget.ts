/**
 * Bundle budget gate (TEST-001). Run after `bun run build`:
 *
 *   bun scripts/bundle-budget.ts
 *
 * Measures `dist/` against `scripts/bundle-budget.json`, prints a table (also
 * appended to `$GITHUB_STEP_SUMMARY` in CI), and exits 1 when any metric is
 * over budget or the build output cannot be measured. Ratcheting a budget is
 * a one-line JSON diff.
 */
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { type DistFile, evaluate, measure, parseBudget, toMarkdown } from './bundleBudget.ts';

const root = path.resolve(import.meta.dirname, '..');
const distDir = path.join(root, 'dist');
const budgetPath = path.join(import.meta.dirname, 'bundle-budget.json');

function fail(message: string): never {
  console.error(`bundle-budget: ${message}`);
  // A structural failure belongs in the job summary too, not only the log.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary)
    appendFileSync(summary, `### Bundle budget\n\nCould not measure the build: ${message}\n`);
  process.exit(1);
}

/** Every file under `dir`, as `dist/`-relative posix paths. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

if (!existsSync(path.join(distDir, 'index.html')) || !existsSync(path.join(distDir, 'sw.js'))) {
  fail('dist/index.html or dist/sw.js is missing. Run `bun run build` first.');
}

const files: DistFile[] = walk(distDir).map((full) => {
  const content = readFileSync(full);
  return {
    path: path.relative(distDir, full).split(path.sep).join('/'),
    bytes: content.byteLength,
    // Fixed level so the numbers do not move with zlib's default.
    gzipBytes: gzipSync(content, { level: 9 }).byteLength,
  };
});

let report: string;
let violations: number;
try {
  const measurement = measure({
    indexHtml: readFileSync(path.join(distDir, 'index.html'), 'utf8'),
    swJs: readFileSync(path.join(distDir, 'sw.js'), 'utf8'),
    files,
  });
  const budget = parseBudget(JSON.parse(readFileSync(budgetPath, 'utf8')));
  const result = evaluate(measurement, budget);
  violations = result.violations.length;
  report = [
    '### Bundle budget',
    '',
    toMarkdown(result.rows),
    '',
    violations === 0
      ? 'All metrics are within budget.'
      : `${violations} metric(s) over budget. Shrink the bundle, or raise the budget in \`scripts/bundle-budget.json\` with a reason in the PR.`,
  ].join('\n');
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

console.log(report);
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) appendFileSync(summaryPath, `${report}\n`);
if (violations > 0) process.exit(1);
