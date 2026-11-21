import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Advisory,
  type IgnoredAdvisory,
  judge,
  parseIgnores,
  shippedPackages,
  toMarkdown,
} from './dependencyAudit.ts';

const root = path.resolve(import.meta.dirname, '..');

const advisory = (ghsa: string, severity: Advisory['severity']): Advisory => ({
  id: 1,
  url: `https://github.com/advisories/${ghsa}`,
  title: `Advisory ${ghsa}`,
  severity,
  vulnerable_versions: '<2.0.0',
});

const ignore = (pkg: string, ghsa: string): IgnoredAdvisory => ({
  package: pkg,
  advisory: ghsa,
  reason: 'does not apply',
  reviewed: '2026-11-21',
});

describe('shippedPackages', () => {
  it('reads the package headings and nothing else', () => {
    const notices = [
      '# Third-party notices',
      '',
      '## @scope/pkg 1.2.3',
      'MIT License',
      '## react 19.2.7',
      '### Not a package',
    ].join('\n');
    expect([...shippedPackages(notices)]).toEqual(['@scope/pkg', 'react']);
  });

  it('finds the app framework in the committed notices', () => {
    const shipped = shippedPackages(
      readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    );
    expect(shipped.has('react')).toBe(true);
    expect(shipped.has('dexie')).toBe(true);
    expect(shipped.has('vitest')).toBe(false);
  });
});

describe('judge', () => {
  const shipped = new Set(['react', 'router']);

  it('fails only on a high or critical advisory against a shipped package', () => {
    const v = judge(
      {
        react: [advisory('GHSA-a', 'critical'), advisory('GHSA-b', 'moderate')],
        vitest: [advisory('GHSA-c', 'critical')],
      },
      shipped,
      [],
    );
    expect(v.failing.map((f) => f.advisory.url)).toEqual(['https://github.com/advisories/GHSA-a']);
    expect(v.reported).toHaveLength(2);
  });

  it('lets a recorded reason rule an advisory out, by package and id', () => {
    const v = judge(
      { router: [advisory('GHSA-r', 'high')], react: [advisory('GHSA-r', 'high')] },
      shipped,
      [ignore('router', 'GHSA-r')],
    );
    expect(v.ignored.map((f) => f.package)).toEqual(['router']);
    expect(v.failing.map((f) => f.package)).toEqual(['react']);
    expect(v.stale).toEqual([]);
  });

  it('names an ignore entry that no longer matches', () => {
    const v = judge({}, shipped, [ignore('router', 'GHSA-gone')]);
    expect(v.stale.map((i) => i.advisory)).toEqual(['GHSA-gone']);
    expect(toMarkdown(v)).toContain('router GHSA-gone');
  });
});

describe('parseIgnores', () => {
  it('reads the committed file', () => {
    const file = path.join(root, 'scripts/dependency-audit-ignore.json');
    expect(parseIgnores(JSON.parse(readFileSync(file, 'utf8'))).length).toBeGreaterThan(0);
  });

  it('refuses an entry with no reason', () => {
    expect(() =>
      parseIgnores([{ package: 'a', advisory: 'GHSA-x', reason: '', reviewed: '2026-11-21' }]),
    ).toThrow('ignore entry 0 has no reason');
  });
});
