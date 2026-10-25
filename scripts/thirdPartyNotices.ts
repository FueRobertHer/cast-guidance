/**
 * Pure core of the third-party notices generator (LEGAL-001). The CLI in
 * `third-party-notices.ts` reads `dist/` and `node_modules/` and hands the
 * results to these functions, so the inventory rules can be tested with
 * in-memory fixtures.
 *
 * The inventory is built from what the production build actually ships, not
 * from `package.json`:
 *
 * - every package with a module in an emitted JS chunk, main bundle and
 *   workers alike, from the record `scripts/shippedModules.ts` writes;
 * - cross-checked against Vite's own `build.license` output for the main
 *   bundle, whose identifier and text it prefers;
 * - the Workbox runtime modules in the generated service worker, from the
 *   `workbox:<module>:` markers each one leaves in `sw.js` and `workbox-*.js`;
 * - a short allowlist of extras whose code ships without a module under
 *   `node_modules` (plugin virtual modules and the Tailwind stylesheet).
 *
 * Every rule fails loudly. A JS file the record does not cover, a virtual
 * module no extra claims, an extra with no trace in the build, a package with
 * no license text, a license identifier outside the allowlist and an unused
 * override all throw, because each would otherwise produce a notices file that
 * quietly leaves something out.
 */

/** SPDX identifiers the app accepts in shipped code. Anything else fails the build. */
export const ALLOWED_LICENSES: readonly string[] = [
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
];

export type ShipsIn = 'app' | 'worker' | 'service worker' | 'stylesheet';

/**
 * Code that ships without a module under `node_modules`, so neither Vite's
 * license list nor the module record names its package. Each extra must leave
 * a trace in the build (a virtual module id or a CSS banner); an extra without
 * one fails, so the list cannot go stale.
 */
export interface Extra {
  name: string;
  /** Where its code ends up, for the reader of this list. */
  why: string;
  /** A virtual module id prefix that only this package's plugin produces. */
  moduleIdPrefix?: string;
  /** Text the package writes into the built CSS. */
  cssMarker?: string;
}

export const EXTRAS: readonly Extra[] = [
  {
    name: 'rolldown',
    why: 'runtime helpers the bundler injects into the chunks',
    moduleIdPrefix: '\0rolldown/',
  },
  {
    name: 'tailwindcss',
    why: 'the preflight reset and the utility classes in the stylesheet',
    cssMarker: '/*! tailwindcss v',
  },
  {
    name: 'vite',
    why: 'the modulepreload polyfill and the dynamic import preload helper',
    moduleIdPrefix: '\0vite/',
  },
  {
    name: 'vite-plugin-pwa',
    why: 'the virtual:pwa-register/react module behind the update prompt',
    moduleIdPrefix: '/@vite-plugin-pwa/',
  },
];

/** One package as read from `node_modules`. */
export interface PackageRecord {
  name: string;
  version: string;
  /** The `license` field of its package.json, when it is a string. */
  identifier?: string;
  /** Its LICENSE, LICENCE or COPYING file, trimmed. */
  licenseText?: string;
  /** Its NOTICE file, trimmed (Apache-2.0 section 4(d) requires reproducing it). */
  noticeText?: string;
}

/** The file system side, supplied by the CLI and faked in the tests. */
export interface PackageSource {
  /** The directory (root-relative, posix) of the package that owns a module path. */
  ownerOf(moduleId: string): string | undefined;
  /** Reads the package in a root-relative directory, or undefined when there is none. */
  read(dir: string): PackageRecord | undefined;
}

export interface Override {
  /** Why the package needs one; required so the file explains itself. */
  reason: string;
  /** Replaces the license text, for a package that ships none. */
  text?: string;
  /** Where `text` was copied from. */
  source?: string;
  /** Replaces a missing or non-SPDX `license` field. */
  identifier?: string;
  /** Keeps the license text up to this line, for a file that also lists unrelated licenses. */
  cutBefore?: string;
}

export interface BuildFile {
  /** Posix path relative to `dist/`. */
  path: string;
  text: string;
}

export interface InventoryInput {
  /** Parsed `dist/.vite/licenses.json` (Vite `build.license`). */
  viteLicenses: unknown;
  /** Parsed `dist/.vite/shipped-modules.json` (`scripts/shippedModules.ts`). */
  shippedModules: unknown;
  /** Every `.js` file in `dist/`. */
  jsFiles: BuildFile[];
  /** Every `.css` file in `dist/`. */
  cssFiles: BuildFile[];
  extras?: readonly Extra[];
}

export interface InventoryItem extends PackageRecord {
  /** The text Vite's license list carried, preferred over `licenseText`. */
  viteText?: string;
  shipsIn: ShipsIn[];
}

export interface NoticeEntry {
  name: string;
  version: string;
  identifier: string;
  text: string;
  textSource?: string;
  noticeText?: string;
  shipsIn: ShipsIn[];
}

const SHIPS_IN_ORDER: readonly ShipsIn[] = ['app', 'worker', 'service worker', 'stylesheet'];

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Chunk {
  fileName: string;
  kind: 'main' | 'worker';
  moduleIds: string[];
}

function parseShippedModules(value: unknown): Chunk[] {
  if (!isRecord(value) || !Array.isArray(value.chunks)) {
    throw new Error('shipped-modules.json has no `chunks` array.');
  }
  return value.chunks.map((chunk, index) => {
    if (
      !isRecord(chunk) ||
      typeof chunk.fileName !== 'string' ||
      (chunk.kind !== 'main' && chunk.kind !== 'worker') ||
      !Array.isArray(chunk.moduleIds) ||
      !chunk.moduleIds.every((id) => typeof id === 'string')
    ) {
      throw new Error(`shipped-modules.json chunk ${index} is malformed.`);
    }
    return { fileName: chunk.fileName, kind: chunk.kind, moduleIds: chunk.moduleIds as string[] };
  });
}

interface ViteEntry {
  name: string;
  version: string;
  identifier?: string;
  text?: string;
}

function parseViteLicenses(value: unknown): ViteEntry[] {
  if (!Array.isArray(value)) throw new Error('licenses.json is not an array.');
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string') {
      throw new Error(`licenses.json entry ${index} has no name or version.`);
    }
    return {
      name: entry.name,
      version: entry.version,
      identifier: typeof entry.identifier === 'string' ? entry.identifier : undefined,
      text: typeof entry.text === 'string' ? entry.text : undefined,
    };
  });
}

function isUnderNodeModules(moduleId: string): boolean {
  return moduleId.split('/').includes('node_modules');
}

/** `workbox-<module>` for every `workbox:<module>:` marker, sorted and unique. */
export function workboxPackages(serviceWorkerText: string): string[] {
  const names = new Set<string>();
  for (const match of serviceWorkerText.matchAll(/workbox:([a-z][a-z-]*):/g)) {
    names.add(`workbox-${match[1]}`);
  }
  return [...names].sort(compare);
}

/** The service worker files: `sw.js` and the `workbox-*.js` runtime chunks at the root of `dist/`. */
function isServiceWorkerFile(filePath: string): boolean {
  return filePath === 'sw.js' || /^workbox-[^/]+\.js$/.test(filePath);
}

/**
 * Every package the build ships, keyed by `name@version`, with where it
 * ships. Throws on any gap described in the module comment.
 */
export function collectInventory(
  input: InventoryInput,
  source: PackageSource,
): Map<string, InventoryItem> {
  const chunks = parseShippedModules(input.shippedModules);
  const viteEntries = parseViteLicenses(input.viteLicenses);
  const extras = input.extras ?? EXTRAS;
  const inventory = new Map<string, InventoryItem>();
  const errors: string[] = [];

  const add = (record: PackageRecord, shipsIn: ShipsIn) => {
    const key = `${record.name}@${record.version}`;
    const item = inventory.get(key) ?? { ...record, shipsIn: [] };
    if (!item.shipsIn.includes(shipsIn)) item.shipsIn.push(shipsIn);
    inventory.set(key, item);
    return key;
  };
  const readOrFail = (dir: string, why: string): PackageRecord | undefined => {
    const record = source.read(dir);
    if (!record) errors.push(`${why}: no package at ${dir}.`);
    return record;
  };

  // Coverage: every emitted script is either a recorded chunk or part of the
  // service worker. A chunk the collector never saw (a new worker type, a
  // plugin that emits its own script) would otherwise ship unlisted.
  const recorded = new Set(chunks.map((chunk) => chunk.fileName));
  for (const file of input.jsFiles) {
    if (!recorded.has(file.path) && !isServiceWorkerFile(file.path)) {
      errors.push(
        `${file.path} is not in shipped-modules.json, so its packages are unknown. Register the collector for the build that emits it (see vite.config.ts).`,
      );
    }
  }
  const emitted = new Set(input.jsFiles.map((file) => file.path));
  for (const chunk of chunks) {
    if (!emitted.has(chunk.fileName)) {
      errors.push(`${chunk.fileName} is in shipped-modules.json but not in dist/. Rebuild.`);
    }
  }

  // Packages and virtual modules in the JS chunks.
  const extraSeen = new Map<string, Set<ShipsIn>>();
  const mainKeys = new Set<string>();
  for (const chunk of chunks) {
    const shipsIn: ShipsIn = chunk.kind === 'main' ? 'app' : 'worker';
    for (const rawId of chunk.moduleIds) {
      const moduleId = rawId.split('?')[0] ?? rawId;
      if (isUnderNodeModules(moduleId)) {
        const dir = source.ownerOf(moduleId);
        if (!dir) {
          errors.push(`${chunk.fileName}: no package owns ${moduleId}.`);
          continue;
        }
        const record = readOrFail(dir, `${chunk.fileName}: ${moduleId}`);
        if (!record) continue;
        const key = add(record, shipsIn);
        if (chunk.kind === 'main') mainKeys.add(key);
        continue;
      }
      const extra = extras.find(
        (candidate) => candidate.moduleIdPrefix && moduleId.startsWith(candidate.moduleIdPrefix),
      );
      if (!extra) {
        errors.push(
          `${chunk.fileName}: virtual module ${JSON.stringify(moduleId)} is not claimed by any extra in scripts/thirdPartyNotices.ts.`,
        );
        continue;
      }
      const seen = extraSeen.get(extra.name) ?? new Set<ShipsIn>();
      seen.add(shipsIn);
      extraSeen.set(extra.name, seen);
    }
  }

  // Vite's list covers the main bundle only; it must agree with the record.
  const viteKeys = new Set<string>();
  for (const entry of viteEntries) {
    const key = `${entry.name}@${entry.version}`;
    viteKeys.add(key);
    const item = inventory.get(key);
    if (!item || !mainKeys.has(key)) {
      errors.push(`Vite's license list has ${key}, but no main chunk records it.`);
      continue;
    }
    if (entry.identifier !== undefined) item.identifier = entry.identifier;
    if (entry.text !== undefined && entry.text.trim() !== '') item.viteText = entry.text.trim();
  }
  for (const key of [...mainKeys].sort(compare)) {
    if (!viteKeys.has(key)) {
      errors.push(`${key} ships in the main bundle, but Vite's license list misses it.`);
    }
  }

  // The service worker runtime.
  for (const file of input.jsFiles.filter((candidate) => isServiceWorkerFile(candidate.path))) {
    for (const name of workboxPackages(file.text)) {
      const record = readOrFail(`node_modules/${name}`, `${file.path}: marker for ${name}`);
      if (record) add(record, 'service worker');
    }
  }

  // Extras, which must each leave a trace.
  for (const extra of extras) {
    const seen = extraSeen.get(extra.name) ?? new Set<ShipsIn>();
    if (
      extra.cssMarker &&
      input.cssFiles.some((file) => file.text.includes(extra.cssMarker ?? ''))
    ) {
      seen.add('stylesheet');
    }
    if (seen.size === 0) {
      errors.push(`Extra ${extra.name} has no trace in the build; remove it from EXTRAS.`);
      continue;
    }
    const record = readOrFail(`node_modules/${extra.name}`, `extra ${extra.name}`);
    if (!record) continue;
    for (const shipsIn of [...seen].sort(
      (a, b) => SHIPS_IN_ORDER.indexOf(a) - SHIPS_IN_ORDER.indexOf(b),
    )) {
      add(record, shipsIn);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return inventory;
}

/** Parses `third-party-notices.overrides.json`. */
export function parseOverrides(value: unknown): Record<string, Override> {
  if (!isRecord(value) || !isRecord(value.packages)) {
    throw new Error('The overrides file has no `packages` object.');
  }
  const result: Record<string, Override> = {};
  for (const [name, raw] of Object.entries(value.packages)) {
    if (!isRecord(raw) || typeof raw.reason !== 'string' || raw.reason.trim() === '') {
      throw new Error(`Override ${name} needs a \`reason\`.`);
    }
    const override: Override = { reason: raw.reason };
    for (const field of ['text', 'source', 'identifier', 'cutBefore'] as const) {
      const fieldValue = raw[field];
      if (fieldValue === undefined) continue;
      if (typeof fieldValue !== 'string') {
        throw new Error(`Override ${name}: \`${field}\` must be a string.`);
      }
      override[field] = fieldValue;
    }
    if (override.text !== undefined && override.source === undefined) {
      throw new Error(`Override ${name}: a replacement \`text\` needs its \`source\`.`);
    }
    result[name] = override;
  }
  return result;
}

/**
 * Applies the overrides and the license policy. Throws, listing every
 * problem at once, on a disallowed or missing identifier, a missing text or
 * an override that matches nothing.
 */
export function buildNotices(
  inventory: Map<string, InventoryItem>,
  overrides: Record<string, Override>,
  allowed: readonly string[] = ALLOWED_LICENSES,
): NoticeEntry[] {
  const errors: string[] = [];
  const used = new Set<string>();
  const entries: NoticeEntry[] = [];

  for (const item of inventory.values()) {
    const label = `${item.name}@${item.version}`;
    const override = overrides[item.name];
    if (override) used.add(item.name);

    const identifier = override?.identifier ?? item.identifier;
    if (!identifier) {
      errors.push(`${label} declares no license identifier. Add an override with one.`);
      continue;
    }
    if (!allowed.includes(identifier)) {
      errors.push(
        `${label} is licensed ${identifier}, which is not in the allowlist (${allowed.join(', ')}).`,
      );
      continue;
    }

    let text = (override?.text ?? item.viteText ?? item.licenseText ?? '').replace(/\r\n?/g, '\n');
    if (override?.cutBefore !== undefined) {
      const at = text.indexOf(override.cutBefore);
      if (at < 0) {
        errors.push(`${label}: the override's cutBefore line is no longer in its license text.`);
        continue;
      }
      text = text.slice(0, at);
    }
    text = text.trim();
    if (text === '') {
      errors.push(
        `${label} ships no license text. Add an override with the upstream text and its source.`,
      );
      continue;
    }

    const noticeText = item.noticeText?.replace(/\r\n?/g, '\n').trim();
    entries.push({
      name: item.name,
      version: item.version,
      identifier,
      text,
      ...(override?.text !== undefined ? { textSource: override.source } : {}),
      ...(noticeText ? { noticeText } : {}),
      shipsIn: [...item.shipsIn].sort(
        (a, b) => SHIPS_IN_ORDER.indexOf(a) - SHIPS_IN_ORDER.indexOf(b),
      ),
    });
  }

  for (const name of Object.keys(overrides).sort(compare)) {
    if (!used.has(name)) errors.push(`Override ${name} matches no shipped package; remove it.`);
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));

  // Unsorted: renderNotices owns the order.
  return entries;
}

/** A code fence longer than any run of backticks in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

function block(text: string): string {
  const fence = fenceFor(text);
  return `${fence}text\n${text}\n${fence}`;
}

export const GENERATED_HEADER =
  '<!-- Generated by scripts/third-party-notices.ts from the production build. Do not edit: run `bun run notices`. -->';

/** The Markdown file. Deterministic: no dates, sorted entries. */
export function renderNotices(entries: NoticeEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => compare(a.name, b.name) || compare(a.version, b.version),
  );
  const lines: string[] = [
    GENERATED_HEADER,
    '',
    '# Third-party notices',
    '',
    "Cast Guidance's own code is released under the MIT License; see [LICENSE](LICENSE).",
    '',
    'The production build ships code from the open source packages below: the app bundle, the search worker, the service worker and the stylesheet. Their license texts and NOTICE files follow, reproduced as each package publishes them. This file lists only what the build ships, not every dependency in package.json, and it covers code only, not game data, which the app downloads at runtime (see [docs/content-notice.md](docs/content-notice.md)).',
    '',
    `${sorted.length} packages.`,
    '',
    '| Package | Version | License | Ships in |',
    '| --- | --- | --- | --- |',
    ...sorted.map(
      (entry) =>
        `| ${entry.name} | ${entry.version} | ${entry.identifier} | ${entry.shipsIn.join(', ')} |`,
    ),
  ];
  for (const entry of sorted) {
    lines.push('', `## ${entry.name} ${entry.version}`, '', `License: ${entry.identifier}`);
    if (entry.textSource) {
      lines.push(
        '',
        `The package ships no license file; this text is from its upstream repository: ${entry.textSource}`,
      );
    }
    lines.push('', block(entry.text));
    if (entry.noticeText) lines.push('', 'NOTICE:', '', block(entry.noticeText));
  }
  return `${lines.join('\n')}\n`;
}

/** The `--check` verdict: exit code and what to tell the developer. */
export function checkNotices(
  committed: string | undefined,
  generated: string,
): { exitCode: 0 | 1; message: string } {
  if (committed === generated) {
    return { exitCode: 0, message: 'THIRD_PARTY_NOTICES.md is current.' };
  }
  if (committed === undefined) {
    return {
      exitCode: 1,
      message: 'THIRD_PARTY_NOTICES.md is missing. Run `bun run build && bun run notices`.',
    };
  }
  const a = committed.split('\n');
  const b = generated.split('\n');
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line += 1;
  return {
    exitCode: 1,
    message: [
      `THIRD_PARTY_NOTICES.md is out of date (first difference at line ${line + 1}).`,
      `  committed: ${JSON.stringify(a[line] ?? '<end of file>')}`,
      `  generated: ${JSON.stringify(b[line] ?? '<end of file>')}`,
      'The shipped packages changed. Run `bun run build && bun run notices` and commit the result.',
    ].join('\n'),
  };
}
