/**
 * Pure core of the bundle budget gate (TEST-001). It knows nothing about the
 * file system: the CLI in `bundle-budget.ts` reads `dist/` and hands the text
 * of `index.html` and `sw.js` plus every file's size to `measure`, so the
 * parsing and the budget arithmetic can be tested with in-memory fixtures.
 *
 * The parsers fail loudly rather than measuring nothing. A gate that reads
 * zero entry scripts or zero precache entries would report every metric as
 * comfortably under budget, which is exactly the silent pass this exists to
 * prevent.
 */

/** One emitted file, with its path relative to `dist/` (posix, no leading slash). */
export interface DistFile {
  path: string;
  bytes: number;
  gzipBytes: number;
}

export interface MeasureInput {
  indexHtml: string;
  swJs: string;
  files: DistFile[];
}

export interface Measurement {
  /** The `<script type="module" src>` chunk that boots the app. */
  entry: DistFile;
  /** Entry plus every `<link rel="modulepreload">` chunk: what a cold boot downloads. */
  initialJs: DistFile[];
  /** Every `.js` file under `assets/`, including lazy routes and the search worker. */
  allJs: DistFile[];
  css: DistFile[];
  /** Unique precache entries from the service worker manifest. */
  precache: DistFile[];
}

/** Budget keys, in the order the report lists them. */
export const BUDGET_KEYS = [
  'entryBytes',
  'entryGzipBytes',
  'initialJsBytes',
  'initialJsGzipBytes',
  'totalJsBytes',
  'largestChunkBytes',
  'cssBytes',
  'precacheBytes',
] as const;

export type BudgetKey = (typeof BUDGET_KEYS)[number];
export type Budget = Record<BudgetKey, number>;

const LABELS: Record<BudgetKey, string> = {
  entryBytes: 'Entry chunk (raw)',
  entryGzipBytes: 'Entry chunk (gzip)',
  initialJsBytes: 'Initial JS: entry + modulepreloads (raw)',
  initialJsGzipBytes: 'Initial JS: entry + modulepreloads (gzip)',
  totalJsBytes: 'Total JS (raw)',
  largestChunkBytes: 'Largest JS chunk (raw)',
  cssBytes: 'CSS (raw)',
  precacheBytes: 'Service worker precache (raw)',
};

export interface BudgetRow {
  key: BudgetKey;
  label: string;
  /** Which file a single-file metric measured, for the report. */
  detail?: string;
  actual: number;
  budget: number;
  ok: boolean;
}

export interface Evaluation {
  rows: BudgetRow[];
  violations: BudgetRow[];
}

/** Every opening tag of `tagName`, with its attributes parsed. */
function tags(html: string, tagName: string): Map<string, string>[] {
  const found: Map<string, string>[] = [];
  const tagRe = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi');
  for (const match of html.matchAll(tagRe)) {
    const attrs = new Map<string, string>();
    // name="value", name='value', name=value, or a bare boolean attribute.
    const attrRe = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attr of (match[1] ?? '').matchAll(attrRe)) {
      const name = attr[1];
      if (name === undefined) continue;
      attrs.set(name.toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    found.push(attrs);
  }
  return found;
}

/** Strips HTML comments so a commented-out tag is never counted. */
function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Turns a URL from index.html or sw.js into a `dist/`-relative path. Absolute
 * URLs to another origin are not part of the bundle, so they map to undefined.
 */
export function toDistPath(url: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return undefined;
  const path = url.split(/[?#]/)[0] ?? '';
  return path.replace(/^(\.\/|\/)+/, '');
}

function relList(attrs: Map<string, string>): string[] {
  return (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
}

/** `src` of every `<script type="module">`, attributes in any order. */
export function parseEntryScripts(indexHtml: string): string[] {
  return tags(stripComments(indexHtml), 'script')
    .filter((attrs) => (attrs.get('type') ?? '').toLowerCase() === 'module' && attrs.has('src'))
    .map((attrs) => attrs.get('src') ?? '');
}

/** `href` of every `<link rel="modulepreload">`. */
export function parseModulePreloads(indexHtml: string): string[] {
  return tags(stripComments(indexHtml), 'link')
    .filter((attrs) => relList(attrs).includes('modulepreload') && attrs.has('href'))
    .map((attrs) => attrs.get('href') ?? '');
}

/** Unique `url` values from the Workbox precache manifest in `sw.js`, in first-seen order. */
export function parsePrecacheUrls(swJs: string): string[] {
  const urls = new Set<string>();
  for (const match of swJs.matchAll(/\burl\s*:\s*(?:"([^"]+)"|'([^']+)')/g)) {
    const url = match[1] ?? match[2];
    if (url !== undefined) urls.add(url);
  }
  return [...urls];
}

function lookup(byPath: Map<string, DistFile>, url: string, from: string): DistFile {
  const path = toDistPath(url);
  if (path === undefined) {
    throw new Error(`${from} references ${url}, which is not a file in dist/.`);
  }
  const file = byPath.get(path);
  if (file === undefined) {
    throw new Error(`${from} references ${url}, but dist/${path} does not exist.`);
  }
  return file;
}

/**
 * Resolves the build's entry, preloads, and precache list against the emitted
 * files. Throws when the output does not look like a Vite + Workbox build, so
 * the gate cannot pass by measuring nothing.
 */
export function measure(input: MeasureInput): Measurement {
  const byPath = new Map(input.files.map((file) => [file.path, file]));

  const entries = parseEntryScripts(input.indexHtml);
  if (entries.length !== 1) {
    throw new Error(
      `Expected exactly one <script type="module" src> in index.html, found ${entries.length}.`,
    );
  }
  const entry = lookup(byPath, entries[0] ?? '', 'index.html');

  const preloads = parseModulePreloads(input.indexHtml).map((url) =>
    lookup(byPath, url, 'index.html modulepreload'),
  );
  const initialJs = [entry, ...preloads.filter((file) => file.path !== entry.path)];

  const precacheUrls = parsePrecacheUrls(input.swJs);
  if (precacheUrls.length === 0) {
    throw new Error('Found no precache entries (url:"...") in sw.js.');
  }
  const precache = [
    ...new Map(
      precacheUrls.map((url) => {
        const file = lookup(byPath, url, 'sw.js precache');
        return [file.path, file] as const;
      }),
    ).values(),
  ];

  const assets = input.files.filter((file) => file.path.startsWith('assets/'));
  const allJs = assets.filter((file) => file.path.endsWith('.js'));
  const css = assets.filter((file) => file.path.endsWith('.css'));

  // Workbox silently leaves out any file over maximumFileSizeToCacheInBytes,
  // which breaks offline use without failing the build. Every hashed asset
  // must be in the manifest.
  const precached = new Set(precache.map((file) => file.path));
  const missing = [...allJs, ...css].filter((file) => !precached.has(file.path));
  if (missing.length > 0) {
    throw new Error(
      `Not in the sw.js precache, so unavailable offline: ${missing.map((f) => f.path).join(', ')}.`,
    );
  }

  return { entry, initialJs, allJs, css, precache };
}

const sum = (files: DistFile[], pick: (file: DistFile) => number): number =>
  files.reduce((total, file) => total + pick(file), 0);

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Parses `bundle-budget.json`, rejecting missing, unknown, or non-positive keys. */
export function parseBudget(raw: unknown): Budget {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Bundle budget must be a JSON object.');
  }
  const record = raw as Record<string, unknown>;
  const known = new Set<string>(BUDGET_KEYS);
  const unknown = Object.keys(record).filter((key) => !known.has(key) && key !== '$comment');
  if (unknown.length > 0) throw new Error(`Unknown bundle budget keys: ${unknown.join(', ')}.`);
  const budget = {} as Budget;
  for (const key of BUDGET_KEYS) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`Bundle budget "${key}" must be a positive number of bytes.`);
    }
    budget[key] = value;
  }
  return budget;
}

export function evaluate(measurement: Measurement, budget: Budget): Evaluation {
  const largest = measurement.allJs.reduce<DistFile | undefined>(
    (best, file) => (best === undefined || file.bytes > best.bytes ? file : best),
    undefined,
  );
  const actuals: Record<BudgetKey, { actual: number; detail?: string }> = {
    entryBytes: { actual: measurement.entry.bytes, detail: measurement.entry.path },
    entryGzipBytes: { actual: measurement.entry.gzipBytes, detail: measurement.entry.path },
    initialJsBytes: {
      actual: sum(measurement.initialJs, (f) => f.bytes),
      detail: count(measurement.initialJs.length, 'file', 'files'),
    },
    initialJsGzipBytes: {
      actual: sum(measurement.initialJs, (f) => f.gzipBytes),
      detail: `${count(measurement.initialJs.length, 'file', 'files')}, gzipped separately`,
    },
    totalJsBytes: {
      actual: sum(measurement.allJs, (f) => f.bytes),
      detail: count(measurement.allJs.length, 'file', 'files'),
    },
    largestChunkBytes: { actual: largest?.bytes ?? 0, detail: largest?.path },
    cssBytes: {
      actual: sum(measurement.css, (f) => f.bytes),
      detail: count(measurement.css.length, 'file', 'files'),
    },
    precacheBytes: {
      actual: sum(measurement.precache, (f) => f.bytes),
      detail: count(measurement.precache.length, 'entry', 'entries'),
    },
  };
  const rows = BUDGET_KEYS.map((key): BudgetRow => {
    const { actual, detail } = actuals[key];
    return {
      key,
      label: LABELS[key],
      detail,
      actual,
      budget: budget[key],
      ok: actual <= budget[key],
    };
  });
  return { rows, violations: rows.filter((row) => !row.ok) };
}

const formatBytes = (bytes: number): string =>
  `${bytes.toLocaleString('en-US')} B (${(bytes / 1024).toFixed(1)} KiB)`;

export function toMarkdown(rows: BudgetRow[]): string {
  const lines = [
    '| Metric | Actual | Budget | Used | Status |',
    '| --- | ---: | ---: | ---: | --- |',
    ...rows.map((row) => {
      const label = row.detail === undefined ? row.label : `${row.label}<br>\`${row.detail}\``;
      const used = `${((row.actual / row.budget) * 100).toFixed(1)}%`;
      const status = row.ok ? 'ok' : '**over budget**';
      return `| ${label} | ${formatBytes(row.actual)} | ${formatBytes(row.budget)} | ${used} | ${status} |`;
    }),
  ];
  return lines.join('\n');
}
