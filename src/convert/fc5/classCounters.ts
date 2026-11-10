/**
 * A Fight Club 5e class's `<counter>`s into the uses the sheet counts.
 *
 * Fight Club gives a class's limited uses as counters in its level blocks:
 * `<counter><name>Rage</name><value>3</value><reset>L</reset></counter>` at
 * each level the number changes, with `<subclass>` naming the subclass one is
 * for. Each becomes a `resource` effect in the class's or subclass's own
 * `castGuidance`, as the Workshop's pools are: a level table of its numbers
 * (`{ "byLevel": { "1": 2, "3": 3 } }`), or a formula where Fight Club writes
 * an ability modifier (`%6`, the Charisma modifier) or the proficiency bonus
 * (`%0`). `L` comes back on a long rest and `S` on a short one; a counter that
 * turns from `L` to `S` (the bard's Bardic Inspiration at 5th level) comes
 * back whole on a short rest from that level.
 *
 * A counter with no rest (`Spells Known`) is a number the class tracks, not
 * uses: the class's spells known are read from it, and any other is reported.
 * So is one whose name says it counts (`Eldritch Invocations Known`), and one
 * whose number the converter cannot read.
 */
import { CAST_GUIDANCE_LIMITS, CAST_GUIDANCE_VERSION } from '../../engine/castGuidance';
import { childText, type XmlElement } from '../xml';

/** The highest level a class has. */
const MAX_LEVEL = 20;

/** One `<counter>`: its number and rest at one level. */
interface CounterRow {
  level: number;
  value: string;
  /** `L`, `S`, or what else the file writes; undefined for none. */
  reset?: string;
}

/** A counter of one name, every level the file gives it at. */
export interface FileCounter {
  name: string;
  rows: CounterRow[];
}

/** `Level 18: Disjunction Strike`: a 2024 file's level, ahead of a counter's name. */
const LEVEL_PREFIX = /^Level \d{1,2}: /i;

/** A `<counter>` at a level: the subclass it names (as written, '' for none), its name and row. */
export function readCounter(
  el: XmlElement,
  level: number,
): { of: string; name: string; row: CounterRow } | undefined {
  const name = (childText(el, 'name') ?? '').replace(/\s+/g, ' ').trim().replace(LEVEL_PREFIX, '');
  if (name === '') return undefined;
  const reset = childText(el, 'reset')?.trim();
  return {
    of: childText(el, 'subclass')?.trim() ?? '',
    name,
    row: {
      level,
      value: (childText(el, 'value') ?? '').trim(),
      ...(reset !== undefined && reset !== '' && { reset: reset.toUpperCase() }),
    },
  };
}

/** Add a row to a counter of its name in a list keyed by lowercased name. */
export function addCounterRow(into: Map<string, FileCounter>, name: string, row: CounterRow): void {
  const key = name.toLowerCase();
  const counter = into.get(key) ?? { name, rows: [] };
  counter.rows.push(row);
  into.set(key, counter);
}

/** Names Fight Club gives a number it tracks, not uses: `Infusions Known`, `Dice Size`, `Ritual Level`. */
const COUNTS = /\b(?:known|prepared)\b|\bsize$|\blevel$/i;
const SPELLS_KNOWN = /^spells known$/i;
/** A character outside printable ASCII (`я`, `é`), which a slug drops. */
const OUTSIDE_ASCII = /[^ -~]/;

/**
 * A pool's key: its name as the prose scan keys a feature, else, for a name
 * with letters a slug drops (`Ярость 2`), one of its own from the whole name,
 * so two such pools never share a key and hide each other.
 */
function poolKey(name: string): string {
  const s = slug(name);
  if (s !== '' && !OUTSIDE_ASCII.test(name)) return s;
  let hash = 0x811c9dc5;
  for (const ch of name) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `uses-${hash.toString(36)}`;
}

/** The counter the class's spells known are read from, which no option list counts. */
export function isSpellsKnown(counter: FileCounter): boolean {
  return SPELLS_KNOWN.test(counter.name);
}

/** `%0` is the proficiency bonus; `%1` to `%6`, Strength to Charisma's modifier. */
const CODES = ['prof', 'mod.str', 'mod.dex', 'mod.con', 'mod.int', 'mod.wis', 'mod.cha'];

/** A counter's number: digits, or up to four terms of digits and `%N` added. */
const NUMBER = /^\d{1,4}$/;
const TERMS = /^(?:%\d|\d{1,3})(?: ?\+ ?(?:%\d|\d{1,3})){0,3}$/;

/** A row's number as a formula, or undefined for one the converter cannot read. */
function formulaOf(value: string): string | undefined {
  if (!TERMS.test(value)) return undefined;
  const terms: string[] = [];
  for (const raw of value.split('+')) {
    const t = raw.trim();
    if (!t.startsWith('%')) {
      terms.push(String(Number(t)));
      continue;
    }
    const name = CODES[Number(t.slice(1))];
    if (name === undefined) return undefined;
    terms.push(name);
  }
  // An ability modifier alone gives at least one use, as the rules say of each.
  const sum = terms.join(' + ');
  return terms.length === 1 && terms[0]?.startsWith('mod.') === true ? `max(1, ${sum})` : sum;
}

/** A key like the prose scan's, so a feature's uses and its counter's share one. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}

/** A counter's number at each level from 1 to 20 (undefined below its first), as written. */
function valuesByLevel(rows: readonly CounterRow[]): (string | undefined)[] {
  const out: (string | undefined)[] = Array.from({ length: MAX_LEVEL }, () => undefined);
  // In level order, and the file's last of one level.
  const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.level - b.r.level || a.i - b.i);
  for (const { r } of sorted) {
    for (let lv = r.level; lv <= MAX_LEVEL; lv++) out[lv - 1] = r.value;
  }
  return out;
}

/**
 * Uses by level from a level on (`from`, 1 for all): a level table when every
 * number is plain, else a formula that picks by class level. Undefined when a
 * number cannot be read or the formula would be too long.
 */
function amountFrom(
  values: readonly (string | undefined)[],
  from: number,
): number | { byLevel: Record<string, number> } | { f: string } | undefined {
  const at = values.map((v, i) => (i + 1 < from ? undefined : v));
  if (at.every((v) => v === undefined || NUMBER.test(v))) {
    const byLevel: Record<string, number> = {};
    let last: number | undefined;
    at.forEach((v, i) => {
      const n = v === undefined ? 0 : Number(v);
      if (n !== (last ?? 0)) byLevel[String(i + 1)] = n;
      last = n;
    });
    return Object.keys(byLevel).length > 0 ? { byLevel } : undefined;
  }
  // Each run of one number, as a formula, from the level it starts.
  const runs: { level: number; f: string }[] = [];
  for (let i = 0; i < at.length; i++) {
    const v = at[i];
    const f = v === undefined ? '0' : NUMBER.test(v) ? String(Number(v)) : formulaOf(v);
    if (f === undefined) return undefined;
    if (runs.at(-1)?.f !== f) runs.push({ level: i + 1, f });
  }
  let f = runs[0]?.f ?? '0';
  for (const run of runs.slice(1)) f = `classLevel >= ${run.level} ? ${run.f} : ${f}`;
  return f.length > CAST_GUIDANCE_LIMITS.formulaLength ? undefined : { f };
}

/** What a class's or subclass's counters become. */
export interface CounterPools {
  /** Its `castGuidance`, when it has uses to count. */
  castGuidance?: { v: number; effects: Record<string, unknown>[] };
  /** The names of its pools, lowercased, for the feature of each name to leave its own out. */
  pools: Set<string>;
  /** Its spells known at each level, from a `Spells Known` counter. */
  spellsKnown?: number[];
  reasons: string[];
}

/** Up to four names, and how many more. */
function listed(names: readonly string[]): string {
  const more = names.length > 4 ? `, and ${names.length - 4} more` : '';
  return `${names.slice(0, 4).join(', ')}${more}`;
}

/** A class's or subclass's counters as pools. */
export function counterPools(counters: Iterable<FileCounter>): CounterPools {
  const effects: Record<string, unknown>[] = [];
  const pools = new Set<string>();
  const counts: string[] = [];
  const unread: string[] = [];
  const restChanges: string[] = [];
  const unknownRest: string[] = [];
  let spellsKnown: number[] | undefined;
  for (const c of counters) {
    const resets = [...c.rows]
      .sort((a, b) => a.level - b.level)
      .flatMap((r) => (r.reset === undefined ? [] : [{ level: r.level, reset: r.reset }]));
    const values = valuesByLevel(c.rows);
    if (resets.length === 0 && SPELLS_KNOWN.test(c.name)) {
      if (values.every((v) => v === undefined || NUMBER.test(v))) {
        spellsKnown = values.map((v) => (v === undefined ? 0 : Number(v)));
      } else unread.push(c.name);
      continue;
    }
    if (resets.length === 0 || COUNTS.test(c.name)) {
      counts.push(c.name);
      continue;
    }
    if (resets.some((r) => r.reset !== 'L' && r.reset !== 'S')) {
      unknownRest.push(c.name);
      continue;
    }
    const max = amountFrom(values, 1);
    if (max === undefined || c.name.length > CAST_GUIDANCE_LIMITS.labelLength) {
      unread.push(c.name);
      continue;
    }
    // Long, then short from a level on: back whole on a short rest from there.
    const first = resets[0]?.reset;
    const turn = resets.findIndex((r) => r.reset !== first);
    const after = turn < 0 ? [] : resets.slice(turn);
    const shortFrom =
      first === 'L' && turn >= 0 && after.every((r) => r.reset === 'S')
        ? resets[turn]?.level
        : undefined;
    const regainOnShort = shortFrom === undefined ? undefined : amountFrom(values, shortFrom);
    let reset: 'long' | 'short' = first === 'S' ? 'short' : 'long';
    if (turn >= 0 && regainOnShort === undefined) {
      // It changes some other way: the rest at its highest level.
      reset = resets.at(-1)?.reset === 'S' ? 'short' : 'long';
      restChanges.push(c.name);
    }
    if (effects.length >= CAST_GUIDANCE_LIMITS.effectsPerEntry) {
      unread.push(c.name);
      continue;
    }
    pools.add(c.name.toLowerCase());
    effects.push({
      kind: 'resource',
      key: poolKey(c.name),
      label: c.name,
      max,
      reset,
      ...(regainOnShort !== undefined && { regainOnShort }),
    });
  }
  const reasons: string[] = [];
  if (counts.length > 0) {
    reasons.push(`its counters that count rather than spend (${listed(counts)}) are not converted`);
  }
  if (unread.length > 0) {
    reasons.push(
      `its counters whose numbers the converter cannot read (${listed(unread)}) are not converted`,
    );
  }
  if (unknownRest.length > 0) {
    reasons.push(
      `its counters that come back on a rest the converter does not read (${listed(unknownRest)}) are not converted`,
    );
  }
  if (restChanges.length > 0) {
    reasons.push(
      `its counters whose rest changes by level (${listed(restChanges)}) come back on the rest of their highest level`,
    );
  }
  return {
    ...(effects.length > 0 && { castGuidance: { v: CAST_GUIDANCE_VERSION, effects } }),
    pools,
    ...(spellsKnown !== undefined && { spellsKnown }),
    reasons,
  };
}

/**
 * Leave out the uses a feature's own text would give (the prose scan's, or a
 * curated row's) when a pool of its name counts them, so they are not counted
 * twice.
 */
export function dropOwnUses(feature: Record<string, unknown>): void {
  feature.castGuidance = { v: CAST_GUIDANCE_VERSION, drop: [{ kind: 'resource' }] };
}
