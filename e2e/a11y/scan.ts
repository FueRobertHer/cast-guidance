import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../support/test.ts';
import {
  BASELINE_PATH,
  type Baseline,
  compareState,
  countViolations,
  parseBaseline,
  SCAN_ATTACHMENT,
  type ScanRecord,
  UPDATE_COMMAND,
  UPDATING,
} from './baseline.ts';

/**
 * WCAG 2.0, 2.1 and 2.2 A and AA. `best-practice` is left out of the gate:
 * those rules are advice, and a baseline full of them would bury the WCAG
 * failures. Nothing is disabled globally.
 */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

let cached: Baseline | undefined;

function baseline(): Baseline {
  cached ??= parseBaseline(readFileSync(BASELINE_PATH, 'utf8'));
  return cached;
}

export interface ScanOptions {
  /** Limit the scan to this selector (an opened overlay, say). */
  include?: string;
  /**
   * Leave these selectors out, each with the reason. Only for a widget where
   * a rule is genuinely wrong, never to hide a real finding.
   */
  exclude?: Readonly<Record<string, string>>;
}

/**
 * Runs axe on the page as it is now, as the state `state`, and holds it to the
 * baseline: a rule the baseline does not list for this state, or more nodes
 * than it allows, fails the test (softly, so every state in a test reports).
 * Fewer nodes, or a rule gone, is an annotation asking for a baseline update.
 *
 * Call it only once the state is settled: the overlay open and its content
 * drawn, toasts gone, the data install done. Counts that move between runs
 * are a flake in the spec, not in axe.
 */
export async function scanState(page: Page, state: string, options: ScanOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (options.include !== undefined) builder = builder.include(options.include);
  for (const selector of Object.keys(options.exclude ?? {})) builder = builder.exclude(selector);
  const results = await builder.analyze();

  const rules = countViolations(results.violations);
  const info = test.info();
  await info.attach(SCAN_ATTACHMENT, {
    contentType: 'application/json',
    body: JSON.stringify({
      state,
      rules,
      incomplete: Object.fromEntries(results.incomplete.map((r) => [r.id, r.nodes.length])),
    } satisfies ScanRecord),
  });
  // Every node, for whoever has to fix one; the counts above are the contract.
  await info.attach(`axe-${state}.json`, {
    contentType: 'application/json',
    body: JSON.stringify(
      results.violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      null,
      2,
    ),
  });

  const { regressions, improvements } = compareState(state, baseline()[state], rules);
  for (const c of improvements) {
    info.annotations.push({
      type: 'a11y: please update the baseline',
      description: `${state} / ${c.rule}: ${c.was} -> ${c.now} (run \`${UPDATE_COMMAND}\`)`,
    });
  }
  if (UPDATING) return rules;

  const detail = regressions
    .map((c) => {
      const nodes = results.violations
        .find((v) => v.id === c.rule)
        ?.nodes.map((n) => `      ${n.target.join(' ')}`)
        .join('\n');
      return `  ${c.rule} (${c.impact}, ${c.help}): baseline ${c.was}, now ${c.now}\n${nodes ?? ''}`;
    })
    .join('\n');
  expect
    .soft(
      regressions,
      `New accessibility violations in "${state}":\n${detail}\n` +
        `Fix them. Only if a finding is accepted on purpose, run \`${UPDATE_COMMAND}\` and commit the baseline.`,
    )
    .toEqual([]);
  return rules;
}
