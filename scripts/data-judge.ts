/**
 * Ask Jev about the prose the data audit cannot judge on its own, and save the
 * answers to `scripts/data-judgments.json` for the audit to compare against:
 *
 *   - `prose`: for every trait and feature the engine prose-scans, the yes/no
 *     questions the scanner's output answers (bonus action, limited uses, …);
 *   - `branch`: for every multi-name `additionalSpells` block whose prose
 *     never says "choose", whether it is a choice or a grant of everything.
 *
 * Three one-off scoping sets answer "what is there to do?" for a piece of
 * FUTURE_WORK.md instead. No check reads them, and they are only asked when
 * named, never as part of `all`:
 *
 *   - `bonus`: check and initiative bonuses in prose, by type;
 *   - `featchoice`: picks feats ask for that the app does not offer;
 *   - `capability`: features a player could forget to use in combat.
 *
 *   bun run data:judge -- --dry-run            # what would be asked, and a sample request
 *   bun run data:judge -- --limit 25           # a trial: ask about 25 subjects
 *   bun run data:judge                         # ask about everything not yet judged
 *   bun run data:judge -- --tag latest         # judge the newest compatible release
 *   bun run data:judge -- --set bonus          # ask only one set
 *   bun run data:judge -- --report bonus       # a scoping set's ranked list, from saved answers
 *
 * Only prose with no saved answer is asked about, so a rerun after a data bump
 * costs only what changed. Needs AI_GATEWAY_API_KEY unless `--dry-run` or
 * `--report`. That key is a Vercel AI Gateway key by default; for a direct
 * TypeSafe key, also set JEV_ENDPOINT=https://api.typesafe.ai/v1/systemone and
 * JEV_MODEL=jev-latest.
 * The logic lives in `src/data5e/audit/`; this file fetches, prints and writes.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BONUS_SCOPE } from '../src/data5e/audit/bonusScope';
import { BRANCH_SET, branchSubjects } from '../src/data5e/audit/branches';
import { CAPABILITY_SCOPE } from '../src/data5e/audit/capabilityScope';
import { FEATCHOICE_SCOPE } from '../src/data5e/audit/featChoiceScope';
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
import type { Scope } from '../src/data5e/audit/scoping';
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
    report: { type: 'string' },
  },
});

/** One-off sets, asked only when named: `all` must not spend credit on them. */
const SCOPES: Record<string, Scope> = {
  bonus: BONUS_SCOPE,
  featchoice: FEATCHOICE_SCOPE,
  capability: CAPABILITY_SCOPE,
};
const scopeNamed = (name: string | undefined) =>
  name !== undefined && Object.hasOwn(SCOPES, name) ? SCOPES[name] : undefined;

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
const scopeNames = Object.keys(SCOPES).join(', ');
const askedScope = scopeNamed(values.set);
if (!['all', 'prose', 'branch'].includes(values.set) && askedScope === undefined) {
  die(`--set must be all, prose, branch, ${scopeNames}`);
}
const reportScope = scopeNamed(values.report);
if (values.report !== undefined && reportScope === undefined) {
  die(`--report must be ${scopeNames}`);
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
if (!values['dry-run'] && reportScope === undefined && apiKey === '') {
  die('set AI_GATEWAY_API_KEY, or pass --dry-run to see what would be asked');
}

let file: ReturnType<typeof emptyJudgments>;
try {
  file = readJudgments() ?? emptyJudgments();
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}

console.log(
  reportScope === undefined
    ? `# data-judge against ${tag}, asking ${model} at ${endpoint}\n`
    : `# data-judge against ${tag}, from saved answers\n`,
);
let release: Awaited<ReturnType<typeof fetchRelease>>;
try {
  release = await fetchRelease(tag);
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
const registry = normalizeDataset(release.files);

const runs: Array<{ set: JudgeSet; subjects: JudgeSubject[] }> = [];
if (reportScope !== undefined) {
  console.log(reportScope.report(registry, file));
} else if (askedScope !== undefined) {
  runs.push({ set: askedScope.set, subjects: askedScope.subjects(registry) });
} else {
  if (values.set !== 'branch') {
    // Curated features never reach the scanner, so their answers would go unused.
    runs.push({ set: PROSE_SET, subjects: proseSubjects(registry).filter((s) => !s.curated) });
  }
  if (values.set !== 'prose') runs.push({ set: BRANCH_SET, subjects: branchSubjects(registry) });
}

/**
 * About four characters a token, the usual rule of thumb for English prose.
 * Every request repeats the set's questions, so they count once per subject.
 */
function estimateTokens(set: JudgeSet, subjects: readonly JudgeSubject[]): number {
  const questions = set.questions.reduce((n, q) => n + q.id.length + q.instructions.length, 0);
  return Math.ceil(subjects.reduce((n, s) => n + s.state.length + questions, 0) / 4);
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

if (!values['dry-run'] && reportScope === undefined) {
  summary.push(
    '',
    askedScope === undefined
      ? 'Commit `scripts/data-judgments.json`, then run `bun run data:audit` to compare the scanner with the answers.'
      : `Commit \`scripts/data-judgments.json\`, then run \`bun run data:judge -- --report ${askedScope.set.id}\` for the ranked list.`,
  );
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) appendFileSync(out, `${summary.join('\n')}\n`);
}
if (failures > 0) die(`${failures} subject(s) got no answer; the rest are saved, rerun to retry`);
