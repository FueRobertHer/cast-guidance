/**
 * Import specifiers read from source text, for the architecture tests
 * (`src/engine/architecture.test.ts`, `src/data5e/architecture.test.ts`).
 * Each test loads its sources with `import.meta.glob` (raw), so nothing here
 * needs Node; this only reads and resolves. Paths are relative to `src/`,
 * with forward slashes (`engine/derive.ts`).
 */

export interface Import {
  spec: string;
  /** `import type` or `export type`: erased before the code runs. */
  typeOnly: boolean;
}

// `import ... from 'x'` and `export ... from 'x'` (with or without `type`),
// `import('x')`, and the side-effect `import 'x'`. The negated character
// classes span newlines, so a multi-line import list is one match.
const IMPORT_RE =
  /(import|export)(\s+type\b)?[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

export function importsOf(source: string): Import[] {
  const out: Import[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[3] ?? m[4] ?? m[5];
    if (spec) out.push({ spec, typeOnly: m[3] !== undefined && m[2] !== undefined });
  }
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

/** The top `src/` folder a path is in: `data5e` for `data5e/audit/x.ts`. */
export const layerOf = (srcPath: string) => srcPath.slice(0, srcPath.indexOf('/'));

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
];

export const matchesPackage = (spec: string, pkg: string) =>
  spec === pkg || spec.startsWith(`${pkg}/`);
