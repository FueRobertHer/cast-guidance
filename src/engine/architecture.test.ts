import { describe, expect, it } from 'vitest';
import {
  importsOf,
  matchesPackage,
  resolveIn,
  layerOf as sourceLayer,
  srcKeyed,
  targetOf,
  UI_PACKAGES,
} from '../../tests-fixtures/sourceImports';

/**
 * Architecture guard for the derivation engine.
 *
 * `deriveSheet` and everything it depends on must stay a pure, React-free,
 * storage-free layer: given a `CharacterDoc` and an `EngineContext`, it returns
 * a `DerivedSheet` and nothing else. It must not reach into the UI, the
 * persistence layer, or the framework, so it can be exercised in isolation and
 * reused outside the browser.
 *
 * These tests scan the engine's own source (production files only — test files
 * legitimately import vitest and shared fixtures) and fail if that boundary is
 * crossed: a denylist of UI/persistence packages plus a ban on importing
 * sibling app layers, with imports read from each file's syntax tree.
 * Source is loaded through Vite's `import.meta.glob` (raw), so the test stays
 * inside the browser tsconfig with no Node type dependency.
 */

// Raw text of every engine source file, keyed by path relative to this file
// (e.g. "./effects/class.ts"). Test files are filtered out below.
const rawSources = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** npm packages the engine must never touch (UI framework, storage, widgets). */
const FORBIDDEN_PACKAGES = [
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'dexie',
  'dexie-react-hooks',
  'zustand',
  'vaul',
  'lucide-react',
  '@tanstack/react-virtual',
  'minisearch',
  'workbox-window',
];

/** sibling `src/` layers the engine must not depend on (leaf → up is banned). */
const FORBIDDEN_LAYERS = ['features', 'db', 'ui', 'app', 'stores', 'workers'];

/** Every specifier a file names, type-only ones included. */
const importSpecifiers = (source: string, key: string) =>
  importsOf(source, key).map(({ spec }) => spec);

/** Collapse `.`/`..` segments of a POSIX-style path into a segment list. */
function normalizeSegments(path: string): string[] {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out;
}

/**
 * Resolve a relative or `@/`-aliased specifier to its `src/` layer name.
 * The engine lives at `src/engine`, so a glob key `./effects/x.ts` maps to the
 * src-relative path `engine/effects/x.ts`; imports are resolved against that.
 * Returns null for bare package specifiers.
 */
function layerOf(spec: string, fileKey: string): string | null {
  const fileSrcRel = `engine/${fileKey.replace(/^\.\//, '')}`;
  let segments: string[];
  if (spec.startsWith('.')) {
    const dir = fileSrcRel.slice(0, fileSrcRel.lastIndexOf('/'));
    segments = normalizeSegments(`${dir}/${spec}`);
  } else if (spec.startsWith('@/')) {
    segments = normalizeSegments(spec.slice(2));
  } else {
    return null;
  }
  return segments[0] ?? null;
}

const productionFiles = Object.entries(rawSources).filter(([key]) => !/\.test\.tsx?$/.test(key));

// The layers the engine may reach, loaded so its imports can be followed
// through them: a pure engine file that imports a data5e module which imports
// React is as impure as one that imports React itself.
const REACHABLE_LAYERS = ['engine', 'data5e', 'lib', 'dice'];
const reachable = new Map([
  ...srcKeyed(rawSources, 'engine'),
  ...srcKeyed(
    import.meta.glob('../{data5e,lib,dice}/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>,
    'engine',
  ),
]);

/**
 * Every file the engine's code runs, from its production files through the
 * layers it may reach, with each step that leaves them: `file -> specifier`.
 * Type-only imports are erased before the code runs, so they are not
 * followed.
 */
function runtimeReach(): { files: Set<string>; leaks: string[] } {
  const files = new Set<string>();
  const leaks: string[] = [];
  const known = new Set(reachable.keys());
  const queue = productionFiles.map(([key]) => `engine/${key.replace(/^\.\//, '')}`);
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const { spec, typeOnly, computed } of importsOf(reachable.get(file) ?? '', file)) {
      if (typeOnly) continue;
      if (computed) {
        leaks.push(`${file} -> import(${spec}) (computed: the walk cannot follow it)`);
        continue;
      }
      const target = targetOf(spec, file);
      if (target === undefined) {
        if ([...FORBIDDEN_PACKAGES, ...UI_PACKAGES].some((pkg) => matchesPackage(spec, pkg))) {
          leaks.push(`${file} -> ${spec}`);
        }
        continue;
      }
      if (target.endsWith('.json')) continue;
      if (!REACHABLE_LAYERS.includes(sourceLayer(target))) {
        leaks.push(`${file} -> ${spec} (layer: ${sourceLayer(target)})`);
        continue;
      }
      const resolved = resolveIn(target, known);
      if (resolved === undefined) leaks.push(`${file} -> ${spec} (not found)`);
      else queue.push(resolved);
    }
  }
  return { files, leaks };
}

describe('engine architecture boundary', () => {
  it('scans a non-trivial set of engine source files', () => {
    // Guards against a glob/path bug making the other assertions vacuously pass.
    expect(productionFiles.length).toBeGreaterThan(10);
  });

  it('imports no UI framework, storage, or widget packages', () => {
    const violations: string[] = [];
    for (const [key, source] of productionFiles) {
      for (const spec of importSpecifiers(source, key)) {
        const hit = FORBIDDEN_PACKAGES.find((pkg) => matchesPackage(spec, pkg));
        if (hit) violations.push(`${key} imports "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not depend on UI or persistence layers', () => {
    const violations: string[] = [];
    for (const [key, source] of productionFiles) {
      for (const spec of importSpecifiers(source, key)) {
        const layer = layerOf(spec, key);
        if (layer && FORBIDDEN_LAYERS.includes(layer)) {
          violations.push(`${key} imports "${spec}" (layer: ${layer})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('stays pure through what it imports from data5e, lib and dice', () => {
    const { files, leaks } = runtimeReach();
    // The walk leaves the engine (data5e's plain text and normalize today), so
    // a broken glob or resolver cannot pass by finding nothing.
    expect([...files].some((f) => f.startsWith('data5e/'))).toBe(true);
    expect(leaks).toEqual([]);
  });
});
