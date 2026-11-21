/**
 * Does a PR touch the data audit? Reads changed file names (one per line) on
 * stdin and prints the ones that can change the audit's result, from
 * `dataAuditInputs.ts`. On GitHub Actions it also writes `data=true` or
 * `data=false` to the step's outputs and a line to the run summary.
 *
 *   git diff --name-only HEAD^1 HEAD | bun scripts/data-audit-changes.ts
 *   bun scripts/data-audit-changes.ts --list    # every input, for a look
 *
 * A failure (an import that does not resolve) exits non-zero, and the
 * workflow then runs the audit rather than skip it.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { ALWAYS_INPUTS, auditInputs, auditTouches } from './dataAuditInputs.ts';

const root = process.cwd();
const inputs = auditInputs(root);

if (process.argv.includes('--list')) {
  console.log(inputs.join('\n'));
  console.log(`\n${inputs.length} imported files, plus anything matching:`);
  for (const re of ALWAYS_INPUTS) console.log(`  ${re.source}`);
  process.exit(0);
}

const changed = readFileSync(0, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '');
const touched = auditTouches(changed, new Set(inputs));

console.log(
  `${inputs.length} imported files; ${changed.length} changed; ${touched.length} audit inputs changed.`,
);
for (const file of touched) console.log(`  ${file}`);

const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `data=${touched.length > 0}\n`);
if (GITHUB_STEP_SUMMARY) {
  const summary =
    touched.length > 0
      ? `The audit runs: ${touched.length} of its inputs changed (${touched
          .slice(0, 5)
          .map((f) => `\`${f}\``)
          .join(', ')}${touched.length > 5 ? ', ...' : ''}).\n`
      : `No data audit inputs changed (${inputs.length} imported files checked); the audit is skipped.\n`;
  appendFileSync(GITHUB_STEP_SUMMARY, summary);
}
