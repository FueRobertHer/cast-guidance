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
 * installed game data has, left out as a duplicate, is still offered.
 */
import type { RulesVersion } from '../../data5e/rulesVersion';
import { childTexts, type XmlElement } from '../xml';
import { type FileCounter, isSpellsKnown } from './classCounters';
import {
  citationEntry,
  type Fc5Context,
  type Fc5Part,
  type Placement,
  placeEntity,
} from './context';
import { countWord, type Entry, entryName, plainText, readText } from './text';

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

/** A feature named for a label, or a numbered repeat of one (`Metamagic (2nd)`). */
function isLabelFeature(name: string, label: string): boolean {
  const n = name.toLowerCase();
  const l = label.toLowerCase();
  return n === l || (n.startsWith(`${l} (`) && n.endsWith(')') && n.length - l.length <= 12);
}

const KNOWN = /^(.{1,60}?) (?:known|options known)$/i;

/** A class's name as its lists name it, `(UA)` dropped wherever it sits: `Mystic (UA) (Immortal)` as `mystic (immortal)`. */
function ownerKey(name: string): string {
  return name
    .replace(/ ?\(UA\)/gi, '')
    .trim()
    .toLowerCase();
}

/** The option lists the file stores as spells for this host (`Warmage (Valda): Tricks`), with their labels. */
function storedLists(host: OptionHost): { list: string; label: string }[] {
  const owner = ownerKey(host.owner);
  const mine: { list: string; label: string }[] = [];
  for (const list of host.ctx.optionLists ?? []) {
    const colon = list.indexOf(': ');
    if (colon <= 0 || ownerKey(list.slice(0, colon)) !== owner) continue;
    const label = list.slice(colon + 2).trim();
    if (label !== '') mine.push({ list, label });
  }
  return mine;
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
  return {
    progression,
    parts,
    rest: choices.filter((c) => !taken.has(c)),
    countersRead,
  };
}
