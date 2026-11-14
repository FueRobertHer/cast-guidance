/**
 * Whole-release sheet snapshot, to prove a move of mechanics between code and
 * data changes no sheet (rule pack port; `docs/rule-sets.md`). It derives a
 * fixed set of builds on the pinned release and records a hash of every field
 * of every sheet, so two trees can be compared build by build.
 *
 *   bun --tsconfig-override=tsconfig.app.json scripts/rules-diff.ts snapshot \
 *     --release <release.json> --out <snapshot.json> [--dump <text> --dump-dir <dir>]
 *   bun scripts/rules-diff.ts compare <a.json> <b.json> [--expect-zero]
 *
 * The release is cached in `--release` (fetched on first use; no game data goes
 * in the repo), so both trees read the same files in the same order. To compare
 * against another commit, export its tree with `git archive <commit> | tar -x`
 * into a scratch folder, give it this repo's `node_modules`, copy this script
 * into its `scripts/`, and snapshot there with the same `--release`. A tree
 * without `src/data5e/builtInRules.ts` derives without built-in rule sets.
 *
 * `--dump <text>` also writes the full sheet of every build whose id holds
 * `<text>` into `--dump-dir`, to see a difference the hashes point at.
 *
 * Every build is made three times: with every ability 14; again with every
 * ability 8 (ids end in `[8s]`), where a minimum (`max(1, mod.cha)`) shows; and
 * again raging and bloodied (`[on]`), where a row that holds only in a state
 * shows. A class build at level 20 in its own edition is also made once for
 * each later usable option of each feature pick (ids hold `| <pick> = <option>`),
 * since a build takes the first.
 *
 * `--coverage <file>` writes, for each code table (`CURATED`, `STANDING`, the
 * roll tables) and the built-in rows, the keys no build read: a move of one of
 * those rows must be proved some other way. It wraps the tables in place to
 * count, so it changes no sheet.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { DATA_TAG } from '../src/data5e/config';
import type { Entity } from '../src/data5e/copyMod';
import { engineContextFor } from '../src/data5e/engineAdapter';
import { type EntityRegistry, normalizeDataset } from '../src/data5e/normalize';
import { editionOf } from '../src/data5e/rulesVersion';
import { deriveSheet } from '../src/engine/derive';
import {
  type CharacterDoc,
  type DerivedSheet,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
} from '../src/engine/types';
import { fetchRelease } from './data-release';

/** Per build: a hash of each sheet field, by field. */
type Snapshot = Record<string, Record<string, string>>;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    release: { type: 'string' },
    out: { type: 'string' },
    dump: { type: 'string' },
    'dump-dir': { type: 'string' },
    coverage: { type: 'string' },
    'expect-zero': { type: 'boolean', default: false },
  },
});

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const refOf = (e: Entity): EntityRef => ({ name: str(e.name), source: str(e.source) });
const uidOf = (r: EntityRef) => `${r.name}|${r.source}`;
const hash = (v: unknown) =>
  createHash('sha1')
    .update(JSON.stringify(v) ?? 'undefined')
    .digest('hex')
    .slice(0, 12);

// ---------------------------------------------------------------- compare

function compare(aPath: string, bPath: string): number {
  const a = JSON.parse(readFileSync(aPath, 'utf8')) as Snapshot;
  const b = JSON.parse(readFileSync(bPath, 'utf8')) as Snapshot;
  const onlyA = Object.keys(a).filter((id) => !(id in b));
  const onlyB = Object.keys(b).filter((id) => !(id in a));
  const byField = new Map<string, string[]>();
  for (const [id, fields] of Object.entries(a)) {
    const other = b[id];
    if (other === undefined) continue;
    for (const field of new Set([...Object.keys(fields), ...Object.keys(other)])) {
      if (fields[field] === other[field]) continue;
      const ids = byField.get(field) ?? [];
      ids.push(id);
      byField.set(field, ids);
    }
  }
  const changed = new Set([...byField.values()].flat());
  console.log(`builds: ${Object.keys(a).length} and ${Object.keys(b).length}`);
  console.log(
    `changed: ${changed.size}; only in the first: ${onlyA.length}; only in the second: ${onlyB.length}`,
  );
  for (const id of onlyA.slice(0, 20)) console.log(`  only first: ${id}`);
  for (const id of onlyB.slice(0, 20)) console.log(`  only second: ${id}`);
  for (const [field, ids] of [...byField].sort((x, y) => y[1].length - x[1].length)) {
    console.log(`  ${field}: ${ids.length} builds, e.g. ${ids.slice(0, 5).join('; ')}`);
  }
  return changed.size + onlyA.length + onlyB.length;
}

// ---------------------------------------------------------------- snapshot

async function releaseFiles(file: string): Promise<Map<string, unknown>> {
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.fromEntries((await fetchRelease(DATA_TAG)).files)));
  }
  return new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>));
}

/** The built-in rule sets, where this tree has them. */
async function withRules(reg: EntityRegistry): Promise<string> {
  const loader = path.resolve(import.meta.dirname, '../src/data5e/builtInRules.ts');
  if (!existsSync(loader)) return 'none in this tree';
  const { withBuiltInRules } = (await import(pathToFileURL(loader).href)) as {
    withBuiltInRules: (r: EntityRegistry) => Promise<EntityRegistry>;
  };
  await withBuiltInRules(reg);
  if (reg.ruleSetsFailed) throw new Error('The built-in rule sets did not load.');
  return `${reg.byType('ruleSet' as never).length} sets`;
}

/** The code tables `--coverage` counts: name, module and export. */
const TABLES: ReadonlyArray<readonly [string, string]> = [
  ['../src/engine/curated/curatedEffects.ts', 'CURATED'],
  ['../src/engine/curated/standingEffects.ts', 'STANDING'],
  ['../src/engine/curated/rollAdvantages.ts', 'ROLL_ADVANTAGES'],
  ['../src/engine/curated/rollExtras.ts', 'ROLL_EXTRAS'],
];

/**
 * Wrap each code table's rows, and each built-in row's effects, so a read of one
 * is counted. A row is a function (called) or a list (read); either way the
 * engine gets what it got before. Returns the keys read and the keys in all.
 */
async function instrument(
  reg: EntityRegistry,
): Promise<Map<string, { all: string[]; read: Set<string> }>> {
  const out = new Map<string, { all: string[]; read: Set<string> }>();
  for (const [file, name] of TABLES) {
    const at = path.resolve(import.meta.dirname, file);
    if (!existsSync(at)) continue;
    const table = ((await import(pathToFileURL(at).href)) as Record<string, unknown>)[name];
    if (typeof table !== 'object' || table === null) continue;
    const rows = table as Record<string, unknown>;
    const read = new Set<string>();
    out.set(name, { all: Object.keys(rows), read });
    for (const [key, row] of Object.entries(rows)) {
      rows[key] =
        typeof row === 'function'
          ? (...args: unknown[]) => {
              read.add(key);
              return (row as (...a: unknown[]) => unknown)(...args);
            }
          : new Proxy(row as object, {
              get(target, prop, receiver) {
                read.add(key);
                return Reflect.get(target, prop, receiver);
              },
            });
    }
  }
  const mechanics = (await import(
    pathToFileURL(path.resolve(import.meta.dirname, '../src/engine/effects/mechanics.ts')).href
  )) as { readRuleSet?: (raw: unknown) => { rows: Array<{ part: string; keys: string[] }> } };
  if (mechanics.readRuleSet !== undefined) {
    const read = new Set<string>();
    const all: string[] = [];
    out.set('built-in rows', { all, read });
    for (const set of reg.byType('ruleSet' as never)) {
      for (const row of mechanics.readRuleSet(set).rows) {
        const key = `${row.part}:${row.keys[0]}`;
        all.push(key);
        const effects = (row as unknown as { effects: object }).effects;
        (row as unknown as { effects: object }).effects = new Proxy(effects, {
          get(target, prop, receiver) {
            read.add(key);
            return Reflect.get(target, prop, receiver);
          },
        });
      }
    }
  }
  return out;
}

/** Every ability 8: the low pass, where a minimum on an ability's modifier shows. */
const LOW = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };

/**
 * The states the code tables' rows wait on (`while`), on: raging, and bloodied
 * at 1 hit point. An effect that holds only while raging is on no sheet
 * otherwise, so a wrong one would change nothing a build records. A Rage with
 * no parts of its own, so only the rows that wait on it differ.
 */
function statesOn(doc: CharacterDoc): CharacterDoc {
  doc.play.activeEffects = [{ id: 'rules-diff-rage', name: 'Rage', parts: [] }];
  doc.play.hpInitialized = true;
  doc.play.currentHp = 1;
  return doc;
}

function baseDoc(edition: '2014' | '2024'): CharacterDoc {
  const doc = newCharacterDoc('rules-diff', 'Rules diff', DATA_TAG);
  doc.rulesVersion = edition;
  doc.abilities = {
    method: 'manual',
    base: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
  } as CharacterDoc['abilities'];
  return doc;
}

const fighter = (edition: '2014' | '2024', levels: number) => ({
  ref: { name: 'Fighter', source: edition === '2024' ? 'XPHB' : 'PHB' },
  levels,
  hp: [],
});

/** A feature pick a build answered (a subclass's Totem Spirit), and its usable options. */
interface FeaturePick {
  id: string;
  count: number;
  options: string[];
}

/**
 * Answer every open prompt with its first usable options, a few rounds deep.
 * The feature picks it answered go into `picks`, for the branch builds.
 */
function settle(doc: CharacterDoc, ctx: EngineContext, picks: FeaturePick[] = []): DerivedSheet {
  let sheet = deriveSheet(doc, ctx);
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const p of sheet.pending) {
      if (doc.choices[p.id] !== undefined || p.options.length === 0) continue;
      const usable = p.options.filter((o) => o.disabled === undefined);
      const pool = usable.length > 0 ? usable : p.options;
      const n = Math.max(1, Math.min(p.count, pool.length));
      if (p.kind === 'feature' && usable.length > n) {
        picks.push({ id: p.id, count: n, options: usable.map((o) => o.id) });
      }
      doc.choices[p.id] = pool.slice(0, n).map((o) => o.id);
      changed = true;
    }
    if (!changed) break;
    sheet = deriveSheet(doc, ctx);
  }
  return sheet;
}

async function snapshot(): Promise<void> {
  if (values.release === undefined || values.out === undefined) {
    console.error('snapshot needs --release <file> and --out <file>.');
    process.exit(1);
  }
  const reg = normalizeDataset(await releaseFiles(values.release));
  const rules = await withRules(reg);
  const coverage = values.coverage === undefined ? undefined : await instrument(reg);
  const ctx = engineContextFor(reg, {});
  const snap: Snapshot = {};
  const dump = values.dump;
  const dumpDir = values['dump-dir'] ?? path.dirname(values.out);

  /** One build, settled and hashed; the feature picks it answered. */
  const one = (
    id: string,
    doc: CharacterDoc,
    preset?: (d: CharacterDoc) => void,
  ): FeaturePick[] => {
    preset?.(doc);
    const picks: FeaturePick[] = [];
    let sheet: DerivedSheet;
    try {
      sheet = settle(doc, ctx, picks);
    } catch (err) {
      snap[id] = { throws: hash(String(err)) };
      return [];
    }
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(sheet)) fields[k] = hash(v);
    fields.choices = hash(doc.choices);
    snap[id] = fields;
    if (dump !== undefined && id.includes(dump)) {
      mkdirSync(dumpDir, { recursive: true });
      // The id's hash too: a branch build's id runs past what a file name keeps.
      const name = `${id.replace(/[^a-z0-9]+/gi, '_').slice(0, 100)}_${hash(id).slice(0, 8)}`;
      const file = path.join(dumpDir, `${name}.json`);
      writeFileSync(file, JSON.stringify({ id, choices: doc.choices, sheet }, null, 1));
    }
    return picks;
  };

  /** A build at 14s, at 8s and in the states rows wait on, each from its own copy of `doc`. */
  const record = (
    id: string,
    doc: CharacterDoc,
    preset?: (d: CharacterDoc) => void,
  ): FeaturePick[] => {
    const picks = one(id, structuredClone(doc), preset);
    const low = structuredClone(doc);
    low.abilities = { method: 'manual', base: { ...LOW } } as CharacterDoc['abilities'];
    one(`${id} [8s]`, low, preset);
    one(`${id} [on]`, statesOn(structuredClone(doc)), preset);
    return picks;
  };

  /** `doc` again for each later option of each feature pick it answered with its first. */
  const branches = (id: string, doc: CharacterDoc, picks: readonly FeaturePick[]) => {
    for (const pick of picks) {
      for (const option of pick.options.slice(pick.count)) {
        const others = pick.options.filter((o) => o !== option).slice(0, pick.count - 1);
        record(`${id} | ${pick.id} = ${option}`, doc, (d) => {
          d.choices[pick.id] = [option, ...others];
        });
      }
    }
  };

  const classes = reg.byType('class');
  const subclasses = reg.byType('subclass');
  const LEVELS = [1, 2, 3, 5, 6, 9, 11, 14, 17, 20];
  // Where every feature pick is open, so the branch builds see them all.
  const TOP_LEVEL = 20;
  const OTHER_EDITION_LEVELS = new Set([3, 11, 20]);
  for (const cls of classes) {
    const ref = refOf(cls);
    const own = editionOf(cls);
    const subs = subclasses.filter(
      (s) =>
        str(s.className).toLowerCase() === ref.name.toLowerCase() &&
        str(s.classSource).toLowerCase() === ref.source.toLowerCase(),
    );
    for (const sub of [undefined, ...subs]) {
      const subRef = sub === undefined ? undefined : refOf(sub);
      for (const level of LEVELS) {
        for (const edition of ['2014', '2024'] as const) {
          if (edition !== own && !OTHER_EDITION_LEVELS.has(level)) continue;
          const doc = baseDoc(edition);
          doc.classes = [{ ref, ...(subRef ? { subclass: subRef } : {}), levels: level, hp: [] }];
          const id = `class ${uidOf(ref)} / ${subRef ? uidOf(subRef) : '-'} @${level} ${edition}`;
          const picks = record(id, doc);
          if (level === TOP_LEVEL && edition === own) branches(id, doc, picks);
        }
      }
    }
  }

  // Every optional feature, picked in up to two hosts whose progression offers its type, at 20.
  for (const of of reg.byType('optionalfeature')) {
    const types = Array.isArray(of.featureType) ? of.featureType.map(String) : [];
    const uid = uidOf(refOf(of)).toLowerCase();
    let hosts = 0;
    for (const host of [...classes, ...subclasses]) {
      if (hosts >= 2) break;
      const progressions = Array.isArray(host.optionalfeatureProgression)
        ? (host.optionalfeatureProgression as Array<{ featureType?: unknown }>)
        : [];
      for (const prog of progressions) {
        const offered = Array.isArray(prog.featureType) ? prog.featureType.map(String) : [];
        if (!types.some((t) => offered.includes(t))) continue;
        const isSub = host.className !== undefined;
        const cls = isSub
          ? classes.find(
              (c) => str(c.name) === str(host.className) && str(c.source) === str(host.classSource),
            )
          : host;
        if (cls === undefined) continue;
        const clsRef = refOf(cls);
        const subRef = isSub ? refOf(host) : undefined;
        const doc = baseDoc(editionOf(cls));
        doc.classes = [
          { ref: clsRef, ...(subRef ? { subclass: subRef } : {}), levels: 20, hp: [] },
        ];
        const idBase = subRef
          ? `subclass:${uidOf(subRef).toLowerCase()}`
          : `class:${uidOf(clsRef).toLowerCase()}`;
        const promptId = `${idBase}:optfeature:${offered.join('+')}`;
        record(
          `optfeature ${uid} in ${uidOf(clsRef)}${subRef ? ` / ${uidOf(subRef)}` : ''}`,
          doc,
          (d) => {
            d.choices[promptId] = [uid];
          },
        );
        hosts++;
        break;
      }
    }
  }

  for (const f of reg.byType('feat')) {
    const edition = editionOf(f);
    const doc = baseDoc(edition);
    doc.classes = [fighter(edition, 4)];
    doc.feats = [{ ref: refOf(f), instanceId: 'rules-diff' }];
    record(`feat ${uidOf(refOf(f))}`, doc);
  }

  for (const race of reg.byType('race')) {
    const edition = editionOf(race);
    const doc = baseDoc(edition);
    doc.classes = [fighter(edition, 5)];
    doc.race = refOf(race);
    record(`race ${uidOf(refOf(race))}`, doc);
  }
  for (const sr of reg.byType('subrace')) {
    const race = reg.get('race', str(sr.raceName), str(sr.raceSource));
    if (race === undefined) continue;
    const edition = editionOf(race);
    const doc = baseDoc(edition);
    doc.classes = [fighter(edition, 5)];
    doc.race = refOf(race);
    doc.subrace = refOf(sr);
    record(`subrace ${uidOf(refOf(sr))} of ${uidOf(refOf(race))}`, doc);
  }

  for (const bg of reg.byType('background')) {
    const edition = editionOf(bg);
    const doc = baseDoc(edition);
    doc.classes = [fighter(edition, 5)];
    doc.background = refOf(bg);
    record(`background ${uidOf(refOf(bg))}`, doc);
  }

  // Every magic item, equipped and attuned, on a level 5 Fighter of its edition.
  for (const item of reg.byType('item')) {
    if (str(item.rarity) === '' || str(item.rarity) === 'none') continue;
    const edition = editionOf(item);
    const doc = baseDoc(edition);
    doc.classes = [fighter(edition, 5)];
    doc.equipment = [
      { id: 'rules-diff', ref: refOf(item), qty: 1, equipped: true, attuned: true },
    ] as CharacterDoc['equipment'];
    record(`item ${uidOf(refOf(item))}`, doc);
  }

  const MULTI: Array<['2014' | '2024', Array<[string, string, number]>]> = [
    [
      '2024',
      [
        ['Paladin', 'XPHB', 5],
        ['Ranger', 'XPHB', 3],
      ],
    ],
    [
      '2024',
      [
        ['Warlock', 'XPHB', 9],
        ['Druid', 'XPHB', 2],
      ],
    ],
    [
      '2014',
      [
        ['Paladin', 'PHB', 6],
        ['Warlock', 'PHB', 3],
      ],
    ],
    [
      '2014',
      [
        ['Fighter', 'PHB', 17],
        ['Monk', 'PHB', 3],
      ],
    ],
    [
      '2024',
      [
        ['Fighter', 'XPHB', 17],
        ['Monk', 'XPHB', 3],
      ],
    ],
  ];
  for (const [edition, parts] of MULTI) {
    const doc = baseDoc(edition);
    doc.classes = parts.map(([name, source, levels]) => ({
      ref: { name, source },
      levels,
      hp: [],
    }));
    record(`multi ${parts.map((p) => p.join(' ')).join(' / ')} ${edition}`, doc);
  }

  writeFileSync(values.out, JSON.stringify(snap));
  if (coverage !== undefined && values.coverage !== undefined) {
    const report: Record<string, { keys: number; unread: string[] }> = {};
    for (const [name, { all, read }] of coverage) {
      const unread = all.filter((k) => !read.has(k)).sort();
      report[name] = { keys: all.length, unread };
      console.log(`coverage ${name}: ${all.length - unread.length} of ${all.length} keys read`);
    }
    writeFileSync(values.coverage, JSON.stringify(report, null, 1));
  }
  console.log(`built-in rules: ${rules}`);
  console.log(`${Object.keys(snap).length} builds snapshotted to ${values.out}`);
}

const [command, ...rest] = positionals;
if (command === 'snapshot') {
  await snapshot();
} else if (command === 'compare' && rest.length === 2) {
  const changes = compare(rest[0] as string, rest[1] as string);
  if (values['expect-zero'] && changes > 0) process.exit(1);
} else {
  console.error('Usage: rules-diff.ts snapshot --release <file> --out <file> | compare <a> <b>');
  process.exit(1);
}
