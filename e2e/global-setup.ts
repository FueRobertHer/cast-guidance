import { existsSync } from 'node:fs';
import path from 'node:path';

/** Fails fast, with the fix, when there is no build to test. */
export default function globalSetup(): void {
  const dist = path.resolve(import.meta.dirname, '../dist');
  const missing = ['index.html', 'sw.js'].filter((f) => !existsSync(path.join(dist, f)));
  if (missing.length > 0) {
    throw new Error(
      `E2E runs against the production build, and dist/ has no ${missing.join(' or ')}. ` +
        'Run `bun run build` first, or `bun run e2e:ci`, which builds and then tests.',
    );
  }
}
