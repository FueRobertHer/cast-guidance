/**
 * A Fight Club class's options: optional features named `Label: Name` that
 * are not subclass picks (`Fighting Style: Archery`, `Metamagic: Careful
 * Spell`), two or more of one label. Each becomes a 5etools optional feature
 * whose feature type names its class and label, `Ember Knight: Fighting
 * Style`, as the option lists Fight Club stores as spells are named; the class
 * (or subclass) gets an `optionalfeatureProgression` that offers them.
 *
 * How many it picks: a counter named for the label (`Fighting Styles Known`),
 * else the number the class's feature of that label gives (`you gain two of
 * the following Metamagic options`, one where it gives none), and as many
 * more as each later feature of that label gives (the sorcerer's `Metamagic
 * (2nd)` at 10th level). A list repeated at a later level is not another pick:
 * Fight Club adds the Champion's extra styles at 10th level to the fighter's
 * list. An option first listed at a later level than the rest needs that level.
 *
 * A label of an official list (Fighting Style, Metamagic, Eldritch
 * Invocations, Pact Boon, Maneuvers) also offers that list, so an option the
 * installed game data has, left out as a duplicate, is still offered. An
 * official list the features count but the file gives no options or counter
 * for is offered at the count they state (see `classLists.ts`).
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import { childTexts, type XmlElement } from '../xml';
import { type FileCounter, isSpellsKnown } from './classCounters';
import { textLists } from './classLists';
import { BASE_CLASSES } from './classOption';
import { readFeatureSpells } from './classSpells';
import {
  citationEntry,
  type Fc5Context,
  type Fc5Part,
  type FileClasses,
  type Placement,
  placeEntity,
} from './context';
import { countWord, type Entry, entryName, lastGroup, ownerKey, plainText, readText } from './text';

/** One option as the class lists it. */
export interface OptionChoice {
  name: string;
  level: number;
  el: XmlElement;
  edition?: RulesVersion;
}

/** The class or subclass whose options these are. */
export interface OptionHost {
  /** What its feature type names: `Ember Knight`, `Ember Knight (Ash Guard)`. */
  owner: string;
  /** Its class's name, for an official list and a level prerequisite. */
  className: string;
  ctx: Fc5Context;
  /** Its place, for an option that cites no book. */
  placement: Placement;
  edition: RulesVersion | undefined;
  /** Its fixed features, names as converted, with their text. */
  fixed: readonly { name: string; level: number; entries: Entry[] }[];
  /**
   * A subclass's class's fixed features: a list stored with no class's name
   * that the class names is the class's, not the subclass's.
   */
  classFixed?: readonly { name: string; level: number; entries: Entry[] }[];
  /** Its counters, by lowercased name. */
  counters: ReadonlyMap<string, FileCounter>;
}

/** An option part, the label it is listed under, and the official list that label maps to, if any. */
export interface OptionPart extends Fc5Part {
  label: string;
  official?: string;
}

export interface HostOptions {
  /** The host's `optionalfeatureProgression`, one per label. */
  progression: Record<string, unknown>[];
  parts: OptionPart[];
  /** The choices that are no label's options, as given. */
  rest: OptionChoice[];
  /** The counters a count was read from, lowercased. */
  countersRead: Set<string>;
  /** The options whose table of spells is kept as text. */
  spellsKept: string[];
  /** The stored lists offered at the counts their features' words give, by label. */
  countedFromText: string[];
}

const PICK = /^([^:]{1,60}): (.{1,120})$/;

/** The official list a label is, by the class's name for a fighting style. */
function officialType(label: string, className: string, edition: RulesVersion): string | undefined {
  const l = label.toLowerCase();
  if (/^fighting styles?$/.test(l)) {
    // The 2024 rules make fighting styles feats: no list of optional features.
    if (edition === '2024') return undefined;
    if (/^paladin\b/i.test(className)) return 'FS:P';
    if (/^ranger\b/i.test(className)) return 'FS:R';
    if (/^bard\b/i.test(className)) return 'FS:B';
    return 'FS:F';
  }
  if (/^metamagic(?: options?)?$/.test(l)) return 'MM';
  if (/^(?:eldritch )?invocations?$/.test(l)) return 'EI';
  if (/^pact boons?$/.test(l)) return 'PB';
  if (/^(?:battle master )?maneuvers?(?: options?)?$/.test(l)) return 'MV:B';
  return undefined;
}

/** `Fighting Styles` and `Fighting Style`, `Esoteric Theories` and `Esoteric Theory`, alike. */
export function stem(words: string): string {
  return words
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/ies$/, 'y')
    .replace(/(?<=[^s])s$/, '');
}

/** A counter of numbers alone, by level, as a progression: `{ "1": 1, "10": 2 }`. */
export function countsByLevel(counter: FileCounter): Record<string, number> | undefined {
  const rows = [...counter.rows].sort((a, b) => a.level - b.level);
  const out: Record<string, number> = {};
  let last = 0;
  for (const r of rows) {
    if (!/^\d{1,3}$/.test(r.value)) return undefined;
    const n = Number(r.value);
    if (n !== last) out[String(r.level)] = n;
    last = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `gain two of the following`, `choose one`, `learn three`: the number of picks a feature gives. */
const GIVES = /\b(?:gain|choose|learn|pick|select|adopt|master)s? (one|two|three|four|\d)\b/i;
/** The picks a feature gives: the number it names, else one. */
function picksIn(entries: readonly Entry[]): number {
  const n = GIVES.exec(plainText(entries as Entry[]));
  return n === null ? 1 : (countWord(n[1] ?? '') ?? 1);
}

/** A word's start, shared by its singular and plural: `propert` for `properties`, `hex` for `hexes`. */
function wordRoot(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3);
  if (w.length > 4 && /(?:x|ch|sh|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** A text's words, lowercased. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter((w) => w !== '');
}

/** The roots a list's name is found by: its words', a generic last `Options` aside (`Psionic Discipline` for `Psionic Discipline Options`). */
function listRoots(list: string): string[] {
  const all = wordsOf(list);
  return (all.length > 1 && /^options?$/.test(all.at(-1) ?? '') ? all.slice(0, -1) : all).map(
    wordRoot,
  );
}

/** Whether `have` holds the roots `want` from its word `i` on, each word starting with its root. */
function rootsAt(have: readonly string[], want: readonly string[], i: number): boolean {
  return want.every((r, k) => have[i + k]?.startsWith(r) === true);
}

/**
 * Whether words name a list by its roots: the roots in a row, other than as
 * the tail of a longer list's (`grand hex` names `Grand Hexes`, not `Hexes`,
 * when the file has both).
 */
function namesList(
  have: readonly string[],
  want: readonly string[],
  longer: readonly (readonly string[])[],
): boolean {
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= have.length; i += 1) {
    if (!rootsAt(have, want, i)) continue;
    const end = i + want.length;
    if (!longer.some((l) => rootsAt(have, l, end - l.length))) return true;
  }
  return false;
}

/** `learn two`, `you know one`, `unlock an`: a number of picks, before what is picked. */
const PICKS_OF =
  /\b(gain|choose|learn|pick|select|adopt|master|know|unlock)s? (one|two|three|four|\d{1,2}|an?)\b/gi;
/** Verbs that pick at the opening, but later name a pick made already (`choose one mutagen affecting you`). */
const CHOOSE = /^(?:choose|pick|select)$/i;
/** How far after the number the picked thing's name may start, in words. */
const PICKS_REACH = 4;
/** How much of a sentence on either side of a `learn two` is read: a long run with no full stop costs no more. */
const SENTENCE = 300;
/** `Whenever you learn a new trick shot`: a condition, not a pick. */
const SWAP = /\b(?:whenever|each time)\b/i;
/** `you can replace one formula you know with a new one`: a swap, not a pick. */
const REPLACE = /\breplace/i;
/** `additional`, `more`, `another`: picks on top of some, at the levels the sentence lists. */
const EXTRA = /^(?:additional|more|another)$/;
/** `at 13th, 15th, and 17th level`. */
const LEVELS_AT = /\bat ((?:\d{1,2}(?:st|nd|rd|th),? (?:and )?){0,9}\d{1,2}(?:st|nd|rd|th)) level/i;
/** `at Psion levels 5, 10, 13, and 17`. */
const AT_LEVELS = /\bat (?:[a-z]{1,20} )?levels? ((?:\d{1,2},? (?:and )?){0,9}\d{1,2})\b/i;
/**
 * `and another at 13th and 15th level`, `and two more at 7th level`, `and an
 * additional one at levels 7th and 10th`: that many more at each.
 */
const MORE_AT =
  /\b(?:another|an additional one|(one|two|three|four) more)\b[^.]{0,60}?\bat (?:((?:\d{1,2}(?:st|nd|rd|th),? (?:and )?){0,9}\d{1,2}(?:st|nd|rd|th)) level|levels ((?:\d{1,2}(?:st|nd|rd|th),? (?:and )?){0,9}\d{1,2}(?:st|nd|rd|th)))/i;

/**
 * One feature's picks of a list: at the feature's level (`level` absent) or
 * at the levels it names; `total` when it says how many are known in all
 * (`you now know three tricks`) rather than how many more.
 */
interface Picks {
  level?: number;
  n: number;
  total?: boolean;
}

/**
 * The picks of a list a feature's text gives, from each `learn two` whose
 * next few words hold a form of the list's last word (`learn two trick
 * shots`, `choose three 1st-level powers`), not as the tail of a longer
 * list's name (`longer`):
 * - the first gives its number at the feature's level, less the options of
 *   the list the host has outright that its sentence names (`learn two such
 *   Focus Arts: Weapon Parry and Dodge Step`: none to pick), and as many more
 *   as its sentence's `another` or `two more` says at the levels after it
 *   (`learn one grand hex, and you learn another at 13th and 15th level`);
 * - `learn one additional curse at 6th and 10th level` gives its number at
 *   each level listed, none at the feature's own.
 * A condition or a swap (`whenever you learn a new trick shot`, `you can
 * replace one`) and `a number of` are not picks; after the list's first
 * feature (`opening` false), neither is a `choose`, and `you know three` is
 * the total known.
 */
function picksOf(
  text: string,
  list: string,
  granted: readonly (readonly string[])[],
  longer: readonly (readonly string[])[],
  opening: boolean,
  full?: readonly string[],
): Picks[] {
  // What is picked: the list's last word, and the one before a generic `Options`.
  const words = wordsOf(list);
  const roots = words.slice(/^options?$/.test(words.at(-1) ?? '') ? -2 : -1).map(wordRoot);
  if (roots.length === 0) return [];
  const out: Picks[] = [];
  let first = true;
  for (const m of text.matchAll(PICKS_OF)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    const ahead = text.slice(end, end + SENTENCE);
    const stop = ahead.indexOf('.');
    const rest = stop < 0 ? ahead : ahead.slice(0, stop);
    const next = wordsOf(rest.slice(0, 80));
    const picked = (k: number) =>
      k < PICKS_REACH &&
      roots.some((r) => next[k]?.startsWith(r) === true) &&
      !longer.some((l) => rootsAt(next, l, k + 1 - l.length)) &&
      (full === undefined || rootsAt(next, full, k + 1 - full.length));
    if (!next.some((_, k) => picked(k)) || next[0] === 'number') continue;
    const verb = (m[1] ?? '').toLowerCase();
    if (!opening && CHOOSE.test(verb)) continue;
    const behind = text.slice(Math.max(0, at - SENTENCE), at);
    if (SWAP.test(behind.slice(behind.lastIndexOf('.') + 1)) || REPLACE.test(rest)) continue;
    const word = (m[2] ?? '').toLowerCase();
    const n = word === 'a' || word === 'an' ? 1 : countWord(word);
    if (n === undefined) continue;
    const listed = LEVELS_AT.exec(rest)?.[1] ?? AT_LEVELS.exec(rest)?.[1];
    const levels = (listed?.match(/\d{1,2}/g) ?? []).map(Number);
    const extra = EXTRA.test(next[0] ?? '');
    if (extra && levels.length > 0) {
      for (const level of levels) out.push({ level, n });
      continue;
    }
    if (!first) continue;
    first = false;
    const restWords = wordsOf(rest);
    const given = granted.filter((g) => namesList(restWords, g, [])).length;
    out.push({
      n: Math.max(0, n - given),
      ...(!opening && verb === 'know' && !extra && { total: true }),
    });
    const more = MORE_AT.exec(rest);
    if (more !== null) {
      const each = more[1] === undefined ? 1 : (countWord(more[1]) ?? 1);
      for (const level of (more[2] ?? more[3])?.match(/\d{1,2}/g) ?? [])
        out.push({ level: Number(level), n: each });
    }
  }
  return out;
}

/** A host's fixed feature, its words read once. */
interface ReadFeature {
  level: number;
  text: string;
  name: readonly string[];
  words: readonly string[];
}

/**
 * The picks a list's features give by level, totalled, from {@link picksOf};
 * undefined when none gives a number. `granted` are the roots of the list's
 * options the host has outright; `full`, its own roots, when a shorter list
 * shares its last word (`Grand Hexes` and `Hexes`), so that only its whole
 * name picks from it.
 */
function countsFromText(
  features: readonly ReadFeature[],
  list: string,
  granted: readonly (readonly string[])[],
  longer: readonly (readonly string[])[],
  full?: readonly string[],
): Record<string, number> | undefined {
  // By level, the most any one feature adds there: a level one feature lists
  // (`at 7th and 10th level`) and another is the feature of (`Arcane Shot
  // Improvement` at 7th) is one pick, not two.
  const added = new Map<number, number>();
  const totals = new Map<number, number>();
  let opening = true;
  for (const f of [...features].sort((a, b) => a.level - b.level)) {
    const picks = picksOf(f.text, list, granted, longer, opening, full);
    if (picks.length === 0) continue;
    opening = false;
    const own = new Map<number, number>();
    for (const p of picks) {
      const level = p.level ?? f.level;
      if (p.total === true) totals.set(level, Math.max(totals.get(level) ?? 0, p.n));
      else own.set(level, (own.get(level) ?? 0) + p.n);
    }
    for (const [level, n] of own) added.set(level, Math.max(added.get(level) ?? 0, n));
  }
  const counts: Record<string, number> = {};
  let known = 0;
  for (const level of [...new Set([...added.keys(), ...totals.keys()])].sort((a, b) => a - b)) {
    const now = Math.max(known + (added.get(level) ?? 0), totals.get(level) ?? 0);
    if (now > known) counts[String(level)] = now;
    known = now;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

/** Features with their words, and every start of every word they hold, to rule a list out at a glance. */
interface ReadFeatures {
  features: readonly ReadFeature[];
  starts: ReadonlySet<string>;
}

const readCache = new WeakMap<object, ReadFeatures>();

/** A host's features read once, for every list asked about them. */
function readFeatures(fixed: OptionHost['fixed']): ReadFeatures {
  const known = readCache.get(fixed);
  if (known !== undefined) return known;
  const starts = new Set<string>();
  const features = fixed.map((f) => {
    const text = plainText(f.entries);
    const name = wordsOf(f.name);
    const words = wordsOf(text);
    for (const w of [...name, ...words]) {
      for (let i = 1; i <= Math.min(w.length, 24); i += 1) starts.add(w.slice(0, i));
    }
    return { level: f.level, text, name, words };
  });
  const out = { features, starts };
  readCache.set(fixed, out);
  return out;
}

/** Whether features may name a list, by its roots: each root starts a word of theirs. */
function mayName(read: ReadFeatures, want: readonly string[]): boolean {
  return want.length > 0 && want.every((r) => read.starts.has(r.slice(0, 24)));
}

/** The features that name a list, by its roots. */
function naming(
  read: ReadFeatures,
  want: readonly string[],
  longer: readonly (readonly string[])[],
): ReadFeature[] {
  if (!mayName(read, want)) return [];
  return read.features.filter(
    (f) => namesList(f.name, want, longer) || namesList(f.words, want, longer),
  );
}

/**
 * Offer the lists the file stores as spells that no option or counter of the
 * host offers, at the picks its features' words give (`you learn two trick
 * shots`): its own (`Gunslinger: Trick Shots`), and those stored with no
 * class's name (`Blood Curses`) that its features name, a class's before its
 * subclass's. A list no feature gives a number of stays unoffered, as does one
 * whose label the host already offers.
 */
function linkTextLists(
  host: OptionHost,
  mine: readonly { list: string; label: string }[],
  progression: Record<string, unknown>[],
): string[] {
  const stems = new Set<string>();
  for (const p of progression) if (typeof p.name === 'string') stems.add(stem(p.name));
  const own = readFeatures(host.fixed);
  const ofClass = host.classFixed === undefined ? undefined : readFeatures(host.classFixed);
  // Each label's roots, and the longer labels it is the tail of.
  const labels = [...mine.map((m) => m.label)];
  for (const list of host.ctx.optionLists ?? []) if (!list.includes(': ')) labels.push(list);
  const rootsOf = new Map(labels.map((l) => [l, listRoots(l)]));
  const tailOf = (tail: readonly string[], roots: readonly string[]) =>
    tail.every((r, k) => roots[roots.length - tail.length + k] === r);
  const longerThan = (label: string): (readonly string[])[] => {
    const want = rootsOf.get(label) ?? [];
    const out: (readonly string[])[] = [];
    for (const [other, roots] of rootsOf) {
      if (other === label || roots.length <= want.length) continue;
      if (tailOf(want, roots)) out.push(roots);
    }
    return out;
  };
  const hasShorter = (label: string): boolean => {
    const want = rootsOf.get(label) ?? [];
    for (const [other, roots] of rootsOf) {
      if (other !== label && roots.length < want.length && tailOf(roots, want)) return true;
    }
    return false;
  };
  const candidates: { list: string; label: string }[] = [...mine];
  for (const list of host.ctx.optionLists ?? []) {
    if (list.includes(': ')) continue;
    const want = rootsOf.get(list) ?? [];
    if (!mayName(own, want)) continue;
    if (ofClass !== undefined && mayName(ofClass, want)) {
      if (naming(ofClass, want, longerThan(list)).length > 0) continue;
    }
    candidates.push({ list, label: list });
  }
  const counted: string[] = [];
  for (const { list, label } of candidates) {
    const want = rootsOf.get(label) ?? [];
    if (stems.has(stem(label)) || !mayName(own, want)) continue;
    const longer = longerThan(label);
    const features = naming(own, want, longer);
    if (features.length === 0) continue;
    // The list's options the host has outright: `Focus Art: Weapon Parry`.
    const granted: string[][] = [];
    for (const f of host.fixed) {
      const m = PICK.exec(f.name);
      if (m !== null && stem(m[1] ?? '') === stem(label)) granted.push(listRoots(m[2] ?? ''));
    }
    const full = hasShorter(label) ? want : undefined;
    const counts = countsFromText(features, label, granted, longer, full);
    if (counts === undefined) continue;
    progression.push({ name: label, featureType: [list], progression: counts });
    stems.add(stem(label));
    counted.push(label);
  }
  return counted;
}

/** A feature named for a label, or a numbered repeat of one (`Metamagic (2nd)`, `Metamagic Option (3rd)`). */
function isLabelFeature(name: string, label: string): boolean {
  const n = name.toLowerCase();
  const l = label.toLowerCase();
  return n === l || (n.startsWith(l) && /^(?: options?)? \([^()]{1,9}\)$/.test(n.slice(l.length)));
}

const KNOWN = /^(.{1,60}?) (?:known|options known)$/i;

/**
 * The option lists the file stores as spells for this host (`Warmage (Valda):
 * Tricks`), with their labels. The list's owner names the host as
 * {@link ownerKey} reads it, and in the host's edition when it marks one
 * (`Ranger (Trapper (Legacy))`).
 */
function storedLists(host: OptionHost): { list: string; label: string }[] {
  const owners = new Set(ownerKeys(host.owner, host.className, host.ctx.classes));
  const edition = host.edition ?? host.placement.edition;
  const mine: { list: string; label: string }[] = [];
  for (const list of host.ctx.optionLists ?? []) {
    const colon = list.indexOf(': ');
    if (colon <= 0) continue;
    const named = ownerKey(list.slice(0, colon));
    if (!owners.has(named.key) || (named.edition !== undefined && named.edition !== edition))
      continue;
    const label = list.slice(colon + 2).trim();
    if (label !== '') mine.push({ list, label });
  }
  return mine;
}

/**
 * The keys an option list's owner may name a host by: its own name as
 * {@link ownerKey} reads it and, for a class the file names with an author's
 * qualifier (`Madwalker (Tanares)`), its name without it (`Madwalker`,
 * `Madwalker (Arachnid Trail)` for its subclass), when no other class in the
 * file or the rules goes by that name. The owner is the class's name, or the
 * class's name and the subclass's in brackets, as hosts name themselves.
 */
export function ownerKeys(
  owner: string,
  className: string,
  classes: FileClasses | undefined,
): string[] {
  const keys = [ownerKey(owner).key];
  const bare = lastGroup(className)?.base;
  if (bare === undefined || classes === undefined) return keys;
  const key = ownerKey(bare).key;
  if (BASE_CLASSES.has(key)) return keys;
  let named = 0;
  for (const c of classes.values()) {
    if (ownerKey(lastGroup(c.name)?.base ?? c.name).key === key) named += 1;
  }
  if (named === 1) keys.push(ownerKey(`${bare}${owner.slice(className.length)}`).key);
  return keys;
}

/** A host's `X Known` counters (not its spells known), each with the label words it names. */
function knownOf(counters: Iterable<FileCounter>): { counter: FileCounter; words: string }[] {
  const out: { counter: FileCounter; words: string }[] = [];
  for (const counter of counters) {
    if (isSpellsKnown(counter)) continue;
    const m = KNOWN.exec(counter.name);
    if (m !== null) out.push({ counter, words: (m[1] ?? '').trim() });
  }
  return out;
}

/**
 * Which label each Known counter counts, by lowercased label, one label a
 * counter and whatever order the file gives them in: the label of the
 * counter's own name (`Hexes Known` counts `Hexes`, not `Grand Hexes`), else,
 * for a counter no label is named for, the one label whose name ends in it
 * (`Invocations Known` for `Eldritch Invocations`) that no other such counter
 * fits.
 */
function knownCounters(
  labels: readonly string[],
  known: readonly { counter: FileCounter; words: string }[],
): Map<string, FileCounter> {
  const unique = [...new Map(labels.map((l) => [l.toLowerCase(), l])).values()];
  const out = new Map<string, FileCounter>();
  const rest: { counter: FileCounter; want: string }[] = [];
  for (const { counter, words } of known) {
    const want = stem(words);
    const exact = unique.filter((l) => stem(l) === want);
    const [label] = exact;
    if (exact.length === 0) rest.push({ counter, want });
    else if (exact.length === 1 && label !== undefined && !out.has(label.toLowerCase())) {
      out.set(label.toLowerCase(), counter);
    }
  }
  const byLabel = new Map<string, FileCounter[]>();
  for (const { counter, want } of rest) {
    const fits = unique.filter((l) => !out.has(l.toLowerCase()) && stem(l).endsWith(want));
    const [label] = fits;
    if (fits.length !== 1 || label === undefined) continue;
    byLabel.set(label.toLowerCase(), [...(byLabel.get(label.toLowerCase()) ?? []), counter]);
  }
  for (const [label, [counter, ...more]] of byLabel) {
    if (counter !== undefined && more.length === 0) out.set(label, counter);
  }
  return out;
}

/**
 * Offer the option lists the file stores as spells for this host that a
 * counter of the host counts (`Tricks Known`, by {@link knownCounters}); else
 * the official list a counter names (`Eldritch Invocations Known`) when it
 * fits no list of the host's. A counter that fits no list, or two alike,
 * stays unread.
 */
function linkStoredLists(
  host: OptionHost,
  mine: readonly { list: string; label: string }[],
  labels: readonly string[],
  known: readonly { counter: FileCounter; words: string }[],
  knownFor: ReadonlyMap<string, FileCounter>,
  progression: Record<string, unknown>[],
  countersRead: Set<string>,
): void {
  const offered = new Set<string>();
  for (const p of progression) {
    for (const t of Array.isArray(p.featureType) ? p.featureType : []) {
      if (typeof t === 'string') offered.add(t.toLowerCase());
    }
  }
  const offer = (counter: FileCounter, list: string, label: string) => {
    const key = counter.name.toLowerCase();
    if (countersRead.has(key) || offered.has(list.toLowerCase())) return;
    const counts = countsByLevel(counter);
    if (counts === undefined) return;
    progression.push({ name: label, featureType: [list], progression: counts });
    offered.add(list.toLowerCase());
    countersRead.add(key);
  };
  for (const { list, label } of mine) {
    const counter = knownFor.get(label.toLowerCase());
    if (counter !== undefined) offer(counter, list, label);
  }
  const edition = host.edition ?? host.placement.edition;
  for (const { counter, words } of known) {
    const want = stem(words);
    if (labels.some((l) => stem(l).endsWith(want))) continue;
    const official = officialType(words, host.className, edition);
    if (official !== undefined) offer(counter, official, words);
  }
}

/** The options of a class or subclass, grouped by label, and what they become. */
export function convertOptions(choices: readonly OptionChoice[], host: OptionHost): HostOptions {
  const groups = new Map<string, { label: string; options: OptionChoice[] }>();
  for (const c of choices) {
    const m = PICK.exec(c.name);
    if (m === null) continue;
    const label = (m[1] ?? '').trim();
    const g = groups.get(label.toLowerCase()) ?? { label, options: [] };
    g.options.push(c);
    groups.set(label.toLowerCase(), g);
  }
  const progression: Record<string, unknown>[] = [];
  const parts: OptionPart[] = [];
  const countersRead = new Set<string>();
  const spellsKept: string[] = [];
  const taken = new Set<OptionChoice>();
  const lists: { label: string; options: OptionChoice[]; byName: Map<string, OptionChoice> }[] = [];
  for (const { label, options } of groups.values()) {
    // Two of one name at two levels are one option, from the first.
    const byName = new Map<string, OptionChoice>();
    for (const o of [...options].sort((a, b) => a.level - b.level)) {
      const name = entryName(PICK.exec(o.name)?.[2] ?? '').name;
      const key = name.toLowerCase();
      if (name !== '' && !byName.has(key)) byName.set(key, o);
    }
    if (byName.size >= 2) lists.push({ label, options, byName });
  }
  // A Known counter counts one label, of the host's own lists or those the file stores as spells.
  const mine = storedLists(host);
  const labels = [...lists.map((l) => l.label), ...mine.map((l) => l.label)];
  const known = knownOf(host.counters.values());
  const knownFor = knownCounters(labels, known);
  for (const { label, options, byName } of lists) {
    for (const o of options) taken.add(o);
    let first = Number.POSITIVE_INFINITY;
    for (const o of byName.values()) first = Math.min(first, o.level);
    const edition = host.edition ?? host.placement.edition;
    const featureType = `${host.owner}: ${label}`;
    const official = officialType(label, host.className, edition);

    // How many it picks, by level.
    const known = knownFor.get(label.toLowerCase());
    const fromCounter = known === undefined ? undefined : countsByLevel(known);
    let counts: Record<string, number>;
    if (known !== undefined && fromCounter !== undefined) {
      countersRead.add(known.name.toLowerCase());
      counts = fromCounter;
    } else {
      const own = host.fixed
        .filter((f) => isLabelFeature(f.name, label))
        .sort((a, b) => a.level - b.level);
      const opening = own.find((f) => f.level === first);
      let total = opening === undefined ? 1 : picksIn(opening.entries);
      counts = { [String(first)]: total };
      for (const f of own) {
        if (f.level <= first) continue;
        total += picksIn(f.entries);
        counts[String(f.level)] = total;
      }
    }
    progression.push({
      name: label,
      featureType: official === undefined ? [featureType] : [featureType, official],
      progression: counts,
    });

    for (const [, o] of byName) {
      const named = entryName(PICK.exec(o.name)?.[2] ?? '');
      const text = readText(childTexts(o.el, 'text'));
      const placement =
        text.sourceLine === undefined
          ? host.placement
          : host.ctx.place(text.sourceLine, named.edition ?? o.edition ?? host.edition);
      const entity: Record<string, unknown> = { name: named.name.replace(/\|/g, '/') };
      placeEntity(entity, placement);
      entity.featureType = [featureType];
      if (o.level > first) {
        entity.prerequisite = [
          { level: { level: o.level, class: { name: host.className, visible: true } } },
        ];
      }
      const entries: Entry[] = [...text.entries];
      const citation = citationEntry(placement);
      if (citation !== undefined) entries.push(citation);
      entity.entries = entries;
      // The spells it gives, by the host's level: a 2014 land's circle spells.
      const spells = readFeatureSpells([{ level: o.level, entries: text.entries }], {
        tables: true,
        index: host.ctx.spells,
      });
      if (spells.blocks !== undefined) entity.additionalSpells = spells.blocks;
      if (spells.unread) spellsKept.push(String(entity.name));
      parts.push({
        kind: 'optionalfeature',
        entity,
        placement,
        label,
        ...(official !== undefined && { official }),
      });
    }
  }
  linkStoredLists(host, mine, labels, known, knownFor, progression, countersRead);
  // An official list its features count but no option or counter offers: the 2024 Sorcerer's Metamagic.
  progression.push(...textLists(host.className, host.fixed, progression));
  const countedFromText = linkTextLists(host, mine, progression);
  return {
    progression,
    parts,
    rest: choices.filter((c) => !taken.has(c)),
    countersRead,
    spellsKept,
    countedFromText,
  };
}
