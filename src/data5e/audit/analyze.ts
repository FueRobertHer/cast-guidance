/**
 * Pure core of the data audit (TEST-005). `scripts/data-audit.ts` downloads a
 * release and hands the parsed files here; this runs them through the app's
 * own normalization and returns what it found as data, so the counting can be
 * tested with in-memory fixtures and judged against a budget in `budget.ts`.
 *
 * Relative imports only: the CLI loads this under plain Bun, which does not
 * see the app's `@/` path alias.
 */
import { parseDice } from '../../dice/parse';
import { spellRollActions } from '../../features/sheet/spellRolls';
import { isRenderedTag } from '../entries/inlineTags';
import { normalizeDataset } from '../normalize';
import { BRANCH_SET, type BranchBlock, branchSubjects, findBranchBlocks } from './branches';
import { answersFor, type JudgmentFile } from './judgments';
import { auditProse, type ProseAudit } from './proseChecks';
import { proseSubjects } from './proseSubjects';
import { auditReprints, type ReprintAudit, reprintPairs } from './reprints';

export interface FileSize {
  path: string;
  bytes: number;
}

export interface AuditReport {
  tag: string;
  fileCount: number;
  /** Entities per registry type after `_copy` and `_versions`. */
  entities: Record<string, number>;
  /** Normalization warnings, grouped by {@link groupWarningKey}. */
  warningGroups: Record<string, number>;
  /** A few entity uids per warning group, for the printed report. */
  warningExamples: Record<string, string[]>;
  /** Warnings that say a `_copy` pointed at nothing. */
  unresolvedCopies: number;
  spellCount: number;
  /** Spells that expose at least one roll chip at some level. */
  spellsWithDice: number;
  generatedRolls: number;
  /** Every generated roll the dice parser refuses, one line each. */
  invalidSpellRolls: string[];
  /** Every `{@tag}` in every string of every file, by tag name. */
  tagCounts: Record<string, number>;
  /** The subset of `tagCounts` the entry renderer shows as plain text. */
  unhandledTags: Record<string, number>;
  /** Every underscore-prefixed key in the raw files, by key. */
  underscoreKeys: Record<string, number>;
  /** The five largest files, largest first. */
  largestFiles: FileSize[];
  /** Files over `maxFileBytes`, the line for planning a bump. */
  oversizedFiles: string[];
  maxFileBytes: number;
  /** `additionalSpells` blocks the branch heuristic acts on. */
  branchBlocks: BranchBlock[];
  /** The prose scanner against saved Jev judgments, when there are any. */
  prose: ProseAudit;
  /** 2014/2024 reprint pairs and their labels. Counts only: nothing here can fail. */
  reprints: ReprintAudit;
}

export interface AnalyzeInput {
  tag: string;
  files: ReadonlyMap<string, unknown>;
  /** Decoded size of each file, by the same path as `files`. */
  fileBytes: ReadonlyMap<string, number>;
  /** Files above this are reported as oversized. */
  maxFileBytes: number;
  /** Saved judgments (`scripts/data-judgments.json`), when the file exists. */
  judgments?: JudgmentFile;
}

/**
 * The shape of a warning with its specifics removed, so forty "target not
 * found" messages about different entities count as one kind of problem.
 * Quoted text becomes `"…"` and a trailing JSON object becomes `{…}`.
 */
export function groupWarningKey(message: string): string {
  return message.replace(/"[^"]*"/g, '"…"').replace(/\{.*\}$/, '{…}');
}

const UNRESOLVED_COPY = 'unresolved _copy target';

/** Ability modifiers each spell is checked with: none known, negative, zero, high. */
const AUDIT_MODIFIERS: ReadonlyArray<number | undefined> = [undefined, -1, 0, 5];

const TAG_PATTERN = /\{@([a-zA-Z0-9]+)[ }]/g;

function bump(map: Record<string, number>, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

function walk(value: unknown, visit: (key: string | undefined, value: unknown) => void): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === 'string') visit(undefined, next);
    else if (Array.isArray(next)) for (const child of next) stack.push(child);
    else if (next !== null && typeof next === 'object') {
      for (const [key, child] of Object.entries(next)) {
        visit(key, child);
        stack.push(child);
      }
    }
  }
}

/** Sort a count map by count, largest first, then by name. */
export function sortedCounts(map: Record<string, number>): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function analyzeDataset(input: AnalyzeInput): AuditReport {
  const { tag, files, fileBytes, maxFileBytes, judgments } = input;
  const largest = [...fileBytes.entries()]
    .map(([path, bytes]) => ({ path, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

  // Raw counts come first: normalization resolves `_copy` in place, so a walk
  // afterwards would see the parser's output rather than the release.
  const tagCounts: Record<string, number> = {};
  const underscoreKeys: Record<string, number> = {};
  for (const json of files.values()) {
    walk(json, (key, value) => {
      if (key !== undefined) {
        if (key.startsWith('_')) bump(underscoreKeys, key);
        return;
      }
      for (const match of (value as string).matchAll(TAG_PATTERN)) bump(tagCounts, match[1] ?? '');
    });
  }
  const unhandledTags: Record<string, number> = {};
  for (const [name, count] of Object.entries(tagCounts)) {
    if (!isRenderedTag(name)) unhandledTags[name] = count;
  }

  const reg = normalizeDataset(files);

  const warningGroups: Record<string, number> = {};
  const warningExamples: Record<string, string[]> = {};
  let unresolvedCopies = 0;
  for (const warning of reg.warnings) {
    const key = groupWarningKey(warning.message);
    bump(warningGroups, key);
    const examples = (warningExamples[key] ??= []);
    if (examples.length < 4) examples.push(warning.entity);
    if (warning.message.includes(UNRESOLVED_COPY)) unresolvedCopies++;
  }

  // Every roll chip at every character level and valid slot level must stay
  // valid input for the dice engine, nonstandard scaling thresholds included.
  const invalidSpellRolls: string[] = [];
  let spellsWithDice = 0;
  let generatedRolls = 0;
  const spells = reg.byType('spell');
  for (const spell of spells) {
    let hasRoll = false;
    const baseLevel = typeof spell.level === 'number' ? spell.level : 0;
    const slotLevels =
      baseLevel === 0
        ? [0]
        : Array.from({ length: Math.max(0, 10 - baseLevel) }, (_, i) => baseLevel + i);
    // Level 0 is a sheet with no class picked yet, which the app also renders.
    for (let characterLevel = 0; characterLevel <= 20; characterLevel++) {
      for (const slotLevel of slotLevels) {
        for (const abilityModifier of AUDIT_MODIFIERS) {
          const actions = spellRollActions(spell, { characterLevel, slotLevel, abilityModifier });
          generatedRolls += actions.length;
          hasRoll ||= actions.length > 0;
          for (const action of actions) {
            try {
              parseDice(action.expr);
            } catch (error) {
              invalidSpellRolls.push(
                `${String(spell.name)}|${String(spell.source)} character L${characterLevel}, slot L${slotLevel}, modifier ${String(abilityModifier)}: ${action.expr} (${String(error)})`,
              );
            }
          }
        }
      }
    }
    if (hasRoll) spellsWithDice++;
  }

  return {
    tag,
    fileCount: files.size,
    entities: reg.counts(),
    warningGroups,
    warningExamples,
    unresolvedCopies,
    spellCount: spells.length,
    spellsWithDice,
    generatedRolls,
    invalidSpellRolls,
    tagCounts,
    unhandledTags,
    underscoreKeys,
    largestFiles: largest.slice(0, 5),
    oversizedFiles: largest.filter((f) => f.bytes > maxFileBytes).map((f) => f.path),
    maxFileBytes,
    branchBlocks: withChoiceProposals(findBranchBlocks(reg), reg, judgments),
    prose: auditProse(proseSubjects(reg), judgments),
    reprints: auditReprints(reprintPairs(reg), judgments),
  };
}

const blockId = (b: BranchBlock) => `${b.key}:${b.uid}:${b.names.join('|')}`;

/** Attach Jev's saved answer to each unworded block that has one. */
function withChoiceProposals(
  blocks: BranchBlock[],
  reg: Parameters<typeof branchSubjects>[0],
  judgments: JudgmentFile | undefined,
): BranchBlock[] {
  if (judgments === undefined) return blocks;
  const proposals = new Map<string, number>();
  for (const subject of branchSubjects(reg)) {
    const p = answersFor(judgments, BRANCH_SET, subject.key)?.choice;
    if (p !== undefined) proposals.set(blockId(subject.block), p);
  }
  return blocks.map((block) => {
    const p = proposals.get(blockId(block));
    return p === undefined ? block : { ...block, choiceP: p };
  });
}
