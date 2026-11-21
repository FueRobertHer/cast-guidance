import { describe, expect, it } from 'vitest';
import {
  importsOf,
  isTestFile,
  layerOf,
  matchesPackage,
  srcKeyed,
  targetOf,
  UI_PACKAGES,
} from '../../tests-fixtures/sourceImports';

/**
 * Architecture guard for the data layer. `src/data5e` loads, normalizes and
 * serves game data; it may use storage (`db`) and the app's stores, but not
 * the UI: React lives only in `hooks.ts` and `entries/**` (the React
 * boundary, also in `biome.json`), and no file reaches up into `features`,
 * `ui` or `app`.
 *
 * Code that crossed the line before this test existed is listed below, each
 * import exactly. The list may only shrink: a new crossing fails, and so does
 * an entry the code no longer has, so fixing one means deleting its line.
 */

const sources = srcKeyed(
  import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >,
  'data5e',
);

/** Where React is allowed, by design. */
const REACT_BOUNDARY = (p: string) => p === 'data5e/hooks.ts' || p.startsWith('data5e/entries/');

/** The UI layers data must not depend on. */
const UI_LAYERS = ['features', 'ui', 'app'];

/**
 * Crossings on main when the rule was added (2026-11-21), for the layer
 * cycles work to remove: `file -> specifier`.
 */
const KNOWN = new Set([
  // A live query hook outside the React boundary.
  'data5e/sourceFilter.ts -> dexie-react-hooks',
  // The audit reads two sheet helpers that belong below the UI.
  'data5e/audit/analyze.ts -> ../../features/sheet/spellRolls',
  'data5e/audit/capabilityScope.ts -> ../../features/sheet/combatCapabilities',
  // The entries renderer draws a dice chip from the UI kit.
  'data5e/entries/renderEntries.tsx -> @/ui/RollChip',
]);

function crossings(): string[] {
  const found: string[] = [];
  for (const [file, text] of sources) {
    if (isTestFile(file)) continue;
    for (const { spec } of importsOf(text, file)) {
      const target = targetOf(spec, file);
      if (target === undefined) {
        if (!REACT_BOUNDARY(file) && UI_PACKAGES.some((pkg) => matchesPackage(spec, pkg))) {
          found.push(`${file} -> ${spec}`);
        }
      } else if (UI_LAYERS.includes(layerOf(target))) {
        found.push(`${file} -> ${spec}`);
      }
    }
  }
  return found.sort();
}

describe('data5e architecture boundary', () => {
  it('scans a non-trivial set of data5e source files', () => {
    expect([...sources.keys()].filter((f) => !isTestFile(f)).length).toBeGreaterThan(20);
  });

  it('keeps React to hooks.ts and entries/, and reaches no UI layer, past the known list', () => {
    expect(crossings().filter((c) => !KNOWN.has(c))).toEqual([]);
  });

  it('lists no known crossing the code no longer has', () => {
    const now = new Set(crossings());
    expect([...KNOWN].filter((c) => !now.has(c))).toEqual([]);
  });
});
