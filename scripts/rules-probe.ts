/**
 * Proves each row moved out of a code table (`TABLES`: `CURATED`, `STANDING`;
 * the spend link tables until 3d and `ROLL_EXTRAS` until 3e were proved the
 * same way) into a
 * built-in rule set adds what the code row added, before the code row is
 * deleted (rule pack port; `docs/rule-sets.md`). Run it while both are in the
 * tree: for every built-in row whose key its part's code tables still have,
 * each build that reads the row is derived twice in one process, once with the
 * code rows (the built-in row's moved keys hidden, its others kept) and once
 * with the built-in row (the code rows hidden), and every sheet field must
 * match, as must the actions and uses
 * the build collected (`collected`), since the sheet drops a price whose pool or
 * slots the build lacks.
 *
 * Its builds go wider than `rules-diff.ts`'s, since a level table, a minimum or
 * a gear condition can differ where that harness does not look. Every class
 * and subclass that reads a moved row (found at level 20, raging, with each
 * later option of its feature picks, and with the table's optional class
 * features on where those read a row the class as printed does not: Tasha's
 * Steady Aim) is built at every level from 1 to 20 in
 * four states: plain and raging at 1 hit point, each with five ability arrays,
 * and in heavy or light gear, each with two (`State`). It is built again as a
 * multiclass where the class's level is not the character's: levels 1 to 17
 * and three of another class, raging, with three arrays. Every feat, optional
 * feature and race that reads one is built across levels in the four states; a
 * feat on a Fighter and again on a Wizard, whose slots a feat's slot price needs.
 *
 * A pick answers as `rules-diff.ts`'s do: a spell pick with the spells its
 * query fits, and with `--answers last` every prompt with its last usable
 * options. A subclass that reads a moved row is built again at every level
 * with what an "in place of" pick names held: under a background giving those
 * skills and tools, and after a first level of Wizard (INT and WIS saves).
 *
 * It sees one entity at a time (a class alone, a feat or race on a bare
 * Fighter or Wizard), so a row that only differs beside another entity's row
 * (two proficiency bonuses on initiative that count once) needs its own test.
 *
 *   bun --tsconfig-override=tsconfig.app.json scripts/rules-probe.ts --release <release.json> [--only <text>]...
 *
 * A full run takes about 35 minutes (about 50 for 3c's 287 spend keys).
 * `--only <text>` probes only the moved keys
 * that hold `<text>`, to check one row (or a mutant of it) in a minute or two;
 * it may be given more than once.
 *
 * It exits 1 when a sheet differs or a moved row is read by no build, which
 * then needs a proof of its own. A build that throws the same way both times
 * compared no sheet, so it counts for no row; the summary says how many.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { withBuiltInRules } from '../src/data5e/builtInRules';
import { DATA_TAG } from '../src/data5e/config';
import type { Entity } from '../src/data5e/copyMod';
import { engineContextFor } from '../src/data5e/engineAdapter';
import { normalizeDataset } from '../src/data5e/normalize';
import { editionOf } from '../src/data5e/rulesVersion';
import { RULE_SET_TYPE } from '../src/engine/castGuidance';
import { CURATED } from '../src/engine/curated/curatedEffects';
import { STANDING } from '../src/engine/curated/standingEffects';
import { deriveSheet } from '../src/engine/derive';
import { Collector } from '../src/engine/effects/base';
import { type RulePart, readRuleSet } from '../src/engine/effects/mechanics';
import { spellFitsQuery } from '../src/engine/spellQuery';
import {
  type CharacterDoc,
  type ChoicePrompt,
  type DerivedSheet,
  type EffectInput,
  type EngineContext,
  type EntityRef,
  newCharacterDoc,
} from '../src/engine/types';
import { fetchRelease } from './data-release';

const { values } = parseArgs({
  options: {
    release: { type: 'string' },
    only: { type: 'string', multiple: true },
    answers: { type: 'string', default: 'first' },
  },
});
if (values.release === undefined || (values.answers !== 'first' && values.answers !== 'last')) {
  console.error(
    'Usage: rules-probe.ts --release <release.json> [--only <text>]... [--answers first|last]',
  );
  process.exit(1);
}
const LAST = values.answers === 'last';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const refOf = (e: Entity): EntityRef => ({ name: str(e.name), source: str(e.source) });
const uidOf = (r: EntityRef) => `${r.name}|${r.source}`;
const hash = (v: unknown) =>
  createHash('sha1')
    .update(JSON.stringify(v) ?? 'undefined')
    .digest('hex')
    .slice(0, 12);

async function releaseFiles(file: string): Promise<Map<string, unknown>> {
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(Object.fromEntries((await fetchRelease(DATA_TAG)).files)));
  }
  return new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>));
}

const reg = normalizeDataset(await releaseFiles(values.release));
await withBuiltInRules(reg);
if (reg.ruleSetsFailed) throw new Error('The built-in rule sets did not load.');
const ctx: EngineContext = engineContextFor(reg, {});

/** What the "in place of" picks name, held: a background no other build takes. */
const PAST: EntityRef = { name: 'Rules Probe Past', source: 'RULESPROBE' };
reg.addAll('background', [
  {
    ...PAST,
    skillProficiencies: [{ persuasion: true, performance: true, arcana: true, nature: true }],
    toolProficiencies: [
      {
        "smith's tools": true,
        "alchemist's supplies": true,
        "woodcarver's tools": true,
        'herbalism kit': true,
        "calligrapher's supplies": true,
        "cartographer's tools": true,
      },
    ],
  } as Entity,
]);

/** Every spell a spell prompt's query fits, by `name|source`, sorted: its answers. */
const spells = reg.byType('spell');
const spellsFor = (p: ChoicePrompt): string[] =>
  p.spellQuery === undefined
    ? []
    : spells
        .filter((s) => spellFitsQuery(s, p.spellQuery as never))
        .map((s) => uidOf(refOf(s)))
        .sort();

// ------------------------------------------------------------ the two configs

type Table = Record<string, unknown>;
/**
 * The code tables each part's rows stand in for, while they have rows. Each
 * table's rows take their own arguments: a function (`CURATED`, `STANDING`) or
 * a list or record (`ROLL_EXTRAS` was). A part whose rows have all moved
 * (`rollAdvantage`, `rollExtra`, `spend`) has none: to probe again, put its
 * table and its call sites' fallback back.
 */
const TABLES: Partial<Record<RulePart, readonly Table[]>> = {
  curated: [CURATED],
  standing: [STANDING],
};
type Row = (...args: unknown[]) => unknown;
/** A moved row by part and key, as `part key`: one key may have a row in two parts. */
const idOf = (part: string, key: string) => `${part} ${key}`;

/**
 * The code key a built-in row's key stands in for, and the part's tables that
 * have it: the key itself, or, for a row of one printing (`roving|ranger|xphb`),
 * the key without its printing, which the code row reads the printing under.
 */
function codeKeyOf(part: RulePart, key: string): { key: string; tables: Table[] } | undefined {
  const tables = TABLES[part] ?? [];
  const holding = (k: string) => tables.filter((t) => Object.hasOwn(t, k));
  if (holding(key).length > 0) return { key, tables: holding(key) };
  const at = key.lastIndexOf('|');
  if (at <= 0) return undefined;
  const bare = key.slice(0, at);
  return holding(bare).length > 0 ? { key: bare, tables: holding(bare) } : undefined;
}

/** Every code row a built-in row stands in for, by part and code key, while a code table has it. */
const shipped = reg.byType(RULE_SET_TYPE);
const moved = new Map<string, { part: RulePart; key: string; tables: Table[] }>();
for (const set of shipped) {
  for (const row of readRuleSet(set).rows) {
    for (const rowKey of row.keys) {
      const code = codeKeyOf(row.part, rowKey);
      if (code === undefined) continue;
      const { key, tables } = code;
      if (values.only === undefined || values.only.some((t) => key.includes(t.toLowerCase()))) {
        moved.set(idOf(row.part, key), { part: row.part, key, tables });
      }
    }
  }
}
if (moved.size === 0) {
  console.log('No built-in row has a code row beside it: nothing to probe.');
  process.exit(0);
}

/** Whether a shipped row's key stands in for a moved code row. */
function standsInForMoved(part: unknown, k: unknown): boolean {
  if (TABLES[String(part) as RulePart] === undefined) return false;
  const code = codeKeyOf(String(part) as RulePart, String(k).trim().toLowerCase());
  return code !== undefined && moved.has(idOf(String(part), code.key));
}

/**
 * The shipped sets without the moved keys: what the tree read before the move.
 * A row keeps its other keys, since a moved key may share a row with one moved
 * earlier, whose code row is gone (rows with one body share their keys).
 */
const before: Entity[] = shipped.map((set) => {
  const rows = Array.isArray(set.rows)
    ? (set.rows as Array<{ part?: unknown; keys?: unknown }>)
    : [];
  return {
    ...set,
    rows: rows.flatMap((r) => {
      if (!Array.isArray(r.keys)) return [r];
      const keys = r.keys.filter((k) => !standsInForMoved(r.part, k));
      if (keys.length === r.keys.length) return [r];
      return keys.length === 0 ? [] : [{ ...r, keys }];
    }),
  };
});

/** Moved rows (`idOf`) a build under the code rows read. */
let reads = new Set<string>();

/** A code row that notes each build reading it: a function row when called, a list when read. */
function noting(id: string, row: unknown): unknown {
  if (typeof row === 'function') {
    return (...args: unknown[]) => {
      reads.add(id);
      return (row as Row)(...args);
    };
  }
  return new Proxy(row as object, {
    get(target, prop, receiver) {
      reads.add(id);
      return Reflect.get(target, prop, receiver);
    },
  });
}

const counted = [...moved].flatMap(([id, { key, tables }]) =>
  tables.map((table) => ({ key, table, row: noting(id, table[key]) })),
);

function codeRowsOn(): void {
  reg.setRuleSets(before);
  for (const { key, table, row } of counted) table[key] = row;
}

function dataRowsOn(): void {
  reg.setRuleSets(shipped);
  for (const { key, tables } of moved.values()) for (const table of tables) delete table[key];
}

/**
 * The collectors of the latest `deriveSheet`, so a build's actions and uses can
 * be compared before the sheet drops a price it cannot pay (`costOnSheet`).
 */
let collectors = new Set<Collector>();
const collectorAdd = Collector.prototype.add;
Collector.prototype.add = function add(this: Collector, e: EffectInput): void {
  collectors.add(this);
  collectorAdd.call(this, e);
};
/** What linking a price can change: the actions and the uses. */
const collected = () =>
  [...collectors].map((c) => c.effects.filter((e) => e.kind === 'action' || e.kind === 'resource'));

// ------------------------------------------------------------------ builds

const ARRAYS: Record<string, Record<string, number>> = {
  '14s': { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
  '8s': { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
  '3s': { str: 3, dex: 3, con: 3, int: 3, wis: 3, cha: 3 },
  '20s': { str: 20, dex: 20, con: 20, int: 20, wis: 20, cha: 20 },
  mixed: { str: 3, dex: 20, con: 10, int: 13, wis: 8, cha: 15 },
};

/**
 * What a build carries beside its scores. `on` is raging at 1 hit point, since
 * an effect that holds only while raging or bloodied is on no sheet otherwise.
 * The two gear states show what holds only with gear, or never in it: `heavy`
 * wears plate and a shield and carries a longsword and a longbow (a ranged
 * bonus, `unless: heavyArmor`); `light` wears leather and carries the longsword
 * alone (a bonus that wants one melee weapon, `unless: armor` against heavy).
 */
type State = 'plain' | 'on' | 'heavy' | 'light';
const GEAR: Record<'heavy' | 'light', string[]> = {
  heavy: ['Plate Armor', 'Shield', 'Longsword', 'Longbow'],
  light: ['Leather Armor', 'Longsword'],
};
/** The gear states look at fewer arrays: what gear gates is rarely a score. */
const ARRAYS_BY_STATE: Record<State, readonly string[]> = {
  plain: Object.keys(ARRAYS),
  on: Object.keys(ARRAYS),
  heavy: ['14s', 'mixed'],
  light: ['14s', 'mixed'],
};
const gearSource = (edition: '2014' | '2024') => (edition === '2024' ? 'XPHB' : 'PHB');
for (const edition of ['2014', '2024'] as const) {
  for (const name of new Set(Object.values(GEAR).flat())) {
    const source = gearSource(edition);
    if ((reg.get('item', name, source) ?? reg.get('baseitem', name, source)) === undefined) {
      throw new Error(`The release has no ${name}|${gearSource(edition)} for the gear builds.`);
    }
  }
}

interface Shape {
  edition: '2014' | '2024';
  classes: Array<{ ref: EntityRef; subclass?: EntityRef; levels: number }>;
  feat?: EntityRef;
  race?: EntityRef;
  subrace?: EntityRef;
  background?: EntityRef;
  choices?: Record<string, string[]>;
  /** The table's optional class features on (`CharacterDoc.optionalClassFeatures`). */
  optional?: boolean;
}

function docOf(shape: Shape, array: string, state: State): CharacterDoc {
  const doc = newCharacterDoc('rules-probe', 'Rules probe', DATA_TAG);
  doc.rulesVersion = shape.edition;
  doc.abilities = { method: 'manual', base: { ...ARRAYS[array] } } as CharacterDoc['abilities'];
  doc.classes = shape.classes.map((c) => ({ ...c, hp: [] }));
  if (shape.feat !== undefined) doc.feats = [{ ref: shape.feat, instanceId: 'rules-probe' }];
  if (shape.race !== undefined) doc.race = shape.race;
  if (shape.subrace !== undefined) doc.subrace = shape.subrace;
  if (shape.background !== undefined) doc.background = shape.background;
  doc.choices = structuredClone(shape.choices ?? {});
  if (shape.optional === true) doc.optionalClassFeatures = true;
  if (state === 'on') {
    doc.play.activeEffects = [{ id: 'rules-probe-rage', name: 'Rage', parts: [] }];
    doc.play.hpInitialized = true;
    doc.play.currentHp = 1;
  }
  if (state === 'heavy' || state === 'light') {
    doc.equipment = GEAR[state].map((name, i) => ({
      id: `rules-probe-${i}`,
      ref: { name, source: gearSource(shape.edition) },
      qty: 1,
      equipped: true,
      attuned: false,
    }));
  }
  return doc;
}

interface FeaturePick {
  id: string;
  count: number;
  options: string[];
}

/**
 * As `rules-diff.ts` does: answer every open prompt with its first usable
 * options (its last, with `--answers last`), a spell pick with fitting spells.
 */
function settle(doc: CharacterDoc, picks: FeaturePick[] = []): DerivedSheet {
  collectors = new Set();
  let sheet = deriveSheet(doc, ctx);
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const p of sheet.pending) {
      if (doc.choices[p.id] !== undefined) continue;
      const usable = p.options.filter((o) => o.disabled === undefined);
      const pool =
        p.options.length > 0
          ? (usable.length > 0 ? usable : p.options).map((o) => o.id)
          : spellsFor(p);
      if (pool.length === 0) continue;
      const n = Math.max(1, Math.min(p.count, pool.length));
      if (p.kind === 'feature' && usable.length > n) {
        picks.push({ id: p.id, count: n, options: usable.map((o) => o.id) });
      }
      doc.choices[p.id] = LAST ? pool.slice(-n) : pool.slice(0, n);
      changed = true;
    }
    if (!changed) break;
    collectors = new Set();
    sheet = deriveSheet(doc, ctx);
  }
  return sheet;
}

function fields(doc: CharacterDoc): Record<string, string> {
  let sheet: DerivedSheet;
  try {
    sheet = settle(doc);
  } catch (err) {
    return { throws: hash(String(err)) };
  }
  const out: Record<string, string> = { choices: '' };
  for (const [k, v] of Object.entries(sheet)) out[k] = hash(v);
  out.choices = hash(doc.choices);
  out.collected = hash(collected());
  return out;
}

/** Moved keys the shape reads under the code rows, and the feature picks it answered. */
function discover(
  shape: Shape,
  array = '14s',
  state: State = 'on',
): { read: Set<string>; picks: FeaturePick[] } {
  codeRowsOn();
  reads = new Set();
  const picks: FeaturePick[] = [];
  try {
    settle(docOf(shape, array, state), picks);
  } catch {
    // A build that throws reads nothing; the compare reports it if the move matters.
  }
  return { read: reads, picks };
}

/** Each later usable option of each feature pick, as a shape of its own. */
function branches(shape: Shape, picks: readonly FeaturePick[]): Shape[] {
  return picks.flatMap((pick) =>
    pick.options.slice(pick.count).map((option) => ({
      ...shape,
      choices: {
        ...shape.choices,
        [pick.id]: [option, ...pick.options.filter((o) => o !== option).slice(0, pick.count - 1)],
      },
    })),
  );
}

// ---------------------------------------------------------------- compare

const proved = new Map<string, number>();
const differences: string[] = [];
/**
 * Builds that differed, by the moved rows (`idOf`) they read. A build that reads
 * several counts for each, so a row's count can include another row's change.
 */
const differing = new Map<string, number>();
/** Builds that threw the same way both times: they compared no sheet, so prove nothing. */
const threw: string[] = [];
let compared = 0;

/** Build a shape both ways; count it for the moved keys the code rows read. */
function compare(id: string, shape: Shape, array: string, state: State): void {
  codeRowsOn();
  reads = new Set();
  const a = fields(docOf(shape, array, state));
  const read = reads;
  if (read.size === 0) return;
  dataRowsOn();
  const b = fields(docOf(shape, array, state));
  compared++;
  const at = `${id} [${array}${state === 'plain' ? '' : ` ${state}`}]`;
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]);
  if (changed.length > 0) {
    differences.push(`${at}: ${changed.join(', ')} (reads ${[...read].join('; ')})`);
    for (const k of read) differing.set(k, (differing.get(k) ?? 0) + 1);
  } else if (a.throws !== undefined) {
    threw.push(`${at} (reads ${[...read].join('; ')})`);
    return;
  }
  for (const k of read) proved.set(k, (proved.get(k) ?? 0) + 1);
}

/** A shape at each of `levels`, in every state, with that state's ability arrays. */
function sweep(id: string, levels: readonly number[], at: (n: number) => Shape): void {
  for (const n of levels) {
    for (const [state, arrays] of Object.entries(ARRAYS_BY_STATE) as Array<[State, string[]]>) {
      for (const array of arrays) compare(`${id} @${n}`, at(n), array, state);
    }
  }
}

const ALL_LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const fighterOf = (edition: '2014' | '2024'): EntityRef => ({
  name: 'Fighter',
  source: edition === '2024' ? 'XPHB' : 'PHB',
});
const wizardOf = (edition: '2014' | '2024'): EntityRef => ({
  name: 'Wizard',
  source: edition === '2024' ? 'XPHB' : 'PHB',
});

const classes = reg.byType('class');
const subclasses = reg.byType('subclass');

// Classes and subclasses: found at 20, then every level, and as a multiclass.
for (const cls of classes) {
  const ref = refOf(cls);
  const edition = editionOf(cls);
  const subs = subclasses.filter(
    (s) =>
      str(s.className).toLowerCase() === ref.name.toLowerCase() &&
      str(s.classSource).toLowerCase() === ref.source.toLowerCase(),
  );
  for (const sub of [undefined, ...subs]) {
    const subRef = sub === undefined ? undefined : refOf(sub);
    const at =
      (shape: Shape) =>
      (n: number): Shape => ({
        ...shape,
        classes: [{ ref, ...(subRef ? { subclass: subRef } : {}), levels: n }],
      });
    const base: Shape = {
      edition,
      classes: [{ ref, ...(subRef ? { subclass: subRef } : {}), levels: 20 }],
    };
    const found = discover(base);
    const printed = new Set(found.read);
    const shapes = [base, ...branches(base, found.picks)].filter((s) => {
      const read = s === base ? found.read : discover(s).read;
      for (const k of read) printed.add(k);
      return read.size > 0;
    });
    // With the optional class features on, each a pick: kept only where one reads
    // a row the class as printed never does, so the sweep does not run twice.
    const optional: Shape = { ...base, optional: true };
    const withOptional = discover(optional);
    for (const s of [optional, ...branches(optional, withOptional.picks)]) {
      const read = s === optional ? withOptional.read : discover(s).read;
      if ([...read].some((k) => !printed.has(k))) shapes.push(s);
    }
    const id = `class ${uidOf(ref)} / ${subRef ? uidOf(subRef) : '-'}`;
    const labelOf = (shape: Shape) =>
      `${id}${shape.optional === true ? ' [optional]' : ''}${
        shape.choices !== undefined ? ` | ${JSON.stringify(shape.choices)}` : ''
      }`;
    for (const shape of shapes) sweep(labelOf(shape), ALL_LEVELS, at(shape));
    // What an "in place of" pick names, held, where the subclass reads a row.
    if (subRef !== undefined && shapes.length > 0) {
      const held: Shape = { ...base, background: PAST };
      sweep(`${id} [held]`, ALL_LEVELS, at(held));
      sweep(`${id} after Wizard 1`, ALL_LEVELS.slice(0, 19), (n) => ({
        ...base,
        classes: [
          { ref: wizardOf(edition), levels: 1 },
          { ref, subclass: subRef, levels: n },
        ],
      }));
    }
    // The class's level is not the character's: three levels of another class after
    // it, in the first shape that reads a row (the class as printed, else a pick)
    // and in each kept for the optional class features, whose rows no other reads.
    const multiclassed = shapes.filter((s, i) => i === 0 || s.optional === true);
    const other = ref.name === 'Fighter' ? wizardOf(edition) : fighterOf(edition);
    for (const from of multiclassed) {
      for (let n = 1; n <= 17; n++) {
        const shape: Shape = {
          ...from,
          classes: [
            { ref, ...(subRef ? { subclass: subRef } : {}), levels: n },
            { ref: other, levels: 3 },
          ],
        };
        for (const array of ['14s', '8s', 'mixed'])
          compare(`${labelOf(from)} @${n} + ${other.name} 3`, shape, array, 'on');
      }
    }
  }
}

// Optional features: in up to two hosts whose progression offers their type.
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
      const idBase = subRef
        ? `subclass:${uidOf(subRef).toLowerCase()}`
        : `class:${uidOf(clsRef).toLowerCase()}`;
      const choices = { [`${idBase}:optfeature:${offered.join('+')}`]: [uid] };
      const at = (n: number): Shape => ({
        edition: editionOf(cls),
        classes: [{ ref: clsRef, ...(subRef ? { subclass: subRef } : {}), levels: n }],
        choices,
      });
      hosts++;
      if (discover(at(20)).read.size > 0) {
        sweep(
          `optfeature ${uid} in ${uidOf(clsRef)}${subRef ? ` / ${uidOf(subRef)}` : ''}`,
          ALL_LEVELS,
          at,
        );
      }
      break;
    }
  }
}

// Feats on a Fighter of their edition and on a Wizard, whose slots a slot price
// needs; races on a Fighter.
const FEAT_LEVELS = [1, 2, 3, 4, 5, 8, 11, 12, 16, 17, 20];
for (const f of reg.byType('feat')) {
  const edition = editionOf(f);
  const at = (n: number): Shape => ({
    edition,
    classes: [{ ref: fighterOf(edition), levels: n }],
    feat: refOf(f),
  });
  if (discover(at(4)).read.size === 0) continue;
  sweep(`feat ${uidOf(refOf(f))}`, FEAT_LEVELS, at);
  sweep(`feat ${uidOf(refOf(f))} on a Wizard`, FEAT_LEVELS, (n) => ({
    edition,
    classes: [{ ref: wizardOf(edition), levels: n }],
    feat: refOf(f),
  }));
  const multi = (n: number): Shape => ({
    edition,
    classes: [
      { ref: fighterOf(edition), levels: n },
      { ref: wizardOf(edition), levels: 3 },
    ],
    feat: refOf(f),
  });
  sweep(`feat ${uidOf(refOf(f))} + Wizard 3`, [1, 4, 9, 17], multi);
}
const RACE_LEVELS = [1, 3, 5, 11, 17, 20];
for (const race of reg.byType('race')) {
  const edition = editionOf(race);
  const at = (n: number): Shape => ({
    edition,
    classes: [{ ref: fighterOf(edition), levels: n }],
    race: refOf(race),
  });
  if (discover(at(5)).read.size === 0) continue;
  sweep(`race ${uidOf(refOf(race))}`, RACE_LEVELS, at);
}
for (const sr of reg.byType('subrace')) {
  const race = reg.get('race', str(sr.raceName), str(sr.raceSource));
  if (race === undefined) continue;
  const edition = editionOf(race);
  const at = (n: number): Shape => ({
    edition,
    classes: [{ ref: fighterOf(edition), levels: n }],
    race: refOf(race),
    subrace: refOf(sr),
  });
  if (discover(at(5)).read.size === 0) continue;
  sweep(`subrace ${uidOf(refOf(sr))} of ${uidOf(refOf(race))}`, RACE_LEVELS, at);
}

codeRowsOn();
const unproved = [...moved.keys()].filter((k) => !proved.has(k)).sort();
console.log(
  `moved rows: ${moved.size}; builds compared: ${compared}; differences: ${differences.length}`,
);
for (const d of differences.slice(0, 40)) console.log(`  differs: ${d}`);
for (const [k, n] of [...differing].sort()) {
  console.log(`  differed, of the builds that read it: ${k} ${n} of ${proved.get(k) ?? n}`);
}
console.log(`threw both times, so counted for nothing: ${threw.length}`);
for (const t of threw.slice(0, 10)) console.log(`  threw: ${t}`);
const fewest = [...proved].sort((x, y) => x[1] - y[1]).slice(0, 10);
console.log(`fewest builds: ${fewest.map(([k, n]) => `${k} ${n}`).join('; ')}`);
console.log(
  `read by no build: ${unproved.length}${unproved.length > 0 ? `: ${unproved.join('; ')}` : ''}`,
);
if (differences.length > 0 || unproved.length > 0) process.exit(1);
