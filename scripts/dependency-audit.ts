/**
 * Fails on a high or critical advisory against a package the build ships,
 * unless `scripts/dependency-audit-ignore.json` records why it does not
 * apply. Reports every other advisory. The rules are in `dependencyAudit.ts`.
 *
 *   bun scripts/dependency-audit.ts
 *
 * Needs the network (`bun audit` asks the npm registry) and an install.
 * On GitHub Actions it also writes its table to the run summary.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import {
  type AuditReport,
  judge,
  parseIgnores,
  shippedPackages,
  toMarkdown,
} from './dependencyAudit.ts';

const audit = spawnSync('bun', ['audit', '--json'], { encoding: 'utf8', shell: false });
let report: AuditReport;
try {
  // `bun audit` exits 1 whenever it finds an advisory, so only its output counts.
  report = JSON.parse(audit.stdout || '{}') as AuditReport;
} catch {
  console.error(`dependency-audit: could not read bun audit's output.\n${audit.stderr}`);
  process.exit(2);
}
if (audit.error || (audit.status !== 0 && audit.status !== 1)) {
  console.error(`dependency-audit: bun audit failed (${audit.error?.message ?? audit.status}).`);
  console.error(audit.stderr);
  process.exit(2);
}

const shipped = shippedPackages(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8'));
const ignores = parseIgnores(
  JSON.parse(readFileSync('scripts/dependency-audit-ignore.json', 'utf8')),
);
const verdict = judge(report, shipped, ignores);
const markdown = toMarkdown(verdict);
console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
for (const f of verdict.failing) {
  console.log(
    `::error file=package.json::${f.package}: ${f.advisory.severity} ${f.advisory.title} (${f.advisory.url}). Update it, or record in scripts/dependency-audit-ignore.json why it does not apply to what ships.`,
  );
}
process.exit(verdict.failing.length > 0 ? 1 : 0);
