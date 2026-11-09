/**
 * Another app's XML into homebrew JSON, for the import page. Loaded only when
 * an import turns out to be XML (see `importText.ts`), so the converters stay
 * out of every other chunk.
 *
 * Entries the installed game data already has are left out: the installed copy
 * carries the app's curated mechanics, and a second one in every picker is
 * noise. What counts as installed is the official part of the registry, read
 * by name and rules edition.
 */
import { type ConversionResult, type ConvertOptions, convertXmlText } from '@/convert';
import { heldBooks, installedCheck } from '@/convert/official';
import { getRegistry } from '@/data5e/registry';
import { dataStatusStore } from '@/stores/dataStatus';

/**
 * Convert an XML import against the game data on this device. A registry that
 * cannot be read converts everything; so does data still downloading, for an
 * entry it has not reached yet. `coverage` says which, for the report of a
 * file that converts anything: it is about the entries converted, so it says
 * nothing about one where every entry was already installed.
 */
export async function convertImportXml(
  text: string,
  fileName: string,
): Promise<{ result: ConversionResult; coverage?: string }> {
  // Read before the registry, as `loadOfficialIndex` does: a pack landing in
  // between must not count as checked.
  const complete = dataStatusStore.getState().phase === 'done';
  let opts: ConvertOptions = { fileName };
  try {
    const reg = await getRegistry();
    opts = {
      fileName,
      isInstalled: installedCheck(reg),
      hasBook: heldBooks(reg),
      rulesBooks: reg.rulesBooks,
    };
  } catch {
    opts = { fileName };
  }
  const result = convertXmlText(text, opts);
  if (opts.isInstalled === undefined) {
    return {
      result,
      coverage: 'Game data could not be read, so entries it already has were converted as well.',
    };
  }
  if (!complete) {
    return {
      result,
      coverage:
        'Not all game data is on this device yet, so entries it does not have yet were converted as well.',
    };
  }
  return { result };
}
