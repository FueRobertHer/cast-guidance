/**
 * Third-party notices generator (LEGAL-001). Run after `bun run build`:
 *
 *   bun scripts/third-party-notices.ts           # writes THIRD_PARTY_NOTICES.md
 *   bun scripts/third-party-notices.ts --check   # fails when it is out of date
 *
 * Reads the two build records that `scripts/shippedModules.ts` writes to
 * `node_modules/.cache/cast-guidance/notices/` (Vite's `build.license` list
 * and the per-chunk module record), the emitted scripts and stylesheets in
 * `dist/`, and each shipped package's files under `node_modules/`. The rules
 * live in `thirdPartyNotices.ts`. It also fails when `dist/.vite/` exists:
 * the records must never reach the deployed output.
 *
 * `--root <dir>` points it at another project directory (the tests use it).
 */
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { LICENSES_FILE, RECORDS_DIR, SHIPPED_MODULES_FILE } from './shippedModules.ts';
import {
  type BuildFile,
  buildNotices,
  checkNotices,
  collectInventory,
  type PackageRecord,
  type PackageSource,
  parseOverrides,
  renderNotices,
} from './thirdPartyNotices.ts';

const LICENSE_FILE = /^(licen[cs]e|copying)/i;
const NOTICE_FILE = /^notice/i;

function readText(file: string): string {
  return readFileSync(file, 'utf8').replace(/^﻿/, '');
}

/** The first matching file in `dir`, in sorted order so the pick is stable. */
function findFile(dir: string, pattern: RegExp): string | undefined {
  const name = readdirSync(dir)
    .filter((entry) => pattern.test(entry) && statSync(path.join(dir, entry)).isFile())
    .sort()[0];
  return name === undefined ? undefined : path.join(dir, name);
}

/** Reads packages from `node_modules` under `root`. */
export function fileSystemSource(root: string): PackageSource {
  const cache = new Map<string, PackageRecord | undefined>();
  const read = (dir: string): PackageRecord | undefined => {
    if (cache.has(dir)) return cache.get(dir);
    const full = path.join(root, dir);
    const manifestPath = path.join(full, 'package.json');
    let record: PackageRecord | undefined;
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readText(manifestPath)) as Record<string, unknown>;
      if (typeof manifest.name === 'string') {
        const licenseFile = findFile(full, LICENSE_FILE);
        const noticeFile = findFile(full, NOTICE_FILE);
        record = {
          name: manifest.name,
          version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
          ...(typeof manifest.license === 'string' ? { identifier: manifest.license.trim() } : {}),
          ...(licenseFile ? { licenseText: readText(licenseFile).trim() } : {}),
          ...(noticeFile ? { noticeText: readText(noticeFile).trim() } : {}),
        };
      }
    }
    cache.set(dir, record);
    return record;
  };
  return {
    read,
    // The nearest package.json with a `name`, as Vite's license plugin finds
    // it: nested ones such as `dist/es5/package.json` only set the module type.
    ownerOf(moduleId) {
      let dir = path.posix.dirname(moduleId);
      while (dir !== '.' && dir !== '/' && path.posix.basename(dir) !== 'node_modules') {
        if (read(dir)) return dir;
        dir = path.posix.dirname(dir);
      }
      return undefined;
    },
  };
}

/** Every file under `dir` with one of `extensions`, as `dir`-relative posix paths. */
function walk(dir: string, extensions: string[], base = dir): BuildFile[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return walk(full, extensions, base);
      if (!extensions.some((extension) => name.endsWith(extension))) return [];
      return [{ path: path.relative(base, full).split(path.sep).join('/'), text: readText(full) }];
    });
}

export interface RunResult {
  exitCode: 0 | 1;
  message: string;
}

export function run(root: string, check: boolean): RunResult {
  const distDir = path.join(root, 'dist');
  const recordsDir = path.join(root, RECORDS_DIR);
  const licensesPath = path.join(recordsDir, LICENSES_FILE);
  const modulesPath = path.join(recordsDir, SHIPPED_MODULES_FILE);
  const noticesPath = path.join(root, 'THIRD_PARTY_NOTICES.md');
  const overridesPath = path.join(root, 'scripts', 'third-party-notices.overrides.json');

  // Deployed as is, so a leaked record would be public. The collector takes
  // Vite's license list out of the bundle; this catches it coming back.
  if (existsSync(path.join(distDir, '.vite'))) {
    return {
      exitCode: 1,
      message:
        'dist/.vite/ exists, so build records would be deployed. The collector in scripts/shippedModules.ts should keep them out of dist/.',
    };
  }
  if (!existsSync(licensesPath) || !existsSync(modulesPath)) {
    return {
      exitCode: 1,
      message: `${RECORDS_DIR}/${LICENSES_FILE} or ${SHIPPED_MODULES_FILE} is missing. Run \`bun run build\` first.`,
    };
  }

  let generated: string;
  try {
    const inventory = collectInventory(
      {
        viteLicenses: JSON.parse(readText(licensesPath)),
        shippedModules: JSON.parse(readText(modulesPath)),
        jsFiles: walk(distDir, ['.js']),
        cssFiles: walk(distDir, ['.css']),
      },
      fileSystemSource(root),
    );
    const overrides = parseOverrides(JSON.parse(readText(overridesPath)));
    generated = renderNotices(buildNotices(inventory, overrides));
  } catch (error) {
    return { exitCode: 1, message: error instanceof Error ? error.message : String(error) };
  }

  if (check) {
    return checkNotices(existsSync(noticesPath) ? readText(noticesPath) : undefined, generated);
  }
  writeFileSync(noticesPath, generated);
  return { exitCode: 0, message: 'Wrote THIRD_PARTY_NOTICES.md.' };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf('--root');
  const root =
    rootFlag >= 0 && args[rootFlag + 1]
      ? path.resolve(args[rootFlag + 1] ?? '')
      : path.resolve(import.meta.dirname, '..');
  const result = run(root, args.includes('--check'));
  if (result.exitCode === 0) {
    console.log(`third-party-notices: ${result.message}`);
  } else {
    console.error(`third-party-notices: ${result.message}`);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) appendFileSync(summary, `### Third-party notices\n\n${result.message}\n`);
  }
  process.exit(result.exitCode);
}
