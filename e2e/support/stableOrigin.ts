import path from 'node:path';

/**
 * The stable origin. A profile is bound to the origin it was built on (its
 * service worker registration, its IndexedDB and its caches are all keyed by
 * scheme, host and port), and every worker's own server listens on a port of
 * its own. A profile built in one worker and opened in another needs a server
 * both can reach at the same address, so `global-setup.ts` starts one for the
 * whole run and publishes its URL here. Workers inherit the environment.
 *
 * It has no down switch: other tests may be using it at the same time. A
 * launch that must be offline is cut off from it in the browser instead (see
 * `coldLaunch.ts`).
 */
export const STABLE_ORIGIN_ENV = 'E2E_STABLE_ORIGIN';

/** Where `cache-levels.setup.ts` publishes one finished profile per cache level. */
export const LEVELS_DIR_ENV = 'E2E_LEVELS_DIR';

function fromEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is unset: it is set by e2e/global-setup.ts, so run through Playwright.`,
    );
  }
  return value;
}

/** `http://127.0.0.1:<port>`, the same in every worker of this run. */
export function stableOrigin(): string {
  return fromEnv(STABLE_ORIGIN_ENV);
}

export function levelsDir(...parts: string[]): string {
  return path.join(fromEnv(LEVELS_DIR_ENV), ...parts);
}
