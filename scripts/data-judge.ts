/**
 * Ask Jev about the prose the data audit cannot judge on its own, and save the
 * answers to `scripts/data-judgments.json` for the audit to compare against:
 *
 *   - `prose`: for every trait and feature the engine prose-scans, the yes/no
 *     questions the scanner's output answers (bonus action, limited uses, …);
 *   - `branch`: for every multi-name `additionalSpells` block whose prose
 *     never says "choose", whether it is a choice or a grant of everything;
 *   - `reprint`: for every 2014/2024 reprint pair whose prose differs, whether
 *     only the wording changed. Only when asked for by name: it is the largest
 *     set, and no check in the audit rests on it.
 *
 *   bun run data:judge -- --dry-run            # what would be asked, and a sample request
 *   bun run data:judge -- --limit 25           # a trial: ask about 25 subjects
 *   bun run data:judge                         # ask `prose` and `branch`, whatever is not yet judged
 *   bun run data:judge -- --set reprint        # ask about reprint pairs instead
 *   bun run data:judge -- --tag latest         # judge the newest compatible release
 *
 * Only prose with no saved answer is asked about, so a rerun after a data bump
 * costs only what changed. Needs AI_GATEWAY_API_KEY unless `--dry-run`. That
 * key is a Vercel AI Gateway key by default; for a direct TypeSafe key, also set
 * JEV_ENDPOINT=https://api.typesafe.ai/v1/systemone and JEV_MODEL=jev-latest.
 * The logic lives in `src/data5e/audit/`; this file fetches, prints and writes.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BRANCH_SET, branchSubjects } from '../src/data5e/audit/branches';
import { createJevClient, JEV_MODEL, jevRequestBody } from '../src/data5e/audit/jev';
import {
  emptyJudgments,
  type JudgeSet,
  type JudgeSubject,
  pendingSubjects,
  runJudgments,
} from '../src/data5e/audit/judgments';
import { PROSE_SET } from '../src/data5e/audit/proseChecks';
import { proseSubjects } from '../src/data5e/audit/proseSubjects';
import {
  auditReprints,
  describeReprints,
  REPRINT_SET,
  reprintPairs,
  reprintSubjects,
} from '../src/data5e/audit/reprints';
import { DATA_TAG, isCompatibleTag } from '../src/data5e/config';
import { normalizeDataset } from '../src/data5e/normalize';
import { readJudgments, writeJudgments } from './data-judgments-file';
import { fetchRelease, resolveLatestTag } from './data-release';

/** Jev's systemone endpoint on Vercel AI Gateway, the default for AI_GATEWAY_API_KEY. */
const GATEWAY_ENDPOINT = 'https://ai-gateway.vercel.sh/typesafe/v1/systemone';

// A direct TypeSafe key needs both: the gateway's model name is not documented
// for the direct API. `||` so an empty variable counts as unset.
const endpoint = process.env.JEV_ENDPOINT || GATEWAY_ENDPOINT;
const model = process.env.JEV_MODEL || JEV_MODEL;

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    tag: { type: 'string' },
    set: { type: 'string', default: 'all' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function die(message: string): never {
  console.error(`data-judge: ${message}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `### Data judge\n\nThe run could not finish: ${message}\n`);
  process.exit(1);
}

function positive(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) die(`--${name} must be a positive integer`);
  return n;
}

const limit = positive('limit', values.limit);
const concurrency = positive('concurrency', values.concurrency) ?? 4;
if (!['all', 'prose', 'branch', 'reprint'].includes(values.set)) {
  die('--set must be all, prose, branch or reprint');
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

const apiKey = process.env.AI_GATEWAY_API_KEY ?? '';
if (!values['dry-run'] && apiKey === '') {
  die('set AI_GATEWAY_API_KEY, or pass --dry-run to see what would be asked');
}

let file: ReturnType<typeof emptyJudgments>;
try {
  file = readJudgments() ?? emptyJudgments();
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

console.log(`# data-judge against ${tag}, asking ${model} at ${endpoint}\n`);
let release: Awaited<ReturnType<typeof fetchRelease>>;
try {
  release = await fetchRelease(tag);
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
const registry = normalizeDataset(release.files);

const runs: Array<{ set: JudgeSet; subjects: JudgeSubject[] }> = [];
if (values.set === 'all' || values.set === 'prose') {
  // Curated features never reach the scanner, so their answers would go unused.
  runs.push({ set: PROSE_SET, subjects: proseSubjects(registry).filter((s) => !s.curated) });
}
if (values.set === 'all' || values.set === 'branch') {
  runs.push({ set: BRANCH_SET, subjects: branchSubjects(registry) });
}
if (values.set === 'reprint') {
  const found = reprintPairs(registry);
  for (const line of describeReprints(auditReprints(found, file))) console.log(line);
  console.log('');
  runs.push({ set: REPRINT_SET, subjects: reprintSubjects(found.pairs) });
}

/**
 * About four characters a token, the usual rule of thumb for English prose. Every
 * request repeats the questions, which is a real share of a short subject's cost.
 */
function estimateTokens(set: JudgeSet, subjects: readonly JudgeSubject[]): number {
  const perRequest = set.questions.reduce((n, q) => n + q.id.length + q.instructions.length, 0);
  return Math.ceil(subjects.reduce((n, s) => n + s.state.length + perRequest, 0) / 4);
}

const summary: string[] = [`### Data judge: ${tag}`, ''];
let failures = 0;
let budgetLeft = limit;
for (const { set, subjects } of runs) {
  const pending = pendingSubjects(set, subjects, file);
  const asking = budgetLeft === undefined ? pending : pending.slice(0, budgetLeft);
  console.log(
    `## ${set.id}@${set.version}: ${subjects.length} subjects, ${subjects.length - pending.length} already judged, ${pending.length} pending, about ${estimateTokens(set, asking)} input tokens to ask ${asking.length}`,
  );

  if (values['dry-run']) {
    const sample = pending[0];
    if (sample !== undefined) {
      const body = jevRequestBody({ state: sample.state, questions: set.questions }, model);
      console.log(`sample request (${sample.label}):\n${JSON.stringify(body, null, 2)}\n`);
    }
    continue;
  }
  if (asking.length === 0) continue;

  const ask = createJevClient({ apiKey, endpoint, model });
  const result = await runJudgments({
    set,
    subjects,
    file,
    ask,
    limit: asking.length,
    concurrency,
    save: writeJudgments,
    onProgress: (done, total) => {
      if (done % 50 === 0 || done === total) console.log(`  ${done}/${total}`);
    },
  });
  budgetLeft = budgetLeft === undefined ? undefined : budgetLeft - result.asked;
  failures += result.failed.length;
  console.log(
    `answered ${result.answered}, failed ${result.failed.length}, left for later ${pending.length - result.asked}`,
  );
  for (const f of result.failed.slice(0, 20)) console.log(`- ${f.label}: ${f.error}`);
  summary.push(
    `- \`${set.id}@${set.version}\`: ${result.answered} answered, ${result.failed.length} failed, ${pending.length - result.asked} left for later (${result.alreadyJudged} already judged)`,
  );
}

if (!values['dry-run']) {
  summary.push(
    '',
    'Commit `scripts/data-judgments.json`, then run `bun run data:audit` to read the answers against the data.',
  );
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) appendFileSync(out, `${summary.join('\n')}\n`);
}
if (failures > 0) die(`${failures} subject(s) got no answer; the rest are saved, rerun to retry`);
