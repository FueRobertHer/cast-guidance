import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_ENTRY, auditInputs, auditTouches, runtimeSpecifiers } from './dataAuditInputs.ts';

const root = path.resolve(import.meta.dirname, '..');

describe('runtimeSpecifiers', () => {
  it('keeps runtime imports and leaves type-only ones out', () => {
    const text = [
      "import a from './a';",
      "import { b, type B } from './b';",
      "import type { C } from './c';",
      "import './side-effect';",
      "export { d } from './d';",
      "export type { E } from './e';",
      "export * from './f';",
      "const g = await import('./g');",
      "import json from './h.json';",
    ].join('\n');
    expect(runtimeSpecifiers('x.ts', text)).toEqual([
      './a',
      './b',
      './side-effect',
      './d',
      './f',
      './g',
      './h.json',
    ]);
  });
});

describe('auditInputs', () => {
  const inputs = auditInputs(root);

  it('starts at the audit and follows it into the app', () => {
    expect(inputs).toContain(AUDIT_ENTRY);
    expect(inputs).toContain('src/data5e/config.ts');
    expect(inputs).toContain('src/engine/effects/proseScan.ts');
  });

  it('includes the built-in rule data, which the old hand-kept pattern missed', () => {
    expect(inputs).toContain('src/rules/cast-guidance/standing.json');
    expect(inputs.filter((f) => f.startsWith('src/rules/')).length).toBeGreaterThan(3);
  });

  it('leaves out what the audit never loads', () => {
    expect(inputs.some((f) => f.endsWith('.tsx'))).toBe(false);
    expect(inputs.some((f) => f.startsWith('src/db/') || f.startsWith('src/ui/'))).toBe(false);
  });

  it('fails on an import it cannot resolve rather than drop it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'audit-inputs-'));
    try {
      writeFileSync(path.join(dir, 'tsconfig.app.json'), '{"compilerOptions":{}}');
      writeFileSync(path.join(dir, 'entry.ts'), "import { x } from './gone';\nconsole.log(x);\n");
      expect(() => auditInputs(dir, 'entry.ts')).toThrow('entry.ts: cannot resolve "./gone"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('auditTouches', () => {
  const inputs = new Set(['src/a.ts', 'src/rules/x.json']);

  it('matches imported files and the always-inputs', () => {
    expect(
      auditTouches(
        ['src/a.ts', 'README.md', 'src/rules/x.json', 'bun.lock', 'scripts/data-audit-budget.json'],
        inputs,
      ),
    ).toEqual(['src/a.ts', 'src/rules/x.json', 'bun.lock', 'scripts/data-audit-budget.json']);
  });

  it('matches nothing for an unrelated change', () => {
    expect(auditTouches(['src/features/x.tsx', 'docs/a.md'], inputs)).toEqual([]);
  });
});
