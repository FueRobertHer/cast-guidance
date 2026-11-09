/**
 * Run the import converter over real files and print what it did: how many
 * entries converted, which lost something and why (grouped), and what was
 * left out. Unit tests use small made-up samples; this is the check against
 * the files people actually have.
 *
 *   bun scripts/convert-fc5.ts spells.xml items.xml
 *   bun scripts/convert-fc5.ts compendium.xml --out converted/   # also write the JSON
 *   bun scripts/convert-fc5.ts compendium.xml --notes            # every note, not just counts
 *
 * Nothing here checks against installed game data, so no entry is left out as
 * "already installed". Game data never lands in the repo: point it at files
 * outside it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { convertXmlText } from '../src/convert/index';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    notes: { type: 'boolean', default: false },
  },
});

if (positionals.length === 0) {
  console.error('Usage: bun scripts/convert-fc5.ts <file.xml>... [--out dir] [--notes]');
  process.exit(2);
}

let failed = false;
for (const file of positionals) {
  const fileName = path.basename(file);
  const text = readFileSync(file, 'utf8');
  const started = performance.now();
  let result: ReturnType<typeof convertXmlText>;
  try {
    result = convertXmlText(text, { fileName });
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

  if (values.out !== undefined) {
    mkdirSync(values.out, { recursive: true });
    const target = path.join(values.out, `${path.parse(fileName).name}.json`);
    writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`  wrote ${target}`);
  }
}
process.exit(failed ? 1 : 0);
