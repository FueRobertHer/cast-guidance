/**
 * The dependency audit's rules, kept apart from its CLI
 * (`dependency-audit.ts`) so they can be tested without the network.
 *
 * `bun audit` lists advisories for every installed package, and most of
 * them are in the toolchain (the test runner, the dev server, the bundler's
 * helpers), which never reaches a player. The gate is narrower: a high or
 * critical advisory against a package the build ships fails, unless it has
 * been read and recorded as not applying, with the reason, in
 * `dependency-audit-ignore.json`. Everything else is reported, not gated:
 * Dependabot's version updates (`.github/dependabot.yml`) bring the fixes.
 *
 * What ships is the package list in `THIRD_PARTY_NOTICES.md`, which CI's
 * `notices:check` keeps equal to what the build emits.
 */

export type Severity = 'low' | 'moderate' | 'high' | 'critical';

export interface Advisory {
  id: number;
  url: string;
  title: string;
  severity: Severity;
  vulnerable_versions: string;
}

/** `bun audit --json`: advisories by package name. */
export type AuditReport = Record<string, Advisory[]>;

/** An advisory read and judged not to apply to what ships, and why. */
export interface IgnoredAdvisory {
  package: string;
  /** The advisory's GHSA id, the last part of its URL. */
  advisory: string;
  reason: string;
  /** When it was read (YYYY-MM-DD); a reader rechecks old entries. */
  reviewed: string;
}

export const GATED: ReadonlySet<Severity> = new Set(['high', 'critical']);

/** The GHSA id of an advisory, from its URL. */
export function ghsaOf(advisory: Advisory): string {
  return advisory.url.slice(advisory.url.lastIndexOf('/') + 1);
}

/** Package names from `THIRD_PARTY_NOTICES.md`'s `## name version` headings. */
export function shippedPackages(notices: string): Set<string> {
  const names = new Set<string>();
  for (const match of notices.matchAll(/^## (\S+) \S+\s*$/gm)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

/** Throws on an ignore file that is not a list of complete entries. */
export function parseIgnores(json: unknown): IgnoredAdvisory[] {
  if (!Array.isArray(json)) throw new Error('the ignore file must be a JSON array');
  return json.map((entry, i) => {
    const e = entry as Partial<IgnoredAdvisory> | null;
    for (const key of ['package', 'advisory', 'reason', 'reviewed'] as const) {
      if (typeof e?.[key] !== 'string' || e[key] === '') {
        throw new Error(`ignore entry ${i} has no ${key}`);
      }
    }
    return e as IgnoredAdvisory;
  });
}

export interface Finding {
  package: string;
  advisory: Advisory;
  shipped: boolean;
  ignored?: IgnoredAdvisory;
}

export interface AuditVerdict {
  /** High or critical, shipped, and not ignored: each fails the gate. */
  failing: Finding[];
  /** Shipped and gated, but read and recorded as not applying. */
  ignored: Finding[];
  /** Everything else, for the report. */
  reported: Finding[];
  /** Ignore entries that no longer match an advisory, to clean up. */
  stale: IgnoredAdvisory[];
}

export function judge(
  report: AuditReport,
  shipped: ReadonlySet<string>,
  ignores: readonly IgnoredAdvisory[],
): AuditVerdict {
  const verdict: AuditVerdict = { failing: [], ignored: [], reported: [], stale: [] };
  const used = new Set<IgnoredAdvisory>();
  for (const [pkg, advisories] of Object.entries(report).sort(([a], [b]) => a.localeCompare(b))) {
    for (const advisory of advisories) {
      const finding: Finding = { package: pkg, advisory, shipped: shipped.has(pkg) };
      if (!finding.shipped || !GATED.has(advisory.severity)) {
        verdict.reported.push(finding);
        continue;
      }
      const ignored = ignores.find((i) => i.package === pkg && i.advisory === ghsaOf(advisory));
      if (ignored) {
        used.add(ignored);
        verdict.ignored.push({ ...finding, ignored });
      } else {
        verdict.failing.push(finding);
      }
    }
  }
  verdict.stale = ignores.filter((i) => !used.has(i));
  return verdict;
}

const line = (f: Finding) =>
  `| ${f.package} | ${f.advisory.severity} | [${ghsaOf(f.advisory)}](${f.advisory.url}) ${f.advisory.title} | ${f.advisory.vulnerable_versions} |`;

/** The run summary: what fails, what was ruled out, and counts for the rest. */
export function toMarkdown(v: AuditVerdict): string {
  const out = ['### Dependency audit', ''];
  if (v.failing.length === 0) {
    out.push('No high or critical advisory against a shipped package.', '');
  } else {
    out.push(`**${v.failing.length} high or critical advisories against shipped packages:**`, '');
    out.push('| Package | Severity | Advisory | Affected |', '| --- | --- | --- | --- |');
    out.push(...v.failing.map(line), '');
  }
  if (v.ignored.length > 0) {
    out.push('Ruled out (`scripts/dependency-audit-ignore.json`):', '');
    for (const f of v.ignored) {
      out.push(
        `- ${f.package} ${ghsaOf(f.advisory)}: ${f.ignored?.reason} (read ${f.ignored?.reviewed})`,
      );
    }
    out.push('');
  }
  if (v.stale.length > 0) {
    out.push(
      `Ignore entries that match no advisory now, to remove: ${v.stale.map((i) => `${i.package} ${i.advisory}`).join(', ')}`,
      '',
    );
  }
  const counts = new Map<string, number>();
  for (const f of v.reported) {
    const key = `${f.shipped ? 'shipped' : 'toolchain only'}, ${f.advisory.severity}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const shown = [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, n]) => `${n} ${key}`);
    out.push(`Not gated: ${shown.join('; ')}. Dependabot's updates bring the fixes.`, '');
  }
  return out.join('\n');
}
