/**
 * The axe baseline and the one-sided ratchet over it (A11Y-003), shared by the
 * specs (`scan.ts`) and the reporter. No browser here, so the policy has unit
 * tests of its own (`baseline.test.ts`).
 *
 * The baseline counts violating nodes per (state, rule), not selectors:
 * Tailwind class churn would make every fingerprint a false change. A scan
 * fails only when something got worse for its state: a rule the baseline does
 * not list for that state, or a higher count. A lower count, or a rule that
 * went away, is good news; it is reported as "please update the baseline" and
 * never fails, so fixing an issue never turns a build red.
 */

import path from 'node:path';

/** The baseline file, next to this module. */
export const BASELINE_PATH = path.join(import.meta.dirname, 'axe-baseline.json');

/** True when this run rewrites the baseline (the reporter writes it). */
export const UPDATING = process.env.A11Y_BASELINE_UPDATE === '1';

/**
 * Refuses a baseline update in CI. The baseline is reviewed in a diff; a CI
 * run that rewrote it would pass whatever it saw and throw the file away.
 */
export function assertUpdateAllowed(env: Readonly<Record<string, string | undefined>>): void {
  if (env.A11Y_BASELINE_UPDATE === '1' && env.CI !== undefined && env.CI !== '') {
    throw new Error(
      'A11Y_BASELINE_UPDATE is set in CI. Update the axe baseline locally ' +
        '(`bun run e2e:a11y:update`) and commit it; CI only checks it.',
    );
  }
}

/** The command that rewrites the baseline, quoted in failures and the summary. */
export const UPDATE_COMMAND = 'bun run e2e:a11y:update';

/** The attachment each scan leaves for the reporter. */
export const SCAN_ATTACHMENT = 'axe-scan';

export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

/** What one scan saw for one rule. */
export interface RuleCount {
  count: number;
  impact: Impact;
  help: string;
}

/** A baseline entry: a counted rule, with an optional note kept across updates. */
export interface BaselineRule extends RuleCount {
  note?: string;
}

/** Rules per state id; a state with no violations is an empty object. */
export type Baseline = Record<string, Record<string, BaselineRule>>;

/** One scan of one state, as the spec attaches it and the reporter reads it. */
export interface ScanRecord {
  state: string;
  rules: Record<string, RuleCount>;
  /**
   * Nodes axe could not decide, per rule (contrast over an image or a
   * translucent layer, say). Reported for a person to look at, never gated:
   * they are not findings, and they move with rendering details.
   */
  incomplete?: Record<string, number>;
}

export interface Change {
  state: string;
  rule: string;
  impact: Impact;
  help: string;
  /** The baseline's count (0 when the rule is new for the state). */
  was: number;
  /** This scan's count (0 when the rule is gone). */
  now: number;
}

export interface Comparison {
  /** New (state, rule) pairs and higher counts: these fail. */
  regressions: Change[];
  /** Lower counts and rules gone: reported, never failed. */
  improvements: Change[];
}

const IMPACT_RANK: Record<Impact, number> = { minor: 0, moderate: 1, serious: 2, critical: 3 };

/** The higher of two impacts (axe reports one per node; a rule takes its worst). */
export function worstImpact(a: Impact, b: Impact): Impact {
  return IMPACT_RANK[a] >= IMPACT_RANK[b] ? a : b;
}

interface AxeViolationLike {
  id: string;
  impact?: string | null;
  help: string;
  nodes: ReadonlyArray<{ impact?: string | null }>;
}

function asImpact(value: string | null | undefined): Impact {
  return value === 'critical' || value === 'serious' || value === 'moderate' ? value : 'minor';
}

/** Counts axe's violations by rule. */
export function countViolations(
  violations: ReadonlyArray<AxeViolationLike>,
): Record<string, RuleCount> {
  const out: Record<string, RuleCount> = {};
  for (const v of violations) {
    if (v.nodes.length === 0) continue;
    let impact = asImpact(v.impact);
    for (const node of v.nodes) impact = worstImpact(impact, asImpact(node.impact));
    out[v.id] = { count: v.nodes.length, impact, help: v.help };
  }
  return out;
}

/** Compares one state's scan with its baseline entry (absent means "nothing allowed"). */
export function compareState(
  state: string,
  baseline: Readonly<Record<string, BaselineRule>> | undefined,
  observed: Readonly<Record<string, RuleCount>>,
): Comparison {
  const regressions: Change[] = [];
  const improvements: Change[] = [];
  const allowed = baseline ?? {};
  for (const [rule, seen] of Object.entries(observed)) {
    const was = allowed[rule]?.count ?? 0;
    const change = { state, rule, impact: seen.impact, help: seen.help, was, now: seen.count };
    if (seen.count > was) regressions.push(change);
    else if (seen.count < was) improvements.push(change);
  }
  for (const [rule, entry] of Object.entries(allowed)) {
    if (rule in observed) continue;
    improvements.push({
      state,
      rule,
      impact: entry.impact,
      help: entry.help,
      was: entry.count,
      now: 0,
    });
  }
  const order = (a: Change, b: Change) => a.rule.localeCompare(b.rule);
  return { regressions: regressions.sort(order), improvements: improvements.sort(order) };
}

/**
 * The baseline after an update run: every scanned state is replaced by what
 * it saw now (notes kept for rules still present). States this run did not
 * scan are kept, so updating from a filtered run cannot drop another state's
 * entry, unless `prune` says the run was complete: then they are gone from
 * the spec, and so from the baseline.
 */
export function nextBaseline(
  previous: Baseline,
  scans: ReadonlyArray<ScanRecord>,
  { prune = false }: { prune?: boolean } = {},
): Baseline {
  const next: Baseline = structuredClone(previous);
  if (prune) {
    for (const state of staleStates(previous, scans)) delete next[state];
  }
  for (const scan of scans) {
    const old = previous[scan.state] ?? {};
    const entry: Record<string, BaselineRule> = {};
    for (const [rule, seen] of Object.entries(scan.rules)) {
      const note = old[rule]?.note;
      entry[rule] = note === undefined ? { ...seen } : { ...seen, note };
    }
    next[scan.state] = entry;
  }
  return next;
}

/** Baseline states no scan in `scans` covered, sorted. */
export function staleStates(baseline: Baseline, scans: ReadonlyArray<ScanRecord>): string[] {
  const scanned = new Set(scans.map((s) => s.state));
  return Object.keys(baseline)
    .filter((s) => !scanned.has(s))
    .sort();
}

/** What the runner knows about how a run was narrowed. */
export interface RunScope {
  grep: RegExp | ReadonlyArray<RegExp>;
  grepInvert: RegExp | ReadonlyArray<RegExp> | null;
  shard: unknown;
  /** Each project's own `grep` and `grepInvert`. */
  projects: ReadonlyArray<{
    grep: RegExp | ReadonlyArray<RegExp>;
    grepInvert: RegExp | ReadonlyArray<RegExp> | null;
  }>;
  /** The runner's `process.argv`. */
  argv: ReadonlyArray<string>;
}

const list = <T>(v: T | ReadonlyArray<T> | null): ReadonlyArray<T> =>
  v === null ? [] : Array.isArray(v) ? (v as ReadonlyArray<T>) : [v as T];

/** CLI flags that can run only some tests of a file. */
const NARROWING_FLAGS = new Set([
  '-g',
  '--grep',
  '-G',
  '--grep-invert',
  '--shard',
  '--last-failed',
  '--only-changed',
  '--test-list',
  '--test-list-invert',
]);

/**
 * Whether the run may have left tests out: a grep or inverted grep (in the
 * config, a project, or `-g` and `-G` on the command line, which the runner
 * applies without writing them into the config), a shard, a last-failed or
 * changed-files run, a test list, or a `file:line` filter. A plain file or
 * folder filter is not narrowing here, since it selects whole spec files.
 */
export function isNarrowedRun(scope: RunScope): boolean {
  const matchesAll = (g: RegExp | ReadonlyArray<RegExp>) =>
    list(g).every((r) => r.source === '.*' || r.source === '(?:)');
  if (!matchesAll(scope.grep) || list(scope.grepInvert).length > 0) return true;
  if (scope.shard !== null && scope.shard !== undefined) return true;
  for (const p of scope.projects) {
    if (!matchesAll(p.grep) || list(p.grepInvert).length > 0) return true;
  }
  const args = scope.argv.slice(scope.argv.indexOf('test') + 1);
  return args.some(
    (a) =>
      NARROWING_FLAGS.has(a.split('=')[0] as string) || /^-[gG]./.test(a) || /:\d+(:\d+)?$/.test(a),
  );
}

/** Stable JSON: states and rules sorted, fields in a fixed order, trailing newline. */
export function serializeBaseline(baseline: Baseline): string {
  const sorted: Baseline = {};
  for (const state of Object.keys(baseline).sort()) {
    const rules = baseline[state] ?? {};
    const entry: Record<string, BaselineRule> = {};
    for (const rule of Object.keys(rules).sort()) {
      const r = rules[rule] as BaselineRule;
      entry[rule] = {
        count: r.count,
        impact: r.impact,
        help: r.help,
        ...(r.note === undefined ? {} : { note: r.note }),
      };
    }
    sorted[state] = entry;
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** Parses a baseline file, refusing anything that is not the shape above. */
export function parseBaseline(text: string): Baseline {
  const raw: unknown = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('axe baseline: expected an object of states');
  }
  for (const [state, rules] of Object.entries(raw)) {
    if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
      throw new Error(`axe baseline: state "${state}" is not an object of rules`);
    }
    for (const [rule, entry] of Object.entries(rules as Record<string, unknown>)) {
      const e = entry as Partial<BaselineRule> | null;
      if (
        e === null ||
        typeof e !== 'object' ||
        !Number.isInteger(e.count) ||
        (e.count as number) < 1 ||
        typeof e.impact !== 'string' ||
        !(e.impact in IMPACT_RANK)
      ) {
        throw new Error(
          `axe baseline: "${state}" / "${rule}" needs a positive count and an impact`,
        );
      }
    }
  }
  return raw as Baseline;
}

/**
 * What a run may conclude about baseline states no scan covered:
 * - `fail`: every axe test ran to an end, passed or skipped, so a state
 *   nothing scanned is stale (or skipped) and fails the run;
 * - `prune`: an update in which every axe test passed, so such states are
 *   dropped from the baseline;
 * - `narrowed`: a grep, shard or line filter may have left tests out;
 * - `unfinished`: an axe test failed or never finished (or, in an update,
 *   was skipped), so its states may be missing for that reason alone.
 */
export type StaleCheck = 'fail' | 'prune' | 'narrowed' | 'unfinished';

/**
 * Decides the {@link StaleCheck} from how the run was scoped and how each axe
 * test ended (`undefined` for one that never reported an end). A skipped
 * test counts as having run: skipping one must not switch the check off
 * for every other state. Only pruning needs every test to have passed.
 */
export function staleCheck({
  narrowed,
  statuses,
  updating,
}: {
  narrowed: boolean;
  statuses: ReadonlyArray<string | undefined>;
  updating: boolean;
}): StaleCheck {
  if (narrowed || statuses.length === 0) return 'narrowed';
  if (updating) return statuses.every((st) => st === 'passed') ? 'prune' : 'unfinished';
  return statuses.every((st) => st === 'passed' || st === 'skipped') ? 'fail' : 'unfinished';
}

/**
 * One record per distinct scan: `--repeat-each` scans every state several
 * times, and identical repeats would list each finding as many times. Repeats
 * that differ are all kept, since that difference is worth seeing.
 */
export function distinctScans(scans: ReadonlyArray<ScanRecord>): ScanRecord[] {
  const seen = new Map<string, ScanRecord>();
  for (const scan of scans) {
    const key = JSON.stringify([scan.state, scan.rules, scan.incomplete ?? {}]);
    if (!seen.has(key)) seen.set(key, scan);
  }
  return [...seen.values()];
}

export interface SummaryInput {
  scans: ReadonlyArray<ScanRecord>;
  baseline: Baseline;
  /** True when this run rewrote the baseline. */
  updated: boolean;
  /** The command that rewrites the baseline, for the note. */
  updateCommand: string;
  /** What to say about baseline states no scan covered; see {@link StaleCheck}. */
  stale?: StaleCheck;
}

/**
 * The markdown the reporter writes for the CI step summary: what got worse
 * (the failures), what got better (update the baseline), and the per-state
 * counts the baseline still allows.
 */
export function renderSummary({
  scans: all,
  baseline,
  updated,
  updateCommand,
  stale = 'narrowed',
}: SummaryInput): string {
  const scans = distinctScans(all);
  const lines: string[] = ['### Accessibility (axe)', ''];
  if (scans.length === 0) {
    lines.push('_No axe scans ran._', '');
    return lines.join('\n');
  }
  const regressions: Change[] = [];
  const improvements: Change[] = [];
  for (const scan of scans) {
    const c = compareState(scan.state, baseline[scan.state], scan.rules);
    regressions.push(...c.regressions);
    improvements.push(...c.improvements);
  }
  const allowed = scans.reduce(
    (n, s) => n + Object.values(s.rules).reduce((m, r) => m + r.count, 0),
    0,
  );
  const states = new Set(scans.map((s) => s.state));
  lines.push(
    `${states.size} states scanned, ${allowed} violating nodes in total, ` +
      `${regressions.length} regression(s), ${improvements.length} improvement(s).`,
    '',
  );
  if (updated) lines.push('**The baseline was rewritten from this run.**', '');

  const table = (title: string, changes: Change[]) => {
    lines.push(
      `#### ${title}`,
      '',
      '| State | Rule | Impact | Baseline | Now |',
      '| --- | --- | --- | ---: | ---: |',
    );
    for (const c of changes) {
      lines.push(`| ${c.state} | ${c.rule} | ${c.impact} | ${c.was} | ${c.now} |`);
    }
    lines.push('');
  };
  if (regressions.length > 0 && !updated) table('Regressions (these fail the run)', regressions);
  if (improvements.length > 0 && !updated) {
    table('Improvements', improvements);
    lines.push(
      `Please update the baseline so it keeps the gain: \`${updateCommand}\`, and commit \`e2e/a11y/axe-baseline.json\`.`,
      '',
    );
  }

  const remaining = [...scans]
    .sort((a, b) => a.state.localeCompare(b.state))
    .flatMap((s) =>
      Object.entries(s.rules)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rule, r]) => `| ${s.state} | ${rule} | ${r.impact} | ${r.count} |`),
    );
  lines.push('#### Violations seen', '');
  if (remaining.length === 0) {
    lines.push('_None._', '');
  } else {
    lines.push('| State | Rule | Impact | Nodes |', '| --- | --- | --- | ---: |', ...remaining, '');
  }

  const review = [...scans]
    .sort((a, b) => a.state.localeCompare(b.state))
    .flatMap((s) =>
      Object.entries(s.incomplete ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([rule, n]) => `| ${s.state} | ${rule} | ${n} |`),
    );
  if (review.length > 0) {
    lines.push(
      '<details><summary>Needs review: nodes axe could not decide (not gated)</summary>',
      '',
      '| State | Rule | Nodes |',
      '| --- | --- | ---: |',
      ...review,
      '',
      '</details>',
      '',
    );
  }

  const unscanned = staleStates(baseline, scans);
  const list = unscanned.join(', ');
  if (unscanned.length === 0) return lines.join('\n');
  if (stale === 'prune') {
    lines.push(`Pruned from the baseline, no longer scanned: ${list}.`, '');
  } else if (stale === 'fail') {
    lines.push(
      '#### Stale baseline states (these fail the run)',
      '',
      `Every axe test ran or was skipped, and none scanned: ${list}. A renamed or ` +
        `removed state must leave the baseline too (\`${updateCommand}\` prunes it); a ` +
        'skipped test leaves its states unchecked, so unskip it or take its states out.',
      '',
    );
  } else if (stale === 'unfinished') {
    lines.push(
      `Baseline states this run did not scan, not checked for staleness because an axe ` +
        `test ${updated ? 'did not pass' : 'failed or did not finish'}: ${list}.`,
      '',
    );
  } else {
    lines.push(`Baseline states this run did not scan (it was narrowed): ${list}.`, '');
  }
  return lines.join('\n');
}
