import type { Entity } from './copyMod';

export type RulesVersion = '2014' | '2024';

/** Core 2024-revision sources ("one" edition in 5etools terms). */
export const SOURCES_2024 = new Set(['XPHB', 'XDMG', 'XMM', 'XScreen']);

export function sourceEdition(source: string | undefined): RulesVersion {
  return source !== undefined && SOURCES_2024.has(source) ? '2024' : '2014';
}

export function editionOf(e: Entity): RulesVersion {
  const edition = e.edition;
  if (edition === 'one') return '2024';
  if (edition === 'classic') return '2014';
  return sourceEdition(typeof e.source === 'string' ? e.source : undefined);
}

/**
 * From several printings of the same thing (looked up by name across editions),
 * pick the one matching the character's rules version — so a 2024 character sees
 * the 2024 Exhaustion / spell / condition text, not whichever printing loaded
 * first. Falls back to any printing when the exact edition isn't present.
 */
export function pickForVersion<T extends Entity>(
  candidates: readonly T[],
  version: RulesVersion,
): T | undefined {
  return candidates.find((e) => editionOf(e) === version) ?? candidates[0];
}

/**
 * Filter a list for a rules version, deduping reprints:
 * - 2024 mode hides entities whose `reprintedAs` target is present in the list.
 * - 2014 mode hides "one"-edition entities entirely.
 */
export function filterByRulesVersion<T extends Entity>(entities: T[], version: RulesVersion): T[] {
  if (version === '2014') return entities.filter((e) => editionOf(e) === '2014');

  const uids = new Set(entities.map((e) => `${String(e.name)}|${String(e.source)}`.toLowerCase()));
  return entities.filter((e) => {
    if (editionOf(e) === '2024') return true;
    const reprints = e.reprintedAs;
    if (!Array.isArray(reprints)) return true;
    // reprintedAs entries: "Name|SOURCE" strings or { uid: "Name|SOURCE" }.
    for (const r of reprints) {
      const uid = typeof r === 'string' ? r : (r as { uid?: string })?.uid;
      if (typeof uid === 'string') {
        // uid may carry extra segments (Name|SOURCE|displayText) — keep first two.
        const [name, source] = uid.split('|');
        if (
          name !== undefined &&
          source !== undefined &&
          uids.has(`${name}|${source}`.toLowerCase())
        ) {
          return false; // superseded by a loaded reprint
        }
      }
    }
    return true;
  });
}
