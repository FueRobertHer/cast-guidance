/**
 * Files from other apps, converted into the 5etools homebrew format this app
 * stores. Every converter is pure (text in, JSON and a report out) and needs
 * no browser API, so it runs the same in the app, a worker or a Bun script.
 *
 * Today: Fight Club 5e compendiums (also read by Game Master 5e and
 * Encounter+). Aurora Builder content and other apps' character files are
 * recognized, so the player hears what the file is rather than "invalid".
 */
import { convertFc5Compendium } from './fc5/compendium';
import type { ConversionResult, ConvertOptions } from './types';
import { readXml } from './xml';

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
  const start = text.search(/\S/);
  if (start !== -1 && WEB_PAGE.test(text.slice(start, start + 32))) {
    throw new UnsupportedFormatError(
      `This is a web page, not a file the app can import. Open it, find the file it links to, and import that. ${CAN_IMPORT}`,
    );
  }
  const { root, problems } = readXml(text);
  switch (root.name) {
    case 'compendium': {
      const result = convertFc5Compendium(root, opts);
      result.report.warnings.unshift(...problems);
      return result;
    }
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
