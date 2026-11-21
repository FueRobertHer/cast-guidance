import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
      "export * as ns from './ns';",
      "import { type Inline } from './inline';",
      "const r = require('./r');",
      "const g = await import('./g');",
      "import json from './h.json';",
    ].join('\n');
    expect(runtimeSpecifiers('x.ts', text)).toEqual([
      './a',
      './b',
      './side-effect',
      './d',
      './f',
      './ns',
      './inline',
      './r',
      './g',
      './h.json',
    ]);
  });

  it.each([
    ['an import() of a computed name', 'const m = await import(`./rules/` + name);'],
    ['a require() of a computed name', 'const m = require(name);'],
    ['import.meta.glob', "const all = import.meta.glob('./rules/*.json');"],
    ['new URL(..., import.meta.url)', "const u = new URL('./a.json', import.meta.url);"],
  ])('refuses %s rather than skip it', (_, line) => {
    expect(() => runtimeSpecifiers('x.ts', line)).toThrow('x.ts:1: ');
  });
});

/** A throwaway project: `files` by relative path, and a tsconfig.app.json with an `@/` alias. */
function withProject(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-inputs-'));
  try {
    const compilerOptions = {
      moduleResolution: 'bundler',
      module: 'esnext',
      resolveJsonModule: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      paths: { '@/*': ['./src/*'] },
    };
    writeFileSync(path.join(dir, 'tsconfig.app.json'), JSON.stringify({ compilerOptions }));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), text);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lines = (...l: string[]) => `${l.join('\n')}\n`;

describe('auditInputs on a small project', () => {
  it('follows the alias, JSON through it, and stops at builtins', () => {
    withProject(
      {
        'entry.ts': lines(
          "import { readFileSync } from 'node:fs';",
          "import { a } from '@/a';",
          "import rows from '@/rows.json';",
          'console.log(a, rows, readFileSync);',
        ),
        'src/a.ts': lines("export { b as a } from './b.ts';"),
        'src/b.ts': lines('export const b = 1;'),
        'src/rows.json': '[]',
      },
      (dir) => {
        expect(auditInputs(dir, 'entry.ts')).toEqual([
          'entry.ts',
          'src/a.ts',
          'src/b.ts',
          'src/rows.json',
        ]);
      },
    );
  });

  it('fails on an import it cannot resolve rather than drop it', () => {
    withProject({ 'entry.ts': lines("import { x } from './gone';", 'console.log(x);') }, (dir) => {
      expect(() => auditInputs(dir, 'entry.ts')).toThrow('entry.ts: cannot resolve "./gone"');
    });
  });
});

describe('auditInputs on the audit', () => {
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
