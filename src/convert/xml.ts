/**
 * A small, forgiving XML reader for files other apps export (a Fight Club 5e
 * compendium first). It builds a plain tree and nothing else: no namespaces,
 * no DTDs, no entities beyond the predefined and numeric ones.
 *
 * Why not the browser's `DOMParser`: it is missing in a Web Worker and in Bun
 * scripts, and it rejects a whole file over one stray `&` or an unclosed tag,
 * which hand-edited compendiums are full of. This reader keeps such a `&` as
 * text, closes what a file leaves open, and ignores a closing tag that matches
 * nothing, so one bad entry does not cost the other thousand.
 *
 * What it refuses is what could hurt: a `<!DOCTYPE>` or any other `<!`
 * declaration (entity expansion, external references) and a file past the
 * size, element or depth limits. Element and attribute names are lowercased,
 * so `<Name>` and `<name>` read the same.
 */
import { IMPORT_LIMITS } from '../lib/guards';

export interface XmlElement {
  /** Lowercased. */
  name: string;
  /** Lowercased names. Built without a prototype, so any name is safe. */
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export class XmlError extends Error {
  override name = 'XmlError';
}

export interface XmlLimits {
  /** UTF-16 length of the whole text. */
  maxLength: number;
  /** Elements anywhere in the tree. */
  maxElements: number;
  /** Element nesting depth. */
  maxDepth: number;
}

/**
 * The same bounds a JSON import gets: the byte cap on what is read, and a
 * depth that no real compendium comes near. The element cap leaves about four
 * times the elements of the largest file measured, the Fight Club SRD 5.1
 * compendium (3.5 MB).
 */
export const XML_LIMITS: XmlLimits = {
  maxLength: IMPORT_LIMITS.maxImportBytes,
  maxElements: 400_000,
  maxDepth: IMPORT_LIMITS.maxDepth,
};

/**
 * The bounds for a file read as it arrives (`xmlStream.ts`), which never holds
 * the whole text or tree: room for the largest community compendiums
 * measured, 56 MB and 572,000 elements, with the depth unchanged.
 */
export const XML_FILE_LIMITS: XmlLimits = {
  maxLength: IMPORT_LIMITS.maxXmlImportBytes,
  maxElements: 1_000_000,
  maxDepth: IMPORT_LIMITS.maxDepth,
};

/** The entities XML predefines, plus a few HTML ones hand-written files use. */
const NAMED_ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  minus: '−',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
};

const ENTITY = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,9});/gi;

/** Decode entities; anything unknown (a bare `&`, `&foo;`) stays as written. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      const valid =
        Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(NAMED_ENTITIES, body.toLowerCase())
      ? (NAMED_ENTITIES[body.toLowerCase()] ?? whole)
      : whole;
  });
}

function isNameStart(ch: string): boolean {
  return /[A-Za-z_:]/.test(ch);
}

function isNameChar(ch: string): boolean {
  return /[A-Za-z0-9_:.-]/.test(ch);
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

export function newElement(name: string): XmlElement {
  return { name, attrs: Object.create(null) as Record<string, string>, children: [] };
}

export function appendText(parent: XmlElement, text: string): void {
  if (text === '') return;
  const last = parent.children.length - 1;
  const prev = parent.children[last];
  if (typeof prev === 'string') parent.children[last] = prev + text;
  else parent.children.push(text);
}

/** A parsed file, and what the reader had to recover from, in words. */
export interface XmlRead {
  root: XmlElement;
  /**
   * Where the file is not well formed: cut off, or tags that do not match.
   * The reader recovers and carries on, so this is the only sign that what
   * it read may be incomplete.
   */
  problems: string[];
}

/** Parse `text` into its root element. See {@link readXml}. */
export function parseXml(text: string, limits: XmlLimits = XML_LIMITS): XmlElement {
  return readXml(text, limits).root;
}

/** What {@link scanXml} reads, in document order. */
export interface XmlSink {
  /** Text, entities decoded; a CDATA section as written; a lone `<` as itself. */
  text(text: string): void;
  /** An opening tag, read whole: its element has its attributes and no children yet. */
  open(el: XmlElement, selfClosing: boolean): void;
  /** A closing tag's name, lowercased. */
  close(name: string): void;
}

export interface XmlScan {
  /** Where reading stopped: the end, or the start of what the text may cut short. */
  next: number;
  /** For the end of a file: what the file is cut off inside, if anything. */
  cutInside?: string;
}

/** The longest opening (`<![CDATA[`) a construct can be told by, which text can end inside. */
const LONGEST_OPENING = 9;

/**
 * Read `text` from `from`, telling `sink` what it finds.
 *
 * With `final` set, the text runs to the end of the file: it is read to its
 * end, recovering from whatever the file cuts short. Without it, more may
 * follow: reading stops at the start of anything the text might cut short (a
 * tag, a comment, text whose end is not yet in sight), and `next` says where
 * to go on from once more has come. Read either way, a file gives the sink the
 * same calls.
 */
export function scanXml(text: string, from: number, final: boolean, sink: XmlSink): XmlScan {
  const n = text.length;
  let i = from;
  /** What the file was cut off inside, if it ends mid-construct. */
  let cutInside: string | undefined;

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      // Text to the end, whole only when nothing follows it: an entity can
      // be cut in two.
      if (!final) return { next: i };
      sink.text(decodeEntities(text.slice(i)));
      i = n;
      break;
    }
    if (lt > i) sink.text(decodeEntities(text.slice(i, lt)));
    i = lt;
    if (!final && n - i < LONGEST_OPENING) return { next: i };
    const next = text.charAt(i + 1);

    if (text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      if (close === -1) {
        if (!final) return { next: i };
        cutInside = 'a comment';
      }
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const close = text.indexOf(']]>', i + 9);
      if (close === -1) {
        if (!final) return { next: i };
        cutInside = 'a CDATA section';
      }
      sink.text(text.slice(i + 9, close === -1 ? n : close));
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (next === '!') {
      throw new XmlError(
        'The file declares a DOCTYPE or entities, which are not read, for safety.',
      );
    }
    if (next === '?') {
      const close = text.indexOf('?>', i + 2);
      if (close === -1 && !final) return { next: i };
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (next === '/') {
      const close = text.indexOf('>', i + 2);
      if (close === -1) {
        if (!final) return { next: i };
        cutInside = 'a tag';
        break;
      }
      sink.close(
        text
          .slice(i + 2, close)
          .trim()
          .toLowerCase(),
      );
      i = close + 1;
      continue;
    }
    if (!isNameStart(next)) {
      // A lone `<` in text ("AC < 15"): keep it as text.
      sink.text('<');
      i += 1;
      continue;
    }

    // An opening tag: its name, then attributes up to `>` or `/>`.
    let j = i + 1;
    while (j < n && isNameChar(text.charAt(j))) j += 1;
    const el = newElement(text.slice(i + 1, j).toLowerCase());
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      const ch = text.charAt(j);
      if (isSpace(ch)) {
        j += 1;
        continue;
      }
      if (ch === '>') {
        j += 1;
        closed = true;
        break;
      }
      if (ch === '/' && text.charAt(j + 1) === '>') {
        j += 2;
        selfClosing = true;
        closed = true;
        break;
      }
      // An attribute: name, then an optional `=value`, quoted or not.
      const nameStart = j;
      while (j < n && !isSpace(text.charAt(j)) && !'=/>'.includes(text.charAt(j))) j += 1;
      const attrName = text.slice(nameStart, j).toLowerCase();
      while (j < n && isSpace(text.charAt(j))) j += 1;
      let value = '';
      if (text.charAt(j) === '=') {
        j += 1;
        while (j < n && isSpace(text.charAt(j))) j += 1;
        const quote = text.charAt(j);
        if (quote === '"' || quote === "'") {
          const end = text.indexOf(quote, j + 1);
          value = text.slice(j + 1, end === -1 ? n : end);
          j = end === -1 ? n : end + 1;
        } else {
          const start = j;
          while (j < n && !isSpace(text.charAt(j)) && text.charAt(j) !== '>') j += 1;
          value = text.slice(start, j);
        }
      }
      if (attrName !== '') el.attrs[attrName] = decodeEntities(value);
      // A stray character the loop above could not consume: step over it.
      if (j === nameStart) j += 1;
    }
    if (!closed) {
      if (!final) return { next: i };
      // A tag cut off at the end of the file, or an attribute quote never
      // closed, which runs to the end.
      cutInside = 'a tag';
      break;
    }
    sink.open(el, selfClosing);
    i = j;
  }
  return cutInside === undefined ? { next: i } : { next: i, cutInside };
}

/**
 * The open elements, the document first, as a closing tag finds them: it
 * closes the nearest open element of its name and everything inside that, and
 * one that matches nothing open is ignored. Whether it closed over anything,
 * which is a sign the file is not well formed, is the result.
 */
export function closeOpen(stack: XmlElement[], name: string): boolean {
  let k = stack.length - 1;
  while (k > 0 && stack[k]?.name !== name) k -= 1;
  const mismatched = k !== stack.length - 1;
  if (k > 0) stack.length = k;
  return mismatched;
}

/** What a reader recovered from, in words: see {@link XmlRead.problems}. */
export function xmlProblems(
  cutInside: string | undefined,
  unclosed: string | undefined,
  mismatched: number,
): string[] {
  const problems: string[] = [];
  if (cutInside !== undefined || unclosed !== undefined) {
    const where =
      cutInside !== undefined
        ? `inside ${cutInside}`
        : `before its <${unclosed}> element is closed`;
    problems.push(
      `The file ends ${where}, so it may be cut off: entries near the end can be missing or incomplete.`,
    );
  }
  if (mismatched > 0) {
    problems.push(
      `${mismatched} closing ${mismatched === 1 ? 'tag does not match the tag it closes' : 'tags do not match the tags they close'}, so some entries may be read wrong.`,
    );
  }
  return problems;
}

/** Counts an element against the limits, as it opens. */
export function countElement(
  count: number,
  depth: number,
  selfClosing: boolean,
  limits: XmlLimits,
) {
  if (count > limits.maxElements) throw new XmlError('The file has too many elements to read.');
  if (!selfClosing && depth > limits.maxDepth) throw new XmlError('The file is nested too deeply.');
}

/**
 * Parse `text` into its root element and the problems it recovered from.
 * Throws {@link XmlError} for a refused declaration, a file past the limits,
 * or one with no element at all.
 */
export function readXml(text: string, limits: XmlLimits = XML_LIMITS): XmlRead {
  if (text.length > limits.maxLength) throw new XmlError('The file is too large to read.');
  const doc = newElement('#document');
  const stack: XmlElement[] = [doc];
  const top = (): XmlElement => stack[stack.length - 1] ?? doc;
  let elements = 0;
  /** Closing tags that matched nothing open, or closed over open elements. */
  let mismatched = 0;
  const { cutInside } = scanXml(text, text.charCodeAt(0) === 0xfeff ? 1 : 0, true, {
    text: (t) => appendText(top(), t),
    open: (el, selfClosing) => {
      elements += 1;
      countElement(elements, stack.length, selfClosing, limits);
      top().children.push(el);
      if (!selfClosing) stack.push(el);
    },
    close: (name) => {
      if (closeOpen(stack, name)) mismatched += 1;
    },
  });

  const root = doc.children.find((c): c is XmlElement => typeof c !== 'string');
  if (root === undefined) throw new XmlError('The file has no XML elements.');
  return { root, problems: xmlProblems(cutInside, stack[1]?.name, mismatched) };
}

/** Child elements, all of them or those named `name` (lowercase). */
export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter(
    (c): c is XmlElement => typeof c !== 'string' && (name === undefined || c.name === name),
  );
}

/** All text inside a node, in document order. */
export function textContent(node: XmlNode): string {
  if (typeof node === 'string') return node;
  return node.children.map(textContent).join('');
}

/**
 * The text of the first child named `name`, trimmed and with runs of white
 * space as one space, or undefined when absent or blank.
 */
export function childText(el: XmlElement, name: string): string | undefined {
  const child = el.children.find((c): c is XmlElement => typeof c !== 'string' && c.name === name);
  if (child === undefined) return undefined;
  // A field is one value: runs of white space are one space, which also keeps
  // the converters' patterns from backtracking over a long run.
  const text = textContent(child).replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text;
}

/** The text of every child named `name`, blank ones included as ''. */
export function childTexts(el: XmlElement, name: string): string[] {
  return childElements(el, name).map(textContent);
}
