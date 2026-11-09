/**
 * Fight Club 5e text into 5etools `entries`, and the naming conventions the
 * format's files share.
 *
 * Fight Club stores prose two ways: one `<text>` per paragraph (with empty
 * `<text/>` as spacers), or one `<text>` holding newlines. Both read the same
 * here: every non-blank line is a paragraph. On top of that, files carry
 * tables as `a | b` lines under a `Caption:` line, bullets as `• item`, a
 * `Source: Book p. 12` line, and 5etools-style lead-ins written as plain text
 * (`Repeatable. You can…`, `Versatile: A Versatile weapon…`). Each becomes
 * the 5etools shape the app renders: a table, a list, a named entry.
 *
 * Dice in prose become roll chips: `{@damage 2d6}` when a damage type follows,
 * `{@dice 2d6}` otherwise, which is what the sheet's roll parser reads.
 */
import type { RulesVersion } from '../../data5e/rulesVersion';

export type Entry = string | Record<string, unknown>;

/** The damage types 5etools spells and the roll parser name in prose. */
export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;

export const ABILITIES = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
} as const;

export type AbilityKey = (typeof ABILITIES)[keyof typeof ABILITIES];

/** `Str`, `strength`, `STR` to `str`; undefined for anything else. */
export function abilityKey(word: string): AbilityKey | undefined {
  const w = word.trim().toLowerCase();
  for (const [full, key] of Object.entries(ABILITIES)) {
    if (w === full || w === key) return key;
  }
  return undefined;
}

export const SKILLS = [
  'acrobatics',
  'animal handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight of hand',
  'stealth',
  'survival',
] as const;

/** Split a comma list ("Insight, Religion", "a, b, and c"), trimmed, blanks dropped. */
export function splitList(text: string): string[] {
  return text
    .split(/,|;|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * A Fight Club proficiency list into its skills (lowercased, 5etools keys) and
 * whatever else it named (saving throws, unknown words), so a caller can say
 * what it could not place.
 */
export function readProficiencies(text: string): { skills: string[]; other: string[] } {
  const skills: string[] = [];
  const other: string[] = [];
  for (const part of splitList(text)) {
    const lower = part.toLowerCase();
    if ((SKILLS as readonly string[]).includes(lower)) skills.push(lower);
    else other.push(part);
  }
  return { skills, other };
}

/**
 * A table lookup by a key read from the file, which sees only the table's own
 * keys: `constructor` or `__proto__` in a file is not a match.
 */
export function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * "Fighter (Eldritch Knight)" into the name and what its final parentheses
 * hold, or undefined. A scan rather than a pattern such as
 * `^(.+?)\s*\((.+)\)$`, which backtracks over a long run of `(`.
 */
export function parenthetical(text: string): { base: string; inner: string } | undefined {
  if (!text.endsWith(')')) return undefined;
  const open = text.indexOf('(', 1);
  if (open === -1 || open === text.length - 1) return undefined;
  const inner = text.slice(open + 1, -1);
  return inner === '' ? undefined : { base: text.slice(0, open).trim(), inner: inner.trim() };
}

/** Wider than any table a rules entry has; see `readText`. */
const MAX_TABLE_COLUMNS = 24;

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };

function countWord(word: string): number | undefined {
  const w = word.toLowerCase();
  const n = own(NUMBER_WORDS, w) ?? Number(w);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * A language line into a 5etools `languageProficiencies` entry: "Common,
 * Elvish", "Two of your choice", "Common and one extra language of your
 * choice". Undefined when it says something else (a choice from a list).
 */
export function readLanguages(raw: string): Record<string, unknown> | undefined {
  // One space between words, so no pattern below backtracks over a long run.
  const text = raw.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const out: Record<string, unknown> = {};
  const choice =
    /(?:^|,?\s*(?:and|plus)\s+)(one|two|three|four|\d)\s+(?:extra\s+|other\s+|additional\s+|standard\s+)*(?:languages?\s+)?of your choice$/i.exec(
      text,
    );
  let named = text;
  if (choice !== null) {
    const count = countWord(choice[1] ?? '');
    if (count === undefined) return undefined;
    out.anyStandard = count;
    named = text.slice(0, choice.index);
  }
  if (/\b(?:choice|choose|any)\b/i.test(named)) return undefined;
  for (const name of splitList(named)) {
    if (!/^[A-Za-z][A-Za-z' -]*$/.test(name)) return undefined;
    out[name.toLowerCase()] = true;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The edition marker a name carries: `Fireball [5.5e]`, `Alert [2024]`. Files
 * built from the SRD 5.2 or by the community converters tag every 2024 entry
 * this way. A bracket that is not a marker (`Sword [Cursed]`) stays in the name.
 */
const NAME_MARKER = /\s*\[([^\]]{1,12})\]\s*$/;

export function markerEdition(marker: string): RulesVersion | undefined {
  if (/^(?:5\.5e?|2024|XPHB|XDMG|XMM|5\.2(?:\.1)?)$/i.test(marker)) return '2024';
  if (/^(?:5e|5\.0e?|5\.1e?|2014|PHB|DMG|MM)$/i.test(marker)) return '2014';
  return undefined;
}

export function splitName(raw: string): { name: string; edition?: RulesVersion } {
  const name = raw.replace(/\s+/g, ' ').trim();
  const m = NAME_MARKER.exec(name);
  const marker = m?.[1];
  if (m === null || marker === undefined) return { name };
  const isMarker = /^(?:\d(?:\.\d)*e?|20\d\d)$/i.test(marker) || /^[A-Z0-9]{2,8}$/.test(marker);
  if (!isMarker) return { name };
  const edition = markerEdition(marker);
  const stripped = name.slice(0, m.index).trim();
  if (stripped === '') return { name };
  return edition === undefined ? { name: stripped } : { name: stripped, edition };
}

/** The edition a `Source:` line points at, when it says. */
export function sourceLineEdition(line: string): RulesVersion | undefined {
  if (/\b(?:5\.2(?:\.\d)?|2024|5\.5e?)\b/.test(line)) return '2024';
  if (/\b(?:5\.0|5\.1|2014)\b/.test(line)) return '2014';
  if (/Player's Handbook \(2024\)|Dungeon Master's Guide \(2024\)/i.test(line)) return '2024';
  return undefined;
}

// ---------------------------------------------------------------------------
// Inline text
// ---------------------------------------------------------------------------

/**
 * Text already holding 5etools tags is left as it is inside those tags. A
 * match stops at the next brace, so a line of `{@` with no `}` is one pass.
 */
const EXISTING_TAG = /(\{@[^{}]*\})/;

const DICE = /\b(\d+d\d+(?:\s?[+-]\s?\d+(?![\dd]))?)\b/g;
const DAMAGE_AFTER = new RegExp(`^\\s+(?:${DAMAGE_TYPES.join('|')})\\b`, 'i');

function tagDice(text: string): string {
  return text.replace(DICE, (match: string, dice: string, offset: number, whole: string) => {
    const after = whole.slice(offset + match.length, offset + match.length + 16);
    const expr = dice.replace(/\s+/g, '');
    return DAMAGE_AFTER.test(after) ? `{@damage ${expr}}` : `{@dice ${expr}}`;
  });
}

/**
 * One line of prose into 5etools text: HTML emphasis (the community converter
 * writes `<i>`, `<b>`) into `{@i}` and `{@b}`, other HTML tags dropped, dice
 * into roll chips. Text inside existing 5etools tags is not touched.
 */
export function inlineText(line: string): string {
  const withMarkup = line
    // Each match stops at the next tag of its kind, open or close, so a line
    // of unclosed tags is one pass, not a scan to the end per tag.
    .replace(/<(?:b|strong)>((?:(?!<\/?(?:b|strong)>)[\s\S])*)<\/(?:b|strong)>/gi, '{@b $1}')
    .replace(/<(?:i|em)>((?:(?!<\/?(?:i|em)>)[\s\S])*)<\/(?:i|em)>/gi, '{@i $1}')
    // Stops at the next `<` too, for the same reason.
    .replace(/<\/?[a-z][a-z0-9]*\b[^<>]*>/gi, '');
  return withMarkup
    .split(EXISTING_TAG)
    .map((part) => (part.startsWith('{@') ? part : tagDice(part)))
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const SMALL_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/** Every word capitalized (or a number, or a small joining word). */
function isTitleCase(words: string[]): boolean {
  return words.every((w, i) => {
    const bare = w.replace(/^[("']+|[)"',]+$/g, '');
    if (bare === '') return true;
    if (/^\d/.test(bare)) return true;
    if (i > 0 && SMALL_WORDS.has(bare.toLowerCase())) return true;
    return /^[A-Z]/.test(bare);
  });
}

/**
 * A lead-in written as text: `Name: rest` (any short label) or `Name. rest`
 * (a Title Case label, as 2024 books set their inline headers). Undefined when
 * the line is ordinary prose.
 */
export function leadIn(line: string): { name: string; rest: string } | undefined {
  const colon = /^([A-Z][^:.!?]{0,48}?):\s+(\S.*)$/.exec(line);
  if (colon !== null) {
    const name = colon[1]?.trim() ?? '';
    const words = name.split(/\s+/);
    if (words.length <= 6 && isTitleCase(words)) return { name, rest: colon[2] ?? '' };
  }
  const period = /^([A-Z][^.:!?]{0,38}?)\.\s+(\S.*)$/.exec(line);
  if (period !== null) {
    const name = period[1]?.trim() ?? '';
    const words = name.split(/\s+/);
    if (words.length <= 5 && isTitleCase(words) && !/^(?:[A-Z]\.?)$/.test(name)) {
      return { name, rest: period[2] ?? '' };
    }
  }
  return undefined;
}

function tableCells(line: string): string[] | undefined {
  if (!line.includes('|')) return undefined;
  const cells = line.split('|').map((c) => c.trim());
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells.length >= 2 ? cells : undefined;
}

const BULLET = /^[•·*-]\s+(.*)$/;
const SOURCE_LINE = /^Source:\s*(.+)$/i;

export interface ReadText {
  entries: Entry[];
  /** The last `Source:` line, without its label. */
  sourceLine?: string;
}

/**
 * Fight Club `<text>` blocks into 5etools entries. Each block is one element's
 * text; blank lines and empty elements only separate.
 */
export function readText(blocks: readonly string[]): ReadText {
  const lines = blocks.flatMap((b) => b.split(/\r?\n/)).map((l) => l.replace(/\s+/g, ' ').trim());
  const entries: Entry[] = [];
  let sourceLine: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line === '') continue;

    const source = SOURCE_LINE.exec(line);
    if (source !== null) {
      sourceLine = source[1]?.trim();
      continue;
    }

    // A table: two or more consecutive lines of cells. A header wider than
    // any rules table is text: padding every row out to it would cost its
    // width times the row count.
    const header = tableCells(line);
    if (header !== undefined && header.length <= MAX_TABLE_COLUMNS) {
      const rows: string[][] = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const cells = tableCells(lines[j] ?? '');
        if (cells === undefined) break;
        rows.push(cells);
      }
      if (rows.length > 0) {
        const width = header.length;
        const table: Record<string, unknown> = {
          type: 'table',
          colLabels: header.map(inlineText),
          rows: rows.map((r) => {
            const cells = r.slice(0, width).map(inlineText);
            while (cells.length < width) cells.push('');
            return cells;
          }),
        };
        const prev = entries[entries.length - 1];
        if (typeof prev === 'string' && prev.endsWith(':') && prev.length <= 80) {
          entries.pop();
          table.caption = prev.slice(0, -1);
        }
        entries.push(table);
        i = j - 1;
        continue;
      }
    }

    // A list: consecutive bullet lines.
    if (BULLET.test(line)) {
      const items: string[] = [];
      let j = i;
      for (; j < lines.length; j += 1) {
        const m = BULLET.exec(lines[j] ?? '');
        if (m === null) break;
        items.push(inlineText(m[1] ?? ''));
      }
      entries.push({ type: 'list', items });
      i = j - 1;
      continue;
    }

    const lead = leadIn(line);
    if (lead !== undefined) {
      entries.push({ type: 'entries', name: lead.name, entries: [inlineText(lead.rest)] });
      continue;
    }
    entries.push(inlineText(line));
  }

  return sourceLine === undefined ? { entries } : { entries, sourceLine };
}

/** All prose in entries, flattened, for the text scans (saves, attacks, mastery). */
export function plainText(entries: readonly Entry[]): string {
  const out: string[] = [];
  const walk = (e: unknown) => {
    if (typeof e === 'string') out.push(e);
    else if (Array.isArray(e)) e.forEach(walk);
    else if (e !== null && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      if (typeof o.name === 'string') out.push(o.name);
      walk(o.entries);
      walk(o.items);
      walk(o.rows);
    }
  };
  walk(entries);
  return out.join('\n');
}
