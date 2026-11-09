/**
 * The books a Fight Club entry cites, read from the `Source:` line every
 * entry ends with: `Source: Xanathar's Guide to Everything p. 150, Elemental
 * Evil Player's Companion p. 15`. The first book is the entry's own; the
 * rest are other printings or references.
 *
 * The book decides what the converter does with an entry. One the game data
 * holds is checked against that book, so an official entry is never copied.
 * One it does not hold (a third-party book, an Unearthed Arcana document)
 * becomes a homebrew source of its own, titled after the book, so its
 * entries group with the official ones of the same name as other printings
 * and the Settings book toggles turn them on and off. On the entry the
 * citation becomes the fields 5etools uses: `source`, `page` and
 * `otherSources`.
 */
import { type RulesVersion, SOURCES_2024, sourceEdition } from '../../data5e/rulesVersion';
import { knownSources, sourceName } from '../../data5e/sourceNames';

export interface Book {
  /** The title as the file writes it, tidied. */
  title: string;
  page?: number;
  /** The game data's code for the book, when the app knows the title. */
  code?: string;
  /**
   * A free rules text (a System Reference Document, the Basic Rules): no book
   * of its own in the game data, which has its entries under the books they
   * come from.
   */
  reference?: true;
}

/** A source in a converted file's `_meta.sources`. */
export interface HomebrewSource {
  json: string;
  abbreviation: string;
  full: string;
}

/** A title reduced for lookup: case, apostrophes, `&amp;` and punctuation set aside. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[‘’']/g, '')
    .replace(/\bvol\.(?=\s|$)/g, 'volume')
    .replace(/[^a-z0-9&]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/**
 * Titles Fight Club writes differently from the game data's own: the older
 * files name the 2014 core books without a year, and one file dates the 2024
 * guide 2025.
 */
const ALIASES: Record<string, string> = {
  "player's handbook": 'PHB',
  "dungeon master's guide": 'DMG',
  'monster manual': 'MM',
  "dungeon master's guide 2025": 'XDMG',
};

let byTitle: Map<string, string> | undefined;

/**
 * Title keys to codes, built on first use. A code stands for its book too:
 * some entries cite `PHB p. 241`.
 */
function titleTable(): Map<string, string> {
  if (byTitle === undefined) {
    const table = new Map<string, string>();
    for (const code of knownSources()) table.set(titleKey(code), code);
    for (const code of knownSources()) table.set(titleKey(sourceName(code)), code);
    for (const [title, code] of Object.entries(ALIASES)) table.set(titleKey(title), code);
    byTitle = table;
  }
  return byTitle;
}

/**
 * `System Reference Document 5.1`, `SRD 5.2.1`, `SRD5.1`, `Basic Rules (2018)`,
 * `Free Rules`. A title that only ends in `SRD` is not one: third-party games
 * publish theirs under that name too.
 */
function isReference(title: string): boolean {
  const key = titleKey(title);
  return (
    /^(?:system reference document|srd)(?:\b|(?=\d))/.test(key) ||
    /\b(?:basic|free) rules\b/.test(key)
  );
}

/**
 * The game data's code for a title. A title the table does not know is tried
 * by its parts, since Fight Club names some books by series: `Spelljammer:
 * Adventures in Space - Astral Adventurer's Guide` is the Astral Adventurer's
 * Guide, `Essentials Kit: Divine Contention` is Divine Contention, and
 * `Curse of Strahd: Optional Backgrounds` belongs to Curse of Strahd.
 */
export function bookCode(title: string): string | undefined {
  const table = titleTable();
  const whole = table.get(titleKey(title));
  if (whole !== undefined) return whole;
  const dash = title.lastIndexOf(' - ');
  if (dash !== -1) {
    const code = table.get(titleKey(title.slice(dash + 3)));
    if (code !== undefined) return code;
  }
  const colon = title.indexOf(': ');
  if (colon !== -1) {
    return (
      table.get(titleKey(title.slice(colon + 2))) ?? table.get(titleKey(title.slice(0, colon)))
    );
  }
  return undefined;
}

const MAX_PARTS = 24;
const MAX_TITLE = 160;

/** How Fight Club marks a book that is not Wizards of the Coast's own. */
const KIND_TAG = / ?\((?:indie|third party|homebrew|3rd party)\)$/i;
/** A page reference: `p. 150`, `p.150`, `page 12`, `p. 35-36`. */
const PAGE = /\bp(?:age|g)?\.? ?(\d{1,5})(?: ?[-–] ?\d{1,5})?\b/gi;

/** A title with its page and kind tag taken off, or undefined when nothing is left. */
function readBook(part: string): Book | undefined {
  let text = part.replace(KIND_TAG, '').trim();
  let page: number | undefined;
  let last: RegExpExecArray | undefined;
  PAGE.lastIndex = 0;
  for (let m = PAGE.exec(text); m !== null; m = PAGE.exec(text)) last = m;
  if (last !== undefined) {
    const after = text
      .slice(last.index + last[0].length)
      .replace(KIND_TAG, '')
      .trim();
    if (after === '') {
      page = Number(last[1]);
      text = text.slice(0, last.index).trim();
    }
  }
  let end = text.length;
  while (end > 0 && ' ,;.'.includes(text.charAt(end - 1))) end -= 1;
  text = text.slice(0, end).replace(KIND_TAG, '').trim();
  // A line that runs on into the entry's text is no title.
  if (text === '' || text.length > MAX_TITLE) return undefined;
  const book: Book = { title: text };
  if (page !== undefined) book.page = page;
  const code = bookCode(text);
  if (code !== undefined) book.code = code;
  else if (isReference(text)) book.reference = true;
  return book;
}

/**
 * A `Source:` line, without its label, into the books it names, the entry's
 * own first. Books are split at commas, but a title can hold a comma itself
 * (`Unearthed Arcana: The Ranger, Revised p. 5`): a part with no page that is
 * not a title the app knows runs on into the next part, unless that part is a
 * title the app knows or the first ends in a kind tag (`Vianna's Exotic
 * Weapons (Homebrew), Player's Handbook (2014)`).
 */
export function readSourceLine(line: string): Book[] {
  const books: Book[] = [];
  let pending = '';
  const flush = () => {
    const book = pending === '' ? undefined : readBook(pending);
    if (book !== undefined) books.push(book);
    pending = '';
  };
  // No entry cites more than a handful of books, and no title runs longer
  // than a line; a file that does is not read past that.
  const parts = line.replace(/\s+/g, ' ').split(',', MAX_PARTS);
  for (const raw of parts) {
    const part = raw.trim();
    if (part === '') continue;
    // `Player's Handbook, p. 213`: the page of the title before it.
    const pageOnly = /^p(?:age|g)?\.? ?(\d{1,5})$/i.exec(part.replace(KIND_TAG, ''));
    if (pageOnly !== null) {
      const target = pending !== '' ? readBook(pending) : books.pop();
      pending = '';
      if (target !== undefined) books.push({ ...target, page: Number(pageOnly[1]) });
      continue;
    }
    // A title the app knows is a book of its own, and so is a title cut short.
    if (readBook(part)?.code !== undefined) flush();
    if (pending !== '' && pending.length + part.length + 2 > MAX_TITLE) flush();
    pending = pending === '' ? part : `${pending}, ${part}`;
    PAGE.lastIndex = 0;
    if (PAGE.test(part) || KIND_TAG.test(part) || bookCode(pending) !== undefined) flush();
  }
  flush();
  return books;
}

/** The edition a book's code says, when it says one. */
export function codeEdition(
  code: string,
  rulesBooks: ReadonlySet<string> | undefined,
): RulesVersion {
  return rulesBooks?.has(code) === true ? '2024' : sourceEdition(code);
}

/** The 2014 core books, whose 2024 revisions have codes of their own. */
const CORE_2014 = new Set(['PHB', 'DMG', 'MM']);

/**
 * Whether {@link codeEdition} knows a book's edition rather than guessing it:
 * a core book's is known, and any book's once the installed data has said
 * which books are 2024 rules. Without that data a later 2024 book (Heroes of
 * Faerûn) reads as 2014.
 */
export function editionKnown(code: string, rulesBooks: ReadonlySet<string> | undefined): boolean {
  return rulesBooks !== undefined || SOURCES_2024.has(code) || CORE_2014.has(code);
}

const MAX_ID = 40;

/** FNV-1a, for an id that had to be cut short and must still be unique. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 5);
}

function camel(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** `Valda's Spire of Secrets` as `VSoS`: each word's first letter, small words lowercased. */
function initials(title: string): string {
  const small = new Set(['a', 'an', 'and', 'of', 'the', 'to', 'in', 'on', 'for', 'from']);
  const out = title
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => (/^\d+$/.test(w) ? w : small.has(w.toLowerCase()) ? w[0] : w[0]?.toUpperCase()))
    .join('');
  return out.slice(0, 8) || 'FC';
}

/**
 * The homebrew source for a book's entries. The id is built from the title, so
 * the same book in two files (or two imports of one file) has the same source.
 * A 2024 entry from a book whose edition the app cannot tell gets a source of
 * its own, `Title (2024)`: Fight Club's 5.5e files mark a third-party entry
 * revised for 2024 that way, and as a printing of its own it sits beside the
 * original instead of hiding it.
 */
export function bookSource(title: string, edition2024: boolean): HomebrewSource {
  const full = edition2024 ? `${title} (2024)` : title;
  let id = camel(title) || 'Book';
  if (id.length > MAX_ID) id = `${id.slice(0, MAX_ID - 5)}${shortHash(title)}`;
  const json = `FC${id}${edition2024 ? '2024' : ''}`;
  return { json, abbreviation: `${initials(title)}${edition2024 ? '24' : ''}`, full };
}
