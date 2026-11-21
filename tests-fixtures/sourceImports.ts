/**
 * Import specifiers read from source text, for the architecture tests
 * (`src/engine/architecture.test.ts`, `src/data5e/architecture.test.ts`).
 * Each test loads its sources with `import.meta.glob` (raw), so nothing here
 * needs Node; this only parses (with the TypeScript parser) and resolves.
 * Paths are relative to `src/`, with forward slashes (`engine/derive.ts`).
 */

import ts from 'typescript';

export interface Import {
  spec: string;
  /** `import type` or `export type`: erased before the code runs. */
  typeOnly: boolean;
  /**
   * A load whose target is not a literal (`import(name)`): `spec` is its
   * source text, and nothing here can say what it loads.
   */
  computed?: boolean;
}

const isLiteral = (
  n: ts.Node | undefined,
): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  n !== undefined && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));

const isImportMetaUrl = (n: ts.Node | undefined) =>
  n !== undefined &&
  ts.isPropertyAccessExpression(n) &&
  n.name.text === 'url' &&
  ts.isMetaProperty(n.expression) &&
  n.expression.keywordToken === ts.SyntaxKind.ImportKeyword;

/**
 * Every module a file loads, read from its syntax tree, so comments, strings
 * and types are never mistaken for imports:
 *
 * - `import ... from 'x'`, `import 'x'`, `export ... from 'x'` and
 *   `import x = require('x')`; with `type` on the statement, type-only. An
 *   `import { type Y } from 'x'` still loads `x` (verbatimModuleSyntax keeps
 *   it as `import {} from 'x'`).
 * - `import('x')`, whatever comments sit inside the parentheses; a computed
 *   `import(name)` is marked `computed`.
 * - `new URL('x', import.meta.url)`, how a worker or asset is named.
 *
 * `typeof import('x')` is a type, so it is not here.
 */
export function importsOf(source: string, fileName = 'source.ts'): Import[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
  const out: Import[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isLiteral(node.moduleSpecifier)) {
      out.push({
        spec: node.moduleSpecifier.text,
        typeOnly: node.importClause?.isTypeOnly ?? false,
      });
    } else if (ts.isExportDeclaration(node) && isLiteral(node.moduleSpecifier)) {
      out.push({ spec: node.moduleSpecifier.text, typeOnly: node.isTypeOnly });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      isLiteral(node.moduleReference.expression)
    ) {
      out.push({ spec: node.moduleReference.expression.text, typeOnly: node.isTypeOnly });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [arg] = node.arguments;
      out.push(
        isLiteral(arg)
          ? { spec: arg.text, typeOnly: false }
          : { spec: arg?.getText(file) ?? '', typeOnly: false, computed: true },
      );
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      isLiteral(node.arguments?.[0]) &&
      isImportMetaUrl(node.arguments?.[1])
    ) {
      out.push({ spec: (node.arguments?.[0] as ts.StringLiteral).text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** Collapse `.` and `..` segments of a POSIX path. */
function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/**
 * Where a relative or `@/` specifier points, relative to `src/`, without an
 * extension check; undefined for a package.
 */
export function targetOf(spec: string, from: string): string | undefined {
  if (spec.startsWith('@/')) return normalize(spec.slice(2));
  if (!spec.startsWith('.')) return undefined;
  return normalize(`${from.slice(0, from.lastIndexOf('/'))}/${spec}`);
}

/** The file a target names among `files`, trying the extensions a bundler would. */
export function resolveIn(target: string, files: ReadonlySet<string>): string | undefined {
  for (const candidate of [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
  ]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

/** The top `src/` folder a path is in: `data5e` for `data5e/audit/x.ts`, `app` for `app`. */
export const layerOf = (srcPath: string) => srcPath.split('/')[0] ?? '';

/** Glob keys relative to a folder under `src/` (`./x.ts`, `../lib/y.ts`) as `src/` paths. */
export function srcKeyed(sources: Record<string, string>, folder: string): Map<string, string> {
  return new Map(
    Object.entries(sources).map(([key, text]) => [normalize(`${folder}/${key}`), text]),
  );
}

export const isTestFile = (p: string) => /\.test\.tsx?$/.test(p);

/** npm packages of the UI framework and its widgets, and of browser storage. */
export const UI_PACKAGES = [
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'dexie-react-hooks',
  'zustand',
  'vaul',
  'lucide-react',
  '@tanstack/react-virtual',
  '@vercel/analytics/react',
  'virtual:pwa-register/react',
];

export const matchesPackage = (spec: string, pkg: string) =>
  spec === pkg || spec.startsWith(`${pkg}/`);
