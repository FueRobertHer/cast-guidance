import { describe, expect, it } from 'vitest';

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
 * crossed. They are intentionally coarse: a denylist of UI/persistence packages
 * plus a ban on importing sibling app layers. Source is loaded through Vite's
 * `import.meta.glob` (raw), so the test stays inside the browser tsconfig with
 * no Node type dependency.
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

// Captures `import ... from '<x>'`, `export ... from '<x>'`, `import('<x>')`,
// and side-effect `import '<x>'`. The negated char classes span newlines, so
// multi-line import lists are matched as a single specifier.
const IMPORT_RE =
  /(?:import|export)[^'"`]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

function matchesPackage(spec: string, pkg: string): boolean {
  return spec === pkg || spec.startsWith(`${pkg}/`);
}

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

describe('engine architecture boundary', () => {
  it('scans a non-trivial set of engine source files', () => {
    // Guards against a glob/path bug making the other assertions vacuously pass.
    expect(productionFiles.length).toBeGreaterThan(10);
  });

  it('imports no UI framework, storage, or widget packages', () => {
    const violations: string[] = [];
    for (const [key, source] of productionFiles) {
      for (const spec of importSpecifiers(source)) {
        const hit = FORBIDDEN_PACKAGES.find((pkg) => matchesPackage(spec, pkg));
        if (hit) violations.push(`${key} imports "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('does not depend on UI or persistence layers', () => {
    const violations: string[] = [];
    for (const [key, source] of productionFiles) {
      for (const spec of importSpecifiers(source)) {
        const layer = layerOf(spec, key);
        if (layer && FORBIDDEN_LAYERS.includes(layer)) {
          violations.push(`${key} imports "${spec}" (layer: ${layer})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
