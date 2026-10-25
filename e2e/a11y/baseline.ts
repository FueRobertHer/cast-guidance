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
 * it saw now (notes kept for rules still present), and states this run did
 * not scan are kept as they were, so updating from a filtered run cannot
 * drop another state's entry.
 */
export function nextBaseline(previous: Baseline, scans: ReadonlyArray<ScanRecord>): Baseline {
  const next: Baseline = structuredClone(previous);
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

export interface SummaryInput {
  scans: ReadonlyArray<ScanRecord>;
  baseline: Baseline;
  /** True when this run rewrote the baseline. */
  updated: boolean;
  /** The command that rewrites the baseline, for the note. */
  updateCommand: string;
}

/**
 * The markdown the reporter writes for the CI step summary: what got worse
 * (the failures), what got better (update the baseline), and the per-state
 * counts the baseline still allows.
 */
export function renderSummary({ scans, baseline, updated, updateCommand }: SummaryInput): string {
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

  const unscanned = Object.keys(baseline)
    .filter((s) => !states.has(s))
    .sort();
  if (unscanned.length > 0) {
    lines.push(
      `Baseline states this run did not scan (filtered out, or gone): ${unscanned.join(', ')}.`,
      '',
    );
  }
  return lines.join('\n');
}
