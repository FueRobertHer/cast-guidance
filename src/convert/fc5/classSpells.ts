/**
 * The spells a class's, a subclass's or a class option's features give, as
 * 5etools `additionalSpells`. Fight Club has no field for them, so the text
 * says them, in two ways this reads:
 *
 * - A table of spells by level, on a subclass or an option: a domain's,
 *   oath's or circle's spells, always prepared from the class level of each
 *   row (`1st`, a dash, `bless, cure wounds`, or a `Cleric Level | Prepared
 *   Spells` table); a ranger's or a sorcerer's, learned at those levels; a patron's
 *   expanded list, by spell level ("The following spells are added to the
 *   warlock spell list for you"). Which it is comes from the feature's words,
 *   not the table's header, which the files get wrong (The Undead's spell
 *   levels under `Warlock Level`). Two or more captioned tables in one
 *   feature are a choice, a named block each (the 2024 Circle of the Land's
 *   lands); one missing a table it cannot read, or a second choice, stays as
 *   text. A cantrip row (`Cantrip: light`) goes at `s0` of an expanded list.
 *   A caster's own table of counts and slots is no table of spells.
 * - A sentence naming a spell the feature always gives: "You always have
 *   the Hunter's Mark spell prepared", "you learn the light cantrip".
 *
 * The rest (a pick, a cast that spends ki or a slot, a table this cannot
 * place) stays in the text, which every feature keeps; the report says when
 * a table of spells was not read. The text is untrusted: every pattern here
 * is linear, with bounded runs.
 */
import type { SpellBlock, SpellIndex } from './spellGrants';
import type { Entry } from './text';

/** A feature as the class lists it: the level it is gained at, and its entries. */
export interface FeatureText {
  level: number;
  entries: readonly Entry[];
}

/** Where a table's spells go: always prepared and learned by class level, expanded by spell level. */
type Section = 'prepared' | 'known' | 'expanded';

/** One table of spells by level, from a table entry or a run of lines. */
interface SpellTable {
  caption?: string;
  /** The first column's header, when the table has one: `Cleric Level`, `Spell Level`. */
  head?: string;
  rows: { level: string; cell: string }[];
}

const MAX_TEXT = 6000;
const MAX_ROWS = 40;
const MAX_WORDS = 7;

/** A dash between a level and its spells: em and en dashes, or a spaced hyphen. */
const DASHES = String.fromCharCode(0x2014, 0x2013);

/** `1st`, a dash, `bless, cure wounds`; `3rd Level: aid`; `Cantrip - light`. */
const LINE = new RegExp(
  `^(cantrips?|\\d{1,2}(?:st|nd|rd|th))(?: level)? ?(?:[${DASHES}:]| - ) ?(.{1,300})$`,
  'i',
);

/** A table of spells by level is headed by a level: `Cleric Level`, `Level`, `Spell Level`. */
const LEVEL_HEAD = /^(?:[a-z' ]{1,30} )?levels?$/i;
const SPELL_HEAD = /\bspells?\b/i;
const SLOT_HEAD = /\bslots?\b/i;
/** A lead-in that is a table's cantrip row. */
const CANTRIP_ROW = /^cantrips?$/i;

/** The words, or a table's caption, that say its spells are always prepared: `Mental Domain Spells`. */
const PREPARED =
  /\b(?:you (?:thereafter )?(?:always )?have\b[^.]{0,80}?\bprepared|always prepared|spells prepared|prepared spells|(?:domain|oath|circle)(?: of [a-z' ]{1,30})? spells)\b/;
/** The words that say a table widens a class's list. */
const EXPANDED =
  /\b(?:added to (?:the|your) [a-z]{1,20} spell list|expanded (?:spell )?list|expands? (?:the|your) [a-z]{1,20} spell list)\b/;
/** The words that say a table's spells are learned. */
const LEARNED = /\byou (?:(?:also|thereafter) )?(?:learn|know|gain)\b[^.]{0,80}?\bspells?\b/;

/** Words a spell's name does not start with: what a sentence names when it names none. */
const NOT_FIRST = new Set([
  'a',
  'additional',
  'all',
  'an',
  'any',
  'bonus',
  'both',
  'certain',
  'chosen',
  'each',
  'essential',
  'extra',
  'following',
  'its',
  'listed',
  'new',
  // `even when you have no spells prepared`.
  'no',
  'one',
  'other',
  'same',
  'selected',
  // `the special cantrip elemental surge`: the name follows.
  'special',
  'that',
  'the',
  'these',
  'this',
  'those',
  'three',
  'two',
  'your',
]);

/** Words no spell's name holds: a line of prose, not a name (`3rd: you gain proficiency`). */
const NOT_IN = new Set([
  'can',
  // `you gain the ability to cast the light cantrip`.
  'cast',
  'cantrip',
  'cantrips',
  'feature',
  'gain',
  'level',
  'spell',
  'spells',
  'you',
  'your',
]);

/** A subclass's word alone, not a spell: `you always have the domain spells prepared`. */
const GROUP_WORDS = new Set(['circle', 'domain', 'oath', 'patron']);

/**
 * `You always have the Hunter's Mark spell prepared`, `you therefore always
 * have the power word heal and power word kill spells prepared`, a star map's
 * `You have the guiding bolt spell prepared`.
 */
const ALWAYS_PREPARED =
  /\byou (?:(?:also|thereafter|therefore|now|then) )?(always )?have (?:the )?([a-z][a-z' /,-]{0,100}?) (spells?) prepared\b/g;
/** `you learn the light cantrip`, `you know the sacred flame and light cantrips`. */
const LEARNS_CANTRIP =
  /\byou (?:(?:also|thereafter|therefore|now|then) )?(?:learn|know|gain) the ([a-z][a-z' /,-]{0,80}?) (cantrips?)\b/g;
/** A sentence about having a spell, not one giving it: `If you have the hex spell prepared`. */
const CONDITION = /^(?:if|when|whenever|unless|while|once)\b/;
/** The same said just before the words: `you can cast it if you have the hex spell prepared`. */
const CONDITION_BEFORE = /\b(?:if|when|whenever|unless|while|once|as long as|so long as) ?$/;

/** `{@spell Hex|FCBook}` as its text, and typographic quotes as plain ones. */
function untag(text: string): string {
  return text
    .replace(/\{@\w{1,20} ([^{}|]{0,200})(?:\|[^{}]{0,200})?\}/g, '$1')
    .replace(/[‘’]/g, "'");
}

/**
 * A note on a spell, not its name: `summon aberration (a spell in chapter 3)`.
 * The spaces before it are bounded, as an unbounded run is rescanned at
 * every space.
 */
const NOTE = /\s{0,8}\([^()]{0,80}\)/g;

/** A cell's part as a spell's name, lowercased, or undefined when it cannot be one. */
function spellName(raw: string): string | undefined {
  const name = untag(raw)
    .toLowerCase()
    .replace(NOTE, '')
    .replace(/[*†‡]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:and|or) /, '')
    .replace(/\.$/, '');
  // Letters of any script: `bakuryō's blessèd blizzard`.
  if (name === '' || name.length > 60 || !/^\p{L}[\p{L}' /-]*\p{L}$/u.test(name)) return undefined;
  const words = name.split(' ');
  if (words.length > MAX_WORDS || NOT_FIRST.has(words[0] ?? '')) return undefined;
  if (words.length === 1 && GROUP_WORDS.has(name)) return undefined;
  return words.some((w) => NOT_IN.has(w)) ? undefined : name;
}

/** A row's level as a number: `3rd` and `3` are 3, a cantrip row 0. */
function rowLevel(raw: string): number | undefined {
  const t = raw.trim().toLowerCase();
  if (/^cantrips?$/.test(t)) return 0;
  const m = /^(\d{1,2})(?:st|nd|rd|th)?(?: level)?$/.exec(t);
  return m === null ? undefined : Number(m[1]);
}

/** A cell that only counts (`4`, `-`): a spellcasting table's, not a table of spells. */
const COUNT_CELL = new RegExp(`^[\\d\\s+${DASHES}-]*$`);

/** The feature's tables of spells by level, and its words around them, lowercased. */
function readEntries(entries: readonly Entry[]): {
  tables: SpellTable[];
  words: string[];
  /** Tables of spells this cannot read: more than one column of spells. */
  odd: number;
} {
  const tables: SpellTable[] = [];
  const words: string[] = [];
  let odd = 0;
  let size = 0;
  let run: SpellTable | undefined;
  let lastLine = '';
  const walk = (e: unknown): void => {
    if (typeof e === 'string') {
      const line = e.trim();
      const m = LINE.exec(line);
      if (m !== null) {
        if (run === undefined) {
          run = { rows: [] };
          if (lastLine.endsWith(':') && lastLine.length < 60) run.caption = lastLine.slice(0, -1);
          tables.push(run);
        }
        if (run.rows.length < MAX_ROWS) run.rows.push({ level: m[1] ?? '', cell: m[2] ?? '' });
        return;
      }
      run = undefined;
      lastLine = line;
      // Prose past the first few thousand characters says nothing more of
      // the tables; lines and tables after it are still read.
      if (line !== '' && size <= MAX_TEXT) {
        size += line.length;
        words.push(untag(line).toLowerCase());
      }
      return;
    }
    if (Array.isArray(e)) {
      e.forEach(walk);
      return;
    }
    if (e === null || typeof e !== 'object') return;
    const o = e as Record<string, unknown>;
    // `Cantrip: light`, which the text reader takes for a lead-in; not
    // `Cantrips. You learn two cantrips`, which is prose.
    const lead = typeof o.name === 'string' ? o.name.trim() : '';
    const inner = Array.isArray(o.entries) ? o.entries : [];
    const cell = inner.length === 1 && typeof inner[0] === 'string' ? inner[0] : undefined;
    if (
      o.type === 'entries' &&
      CANTRIP_ROW.test(lead) &&
      cell !== undefined &&
      cell.length <= 300 &&
      cell.split(',').every((part) => spellName(part) !== undefined)
    ) {
      walk(`${lead}: ${cell}`);
      return;
    }
    run = undefined;
    if (o.type === 'table') {
      const labels = Array.isArray(o.colLabels) ? o.colLabels.map(String) : [];
      const rows = (Array.isArray(o.rows) ? o.rows : []).filter(Array.isArray) as unknown[][];
      const head = labels[0] ?? '';
      // Columns of spells, not a caster's counts (`Spell Slots`, `Spells Known` of numbers).
      const spellCol = labels.map((l, i) => i > 0 && SPELL_HEAD.test(l) && !SLOT_HEAD.test(l));
      const named = rows.some((r) => r.some((c, i) => spellCol[i] && !COUNT_CELL.test(String(c))));
      if (LEVEL_HEAD.test(head) && named) {
        if (labels.length > 2) odd += 1;
        else {
          const caption = typeof o.caption === 'string' ? o.caption.trim() : '';
          tables.push({
            ...(caption !== '' && { caption: caption.replace(/:$/, '') }),
            head,
            rows: rows
              .slice(0, MAX_ROWS)
              .map((r) => ({ level: String(r[0] ?? ''), cell: String(r[1] ?? '') })),
          });
        }
      }
      return;
    }
    walk(o.entries);
    walk(o.items);
  };
  walk(entries);
  return { tables, words, odd };
}

/** What a feature's words say its tables hold. */
function sectionOf(words: string): Section | undefined {
  if (PREPARED.test(words)) return 'prepared';
  if (EXPANDED.test(words)) return 'expanded';
  if (LEARNED.test(words)) return 'known';
  return undefined;
}

type Gated = Record<string, string[]>;

/** The names at each gate's list, without `#c`, so a file of many names adds each in constant time. */
const namesAt = new WeakMap<string[], Set<string>>();

/** Add a spell at a gate, once: `mage hand#c` from a sentence is the table's `mage hand`. */
function add(to: Gated, gate: string, name: string): void {
  const list = (to[gate] ??= []);
  let names = namesAt.get(list);
  if (names === undefined) {
    names = new Set(list.map((n) => n.replace(/#c$/, '')));
    namesAt.set(list, names);
  }
  const base = name.replace(/#c$/, '');
  if (names.has(base)) return;
  names.add(base);
  list.push(name);
}

/** The rules' one spell named with `or`, which a file without spells still names. */
const OR_NAMES = new Set(['create or destroy water']);

/**
 * A cell's part as a spell's name. One that offers two (`sanctuary or
 * deathwatch`) is a pick, unless it is a spell the rules, the file or the
 * installed data has (`create or destroy water`).
 */
function cellName(raw: string, index: SpellIndex | undefined): string | undefined {
  const name = spellName(raw);
  if (name === undefined || !/ or /.test(name) || OR_NAMES.has(name)) return name;
  return index?.level(name) === undefined ? undefined : name;
}

/** A table's spells by gate, undefined when a row cannot be placed. */
function readTable(
  table: SpellTable,
  section: Section,
  index: SpellIndex | undefined,
): Gated | undefined {
  const byLevel = table.head !== undefined && /\bspell level\b/i.test(table.head);
  // A table by spell level that the class learns from as it rises (a
  // Strixhaven mage's) is a table this cannot place.
  if (byLevel && section !== 'expanded') return undefined;
  const rows: { level: number; names: string[] }[] = [];
  for (const row of table.rows) {
    const level = rowLevel(row.level);
    // Notes first, which may hold commas: `conjure animals (bats, rats, or wolves only)`.
    const cell = row.cell.replace(NOTE, '').trim();
    if (COUNT_CELL.test(cell)) continue;
    if (level === undefined || level > 20) return undefined;
    const names = cell.split(',').map((part) => cellName(part, index));
    if (names.some((n) => n === undefined)) return undefined;
    rows.push({ level, names: names as string[] });
  }
  // An expanded list's rows are spell levels (1st to 5th, The Undead's even
  // under `Warlock Level`), unless they are the odd class levels a patron's
  // spells come at: `1st, 3rd ... 9th`, `3, 5, 7, 9`.
  const byClassLevel = section === 'expanded' && !byLevel && oddClassLevels(rows);
  const out: Gated = {};
  // A cantrip row only on an expanded list; spell levels up to 9th.
  const min = section === 'expanded' ? 0 : 1;
  const max = section === 'expanded' && !byClassLevel ? 9 : 20;
  for (const { level, names } of rows) {
    if (level < min || level > max) return undefined;
    const gate =
      section !== 'expanded' || (byClassLevel && level > 0) ? String(level) : `s${level}`;
    for (const n of names) add(out, gate, n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Whether a table's levels past its cantrip row are all odd and reach past 5th: class levels, not spell levels. */
function oddClassLevels(rows: readonly { level: number }[]): boolean {
  const levels = rows.map((r) => r.level).filter((l) => l > 0);
  return levels.every((l) => l % 2 === 1) && levels.some((l) => l > 5);
}

/** Whether a table names a spell the file or the installed data has. */
function namesKnown(table: SpellTable, index: SpellIndex | undefined): boolean {
  if (index === undefined) return false;
  return table.rows.some((row) =>
    row.cell
      .replace(NOTE, '')
      .split(',')
      .some((part) => {
        const name = spellName(part);
        return name !== undefined && index.level(name) !== undefined;
      }),
  );
}

/**
 * A frame's catch as names: `power word heal and power word kill` when
 * plural, else whole. One of two (`the druidcraft or thaumaturgy cantrip`) is
 * a pick, which this does not read.
 */
function namesIn(raw: string, plural: boolean): string[] {
  if (!plural && / or /.test(raw)) return [];
  const parts = plural ? raw.split(/,? (?:and|or) |, /) : [raw];
  const names = parts.map(spellName);
  return names.every((n) => n !== undefined) ? (names as string[]) : [];
}

/** The sentences of a feature's words. */
function sentencesOf(words: readonly string[]): string[] {
  return words.flatMap((w) => w.split(/(?<=[.;!?]) /));
}

/**
 * The `additionalSpells` a class's, subclass's or option's features give,
 * undefined for none, and whether a table of spells was left as text.
 * `tables` reads tables of spells: a subclass's or an option's, not a class's
 * own, whose tables are its spellcasting or optional lists. `index` is the
 * spells the file and the installed data have.
 */
export function readFeatureSpells(
  features: readonly FeatureText[],
  opts: { tables: boolean; index?: SpellIndex | undefined },
): { blocks?: SpellBlock[]; unread: boolean } {
  const common: Partial<Record<Section, Gated>> = {};
  const branches: SpellBlock[] = [];
  let unread = false;
  for (const f of features) {
    const read = readEntries(f.entries);
    if (opts.tables && read.odd > 0) unread = true;
    const feature = String(f.level);
    for (const s of sentencesOf(read.words)) {
      for (const m of s.matchAll(ALWAYS_PREPARED)) {
        const before = s.slice(Math.max(0, m.index - 20), m.index);
        if (m[1] === undefined && (CONDITION.test(s) || CONDITION_BEFORE.test(before))) continue;
        for (const n of namesIn(m[2] ?? '', m[3] === 'spells'))
          add((common.prepared ??= {}), feature, n);
      }
      for (const m of s.matchAll(LEARNS_CANTRIP)) {
        for (const n of namesIn(m[1] ?? '', m[2] === 'cantrips'))
          add((common.known ??= {}), feature, `${n}#c`);
      }
    }
    if (!opts.tables || read.tables.length === 0) continue;
    const captions = read.tables.map((t) => t.caption?.toLowerCase() ?? '');
    const section = sectionOf([...read.words, ...captions].join(' '));
    if (section === undefined) {
      // Untold, it is a table of spells only if it names one the data has,
      // not a Channel Divinity's challenge ratings by level.
      if (read.tables.some((t) => namesKnown(t, opts.index))) unread = true;
      continue;
    }
    const readOnes = read.tables.map((t) => ({
      table: t,
      spells: readTable(t, section, opts.index),
    }));
    const failed = readOnes.some((r) => r.spells === undefined);
    if (failed) unread = true;
    const named = new Set(read.tables.map((t) => t.caption?.toLowerCase()));
    // Two or more tables, each captioned: a choice among them. One the
    // engine can offer only whole and only once (a second would join the
    // first as one pick), so a choice missing a table, or after another, is
    // left as text.
    const choice =
      read.tables.length > 1 && !named.has(undefined) && named.size === read.tables.length;
    if (choice && (failed || branches.length > 0)) {
      unread = true;
      continue;
    }
    const got = readOnes.flatMap(({ table, spells }) =>
      spells === undefined ? [] : [{ table, spells }],
    );
    for (const { table, spells } of got) {
      if (choice) {
        branches.push({ name: table.caption ?? '', [section]: spells });
        continue;
      }
      const into = (common[section] ??= {});
      for (const [gate, names] of Object.entries(spells)) for (const n of names) add(into, gate, n);
    }
  }
  const blocks: SpellBlock[] = [];
  if (Object.keys(common).length > 0) blocks.push(common);
  blocks.push(...branches);
  return blocks.length > 0 ? { blocks, unread } : { unread };
}
