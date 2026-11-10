/**
 * Files from other apps, converted into the 5etools homebrew format this app
 * stores. Every converter is pure (text in, JSON and a report out) and needs
 * no browser API, so it runs the same in the app, a worker or a Bun script.
 *
 * Today: Fight Club 5e compendiums (also read by Game Master 5e and
 * Encounter+). Aurora Builder content and other apps' character files are
 * recognized, so the player hears what the file is rather than "invalid".
 */
import { convertFc5Compendium, fc5Converter, fc5Converts, fc5Indexes } from './fc5/compendium';
import type { ConversionResult, ConvertOptions } from './types';
import { readXml, XML_FILE_LIMITS, type XmlElement } from './xml';
import { readXmlEntries } from './xmlStream';

export type {
  ConversionReport,
  ConversionResult,
  ConvertedKind,
  ConvertOptions,
  EntryNote,
} from './types';
export { XmlError } from './xml';

/** A file in a format this app recognizes but cannot import (yet). */
export class UnsupportedFormatError extends Error {
  override name = 'UnsupportedFormatError';
}

const CAN_IMPORT = 'Fight Club 5e compendiums (XML) and 5etools homebrew (JSON) can be imported.';

/** A web page rather than a file: a folder listing, or a page that links to the file. */
const WEB_PAGE = /^(?:<!doctype\s+html|<html[\s>])/i;

/** Convert an XML file. Throws `XmlError` or {@link UnsupportedFormatError} with words for the player. */
export function convertXmlText(text: string, opts: ConvertOptions): ConversionResult {
  assertNotWebPage(text);
  const { root, problems } = readXml(text);
  assertConvertible(root);
  const result = convertFc5Compendium(root, opts);
  result.report.warnings.unshift(...problems);
  return result;
}

/**
 * Convert an XML file from its text in chunks, as it is read: a file too
 * large to hold whole, on a worker. `open` reads the file from its start, and
 * is called twice: the first read takes what converting any entry depends on
 * from the rest of the file (its spells, feats and classes), the second
 * converts each entry and lets it go. Entries the converter does not read
 * (creatures) are only counted. The result is the one {@link convertXmlText}
 * gives, without ever holding the file; its bounds are {@link XML_FILE_LIMITS}.
 */
export async function convertXmlChunks(
  open: () => AsyncIterable<string>,
  opts: ConvertOptions,
): Promise<ConversionResult> {
  const converter = fc5Converter(opts);
  await readXmlEntries(webPageChecked(open()), {
    limits: XML_FILE_LIMITS,
    keep: fc5Indexes,
    // A file the app cannot convert is refused before the rest is read.
    onRoot: assertConvertible,
    onEntry: (entry) => converter.index(entry),
  });
  const { problems } = await readXmlEntries(open(), {
    limits: XML_FILE_LIMITS,
    keep: fc5Converts,
    onEntry: (entry) => converter.convert(entry),
  });
  const result = converter.finish();
  result.report.warnings.unshift(...problems);
  return result;
}

/** How much of a file's start {@link assertNotWebPage} looks at. */
const START = 32;

function assertNotWebPage(text: string): void {
  const start = text.search(/\S/);
  if (start !== -1 && WEB_PAGE.test(text.slice(start, start + START))) {
    throw new UnsupportedFormatError(
      `This is a web page, not a file the app can import. Open it, find the file it links to, and import that. ${CAN_IMPORT}`,
    );
  }
}

/** The chunks as they are, once their start has been checked for a web page. */
async function* webPageChecked(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let head = '';
  let checked = false;
  // Where the first non-space falls in `head`. Only each new chunk is
  // searched, so a file of leading spaces costs one pass, not one per chunk.
  let start = -1;
  for await (const chunk of chunks) {
    if (!checked) {
      if (start === -1) {
        const at = chunk.search(/\S/);
        if (at !== -1) start = head.length + at;
      }
      head += chunk;
      if (start === -1 || head.length < start + START) continue;
      assertNotWebPage(head);
      checked = true;
      yield head;
      head = '';
      continue;
    }
    yield chunk;
  }
  if (!checked) {
    assertNotWebPage(head);
    yield head;
  }
}

/** Throws {@link UnsupportedFormatError} for a root element this app cannot convert. */
function assertConvertible(root: XmlElement): void {
  switch (root.name) {
    case 'compendium':
      return;
    case 'elements':
      throw new UnsupportedFormatError(
        `This looks like Aurora Builder content, which cannot be imported yet. ${CAN_IMPORT}`,
      );
    case 'source':
    case 'collection':
      throw new UnsupportedFormatError(
        'This is a Fight Club collection list, which only names other files. Import the compendium files it lists instead.',
      );
    case 'pc':
    case 'character':
    case 'characters':
      throw new UnsupportedFormatError(
        `This looks like a character from another app, which cannot be imported yet. ${CAN_IMPORT}`,
      );
    default:
      throw new UnsupportedFormatError(
        `This XML file (<${root.name}>) is not a format the app knows. ${CAN_IMPORT}`,
      );
  }
}
