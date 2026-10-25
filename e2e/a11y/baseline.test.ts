import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertUpdateAllowed,
  type Baseline,
  compareState,
  countViolations,
  isNarrowedRun,
  nextBaseline,
  parseBaseline,
  type RuleCount,
  renderSummary,
  serializeBaseline,
  staleStates,
} from './baseline.ts';

// The axe ratchet's policy (A11Y-003), apart from the browser: worse fails,
// better only asks for a baseline update.

const contrast = (count: number): RuleCount => ({
  count,
  impact: 'serious',
  help: 'Elements must meet minimum color contrast ratio thresholds',
});

const BASE: Baseline = {
  roster: { 'color-contrast': { ...contrast(2), note: 'tracked in #200' } },
  settings: {},
};

describe('compareState', () => {
  it('passes a state that matches its baseline', () => {
    expect(compareState('roster', BASE.roster, { 'color-contrast': contrast(2) })).toEqual({
      regressions: [],
      improvements: [],
    });
  });

  it('fails a rule the baseline does not list for that state', () => {
    const { regressions } = compareState('settings', BASE.settings, {
      'button-name': { count: 1, impact: 'critical', help: 'Buttons must have discernible text' },
    });
    expect(regressions).toEqual([
      expect.objectContaining({ state: 'settings', rule: 'button-name', was: 0, now: 1 }),
    ]);
  });

  it('fails a state the baseline has never seen, if it has any violation', () => {
    expect(compareState('new-state', undefined, {}).regressions).toEqual([]);
    expect(
      compareState('new-state', undefined, { 'color-contrast': contrast(1) }).regressions,
    ).toHaveLength(1);
  });

  it('fails a higher count, even of a listed rule', () => {
    const { regressions } = compareState('roster', BASE.roster, { 'color-contrast': contrast(3) });
    expect(regressions).toEqual([expect.objectContaining({ was: 2, now: 3 })]);
  });

  it('reports a lower count, or a rule gone, as an improvement and never a failure', () => {
    expect(compareState('roster', BASE.roster, { 'color-contrast': contrast(1) })).toEqual({
      regressions: [],
      improvements: [expect.objectContaining({ rule: 'color-contrast', was: 2, now: 1 })],
    });
    expect(compareState('roster', BASE.roster, {})).toEqual({
      regressions: [],
      improvements: [expect.objectContaining({ rule: 'color-contrast', was: 2, now: 0 })],
    });
  });

  it('counts the same rule in another state separately', () => {
    const { regressions } = compareState('settings', BASE.settings, {
      'color-contrast': contrast(1),
    });
    expect(regressions).toHaveLength(1);
  });
});

describe('countViolations', () => {
  it('counts nodes per rule and takes the worst impact any node has', () => {
    expect(
      countViolations([
        {
          id: 'color-contrast',
          impact: 'moderate',
          help: 'h',
          nodes: [{ impact: 'moderate' }, { impact: 'serious' }],
        },
        { id: 'empty', impact: 'minor', help: 'h', nodes: [] },
      ]),
    ).toEqual({ 'color-contrast': { count: 2, impact: 'serious', help: 'h' } });
  });
});

describe('nextBaseline', () => {
  it('replaces scanned states, keeps notes on rules still present, and keeps unscanned states', () => {
    const next = nextBaseline(
      { ...BASE, library: { 'link-name': { count: 1, impact: 'serious', help: 'h' } } },
      [
        { state: 'roster', rules: { 'color-contrast': contrast(1) } },
        { state: 'settings', rules: {} },
      ],
    );
    expect(next.roster).toEqual({ 'color-contrast': { ...contrast(1), note: 'tracked in #200' } });
    expect(next.settings).toEqual({});
    expect(next.library).toEqual({ 'link-name': { count: 1, impact: 'serious', help: 'h' } });
  });

  it('drops a rule a scanned state no longer has, note and all', () => {
    expect(nextBaseline(BASE, [{ state: 'roster', rules: {} }]).roster).toEqual({});
  });
});

describe('the baseline file', () => {
  it('serializes stably: sorted, fixed field order, trailing newline', () => {
    const text = serializeBaseline({
      zeta: {},
      alpha: { b: { help: 'h', impact: 'minor', count: 1 }, a: { ...contrast(2) } },
    } as Baseline);
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(['alpha', 'zeta']);
    expect(Object.keys(JSON.parse(text).alpha)).toEqual(['a', 'b']);
    expect(Object.keys(JSON.parse(text).alpha.b)).toEqual(['count', 'impact', 'help']);
    expect(parseBaseline(text)).toEqual(JSON.parse(text));
  });

  it('refuses a malformed baseline', () => {
    expect(() => parseBaseline('[]')).toThrow(/object of states/);
    expect(() => parseBaseline('{"a": {"r": {"count": 0, "impact": "serious"}}}')).toThrow(
      /positive count/,
    );
    expect(() => parseBaseline('{"a": {"r": {"count": 1, "impact": "awful"}}}')).toThrow(/impact/);
  });

  it('the committed baseline parses and is in its serialized form', () => {
    const text = readFileSync(path.join(import.meta.dirname, 'axe-baseline.json'), 'utf8');
    expect(serializeBaseline(parseBaseline(text))).toBe(text);
  });
});

describe('renderSummary', () => {
  const summary = (scans: Parameters<typeof renderSummary>[0]['scans'], updated = false) =>
    renderSummary({ scans, baseline: BASE, updated, updateCommand: 'bun run e2e:a11y:update' });

  it('lists regressions as failures', () => {
    const md = summary([{ state: 'roster', rules: { 'color-contrast': contrast(3) } }]);
    expect(md).toContain('Regressions (these fail the run)');
    expect(md).toContain('| roster | color-contrast | serious | 2 | 3 |');
  });

  it('asks for a baseline update on an improvement, without calling it a failure', () => {
    const md = summary([{ state: 'roster', rules: {} }]);
    expect(md).not.toContain('Regressions');
    expect(md).toContain('Please update the baseline');
    expect(md).toContain('`bun run e2e:a11y:update`');
  });

  it('names baseline states the run did not scan, and lists undecided nodes apart', () => {
    const md = summary([
      {
        state: 'roster',
        rules: { 'color-contrast': contrast(2) },
        incomplete: { 'color-contrast': 4 },
      },
    ]);
    expect(md).toContain('did not scan (it was narrowed): settings.');
    expect(md).not.toContain('Stale baseline states');
    expect(md).toContain('Needs review');
    expect(md).toContain('| roster | color-contrast | 4 |');
  });

  it('says so when the baseline was rewritten, and when nothing ran', () => {
    expect(summary([{ state: 'roster', rules: {} }], true)).toContain('rewritten from this run');
    expect(summary([])).toContain('No axe scans ran');
  });
});

describe('stale baseline states', () => {
  const scans = [{ state: 'roster', rules: { 'color-contrast': contrast(2) } }];

  it('names the baseline states no scan covered', () => {
    expect(staleStates(BASE, scans)).toEqual(['settings']);
    expect(staleStates(BASE, [...scans, { state: 'settings', rules: {} }])).toEqual([]);
  });

  it('fails a complete run that left a baseline state unscanned', () => {
    const md = renderSummary({
      scans,
      baseline: BASE,
      updated: false,
      updateCommand: 'bun run e2e:a11y:update',
      complete: true,
    });
    expect(md).toContain('Stale baseline states (these fail the run)');
    expect(md).toContain('none scanned: settings.');
  });

  it('prunes them in a complete update, and keeps them in a narrowed one', () => {
    expect(Object.keys(nextBaseline(BASE, scans, { prune: true }))).toEqual(['roster']);
    expect(Object.keys(nextBaseline(BASE, scans))).toEqual(['roster', 'settings']);
    const md = renderSummary({
      scans,
      baseline: BASE,
      updated: true,
      updateCommand: 'x',
      complete: true,
    });
    expect(md).toContain('Pruned from the baseline, no longer scanned: settings.');
  });
});

describe('isNarrowedRun', () => {
  const plain = {
    grep: /.*/,
    grepInvert: null,
    shard: null,
    projects: [{ grep: /.*/, grepInvert: null }],
    argv: ['node', 'playwright', 'test'],
  };

  it('treats a plain run, or whole files and folders, as complete', () => {
    expect(isNarrowedRun(plain)).toBe(false);
    expect(isNarrowedRun({ ...plain, argv: [...plain.argv, 'e2e/a11y', '--workers=2'] })).toBe(
      false,
    );
    expect(isNarrowedRun({ ...plain, argv: [...plain.argv, 'e2e/a11y/axe.spec.ts'] })).toBe(false);
  });

  it('sees a grep on the command line, which the config does not show', () => {
    for (const flag of [['-g', 'roster'], ['--grep=roster'], ['-groster'], ['-G', 'x']]) {
      expect(isNarrowedRun({ ...plain, argv: [...plain.argv, ...flag] }), flag.join(' ')).toBe(
        true,
      );
    }
  });

  it('sees a line filter, a shard, a last-failed run and a config or project grep', () => {
    expect(isNarrowedRun({ ...plain, argv: [...plain.argv, 'e2e/a11y/axe.spec.ts:82'] })).toBe(
      true,
    );
    expect(isNarrowedRun({ ...plain, argv: [...plain.argv, '--last-failed'] })).toBe(true);
    expect(isNarrowedRun({ ...plain, shard: { current: 1, total: 2 } })).toBe(true);
    expect(isNarrowedRun({ ...plain, grep: /roster/ })).toBe(true);
    expect(isNarrowedRun({ ...plain, grepInvert: [/x/] })).toBe(true);
    expect(isNarrowedRun({ ...plain, projects: [{ grep: /x/, grepInvert: null }] })).toBe(true);
  });
});

describe('assertUpdateAllowed', () => {
  it('refuses a baseline update in CI, and allows it anywhere else', () => {
    expect(() => assertUpdateAllowed({ CI: 'true', A11Y_BASELINE_UPDATE: '1' })).toThrow(/in CI/);
    expect(() => assertUpdateAllowed({ A11Y_BASELINE_UPDATE: '1' })).not.toThrow();
    expect(() => assertUpdateAllowed({ CI: 'true' })).not.toThrow();
    expect(() => assertUpdateAllowed({ CI: '', A11Y_BASELINE_UPDATE: '1' })).not.toThrow();
  });
});
