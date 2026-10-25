import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startStaticServer } from './server/staticServer.ts';
import { loadVercelRouting } from './server/vercelRouting.ts';
import { LEVELS_DIR_ENV, STABLE_ORIGIN_ENV } from './support/stableOrigin.ts';

const REPO = path.resolve(import.meta.dirname, '..');
const DIST = path.join(REPO, 'dist');

/**
 * Fails fast, with the fix, when there is no build to test. Then starts the
 * one server whose origin outlives a worker (see `support/stableOrigin.ts`)
 * and makes the directory the cache-level profiles are published to. Workers
 * read both from the environment, which they inherit from this process.
 * Returns the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const missing = ['index.html', 'sw.js'].filter((f) => !existsSync(path.join(DIST, f)));
  if (missing.length > 0) {
    throw new Error(
      `E2E runs against the production build, and dist/ has no ${missing.join(' or ')}. ` +
        'Run `bun run build` first, or `bun run e2e:ci`, which builds and then tests.',
    );
  }

  // A free port unless one is asked for: the origin only has to stay the same
  // for this run, and a fixed default would collide with a second run.
  const port = Number(process.env.E2E_PORT ?? 0);
  const server = await startStaticServer({
    root: DIST,
    routing: loadVercelRouting(path.join(REPO, 'vercel.json')),
    port,
  }).catch((err: unknown) => {
    throw new Error(
      `Could not start the stable-origin server on port ${port}: ${String(err)}. ` +
        'Set E2E_PORT to a free port, or leave it unset for any free port.',
    );
  });
  const levels = mkdtempSync(path.join(tmpdir(), 'cast-guidance-e2e-levels-'));
  process.env[STABLE_ORIGIN_ENV] = server.url;
  process.env[LEVELS_DIR_ENV] = levels;

  return async () => {
    await server.close();
    rmSync(levels, { recursive: true, force: true });
  };
}
