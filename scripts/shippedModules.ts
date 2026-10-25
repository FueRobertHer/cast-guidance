import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Build-time record of which modules each emitted JS chunk contains, for the
 * third-party notices (LEGAL-001, see `scripts/third-party-notices.ts`).
 *
 * Vite's own `build.license` lists the packages in the main bundle, but it
 * does not run on worker builds, so a package that ships only inside a worker
 * (minisearch, in the search worker) would be missing from the notices. The
 * same collector is registered in `plugins` and in `worker.plugins`; both
 * halves share one record, and the main build writes it next to Vite's
 * `.vite/licenses.json` once the workers are bundled (Vite bundles a worker
 * while it transforms the importing module, before the main bundle is
 * generated). The notices script reads both files and deletes them.
 *
 * Module ids under `node_modules` are kept relative to the project root, so
 * the record does not depend on where the checkout lives.
 */

export const SHIPPED_MODULES_FILE = '.vite/shipped-modules.json';

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

export function shippedModulesCollector(root: string): {
  main: Plugin;
  worker: () => Plugin;
} {
  const chunks = new Map<string, ShippedChunk>();

  const record = (
    kind: ShippedChunk['kind'],
    bundle: Record<string, { type: string; moduleIds?: readonly string[] }>,
  ) => {
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
      generateBundle: {
        order: 'post',
        handler(_options, bundle) {
          record('main', bundle);
          const sorted = [...chunks.values()].sort((a, b) =>
            a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0,
          );
          const output: ShippedModules = { chunks: sorted };
          this.emitFile({
            type: 'asset',
            fileName: SHIPPED_MODULES_FILE,
            source: `${JSON.stringify(output, null, 2)}\n`,
          });
        },
      },
    },
    worker: () => ({
      name: 'cg-shipped-modules-worker',
      apply: 'build',
      generateBundle(_options, bundle) {
        record('worker', bundle);
      },
    }),
  };
}
