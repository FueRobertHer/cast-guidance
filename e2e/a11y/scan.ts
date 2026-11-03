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

/** The themes every state is scanned in (DS-001), and the state id each one uses. */
export const SCAN_THEMES = [
  { theme: 'dark', suffix: '' },
  { theme: 'light', suffix: '@light' },
] as const;

/**
 * Draws the page in `theme` for the length of `run`, then puts back what it
 * was. Transitions are held off meanwhile, so axe reads the theme's colours
 * and not a frame part way from one to the other.
 */
async function inTheme<T>(page: Page, theme: string, run: () => Promise<T>): Promise<T> {
  const before = await page.evaluate((next) => {
    const root = document.documentElement;
    const was = root.getAttribute('data-theme');
    const still = document.createElement('style');
    still.id = 'axe-theme-still';
    still.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.append(still);
    root.setAttribute('data-theme', next);
    // Reading a computed style applies the new tokens now, not next frame.
    void getComputedStyle(root).color;
    return was;
  }, theme);
  try {
    return await run();
  } finally {
    await page.evaluate((was) => {
      const root = document.documentElement;
      if (was === null) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', was);
      void getComputedStyle(root).color;
      document.getElementById('axe-theme-still')?.remove();
    }, before);
  }
}

/**
 * Runs axe on the page as it is now, once in each theme, as the state `state`
 * (dark) and `state@light`, and holds each to the baseline: a rule the
 * baseline does not list for that state, or more nodes than it allows, fails
 * the test (softly, so every state in a test reports). Fewer nodes, or a rule
 * gone, is an annotation asking for a baseline update.
 *
 * Call it only once the state is settled: the overlay open and its content
 * drawn, toasts gone, the data install done. Counts that move between runs
 * are a flake in the spec, not in axe.
 */
export async function scanState(page: Page, state: string, options: ScanOptions = {}) {
  for (const { theme, suffix } of SCAN_THEMES) {
    await inTheme(page, theme, () => scanOne(page, `${state}${suffix}`, options));
  }
}

async function scanOne(page: Page, state: string, options: ScanOptions) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (options.include !== undefined) builder = builder.include(options.include);
  for (const selector of Object.keys(options.exclude ?? {})) builder = builder.exclude(selector);
  // vaul draws a drawer's drag overshoot as `[data-vaul-drawer]::after`,
  // a strip below the sheet with `background: inherit`. axe cannot see
  // through a pseudo-element that covers nothing, so it marked every text
  // node in an open drawer "incomplete" for color-contrast, and a failing
  // label in a drawer passed the gate. The strip is off screen while the
  // sheet rests, so hiding it for the scan changes nothing a person sees.
  const unmask = await page.addStyleTag({
    content: '[data-vaul-drawer]::after { display: none !important; }',
  });
  const results = await builder.analyze();
  await unmask.evaluate((el) => (el as Element).remove());

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
  const nodes = (list: typeof results.violations) =>
    list.map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    }));
  await info.attach(`axe-${state}.json`, {
    contentType: 'application/json',
    body: JSON.stringify(
      { violations: nodes(results.violations), incomplete: nodes(results.incomplete) },
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
