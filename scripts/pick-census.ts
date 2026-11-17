/**
 * Proves a pick row moved out of a code table (`CURATED`, `STANDING`) into a
 * built-in rule set asks what the code row asked and gives what it gave, for
 * every answer, before the code row is deleted (rule pack port phase 4;
 * `docs/rule-sets.md`). Rules-diff and the probe answer each prompt with its
 * first options, so an option no build picks, a pick asked only when something
 * is held, and a spell pick (no options to take) would show them nothing.
 *
 * Each code row is caught where real builds call it (every class and subclass
 * at five levels, in its edition, settled, with and without the optional class
 * features), and run again beside its stored row
 * on two fresh collectors holding what the build held so far, three times: as
 * it was, and with some and with all of what an "in place of" row tests held
 * (`HELD`). Each prompt must match (id, kind, label, count, options, their
 * disabled reasons, spell query), as must the effects added before it and the
 * effects each single answer gives: every option, and every spell the query
 * fits. A row of one level the builds never reach (Tiger, asked as an option
 * of Aspect of the Beast) is run at that level alone.
 *
 *   bun --tsconfig-override=tsconfig.app.json scripts/pick-census.ts \
 *     --release <release.json> [--rows <file>] [--only <text>]...
 *
 * `--rows` is a file of rows not yet in the rule sets (`{ "rows": [...] }`, each
 * as a rule set writes it), to check before a move; without it, the shipped
 * rows that still have a code row. It exits 1 on a difference, on a row no
 * build reaches, or when "in place of" prompts, spell answers or a level row
 * were checked nowhere (a census that looked at none of them proves nothing).
 */
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
import { emitRuleRows, type RuleRow, readRuleSet } from '../src/engine/effects/mechanics';
import { spellFitsQuery } from '../src/engine/spellQuery';
import {
  type CharacterDoc,
  type ChoicePrompt,
  type EffectInput,
  type EffectOrigin,
  type EntityRef,
  newCharacterDoc,
  refUid,
} from '../src/engine/types';
import { fetchRelease } from './data-release';

const { values } = parseArgs({
  options: {
    release: { type: 'string' },
    rows: { type: 'string' },
    only: { type: 'string', multiple: true },
  },
});
if (values.release === undefined) {
  console.error(
    'Usage: pick-census.ts --release <release.json> [--rows <file>] [--only <text>]...',
  );
  process.exit(1);
}

type Any = Record<string, unknown>;
type Row = (col: Collector, origin: EffectOrigin, from?: string, level?: number) => void;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const refOf = (e: Entity): EntityRef => ({ name: str(e.name), source: str(e.source) });

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
const ctx = engineContextFor(reg, {});

// ------------------------------------------------------------- the rows

const TABLES = { curated: CURATED, standing: STANDING } as Record<string, Record<string, Row>>;
const rawRows: unknown[] =
  values.rows !== undefined
    ? ((JSON.parse(readFileSync(values.rows, 'utf8')) as { rows: Any[] }).rows ?? []).map(
        ({ pr: _, ...row }) => row,
      )
    : reg
        .byType(RULE_SET_TYPE)
        .flatMap((set) => (Array.isArray(set.rows) ? (set.rows as unknown[]) : []));
const read = readRuleSet({ type: RULE_SET_TYPE, v: 1, name: 'census', rows: rawRows });
if (read.problems.length > 0) {
  console.log(`Rows that do not read:\n  ${read.problems.join('\n  ')}`);
  process.exit(1);
}

/** The code key a row's key stands in for: itself, or without its printing (`|phb`). */
function codeKeyOf(part: string, key: string): string | undefined {
  const table = TABLES[part];
  if (table === undefined) return undefined;
  if (Object.hasOwn(table, key)) return key;
  const at = key.lastIndexOf('|');
  const bare = at > 0 ? key.slice(0, at) : '';
  return bare !== '' && Object.hasOwn(table, bare) ? bare : undefined;
}

/** Each code row, by part and key, and the stored rows standing in for it, printing first. */
interface Moved {
  part: string;
  key: string;
  rows: Array<{ printing?: string; row: RuleRow }>;
}
const moved = new Map<string, Moved>();
/** Row keys with no code row to compare against: listed, never checked. */
const unmapped: string[] = [];
for (const row of read.rows) {
  for (const key of row.keys) {
    const code = codeKeyOf(row.part, key);
    if (code === undefined) {
      unmapped.push(`${row.part} ${key}`);
      continue;
    }
    if (values.only !== undefined && !values.only.some((t) => code.includes(t.toLowerCase()))) {
      continue;
    }
    const id = `${row.part} ${code}`;
    const m = moved.get(id) ?? { part: row.part, key: code, rows: [] };
    moved.set(id, m);
    m.rows.push({ ...(key === code ? {} : { printing: key.slice(code.length + 1) }), row });
  }
}
if (moved.size === 0) {
  console.log('No row stands in for a code row: nothing to check.');
  process.exit(0);
}
// The builds must reach the code rows: a shipped row standing in for one is hidden.
reg.setRuleSets(
  reg.byType(RULE_SET_TYPE).map((set) => {
    const rows = Array.isArray(set.rows)
      ? (set.rows as Array<{ part?: unknown; keys?: unknown }>)
      : [];
    return {
      ...set,
      rows: rows.flatMap((r) => {
        if (!Array.isArray(r.keys)) return [r];
        const keys = r.keys.filter((k) => {
          const code = codeKeyOf(String(r.part), String(k).trim().toLowerCase());
          return code === undefined || !moved.has(`${String(r.part)} ${code}`);
        });
        if (keys.length === r.keys.length) return [r];
        return keys.length === 0 ? [] : [{ ...r, keys }];
      }),
    };
  }),
);

/**
 * The stored row a code row's call reads: the one for the feature's printing,
 * else for its class's or subclass's source, else the plain one, as the call
 * sites find them (`printingKeys`).
 */
function rowFor(m: Moved, origin: EffectOrigin, from: string | undefined): RuleRow | undefined {
  const uidSource = origin.uid.split('|').pop() ?? '';
  return (
    m.rows.find((r) => r.printing !== undefined && r.printing === from)?.row ??
    m.rows.find((r) => r.printing !== undefined && r.printing === uidSource)?.row ??
    m.rows.find((r) => r.printing === undefined)?.row
  );
}

// --------------------------------------------------------- the held states

/** What an "in place of" row tests, held: none, some, all. Added under a background. */
const HELD: Record<string, { skills: string[]; tools: string[]; saves: string[] }> = {
  none: { skills: [], tools: [], saves: [] },
  some: {
    skills: ['Arcana'],
    tools: ["Alchemist's Supplies", "Calligrapher's Supplies"],
    saves: ['wis'],
  },
  all: {
    skills: ['Persuasion', 'Performance', 'Arcana', 'Nature'],
    tools: [
      "Smith's Tools",
      "Alchemist's Supplies",
      "Woodcarver's Tools",
      'Herbalism Kit',
      "Calligrapher's Supplies",
      "Cartographer's Tools",
    ],
    saves: ['int', 'wis'],
  },
};

/** Every spell a spell prompt's query fits, by `name|source`: each is an answer to check. */
const spells = reg.byType('spell');
function spellAnswers(p: ChoicePrompt): string[] {
  if (p.spellQuery === undefined) return [];
  return spells
    .filter((s) => spellFitsQuery(s, p.spellQuery as never))
    .map((s) => `${str(s.name)}|${str(s.source)}`)
    .sort();
}

/** An effect as compared: no origin, a formula as its words, keys in order. */
function shapeOf(e: EffectInput): string {
  const { origin: _, ...rest } = e as EffectInput & { formulas?: Any[] };
  const out: Any = { ...rest };
  const formulas = (rest as { formulas?: Array<{ field: string; formula: { text: string } }> })
    .formulas;
  delete out.formulas;
  for (const f of formulas ?? []) out[f.field] = { f: f.formula.text };
  // The code rows' amount words, as the formulas the stored rows write for them.
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== 'string') continue;
    const mod = /^abilityMod:(\w+)$/.exec(v);
    const min1 = /^abilityModMin1:(\w+)$/.exec(v);
    if (mod !== null && e.kind === 'resource' && k === 'max') {
      // A code pool's `abilityMod:` maximum is at least 1: a formula's needs `min`.
      out[k] = { f: `mod.${mod[1]}` };
      out.min = 1;
    } else if (mod !== null) out[k] = { f: `mod.${mod[1]}` };
    else if (min1 !== null) out[k] = { f: `max(1, mod.${min1[1]})` };
  }
  return JSON.stringify(out, Object.keys(out).sort());
}

const promptOf = (p: ChoicePrompt) =>
  JSON.stringify({
    id: p.id,
    kind: p.kind,
    label: p.label,
    count: p.count,
    options: p.options.map((o) => [o.id, o.label, o.disabled?.reason ?? null]),
    spellQuery: p.spellQuery ?? null,
    allowRepeat: p.allowRepeat ?? null,
  });

/** One side's run: its prompts, the effects added outside them, and each answer's effects. */
interface Run {
  prompts: string[];
  fixed: string[];
  answers: string[];
  warnings: string[];
}

function run(
  col: Collector,
  before: readonly EffectInput[],
  held: (typeof HELD)[string],
  go: (scratch: Collector) => void,
): Run {
  const scratch = new Collector(col.doc, col.ctx);
  for (const e of before) scratch.effects.push(e);
  const ho: EffectOrigin = { type: 'background', uid: 'census|held', label: 'Census' };
  for (const skill of held.skills) scratch.add({ kind: 'skillProf', skill, level: 1, origin: ho });
  for (const name of held.tools) scratch.add({ kind: 'toolProf', name, origin: ho });
  for (const ability of held.saves) {
    scratch.add({ kind: 'saveProf', ability: ability as never, origin: ho });
  }
  const start = scratch.effects.length;
  const asked: Array<{ prompt: ChoicePrompt; apply: (s: string[]) => void; at: number }> = [];
  scratch.choice = (prompt, apply) => asked.push({ prompt, apply, at: scratch.effects.length });
  go(scratch);
  for (const fn of scratch.afterAll.splice(0)) fn();
  const out: Run = { prompts: [], fixed: [], answers: [], warnings: [] };
  out.fixed = scratch.effects.slice(start).map(shapeOf);
  for (const { prompt, apply } of asked) {
    out.prompts.push(promptOf(prompt));
    const answers =
      prompt.kind === 'spell' ? spellAnswers(prompt) : prompt.options.map((o) => o.id);
    for (const id of answers) {
      const at = scratch.effects.length;
      const warned = scratch.warnings.length;
      apply([id]);
      out.answers.push(`${prompt.id} = ${id}: ${scratch.effects.slice(at).map(shapeOf).join(' ')}`);
      out.warnings.push(...scratch.warnings.slice(warned));
      scratch.effects.length = at;
    }
  }
  out.warnings.push(...scratch.warnings);
  return out;
}

/** The class that gives a feature of this origin, and its level, as the call sites pass them. */
function givenBy(doc: CharacterDoc, origin: EffectOrigin): { name?: string; levels?: number } {
  const c = doc.classes.find(
    (x) =>
      refUid(x.ref) === origin.uid ||
      (origin.type === 'subclass' && x.subclass !== undefined && refUid(x.subclass) === origin.uid),
  );
  return c === undefined ? {} : { name: c.ref.name, levels: c.levels };
}

// ---------------------------------------------------------------- compare

const checked = new Map<string, number>();
const differences: string[] = [];
const seen = new Set<string>();
let inPlaceOpened = 0;
let spellAnswered = 0;
let levelRows = 0;
let wrapping = true;

function check(
  m: Moved,
  fn: Row,
  col: Collector,
  origin: EffectOrigin,
  from?: string,
  level?: number,
) {
  const row = rowFor(m, origin, from);
  const id = `${m.part} ${m.key}`;
  if (row === undefined) {
    differences.push(`${id}: no stored row for ${origin.uid} (${from ?? 'its own printing'})`);
    return;
  }
  const by = givenBy(col.doc, origin);
  const before = [...col.effects];
  for (const [state, held] of Object.entries(HELD)) {
    // The class's level too: a count by level reads it, where what came before is the same.
    const at = `${origin.type}:${origin.uid} "${origin.label}" ${from ?? '-'} @${level ?? '-'} class ${by.levels} ${col.doc.rulesVersion}${col.doc.optionalClassFeatures === true ? ' optional' : ''} [${state}]`;
    const sig = `${id} ${at} ${before.length}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    const a = run(col, before, held, (s) => fn(s, origin, from, level));
    const b = run(col, before, held, (s) =>
      emitRuleRows(s, [row], origin, level, by.levels, by.name),
    );
    checked.set(id, (checked.get(id) ?? 0) + 1);
    if (state !== 'none' && a.prompts.some((p) => p.includes(' in place of '))) inPlaceOpened++;
    if (a.prompts.some((p) => p.includes('"kind":"spell"')) && a.answers.length > 0) {
      spellAnswered++;
    }
    if (row.level !== undefined) levelRows++;
    for (const part of ['prompts', 'fixed', 'answers', 'warnings'] as const) {
      const x = a[part].join('\n');
      const y = b[part].join('\n');
      if (x === y) continue;
      const lines = new Set(a[part]);
      const other = new Set(b[part]);
      const onlyCode = a[part].filter((l) => !other.has(l)).slice(0, 3);
      const onlyRow = b[part].filter((l) => !lines.has(l)).slice(0, 3);
      differences.push(
        `${id} ${at} ${part}:\n    code: ${onlyCode.join('\n          ') || '(order)'}\n    row:  ${onlyRow.join('\n          ') || '(order)'}`,
      );
    }
  }
}

for (const m of moved.values()) {
  const table = TABLES[m.part] as Record<string, Row>;
  const fn = table[m.key] as Row;
  table[m.key] = (col, origin, from, level) => {
    if (wrapping) {
      wrapping = false;
      try {
        check(m, fn, col, origin, from, level);
      } finally {
        wrapping = true;
      }
    }
    fn(col, origin, from, level);
  };
}

function baseDoc(edition: '2014' | '2024'): CharacterDoc {
  const doc = newCharacterDoc('pick-census', 'Pick census', DATA_TAG);
  doc.rulesVersion = edition;
  doc.abilities = {
    method: 'manual',
    base: { str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 },
  } as CharacterDoc['abilities'];
  return doc;
}

/** Derive, answering every open prompt with its first usable options, a few rounds deep. */
function settle(doc: CharacterDoc): void {
  wrapping = false;
  let sheet = deriveSheet(doc, ctx);
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const p of sheet.pending) {
      if (doc.choices[p.id] !== undefined || p.options.length === 0) continue;
      const usable = p.options.filter((o) => o.disabled === undefined);
      const pool = usable.length > 0 ? usable : p.options;
      doc.choices[p.id] = pool
        .slice(0, Math.max(1, Math.min(p.count, pool.length)))
        .map((o) => o.id);
      changed = true;
    }
    if (!changed) break;
    sheet = deriveSheet(doc, ctx);
  }
  wrapping = true;
  deriveSheet(doc, ctx);
}

const classes = reg.byType('class');
const subclasses = reg.byType('subclass');
for (const cls of classes) {
  const ref = refOf(cls);
  const subs = subclasses.filter(
    (s) =>
      str(s.className).toLowerCase() === ref.name.toLowerCase() &&
      str(s.classSource).toLowerCase() === ref.source.toLowerCase(),
  );
  for (const sub of [undefined, ...subs]) {
    for (const [level, optional] of [3, 6, 10, 14, 20].flatMap((n) => [
      [n, false] as const,
      [n, true] as const,
    ])) {
      const doc = baseDoc(editionOf(cls));
      // With the optional class features on, which some rows stand in for (Primal Knowledge, 2014).
      if (optional) doc.optionalClassFeatures = true;
      doc.classes = [
        { ref, ...(sub === undefined ? {} : { subclass: refOf(sub) }), levels: level, hp: [] },
      ];
      try {
        settle(doc);
      } catch (err) {
        console.error(`${ref.name} ${sub === undefined ? '' : str(sub.name)} @${level}: ${err}`);
      }
    }
  }
}

// A row of one level no build reaches by its first options: Tiger, an option of Aspect of the Beast.
for (const m of moved.values()) {
  if (checked.has(`${m.part} ${m.key}`)) continue;
  const level = m.rows.find((r) => r.row.level !== undefined)?.row.level;
  if (level === undefined) continue;
  const [label = '', host = ''] = m.key.split('|');
  const sub = subclasses.find((s) => str(s.name).toLowerCase() === host);
  if (sub === undefined) continue;
  const doc = baseDoc(editionOf(sub));
  const cls = classes.find(
    (c) => str(c.name) === str(sub.className) && str(c.source) === str(sub.classSource),
  );
  if (cls === undefined) continue;
  doc.classes = [{ ref: refOf(cls), subclass: refOf(sub), levels: level, hp: [] }];
  const col = new Collector(doc, ctx);
  const origin: EffectOrigin = {
    type: 'subclass',
    uid: refUid(refOf(sub)),
    label: label.replace(/\b\w/g, (c) => c.toUpperCase()),
  };
  (TABLES[m.part] as Record<string, Row>)[m.key]?.(col, origin, undefined, level);
}

// ---------------------------------------------------------------- report

let failed = false;
for (const [id, m] of moved) {
  const n = checked.get(id) ?? 0;
  if (n === 0) {
    failed = true;
    console.log(`not reached: ${id} (${m.rows.length} row${m.rows.length === 1 ? '' : 's'})`);
  }
}
for (const [what, n] of [
  ['"in place of" prompts opened by what is held', inPlaceOpened],
  ['spell prompts with every fitting spell answered', spellAnswered],
  ['runs of a row at one level', levelRows],
] as const) {
  console.log(`${what}: ${n}`);
}
const wants = [...moved.values()].flatMap((m) => m.rows.map((r) => r.row));
const effectsOf = (r: RuleRow) => JSON.stringify(r.effects);
if (wants.some((r) => effectsOf(r).includes('inPlaceOf')) && inPlaceOpened === 0) failed = true;
if (wants.some((r) => effectsOf(r).includes('"ask":"spell"')) && spellAnswered === 0) failed = true;
if (wants.some((r) => r.level !== undefined) && levelRows === 0) failed = true;
console.log(
  `${moved.size} code rows, ${[...checked.values()].reduce((x, y) => x + y, 0)} runs, ${differences.length} differences`,
);
for (const d of differences.slice(0, 60)) console.log(`  ${d}`);
// Rows to be moved are named: one with no code row was written under a wrong key.
// The shipped rows with none moved before: only counted.
if (unmapped.length > 0) {
  console.log(
    `no code row to compare (${unmapped.length})${
      values.rows === undefined ? '' : `: ${unmapped.join(', ')}`
    }`,
  );
}
if (differences.length > 0 || failed) process.exit(1);
