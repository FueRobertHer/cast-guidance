/**
 * Dev-only audit: downloads the REAL pinned dataset and runs it through the
 * app's own normalization (copy/mod resolution), reporting everything the
 * tolerant parsers couldn't interpret. Run before any DATA_TAG bump:
 *
 *   bun scripts/data-audit.ts
 *
 * Network-gated by design — no game data ever lands in the repo.
 */
import { DATA_TAG } from '../src/data5e/config';
import { normalizeDataset } from '../src/data5e/normalize';
import { GithubTagSource } from '../src/data5e/source';

const source = new GithubTagSource(DATA_TAG);

const STATIC_FILES = [
  'races.json',
  'backgrounds.json',
  'feats.json',
  'items-base.json',
  'items.json',
  'magicvariants.json',
  'optionalfeatures.json',
  'skills.json',
  'languages.json',
  'senses.json',
  'actions.json',
  'conditionsdiseases.json',
  'variantrules.json',
  'books.json',
  'class/index.json',
  'spells/index.json',
];

console.log(`# data-audit against ${DATA_TAG}\n`);

const files = new Map<string, unknown>();
async function fetchInto(paths: string[]): Promise<void> {
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (;;) {
        const p = queue.shift();
        if (p === undefined) return;
        files.set(p, await source.fetchFile(p));
      }
    }),
  );
}

await fetchInto(STATIC_FILES);
const classIndex = files.get('class/index.json') as Record<string, string>;
const spellsIndex = files.get('spells/index.json') as Record<string, string>;
await fetchInto([
  ...Object.values(classIndex).map((f) => `class/${f}`),
  ...Object.values(spellsIndex).map((f) => `spells/${f}`),
]);
console.log(`fetched ${files.size} files\n`);

const reg = normalizeDataset(files);

console.log('## entity counts');
const counts = reg.counts();
console.log(
  Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' '),
);

console.log(`\n## copy/mod warnings (${reg.warnings.length})`);
const grouped = new Map<string, string[]>();
for (const w of reg.warnings) {
  const key = w.message.replace(/"[^"]*"/g, '"…"').replace(/\{.*\}$/, '{…}');
  const list = grouped.get(key) ?? [];
  list.push(w.entity);
  grouped.set(key, list);
}
for (const [message, entities] of grouped) {
  console.log(`- [${entities.length}x] ${message}`);
  console.log(`    e.g. ${entities.slice(0, 4).join(', ')}`);
}

// {@tag} histogram across every string in the dataset — feeds renderer coverage.
const tagCounts = new Map<string, number>();
const tagRe = /\{@([a-zA-Z0-9]+)[ }]/g;
const walk = (v: unknown): void => {
  if (typeof v === 'string') {
    for (const m of v.matchAll(tagRe)) {
      const tag = m[1] as string;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  } else if (Array.isArray(v)) {
    for (const x of v) walk(x);
  } else if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) walk(x);
  }
};
for (const json of files.values()) walk(json);

console.log('\n## {@tag} histogram (desc)');
console.log(
  [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}:${n}`)
    .join(' '),
);

// Underscore-prefixed keys we might not handle
const underscoreKeys = new Map<string, number>();
const walkKeys = (v: unknown): void => {
  if (Array.isArray(v)) for (const x of v) walkKeys(x);
  else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('_')) underscoreKeys.set(k, (underscoreKeys.get(k) ?? 0) + 1);
      walkKeys(x);
    }
  }
};
for (const json of files.values()) walkKeys(json);
console.log('\n## underscore keys');
console.log(
  [...underscoreKeys.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}:${n}`)
    .join(' '),
);
