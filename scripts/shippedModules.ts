import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Build-time records for the third-party notices (LEGAL-001, see
 * `scripts/third-party-notices.ts`), kept out of `dist/` so that no deploy
 * path serves them.
 *
 * Vite's own `build.license` lists the packages in the main bundle, but it
 * does not run on worker builds, so a package that ships only inside a worker
 * (minisearch, in the search worker) would be missing from the notices. So
 * this collector also records which modules each emitted JS chunk contains.
 * The same collector is registered in `plugins` and in `worker.plugins`; both
 * halves share one record. Vite bundles a worker while it transforms the
 * importing module, so every worker chunk is recorded before the main bundle
 * is generated.
 *
 * In the main build's `generateBundle`, ordered after every other plugin's
 * (Vite's license plugin included), the collector takes Vite's
 * `.vite/licenses.json` out of the bundle, so it is never written to `dist/`,
 * and writes it with its own record to `RECORDS_DIR`, under
 * `node_modules/.cache`. Each main build first clears that directory, so a
 * failed build leaves no records behind for the notices to read.
 *
 * Module ids under `node_modules` are kept relative to the project root, so
 * the record does not depend on where the checkout lives.
 */

/** Where the records go, relative to the project root. */
export const RECORDS_DIR = 'node_modules/.cache/cast-guidance/notices';
/** The file name Vite's `build.license` is configured to emit (see vite.config.ts). */
export const VITE_LICENSES_ASSET = '.vite/licenses.json';
export const LICENSES_FILE = 'licenses.json';
export const SHIPPED_MODULES_FILE = 'shipped-modules.json';

export interface ShippedChunk {
  fileName: string;
  /** `main` for the app bundle, `worker` for a worker bundle. */
  kind: 'main' | 'worker';
  /** Sorted, unique, posix module ids: root-relative under `node_modules`, or virtual. */
  moduleIds: string[];
}

export interface ShippedModules {
  chunks: ShippedChunk[];
}

/**
 * Keeps the ids the notices care about: modules from packages, as a path
 * relative to the project root, and modules that are not files in the project
 * at all (plugin virtual modules such as `\0vite/preload-helper.js` or
 * `/@vite-plugin-pwa/pwa-register/react`), as they are. The project's own
 * source files are dropped.
 */
export function normalizeModuleId(id: string, root: string): string | undefined {
  const relative = path.relative(root, id).split(path.sep).join('/');
  const insideRoot =
    path.isAbsolute(id) && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (!insideRoot) return id.split(path.sep).join('/');
  return relative.split('/').includes('node_modules') ? relative : undefined;
}

type BundleLike = Record<
  string,
  { type: string; moduleIds?: readonly string[]; source?: string | Uint8Array }
>;

export function shippedModulesCollector(root: string): {
  main: Plugin;
  worker: () => Plugin;
} {
  const chunks = new Map<string, ShippedChunk>();
  const recordsDir = path.join(root, RECORDS_DIR);

  const record = (kind: ShippedChunk['kind'], bundle: BundleLike) => {
    for (const [fileName, output] of Object.entries(bundle)) {
      if (output.type !== 'chunk') continue;
      const ids = new Set<string>();
      for (const id of output.moduleIds ?? []) {
        const kept = normalizeModuleId(id, root);
        if (kept !== undefined) ids.add(kept);
      }
      chunks.set(fileName, { fileName, kind, moduleIds: [...ids].sort() });
    }
  };

  return {
    main: {
      name: 'cg-shipped-modules',
      apply: 'build',
      enforce: 'post',
      buildStart() {
        // A fresh record per build: nothing from an earlier build (or an
        // earlier watch rebuild) may leak into this one's notices.
        chunks.clear();
        rmSync(recordsDir, { recursive: true, force: true });
      },
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          const licenses = (bundle as BundleLike)[VITE_LICENSES_ASSET];
          if (licenses?.type !== 'asset' || licenses.source === undefined) {
            throw new Error(
              `Vite's build.license did not emit ${VITE_LICENSES_ASSET}; the notices need it (see vite.config.ts).`,
            );
          }
          const licensesText =
            typeof licenses.source === 'string'
              ? licenses.source
              : new TextDecoder().decode(licenses.source);
          // Out of the bundle, so it is never written to dist/ or deployed.
          delete bundle[VITE_LICENSES_ASSET];

          record('main', bundle as BundleLike);
          const sorted = [...chunks.values()].sort((a, b) =>
            a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
          );
          const output: ShippedModules = { chunks: sorted };
          mkdirSync(recordsDir, { recursive: true });
          writeFileSync(path.join(recordsDir, LICENSES_FILE), licensesText);
          writeFileSync(
            path.join(recordsDir, SHIPPED_MODULES_FILE),
            `${JSON.stringify(output, null, 2)}\n`,
          );
        },
      },
    },
    worker: () => ({
      name: 'cg-shipped-modules-worker',
      apply: 'build',
      generateBundle(_options, bundle) {
        record('worker', bundle as BundleLike);
      },
    }),
  };
}
