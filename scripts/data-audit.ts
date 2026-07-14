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
import { parseDice } from '../src/dice/parse';
import { spellRollActions } from '../src/features/sheet/spellRolls';

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

// Every spell roll action generated at every character level and valid slot
// level must remain valid input for the dice engine. This intentionally checks
// nonstandard/homebrew scaling thresholds as well as the usual 5/11/17 steps.
const invalidSpellRolls: string[] = [];
let spellsWithRolls = 0;
let generatedRolls = 0;
for (const spell of reg.byType('spell')) {
  let spellHasRoll = false;
  const baseLevel = typeof spell.level === 'number' ? spell.level : 0;
  const characterLevels = Array.from({ length: 20 }, (_, index) => index + 1);
  const slotLevels =
    baseLevel === 0
      ? [0]
      : Array.from({ length: Math.max(0, 10 - baseLevel) }, (_, index) => baseLevel + index);
  for (const characterLevel of characterLevels) {
    for (const slotLevel of slotLevels) {
      const actions = spellRollActions(spell, {
        characterLevel,
        slotLevel,
        abilityModifier: 5,
      });
      generatedRolls += actions.length;
      spellHasRoll ||= actions.length > 0;
      for (const action of actions) {
        try {
          parseDice(action.expr);
        } catch (error) {
          invalidSpellRolls.push(
            `${String(spell.name)}|${String(spell.source)} character L${characterLevel}, slot L${slotLevel}: ${action.expr} (${String(error)})`,
          );
        }
      }
    }
  }
  if (spellHasRoll) spellsWithRolls++;
}
console.log(`\n## spell roll actions`);
console.log(
  `${spellsWithRolls}/${reg.byType('spell').length} spells expose dice; checked ${generatedRolls} generated rolls`,
);
if (invalidSpellRolls.length > 0) {
  console.log(`invalid expressions (${invalidSpellRolls.length})`);
  for (const invalid of invalidSpellRolls.slice(0, 40)) console.log(`- ${invalid}`);
  process.exitCode = 1;
} else {
  console.log('all generated expressions parse');
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
