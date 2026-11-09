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
import { type ConversionResult, convertXmlText } from '@/convert';
import { OFFICIAL_TYPES, officialNames } from '@/convert/official';
import type { ConvertedKind, InstalledCheck } from '@/convert/types';
import type { EntityRegistry } from '@/data5e/normalize';
import { getRegistry } from '@/data5e/registry';
import { editionOf } from '@/data5e/rulesVersion';
import { dataStatusStore } from '@/stores/dataStatus';

/**
 * Official entries by `name|edition`, lowercased, built per kind on first ask.
 * A subrace or lineage is under the names other apps give it (`Dwarf, Hill`).
 */
export function installedCheck(reg: EntityRegistry): InstalledCheck {
  const byKind = new Map<ConvertedKind, Set<string>>();
  return (kind, name, edition) => {
    let keys = byKind.get(kind);
    if (keys === undefined) {
      keys = new Set();
      for (const type of OFFICIAL_TYPES[kind]) {
        for (const e of reg.byType(type).slice(0, reg.officialCount(type))) {
          const ed = editionOf(e);
          for (const n of officialNames(type, e)) keys.add(`${n}|${ed}`);
        }
      }
      byKind.set(kind, keys);
    }
    return keys.has(`${name.toLowerCase()}|${edition}`);
  };
}

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
  let isInstalled: InstalledCheck | undefined;
  try {
    isInstalled = installedCheck(await getRegistry());
  } catch {
    isInstalled = undefined;
  }
  const result = convertXmlText(
    text,
    isInstalled === undefined ? { fileName } : { fileName, isInstalled },
  );
  if (isInstalled === undefined) {
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
