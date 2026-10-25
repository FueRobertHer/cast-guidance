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
  evaluateAudit,
  parseAuditBudget,
  toMarkdown,
} from '../src/data5e/audit/budget';
import {
  DATA_TAG,
  isCompatibleTag,
  MAX_DATA_FILE_BYTES,
  parseTagVersion,
  TAGS_API_URL,
} from '../src/data5e/config';
import { GithubTagSource } from '../src/data5e/source';

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

/**
 * The newest release this build could install, straight from the GitHub tags
 * API. Deliberately not `listAvailableTags` from the loader, which needs
 * IndexedDB. A token, when the workflow provides one, lifts the rate limit.
 */
async function resolveLatestTag(): Promise<string> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${TAGS_API_URL}?per_page=100`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GitHub tags API answered HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!Array.isArray(body)) throw new Error('GitHub tags API did not answer with a list');
  const versions = body
    .map((t: unknown) =>
      t !== null && typeof t === 'object' ? (t as { name?: unknown }).name : '',
    )
    .filter((name): name is string => typeof name === 'string' && isCompatibleTag(name))
    .map((name) => ({ name, v: parseTagVersion(name) }))
    .filter((t): t is { name: string; v: NonNullable<typeof t.v> } => t.v !== null)
    .sort((a, b) => b.v.major - a.v.major || b.v.minor - a.v.minor || b.v.patch - a.v.patch);
  const newest = versions[0];
  if (newest === undefined) throw new Error(`no tag compatible with ${DATA_TAG} on the mirror`);
  return newest.name;
}

const STATIC_FILES = [
  'races.json',
  'backgrounds.json',
  'feats.json',
  'items-base.json',
  'items.json',
  'magicvariants.json',
  'optionalfeatures.json',
  'skills.json',
  'languages.json',
  'senses.json',
  'actions.json',
  'conditionsdiseases.json',
  'variantrules.json',
  'books.json',
  'class/index.json',
  'spells/index.json',
];

async function fetchRelease(tag: string) {
  /** Decoded size of every file fetched, by data path, for the size check. */
  const fileBytes = new Map<string, number>();
  const source = new GithubTagSource(tag, {
    fetchImpl: async (input, init) => {
      const res = await fetch(input, init);
      if (res.ok) {
        const url = String(input);
        const dataPath = url.slice(url.indexOf('/data/') + '/data/'.length);
        fileBytes.set(dataPath, (await res.clone().arrayBuffer()).byteLength);
      }
      return res;
    },
  });
  const files = new Map<string, unknown>();
  const fetchInto = async (paths: string[]) => {
    const queue = [...paths];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (;;) {
          const p = queue.shift();
          if (p === undefined) return;
          files.set(p, await source.fetchFile(p));
        }
      }),
    );
  };
  await fetchInto(STATIC_FILES);
  const index = (p: string) => Object.values((files.get(p) ?? {}) as Record<string, string>);
  await fetchInto([
    ...index('class/index.json').map((f) => `class/${f}`),
    ...index('spells/index.json').map((f) => `spells/${f}`),
  ]);
  return { files, fileBytes };
}

function readBudget(): AuditBudget {
  if (!existsSync(budgetPath)) return { tags: {} };
  return parseAuditBudget(JSON.parse(readFileSync(budgetPath, 'utf8')));
}

function printReport(report: AuditReport): void {
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
    console.log(
      `- ${b.choiceWording ? 'worded' : 'UNWORDED'} ${b.key} ${b.uid} [${b.names.join(', ')}]`,
    );
  }
}

function writeBudget(report: AuditReport, budget: AuditBudget): void {
  const previous = budget.tags[report.tag] ?? budget.tags[DATA_TAG];
  const next: AuditBudget = {
    ...budget,
    tags: { ...budget.tags, [report.tag]: budgetFromReport(report, previous?.branchAllow) },
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

const report = analyzeDataset({
  tag,
  files: release.files,
  fileBytes: release.fileBytes,
  // Half the app's refusal limit is the line for planning a bump: a release
  // that crosses it is still served, but the next few might not be.
  maxFileBytes: MAX_DATA_FILE_BYTES / 2,
});
printReport(report);

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
