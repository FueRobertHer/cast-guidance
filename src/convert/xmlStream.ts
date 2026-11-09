/**
 * An XML file read as it arrives, one entry at a time: the root's children
 * are handed on as each closes, and neither the whole text nor the whole tree
 * is ever held. A community compendium runs to 56 MB and 572,000 elements,
 * most of them creatures and classes the converter does not read, so an entry
 * of a kind not asked for comes as its name and attributes alone.
 *
 * It reads with the same tokenizer as {@link readXml} and keeps the same stack
 * of open elements, so a file gives the same entries, recovered the same way,
 * whichever reads it. Text the reader has to wait on (a tag or a comment cut
 * by a chunk boundary) is read again only once there is twice as much of it,
 * so a long one costs linear time however small the chunks.
 */
import {
  appendText,
  closeOpen,
  countElement,
  newElement,
  scanXml,
  type XmlElement,
  XmlError,
  type XmlLimits,
  type XmlSink,
  xmlProblems,
} from './xml';

export interface XmlEntryOptions {
  limits: XmlLimits;
  /** Whether an entry of this name is built whole; any other comes as its name and attributes. */
  keep(name: string): boolean;
  /** The root element, as soon as it opens. Throw to stop reading. */
  onRoot?(root: XmlElement): void;
  /** Each child element of the root, once it closes or the file ends inside it. */
  onEntry(entry: XmlElement): void;
}

export interface XmlEntries {
  /** The root element, with its attributes and none of its children. */
  root: XmlElement;
  /** As {@link XmlRead.problems}. */
  problems: string[];
}

/**
 * The tree builder of {@link readXml}, cut at the root's children: each is
 * built (or not) on its own and handed on when it closes.
 */
class EntrySink implements XmlSink {
  /** The open elements, the document first. */
  readonly stack: XmlElement[] = [newElement('#document')];
  root: XmlElement | undefined;
  /** The open child of the root, and whether its insides are built. */
  private entry: XmlElement | undefined;
  private building = false;
  private elements = 0;
  mismatched = 0;
  private readonly opts: XmlEntryOptions;

  constructor(opts: XmlEntryOptions) {
    this.opts = opts;
  }

  private top(): XmlElement | undefined {
    return this.stack[this.stack.length - 1];
  }

  text(text: string): void {
    // The root's own text, a skipped entry's and anything after the root are
    // no part of an entry.
    const top = this.top();
    if (this.building && this.stack.length > 2 && top !== undefined) appendText(top, text);
  }

  open(el: XmlElement, selfClosing: boolean): void {
    this.elements += 1;
    countElement(this.elements, this.stack.length, selfClosing, this.opts.limits);
    const depth = this.stack.length;
    if (depth === 1 && this.root === undefined) {
      this.root = el;
      this.opts.onRoot?.(el);
    } else if (depth === 2 && this.stack[1] === this.root) {
      this.entry = el;
      this.building = this.opts.keep(el.name);
    } else if (this.building && depth > 2) {
      this.top()?.children.push(el);
    }
    // Anything else (inside a skipped entry, or after the root) is kept on
    // the stack alone, for its closing tag to find.
    if (!selfClosing) this.stack.push(el);
    else if (this.entry === el) this.emit();
  }

  close(name: string): void {
    if (closeOpen(this.stack, name)) this.mismatched += 1;
    if (this.entry !== undefined && this.stack.length <= 2) this.emit();
  }

  /** The open entry, handed on. */
  emit(): void {
    const entry = this.entry;
    this.entry = undefined;
    this.building = false;
    if (entry !== undefined) this.opts.onEntry(entry);
  }
}

/**
 * Read an XML file from its text in chunks, handing each child of the root to
 * `onEntry`. Throws {@link XmlError} as {@link readXml} does, and whatever
 * `onRoot` throws.
 */
export async function readXmlEntries(
  chunks: AsyncIterable<string>,
  opts: XmlEntryOptions,
): Promise<XmlEntries> {
  const sink = new EntrySink(opts);
  let pending = '';
  let length = 0;
  let first = true;
  /** How long `pending` must be before it is worth reading again. */
  let readAt = 0;
  for await (const chunk of chunks) {
    length += chunk.length;
    if (length > opts.limits.maxLength) throw new XmlError('The file is too large to read.');
    pending += first && chunk.charCodeAt(0) === 0xfeff ? chunk.slice(1) : chunk;
    first = false;
    if (pending.length < readAt) continue;
    const { next } = scanXml(pending, 0, false, sink);
    pending = pending.slice(next);
    readAt = pending.length * 2;
  }
  const { cutInside } = scanXml(pending, 0, true, sink);
  // A file cut off inside an entry: what was read of it, as the whole-file
  // reader keeps it.
  sink.emit();
  const root = sink.root;
  if (root === undefined) throw new XmlError('The file has no XML elements.');
  return { root, problems: xmlProblems(cutInside, sink.stack[1]?.name, sink.mismatched) };
}
