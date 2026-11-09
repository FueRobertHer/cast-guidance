/**
 * Run the import converter over real files and print what it did: how many
 * entries converted, which lost something and why (grouped), and what was
 * left out. Unit tests use small made-up samples; this is the check against
 * the files people actually have.
 *
 *   bun scripts/convert-fc5.ts spells.xml items.xml
 *   bun scripts/convert-fc5.ts compendium.xml --out converted/   # also write the JSON
 *   bun scripts/convert-fc5.ts compendium.xml --notes            # every note, not just counts
 *   bun scripts/convert-fc5.ts srd/*.xml --compare               # field by field against 5etools
 *   bun scripts/convert-fc5.ts srd/*.xml --compare --tag latest  # against the newest release
 *
 * `--compare` fetches a 5etools release (the pinned one unless `--tag` says
 * otherwise) and sets each converted entry beside the official entry of the
 * same name and edition (`src/convert/compareOfficial.ts`). For an SRD file
 * that shows which fields the converter leaves as text, and which it reads
 * differently. Nothing is cached or written.
 *
 * Nothing here leaves an entry out as "already installed", so every entry
 * converts. Game data never lands in the repo: point it at files outside it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  compareWithOfficial,
  type FieldTally,
  type KindComparison,
  type OfficialData,
  spellClassesFromLookup,
} from '../src/convert/compareOfficial';
import { convertXmlText } from '../src/convert/index';
import { officialFeatLookup } from '../src/convert/official';
import type { OfficialFeat } from '../src/convert/types';
import { DATA_TAG, isCompatibleTag } from '../src/data5e/config';
import { normalizeDataset } from '../src/data5e/normalize';
import { GithubTagSource } from '../src/data5e/source';
import { fetchRelease, resolveLatestTag } from './data-release';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    notes: { type: 'boolean', default: false },
    compare: { type: 'boolean', default: false },
    tag: { type: 'string' },
  },
});

function die(message: string): never {
  console.error(`convert-fc5: ${message}`);
  process.exit(2);
}

if (positionals.length === 0) {
  die(
    'usage: bun scripts/convert-fc5.ts <file.xml>... [--out dir] [--notes] [--compare [--tag t]]',
  );
}
if (values.tag !== undefined && !values.compare) die('--tag only applies with --compare');

/** Examples printed per field and outcome. */
const EXAMPLES = 3;

let official: OfficialData | undefined;
/** A background's official feat, as the app finds it; without `--compare`, such a grant is left out. */
let officialFeat: OfficialFeat | undefined;
if (values.compare) {
  let tag = values.tag ?? DATA_TAG;
  try {
    if (tag === 'latest') tag = await resolveLatestTag();
    if (!isCompatibleTag(tag)) die(`${tag} is not compatible with this build (pinned ${DATA_TAG})`);
    const [release, lookup] = await Promise.all([
      fetchRelease(tag),
      new GithubTagSource(tag).fetchFile('generated/gendata-spell-source-lookup.json'),
    ]);
    const registry = normalizeDataset(release.files);
    officialFeat = officialFeatLookup(registry);
    official = {
      byType: (type) => registry.byType(type),
      spellClasses: spellClassesFromLookup(lookup),
    };
    console.log(`Comparing with 5etools ${tag}.`);
  } catch (err) {
    die(`could not fetch 5etools ${tag}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

let failed = false;
for (const file of positionals) {
  const fileName = path.basename(file);
  const text = readFileSync(file, 'utf8');
  const started = performance.now();
  let result: ReturnType<typeof convertXmlText>;
  try {
    result = convertXmlText(text, { fileName, officialFeat });
  } catch (err) {
    failed = true;
    console.log(`\n${fileName}: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  const ms = performance.now() - started;
  const { report, json } = result;
  const total = Object.values(report.converted).reduce((s, n) => s + (n ?? 0), 0);
  const byStatus = (s: string) => report.notes.filter((n) => n.status === s);
  const partial = byStatus('partial');

  console.log(`\n${fileName}  (${(text.length / 1024).toFixed(0)} KB, ${ms.toFixed(0)} ms)`);
  console.log(
    `  converted ${total}: ${Object.entries(report.converted)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')}`,
  );
  console.log(
    `  clean ${total - partial.length}, partial ${partial.length}, skipped ${byStatus('skipped').length}, duplicates ${byStatus('duplicate').length}`,
  );

  // Group reasons with their quoted specifics blanked, so the shape shows.
  const reasons = new Map<string, { count: number; example: string }>();
  for (const note of report.notes) {
    if (note.status === 'installed') continue;
    for (const reason of note.reasons) {
      const key = `${note.status}: ${note.kind}: ${reason.replace(/"[^"]*"/g, '"…"')}`;
      const prev = reasons.get(key);
      reasons.set(key, {
        count: (prev?.count ?? 0) + 1,
        example: prev?.example ?? `${note.name}: ${reason}`,
      });
    }
  }
  for (const [key, { count, example }] of [...reasons].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${String(count).padStart(5)}  ${key}   e.g. ${example}`);
  }
  for (const w of report.warnings) console.log(`  warning: ${w}`);
  if (values.notes) {
    for (const n of report.notes)
      console.log(`    [${n.status}] ${n.kind} ${n.name}: ${n.reasons.join('; ')}`);
  }

  if (official !== undefined) {
    for (const kind of compareWithOfficial(json, official, EXAMPLES)) printComparison(kind);
  }

  if (values.out !== undefined) {
    mkdirSync(values.out, { recursive: true });
    const target = path.join(values.out, `${path.parse(fileName).name}.json`);
    writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`  wrote ${target}`);
  }
}
process.exit(failed ? 1 : 0);

function printComparison(c: KindComparison): void {
  console.log(`\n  ${c.kind}: ${c.matched} of ${c.converted} have an official entry`);
  if (c.unmatched.length > 0) {
    console.log(`    none for, e.g.: ${c.unmatched.join(', ')}`);
  }
  const off = (f: FieldTally) => f.source + f.differs + f.missing + f.extra;
  const rules = c.fields.filter((f) => !f.searchTag && off(f) > 0);
  if (rules.length > 0) {
    console.log(`    ${row('field', 'same', 'source', 'differs', 'missing', 'extra')}`);
  }
  for (const f of rules) {
    console.log(`    ${row(f.field, f.same, f.source, f.differs, f.missing, f.extra)}`);
    for (const [label, counts] of [
      ['lacks', f.lacks],
      ['adds', f.adds],
    ] as const) {
      if (counts.length === 0) continue;
      const shown = counts.slice(0, 6).map((v) => `${v.value} ×${v.count}`);
      console.log(`        ${label}: ${shown.join(', ')}${counts.length > 6 ? ', …' : ''}`);
    }
    for (const outcome of ['missing', 'differs', 'source', 'extra'] as const) {
      for (const line of f.examples[outcome]) console.log(`        ${outcome}: ${line}`);
    }
  }
  const agree = c.fields.filter((f) => !f.searchTag && off(f) === 0);
  if (agree.length > 0) {
    console.log(`    same on every match: ${agree.map((f) => f.field).join(', ')}`);
  }
  const tags = c.fields.filter((f) => f.searchTag);
  if (tags.length > 0) {
    const tally = (f: FieldTally) =>
      `${f.field} ${f.same} same, ${f.source + f.differs} differ, ${f.missing} missing, ${f.extra} extra`;
    console.log(`    search tags, not read by the app: ${tags.map(tally).join('; ')}`);
  }
}

function row(field: string, ...counts: Array<string | number>): string {
  const widths = [6, 8, 9, 9, 7];
  return `${field.padEnd(24)}${counts.map((n, i) => String(n).padStart(widths[i] ?? 7)).join('')}`;
}
