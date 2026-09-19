import type { Entity } from './copyMod';

export type RulesVersion = '2014' | '2024';

export interface EditionRef {
  name: string;
  source: string;
}

/**
 * The printings an entity declares as its replacements. `reprintedAs` entries
 * are `"Name|SOURCE"` strings or `{ uid }` objects, and a uid may carry extra
 * segments (`Name|SOURCE|displayText`), so only the first two are read. One
 * parser, because the picker filter and the compatibility cues in
 * `editionCompat.ts` both need it and two readings of the same field would drift.
 */
export function reprintTargets(entity: Entity): EditionRef[] {
  const reprints = entity.reprintedAs;
  if (!Array.isArray(reprints)) return [];
  const out: EditionRef[] = [];
  for (const entry of reprints) {
    const uid = typeof entry === 'string' ? entry : (entry as { uid?: unknown })?.uid;
    if (typeof uid !== 'string') continue;
    const [name, source] = uid.split('|');
    if (name !== undefined && name !== '' && source !== undefined && source !== '') {
      out.push({ name, source });
    }
  }
  return out;
}

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
    // Superseded by a reprint that is actually in this list.
    return !reprintTargets(e).some((r) => uids.has(`${r.name}|${r.source}`.toLowerCase()));
  });
}
