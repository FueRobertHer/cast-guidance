/**
 * The one step every homebrew import shares, file or URL: the text read, into
 * the 5etools homebrew JSON the app stores. JSON is parsed as it is; XML from
 * another app goes through a converter first, and its report rides along to
 * the preview.
 *
 * Which it is comes from the text, not the file name or content type: a file
 * saved without its extension, or a URL that names neither, still imports.
 * The converter is its own chunk, loaded only for XML, so a JSON import never
 * downloads it.
 *
 * A picked XML file is read by the converter's worker as it streams, so it may
 * be far larger than a JSON one (`maxXmlImportBytes` against `maxImportBytes`):
 * the page holds neither its text nor its tree.
 */

import { looksLikeXml } from '@/convert/sniff';
import type { ConversionReport } from '@/convert/types';
import { convertedTotal } from '@/convert/types';
import { ResponseTooLargeError, readFileTextBounded } from '@/lib/boundedRead';
import { IMPORT_LIMITS } from '@/lib/guards';
import type { ImportProgress } from './convertImport';

/** How much of a picked file is read to tell XML from JSON. */
const SNIFF_BYTES = 64 * 1024;

/** Progress and cancelling, for a conversion. */
export interface ImportOptions {
  /** How far the conversion has read. Not called for JSON, which is read at once. */
  onProgress?: ImportProgress;
  /** Aborting it stops the conversion and rejects with `ImportCancelledError`. */
  signal?: AbortSignal;
}

export interface ParsedImport {
  /** The homebrew JSON. `homebrewRepo.prepare` validates it. */
  raw: unknown;
  /** Set when the file was converted from another app's format. */
  conversion?: ConversionReport;
}

/**
 * A converted file with no entries to add. Its message says why in full
 * sentences: everything is already in the game data (`allInstalled`, which
 * is not a failure), or the file holds only what cannot be converted.
 */
export class NothingToImportError extends Error {
  override name = 'NothingToImportError';
  readonly report: ConversionReport;
  readonly allInstalled: boolean;
  constructor(report: ConversionReport) {
    const installed = report.notes.filter((n) => n.status === 'installed').length;
    const allInstalled =
      installed > 0 && installed === report.notes.length && report.warnings.length === 0;
    super(nothingText(report, installed, allInstalled));
    this.report = report;
    this.allInstalled = allInstalled;
  }
}

function nothingText(report: ConversionReport, installed: number, allInstalled: boolean): string {
  const file = `this ${report.formatName} file`;
  if (allInstalled) {
    return `Every entry in ${file} is already in your game data, so there is nothing to add.`;
  }
  const why = [
    ...(installed > 0
      ? [`${installed} ${installed === 1 ? 'is' : 'are'} already in your game data.`]
      : []),
    ...report.warnings,
  ];
  const skipped = report.notes.find((n) => n.status === 'skipped');
  if (why.length === 0 && skipped !== undefined) {
    why.push(`${skipped.name} was left out: ${skipped.reasons.join('; ')}.`);
  }
  return [`Nothing in ${file} could be converted.`, ...why].join(' ');
}

/** What a read rejects with once its `signal` is aborted. */
export class ImportCancelledError extends Error {
  override name = 'ImportCancelledError';
  constructor() {
    super('The import was cancelled.');
  }
}

function stopIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new ImportCancelledError();
}

/**
 * Read an import's text into homebrew JSON. Throws `SyntaxError` for JSON that
 * does not parse, and for XML: `XmlError`, `UnsupportedFormatError` or
 * {@link NothingToImportError}, each with a message for the player.
 */
export async function parseImportText(
  text: string,
  fileName: string,
  options: ImportOptions = {},
): Promise<ParsedImport> {
  if (!looksLikeXml(text)) return { raw: JSON.parse(text) as unknown };
  return convertXml(text, fileName, options);
}

/**
 * Read a picked file into homebrew JSON, as {@link parseImportText} does, and
 * throw `ResponseTooLargeError` for one over its kind's limit. Which kind it
 * is comes from its first characters, so an XML file is never read whole.
 */
export async function parseImportFile(
  file: File,
  options: ImportOptions = {},
): Promise<ParsedImport> {
  // A character cut at the end of the slice decodes as a replacement, which
  // is not space, so it is never taken for the first character after space.
  const head = await file.slice(0, SNIFF_BYTES).text();
  stopIfCancelled(options.signal);
  if (!looksLikeXml(head)) {
    const text = await readFileTextBounded(file, IMPORT_LIMITS.maxImportBytes);
    stopIfCancelled(options.signal);
    return { raw: JSON.parse(text) as unknown };
  }
  const limit = IMPORT_LIMITS.maxXmlImportBytes;
  if (file.size > limit) throw new ResponseTooLargeError(limit, file.size, 'file');
  const parsed = await convertXml(file, file.name, options);
  // A Cancel pressed as the conversion finished still cancels.
  stopIfCancelled(options.signal);
  return parsed;
}

async function convertXml(
  source: Blob | string,
  fileName: string,
  options: ImportOptions,
): Promise<ParsedImport> {
  const { convertImportXml } = await import('./convertImport');
  const { result, coverage } = await convertImportXml(source, fileName, options);
  const { json, report } = result;
  if (convertedTotal(report) === 0) throw new NothingToImportError(report);
  if (coverage !== undefined) report.warnings.push(coverage);
  return { raw: json, conversion: report };
}
