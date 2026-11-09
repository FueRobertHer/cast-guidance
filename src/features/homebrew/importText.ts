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
 */

import { looksLikeXml } from '@/convert/sniff';
import type { ConversionReport } from '@/convert/types';
import { convertedTotal } from '@/convert/types';

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

/**
 * Read an import's text into homebrew JSON. Throws `SyntaxError` for JSON that
 * does not parse, and for XML: `XmlError`, `UnsupportedFormatError` or
 * {@link NothingToImportError}, each with a message for the player.
 */
export async function parseImportText(text: string, fileName: string): Promise<ParsedImport> {
  if (!looksLikeXml(text)) return { raw: JSON.parse(text) as unknown };
  const { convertImportXml } = await import('./convertImport');
  const { result, coverage } = await convertImportXml(text, fileName);
  const { json, report } = result;
  if (convertedTotal(report) === 0) throw new NothingToImportError(report);
  if (coverage !== undefined) report.warnings.push(coverage);
  return { raw: json, conversion: report };
}
