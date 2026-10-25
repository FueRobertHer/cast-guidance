/**
 * Budgets for the data audit (TEST-005), kept per data tag in
 * `scripts/data-audit-budget.json`.
 *
 * Content at a tag never changes, so most numbers are exact: if the entity
 * count for a pinned tag moves, the parser moved, and the PR that moved it
 * updates the budget in the same diff. Problem counts (warnings, unhandled
 * tags, unrolled dice) are ceilings, and the spell dice count is a floor. A
 * count that improves is only reported, never failed, so the budget can be
 * tightened by hand: the same one-sided ratchet as the bundle and axe gates.
 */
import type { AuditReport } from './analyze';
import type { BranchBlock } from './branches';

/** A multi-name `additionalSpells` block a person read and confirmed. */
export interface BranchAllow {
  uid: string;
  key: string;
  names: string[];
  /** Only a real choice can be allowed; a grant-all block is a bug to fix. */
  verdict: 'choice';
  note: string;
}

export interface TagBudget {
  files: number;
  entities: Record<string, number>;
  /** Ceiling per warning group; a group not listed fails. */
  warningGroups: Record<string, number>;
  unresolvedCopies: number;
  /** Floor: fewer spells with dice means the roll extraction lost some. */
  spellsWithDice: number;
  invalidSpellRolls: number;
  /** Ceiling per tag the renderer shows as plain text; a tag not listed fails. */
  unhandledTags: Record<string, number>;
  /** Underscore keys already looked at. A new one is reported, not failed. */
  underscoreKeys: string[];
  branchAllow: BranchAllow[];
}

export interface AuditBudget {
  $comment?: string;
  tags: Record<string, TagBudget>;
}

export type RowStatus = 'ok' | 'fail' | 'note';

export interface AuditRow {
  check: string;
  budget: string;
  actual: string;
  status: RowStatus;
}

export interface AuditEvaluation {
  /**
   * `exact`: the tag has its own budget. `drift`: it has none and was checked
   * against a baseline tag's, where count changes are expected and only new
   * problems fail. `missing`: no budget to check against at all.
   */
  mode: 'exact' | 'drift' | 'missing';
  budgetTag: string | undefined;
  rows: AuditRow[];
  failures: string[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function fail(path: string, expected: string): never {
  throw new Error(`data-audit budget: ${path} must be ${expected}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(path, 'a non-negative integer');
  }
  return value;
}

function countMap(value: unknown, path: string): Record<string, number> {
  if (!isRecord(value)) fail(path, 'an object of counts');
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(value)) out[key] = count(n, `${path}.${key}`);
  return out;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') fail(path, 'a non-empty string');
  return value;
}

function textList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, 'an array of strings');
  return value.map((item, i) => text(item, `${path}[${i}]`));
}

function parseAllow(value: unknown, path: string): BranchAllow {
  if (!isRecord(value)) fail(path, 'an object');
  if (value.verdict !== 'choice') fail(`${path}.verdict`, '"choice"');
  const names = textList(value.names, `${path}.names`);
  if (names.length < 2) fail(`${path}.names`, 'at least two names');
  return {
    uid: text(value.uid, `${path}.uid`),
    key: text(value.key, `${path}.key`),
    names,
    verdict: 'choice',
    note: text(value.note, `${path}.note`),
  };
}

function parseTagBudget(value: unknown, path: string): TagBudget {
  if (!isRecord(value)) fail(path, 'an object');
  if (!Array.isArray(value.branchAllow)) fail(`${path}.branchAllow`, 'an array');
  return {
    files: count(value.files, `${path}.files`),
    entities: countMap(value.entities, `${path}.entities`),
    warningGroups: countMap(value.warningGroups, `${path}.warningGroups`),
    unresolvedCopies: count(value.unresolvedCopies, `${path}.unresolvedCopies`),
    spellsWithDice: count(value.spellsWithDice, `${path}.spellsWithDice`),
    invalidSpellRolls: count(value.invalidSpellRolls, `${path}.invalidSpellRolls`),
    unhandledTags: countMap(value.unhandledTags, `${path}.unhandledTags`),
    underscoreKeys: textList(value.underscoreKeys, `${path}.underscoreKeys`),
    branchAllow: value.branchAllow.map((a, i) => parseAllow(a, `${path}.branchAllow[${i}]`)),
  };
}

/** Validate the budget file. Throws on any malformed field, naming it. */
export function parseAuditBudget(raw: unknown): AuditBudget {
  if (!isRecord(raw)) fail('the file', 'an object');
  if (!isRecord(raw.tags)) fail('tags', 'an object keyed by data tag');
  const tags: Record<string, TagBudget> = {};
  for (const [tag, entry] of Object.entries(raw.tags)) {
    tags[tag] = parseTagBudget(entry, `tags.${tag}`);
  }
  return typeof raw.$comment === 'string' ? { $comment: raw.$comment, tags } : { tags };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const sameNames = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

function allows(allow: BranchAllow, block: BranchBlock): boolean {
  return allow.uid === block.uid && allow.key === block.key && sameNames(allow.names, block.names);
}

/** Blocks the branch heuristic acts on without the entity's prose saying "choose". */
export function unexplainedBranchBlocks(report: AuditReport): BranchBlock[] {
  return report.branchBlocks.filter((block) => !block.choiceWording);
}

const describeBlock = (b: BranchBlock) => `${b.key} ${b.uid} [${b.names.join(', ')}]`;

class Judge {
  readonly rows: AuditRow[] = [];
  readonly failures: string[] = [];
  readonly notes: string[] = [];

  row(check: string, budget: string | number, actual: string | number, problems: Problems): void {
    this.failures.push(...problems.failures);
    this.notes.push(...problems.notes);
    const status: RowStatus =
      problems.failures.length > 0 ? 'fail' : problems.notes.length > 0 ? 'note' : 'ok';
    this.rows.push({ check, budget: String(budget), actual: String(actual), status });
  }

  result(): Pick<AuditEvaluation, 'rows' | 'failures' | 'notes'> {
    return { rows: this.rows, failures: this.failures, notes: this.notes };
  }
}

interface Problems {
  failures: string[];
  notes: string[];
}

const none = (): Problems => ({ failures: [], notes: [] });

/** A ceiling: over fails, under is a note to tighten it. */
function ceiling(label: string, max: number, actual: number): Problems {
  const p = none();
  if (actual > max) p.failures.push(`${label}: ${actual}, over the budget of ${max}`);
  else if (actual < max) p.notes.push(`${label}: ${actual}, under the budget of ${max}; lower it`);
  return p;
}

/** Ceilings per key: a key the budget does not list fails at any count. */
function ceilingMap(
  label: string,
  max: Record<string, number>,
  actual: Record<string, number>,
): Problems {
  const p = none();
  for (const [key, n] of Object.entries(actual)) {
    const limit = max[key];
    if (limit === undefined) p.failures.push(`${label}: new "${key}" (${n}), not in the budget`);
    else {
      const c = ceiling(`${label} "${key}"`, limit, n);
      p.failures.push(...c.failures);
      p.notes.push(...c.notes);
    }
  }
  for (const key of Object.keys(max)) {
    if (actual[key] === undefined) {
      p.notes.push(`${label}: "${key}" no longer occurs; remove it from the budget`);
    }
  }
  return p;
}

const total = (map: Record<string, number>) => Object.values(map).reduce((a, b) => a + b, 0);

/**
 * Judge a report against the budget for its tag. With no entry for the tag
 * and a `baselineTag` given (the scheduled run against the newest release),
 * the baseline's entry is used in drift mode: counts that differ are expected
 * of a new release and only reported, while new problems still fail.
 */
export function evaluateAudit(
  report: AuditReport,
  budget: AuditBudget,
  options: { baselineTag?: string } = {},
): AuditEvaluation {
  const judge = new Judge();
  const own = budget.tags[report.tag];
  const baseline = options.baselineTag !== undefined ? budget.tags[options.baselineTag] : undefined;
  const entry = own ?? baseline;
  if (entry === undefined) {
    judge.row('budget entry', 'present', 'missing', {
      failures: [
        `no budget for ${report.tag}: run \`bun run data:audit -- --tag ${report.tag} --write-budget\`, review the diff, and commit it`,
      ],
      notes: [],
    });
    return { mode: 'missing', budgetTag: undefined, ...judge.result() };
  }
  const mode = own !== undefined ? 'exact' : 'drift';
  const budgetTag = own !== undefined ? report.tag : options.baselineTag;
  if (mode === 'drift') {
    judge.notes.push(
      `no budget for ${report.tag} yet; checked against ${budgetTag}, so count changes are notes and only new problems fail`,
    );
  }

  // In exact mode a moved count means the parser changed; in drift mode it is
  // what a new release looks like, unless a whole type vanished.
  const exact = (label: string, expected: number, actual: number): Problems => {
    const p = none();
    if (expected === actual) return p;
    const message = `${label}: expected ${expected}, got ${actual}`;
    if (mode === 'exact') p.failures.push(message);
    else if (expected > 0 && actual === 0) p.failures.push(`${message} (the type vanished)`);
    else p.notes.push(message);
    return p;
  };

  judge.row('files', entry.files, report.fileCount, exact('files', entry.files, report.fileCount));

  const entityProblems = none();
  const types = new Set([...Object.keys(entry.entities), ...Object.keys(report.entities)]);
  for (const type of [...types].sort()) {
    const p = exact(`entities.${type}`, entry.entities[type] ?? 0, report.entities[type] ?? 0);
    entityProblems.failures.push(...p.failures);
    entityProblems.notes.push(...p.notes);
  }
  judge.row('entities', total(entry.entities), total(report.entities), entityProblems);

  const dice = none();
  if (report.spellsWithDice < entry.spellsWithDice) {
    const message = `spellsWithDice: ${report.spellsWithDice}, under the floor of ${entry.spellsWithDice}`;
    (mode === 'exact' ? dice.failures : dice.notes).push(message);
  } else if (report.spellsWithDice > entry.spellsWithDice) {
    dice.notes.push(
      `spellsWithDice: ${report.spellsWithDice}, over the floor of ${entry.spellsWithDice}; raise it`,
    );
  }
  judge.row('spells with dice', entry.spellsWithDice, report.spellsWithDice, dice);

  judge.row(
    'warning groups',
    total(entry.warningGroups),
    total(report.warningGroups),
    ceilingMap('warning group', entry.warningGroups, report.warningGroups),
  );
  judge.row(
    'unresolved _copy',
    entry.unresolvedCopies,
    report.unresolvedCopies,
    ceiling('unresolved _copy targets', entry.unresolvedCopies, report.unresolvedCopies),
  );

  const rolls = ceiling(
    'invalid spell rolls',
    entry.invalidSpellRolls,
    report.invalidSpellRolls.length,
  );
  if (rolls.failures.length > 0) {
    rolls.failures.push(...report.invalidSpellRolls.slice(0, 5).map((r) => `  ${r}`));
  }
  judge.row('invalid spell rolls', entry.invalidSpellRolls, report.invalidSpellRolls.length, rolls);

  judge.row(
    'unhandled {@tags}',
    total(entry.unhandledTags),
    total(report.unhandledTags),
    ceilingMap('unhandled tag', entry.unhandledTags, report.unhandledTags),
  );

  const keys = none();
  for (const key of Object.keys(report.underscoreKeys)) {
    if (!entry.underscoreKeys.includes(key)) {
      keys.notes.push(`underscore key "${key}" is new; check the parsers handle or ignore it`);
    }
  }
  judge.row(
    'underscore keys',
    entry.underscoreKeys.length,
    Object.keys(report.underscoreKeys).length,
    keys,
  );

  const branches = none();
  const flagged = unexplainedBranchBlocks(report);
  for (const block of flagged) {
    if (!entry.branchAllow.some((allow) => allows(allow, block))) {
      branches.failures.push(
        `branch heuristic: ${describeBlock(block)} has distinct names and no choice wording; read it and add a branchAllow verdict, or fix the grant`,
      );
    }
  }
  for (const allow of entry.branchAllow) {
    if (!flagged.some((block) => allows(allow, block))) {
      branches.notes.push(
        `branchAllow ${allow.key} ${allow.uid} [${allow.names.join(', ')}] matches nothing; remove it`,
      );
    }
  }
  judge.row('unexplained branch blocks', entry.branchAllow.length, flagged.length, branches);

  const sizes = none();
  for (const path of report.oversizedFiles) {
    sizes.failures.push(`${path} is over ${report.maxFileBytes} bytes; plan the size limit now`);
  }
  judge.row('oversized files', 0, report.oversizedFiles.length, sizes);

  return { mode, budgetTag, ...judge.result() };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<RowStatus, string> = { ok: 'ok', fail: 'FAIL', note: 'note' };

export function toMarkdown(report: AuditReport, evaluation: AuditEvaluation): string {
  const lines = [`### Data audit: ${report.tag}`, ''];
  if (evaluation.budgetTag !== undefined && evaluation.budgetTag !== report.tag) {
    lines.push(
      `Checked against the ${evaluation.budgetTag} budget (no entry for ${report.tag}).`,
      '',
    );
  }
  lines.push('| Check | Budget | Actual | Status |', '| --- | ---: | ---: | --- |');
  for (const row of evaluation.rows) {
    lines.push(`| ${row.check} | ${row.budget} | ${row.actual} | ${STATUS_TEXT[row.status]} |`);
  }
  lines.push('');
  if (evaluation.failures.length > 0) {
    lines.push(`**${evaluation.failures.length} failure line(s)**`, '');
    for (const f of evaluation.failures) lines.push(`- ${f.trim()}`);
    lines.push('');
  } else {
    lines.push('Every check is within budget.', '');
  }
  if (evaluation.notes.length > 0) {
    lines.push('Notes:', '');
    for (const n of evaluation.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The budget entry that exactly matches a report, for `--write-budget`.
 * Branch verdicts are human judgments, so only the given ones that still
 * match a flagged block carry over; a new block still fails until someone
 * reads it and writes its verdict.
 */
export function budgetFromReport(
  report: AuditReport,
  previousAllow: readonly BranchAllow[] = [],
): TagBudget {
  const flagged = unexplainedBranchBlocks(report);
  return {
    files: report.fileCount,
    entities: { ...report.entities },
    warningGroups: { ...report.warningGroups },
    unresolvedCopies: report.unresolvedCopies,
    spellsWithDice: report.spellsWithDice,
    invalidSpellRolls: report.invalidSpellRolls.length,
    unhandledTags: { ...report.unhandledTags },
    underscoreKeys: Object.entries(report.underscoreKeys)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key]) => key),
    branchAllow: previousAllow.filter((allow) => flagged.some((block) => allows(allow, block))),
  };
}
