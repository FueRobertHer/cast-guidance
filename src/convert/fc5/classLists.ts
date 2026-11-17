/**
 * The official option lists a class or subclass picks from when the file
 * lists none of their options: Fight Club stores Eldritch Invocations,
 * Metamagic options, maneuvers and the like as spells (`added as spells in
 * the Eldritch Invocation spell list`), or leaves them to another file, and
 * says only in its features' words how many the class picks. The class (or
 * subclass) then offers the official list, as the 5etools class does, so the
 * options the game data has, or another file gives, are offered at the count
 * the features state.
 *
 * The count comes from one place, never a sum of two: a table column named
 * for the list (`Level | Invocations Known`), else the feature that first
 * counts them (`you learn three maneuvers`, `you know the Elemental
 * Attunement discipline and one other elemental discipline`) plus, at each
 * later level, either the features that add more (`Additional Maneuvers`:
 * `you learn two additional maneuvers`) or, when there are none, the first
 * feature's own words for the later levels (`two additional maneuvers of your
 * choice at 7th, 10th, and 15th level`, `two more at Sorcerer level 10`).
 */
import { type Entry, plainText } from './text';

/** An official list, by what its class's features call one of its options. */
interface TextList {
  featureType: string;
  /** The list's name, as 5etools' own class names its progression. */
  label: string;
  /** The class whose features (or whose subclass's) give it. */
  className: RegExp;
  /** One option or more, as the features count them. */
  noun: string;
}

const LISTS: readonly TextList[] = [
  {
    featureType: 'EI',
    label: 'Eldritch Invocations',
    className: /^warlock\b/i,
    noun: '(?:eldritch )?invocations?',
  },
  { featureType: 'MM', label: 'Metamagic', className: /^sorcerer\b/i, noun: 'meta ?magic' },
  { featureType: 'MV:B', label: 'Maneuvers', className: /^fighter\b/i, noun: 'maneuvers?' },
  { featureType: 'AS', label: 'Arcane Shots', className: /^fighter\b/i, noun: 'arcane shots?' },
  { featureType: 'RN', label: 'Runes', className: /^fighter\b/i, noun: 'runes?' },
  {
    featureType: 'ED',
    label: 'Elemental Disciplines',
    className: /^monk\b/i,
    noun: '(?:elemental )?disciplines?',
  },
];

const COUNT = 'an|one|two|three|four|five|six|another|\\d';
/** `two additional`, `an additional`, `two more`, `another`: more of them at a later level. */
const MORE = '\\b(?:(an|one|two|three|four|\\d) (?:additional|more)|(another))';
const NUMBERS: Readonly<Record<string, number>> = {
  an: 1,
  one: 1,
  another: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

function count(word: string): number | undefined {
  const w = word.toLowerCase();
  const n = Object.hasOwn(NUMBERS, w) ? NUMBERS[w] : Number(w);
  return n !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** The patterns for one list, built once from its noun. */
interface Patterns {
  noun: RegExp;
  /**
   * `you learn three maneuvers`, `you know the X discipline and one other
   * elemental discipline`. Nothing else between the count and the noun:
   * `two burst maneuvers`, `five master runes` and `one of the disciplines
   * below` are a homebrew class's own lists.
   */
  start: RegExp;
  /** `two additional Combat Superiority maneuvers`, `an additional Arcane Shot option`: a later feature's own pick. */
  more: RegExp;
  /**
   * `two additional maneuvers ... at 7th, 10th, and 15th level`, `two more at
   * Sorcerer level 10`, `an additional Arcane Shot option ... when you reach
   * Fighter levels 7, 10, 15, and 18`.
   */
  later: RegExp;
  /** A table column named for the list. */
  column: RegExp;
}

function patterns(list: TextList): Patterns {
  const n = list.noun;
  return {
    noun: new RegExp(`\\b${n}\\b`, 'i'),
    start: new RegExp(
      `\\b(?:learn|gain|know)s? (the [^.,;]{1,40}? and )?(${COUNT})(?: other| of the following)? ${n}\\b`,
      'i',
    ),
    more: new RegExp(`${MORE}(?: [\\w'-]{1,20}){0,3}? (?:${n}|options?)\\b`, 'i'),
    later: new RegExp(
      `${MORE}(?: (?:[\\w'-]{1,20} ){0,3}?(?:${n}|options?|ones?))?\\b(?: of your choice)?(?: when you(?: reach certain levels)?)? (?:at|reach|in this class:) (?:[A-Z][\\w']{1,20} )?(?:levels? )?(\\d{1,2}(?:st|nd|rd|th)?(?:(?:,? and |, )\\d{1,2}(?:st|nd|rd|th)?){0,9})`,
      'gi',
    ),
    column: new RegExp(n, 'i'),
  };
}

const READY = LISTS.map((list) => ({ list, re: patterns(list) }));

/** A feature as the host reads it. */
export interface ListFeature {
  name: string;
  level: number;
  entries: Entry[];
}

function words(entries: readonly Entry[]): string {
  return plainText(entries as Entry[])
    .replace(/\s+/g, ' ')
    .trim();
}

/** A level column of a table named for the list, as `{ level: total }` where the total changes. */
function fromTable(
  features: readonly ListFeature[],
  column: RegExp,
): Record<string, number> | undefined {
  for (const f of features) {
    for (const table of tablesIn(f.entries)) {
      const labels = Array.isArray(table.colLabels) ? table.colLabels.map(String) : [];
      const at = labels.findIndex((l, i) => i > 0 && column.test(l));
      if (at < 0) continue;
      const out: Record<string, number> = {};
      let last = 0;
      const rows = (Array.isArray(table.rows) ? table.rows : [])
        .map((row) => {
          const cells = Array.isArray(row) ? row : [];
          return {
            level: Number.parseInt(String(cells[0] ?? ''), 10),
            value: Number.parseInt(String(cells[at] ?? ''), 10),
          };
        })
        .filter((r) => Number.isInteger(r.level) && r.level >= 1 && r.level <= 20)
        .sort((a, b) => a.level - b.level);
      if (rows.length < 2 || rows.some((r) => !Number.isInteger(r.value))) continue;
      for (const r of rows) {
        if (r.value !== last && r.value > 0) out[String(r.level)] = r.value;
        last = r.value;
      }
      if (Object.keys(out).length > 0) return out;
    }
  }
  return undefined;
}

function tablesIn(entries: readonly unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (e: unknown) => {
    if (Array.isArray(e)) e.forEach(walk);
    else if (e !== null && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      if (o.type === 'table') out.push(o);
      walk(o.entries);
      walk(o.items);
    }
  };
  walk(entries);
  return out;
}

/** The count by prose: the first feature that counts the list, then later features or its own later words. */
function fromProse(
  features: readonly ListFeature[],
  re: Patterns,
): Record<string, number> | undefined {
  const sorted = [...features].sort((a, b) => a.level - b.level);
  let first: { feature: ListFeature; text: string; total: number } | undefined;
  for (const feature of sorted) {
    const text = words(feature.entries);
    const m = re.start.exec(text);
    const n = m === null ? undefined : count(m[2] ?? '');
    if (m === null || n === undefined) continue;
    // `the Elemental Attunement discipline and one other`: the one it names counts too.
    const named = m[1] !== undefined && re.noun.test(m[1]) ? 1 : 0;
    first = { feature, text, total: n + named };
    break;
  }
  if (first === undefined) return undefined;
  const out: Record<string, number> = { [String(first.feature.level)]: first.total };
  let total = first.total;

  // Later features of the list's name that add some: `Additional Maneuvers`.
  const adds = sorted.filter(
    (f) => f !== first.feature && f.level > first.feature.level && re.noun.test(f.name),
  );
  const added: { level: number; n: number }[] = [];
  for (const f of adds) {
    const m = re.more.exec(words(f.entries));
    const n = m === null ? undefined : count(m[1] ?? m[2] ?? '');
    if (n !== undefined) added.push({ level: f.level, n });
  }
  if (added.length === 0) {
    // Else the first feature's own words for later levels.
    re.later.lastIndex = 0;
    for (const m of first.text.matchAll(re.later)) {
      const n = count(m[1] ?? m[2] ?? '');
      if (n === undefined) continue;
      for (const level of (m[3] ?? '').match(/\d{1,2}/g) ?? []) {
        const at = Number(level);
        if (at > first.feature.level && at <= 20) added.push({ level: at, n });
      }
    }
  }
  added.sort((a, b) => a.level - b.level);
  for (const { level, n } of added) {
    total += n;
    out[String(level)] = total;
  }
  return out;
}

/**
 * The official lists this host's features count but its progression does not
 * offer yet, each as a progression entry. `offered` holds the feature types
 * already offered, lowercased.
 */
export function textLists(
  className: string,
  features: readonly ListFeature[],
  offered: ReadonlySet<string>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const { list, re } of READY) {
    if (!list.className.test(className) || offered.has(list.featureType.toLowerCase())) continue;
    const named = features.filter((f) => re.noun.test(f.name) || re.noun.test(words(f.entries)));
    if (named.length === 0) continue;
    const counts = fromTable(named, re.column) ?? fromProse(named, re);
    if (counts === undefined) continue;
    out.push({ name: list.label, featureType: [list.featureType], progression: counts });
  }
  return out;
}
