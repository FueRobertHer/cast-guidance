import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ESSENTIALS_FILES } from '../../src/data5e/packs.ts';
import { MIRROR_PATHS } from '../fixtures/mirror.ts';
import { levelsDir } from './stableOrigin.ts';

/**
 * How much game data a profile holds when it goes offline (PWA-001). Each is
 * built once per run by `cache-levels.setup.ts`, online, with the mirror
 * failing whatever the level leaves out, and then copied for every cell of
 * the route matrix.
 *
 * The background drain downloads packs in a fixed order (essentials, the
 * class packs, items, the spell packs, the library extras) and stops at the
 * first that fails, so each level is a real place for an install to stop:
 * - `none`: the app shell only; the first download never got anywhere.
 * - `essential`: the essentials pack, so the roster, creator and sheet work;
 *   no class, item, spell or book files.
 * - `partial`: everything up to the spell packs: classes and items, but no
 *   spells and no books.
 * - `full`: the whole release.
 */
export type CacheLevel = 'none' | 'essential' | 'partial' | 'full';

export const CACHE_LEVELS: readonly CacheLevel[] = ['none', 'essential', 'partial', 'full'];

/** The library-extras pack, which the drain reaches after the spell packs. */
const LIBRARY_EXTRAS = new Set(['variantrules.json', 'books.json']);

/**
 * Whether the mirror fails `path` while the level is built. `partial` fails
 * the books too, although the drain never gets that far once spells fail, so
 * a page that asks for them on its own cannot change the level.
 */
const LEFT_OUT: Record<CacheLevel, (path: string) => boolean> = {
  none: () => true,
  essential: (path) => !ESSENTIALS_FILES.includes(path),
  partial: (path) => path.startsWith('spells/spells-') || LIBRARY_EXTRAS.has(path),
  full: () => false,
};

export function leftOut(level: CacheLevel, path: string): boolean {
  return LEFT_OUT[level](path);
}

/** The data files on disk once the level is built (the rest were never fetched or failed). */
export function filesAt(level: CacheLevel): number {
  return MIRROR_PATHS.filter((p) => !leftOut(level, p)).length;
}

/** What a built level holds besides data, for the routes that need an id. */
export interface LevelManifest {
  level: CacheLevel;
  characterId: string;
  /** The caster (fixtures/caster.ts), who knows Fireball. */
  casterId: string;
  homebrewId: string;
}

export const CHARACTER_NAME = 'New hero';
export const CASTER_NAME = 'Vela Quill';
export const HOMEBREW_NAME = 'Table Brews';

const MANIFEST = 'level.json';

/**
 * The browser's own caches, left out of every copy. None of them is the app's
 * state, and the HTTP cache would weaken the test: an asset the service
 * worker failed to precache could still load offline from it, where a phone
 * that has evicted it would show a blank screen. Without them each cell
 * proves the precache alone serves the app. Leaving them out also halves what
 * a cell copies.
 */
const BROWSER_CACHES = new Set([
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'ShaderCache',
]);

/** Copies the published profile for `level` to `dest`, without the browser's caches. */
export function copyLevel(level: CacheLevel, dest: string): void {
  cpSync(levelsDir(level), dest, {
    recursive: true,
    filter: (source) => !BROWSER_CACHES.has(path.basename(source)),
  });
}

export function isPublished(level: CacheLevel): boolean {
  return existsSync(levelsDir(level, MANIFEST));
}

export function readManifest(level: CacheLevel): LevelManifest {
  if (!isPublished(level)) {
    throw new Error(
      `The ${level} cache level was not built. It comes from the cache-levels setup project, ` +
        'which the offline-routes project depends on.',
    );
  }
  return JSON.parse(readFileSync(levelsDir(level, MANIFEST), 'utf8')) as LevelManifest;
}

/**
 * Publishes a built profile in one rename, so a cell never copies one that is
 * half written. Each level is built once per run: Playwright does not repeat
 * a dependency project's tests under `--repeat-each`. Should a level be built
 * twice all the same (a second worker given the same setup test), the first
 * to finish wins and the later one is thrown away.
 */
export function publishLevel(built: string, manifest: LevelManifest): void {
  writeFileSync(`${built}/${MANIFEST}`, JSON.stringify(manifest));
  try {
    renameSync(built, levelsDir(manifest.level));
  } catch (err) {
    rmSync(built, { recursive: true, force: true });
    if (!isPublished(manifest.level)) throw err;
  }
}
