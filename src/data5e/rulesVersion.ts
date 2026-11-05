import type { Entity } from './copyMod';
import { type EntityType, isEntityType } from './normalize';

export type RulesVersion = '2014' | '2024';

/**
 * A printing that a `reprintedAs` entry points at.
 *
 * `type` is the bucket to look the target up in, which is not always the
 * holder's own: every 2014 subrace is reprinted as a *race* (`High|PHB` points
 * at `Elf|XPHB`), and some entries carry an explicit `tag` of `feat` or `item`.
 * `shortName` is set for subclass targets, whose uids name the subclass the way
 * 5etools does, by `shortName` ("Life") rather than by `name` ("Life Domain").
 */
export interface EditionRef {
  name: string;
  source: string;
  type?: EntityType;
  shortName?: string;
}

/**
 * Read one `reprintedAs` uid. The shape depends on what is being pointed at: a
 * subclass uid is the four-segment 5etools form
 * `ShortName|ClassName|ClassSource|SubclassSource`, so its source is the *last*
 * segment and reading the first two would put a class name in the source slot.
 * Everything else is `Name|SOURCE`. A half-written uid is dropped rather than
 * turned into a lookup for the empty source.
 */
function parseReprintUid(uid: string, type: EntityType | undefined): EditionRef | undefined {
  const segments = uid.split('|');
  if (type === 'subclass') {
    const shortName = segments[0];
    const source = segments[3];
    if (shortName === undefined || shortName === '' || source === undefined || source === '') {
      return undefined;
    }
    // `name` mirrors the shortName only as a fallback label; the real name is
    // taken from the entity once the target resolves.
    return { name: shortName, shortName, source, type };
  }
  const [name, source] = segments;
  if (name === undefined || name === '' || source === undefined || source === '') return undefined;
  return type === undefined ? { name, source } : { name, source, type };
}

/**
 * Where an entity's reprints live when no `tag` says otherwise. A subrace is
 * the one type that never points at its own kind: the 2024 books fold subraces
 * into the race, so every untagged subrace target in the data is a race
 * (`High|PHB` points at `Elf|XPHB`) and none is a subrace.
 */
export function defaultTargetType(holderType: EntityType): EntityType {
  return holderType === 'subrace' ? 'race' : holderType;
}

/**
 * The printings an entity declares as its replacements, as refs that can be
 * looked up. One parser, because the picker filter and the compatibility cues
 * in `editionCompat.ts` both read this field and two readings of it would drift.
 *
 * Entries are `"Name|SOURCE"` strings or `{ uid, tag }` objects. `holderType`
 * says which uid shape to expect and where the target lives; an entry's own
 * `tag` overrides that for the cross-type targets. Omitting `holderType` reads
 * every uid as `Name|SOURCE` and leaves the target type unset, which is what
 * a picker filter that names no holder type wants.
 */
export function reprintTargets(entity: Entity, holderType?: EntityType): EditionRef[] {
  const reprints = entity.reprintedAs;
  if (!Array.isArray(reprints)) return [];
  const out: EditionRef[] = [];
  for (const entry of reprints) {
    const fields =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : undefined;
    const uid = typeof entry === 'string' ? entry : fields?.uid;
    if (typeof uid !== 'string') continue;
    const tag = fields?.tag;
    const type =
      typeof tag === 'string' && isEntityType(tag)
        ? tag
        : holderType === undefined
          ? undefined
          : defaultTargetType(holderType);
    const ref = parseReprintUid(uid, type);
    if (ref !== undefined) out.push(ref);
  }
  return out;
}

/**
 * Core 2024-revision sources ("one" edition in 5etools terms). Named because
 * not all of them mark anything: XMM reaches this app as bare languages. Later
 * 2024-rules books are not listed; `normalizeDataset` reads those from the data.
 */
export const SOURCES_2024 = new Set(['XPHB', 'XDMG', 'XMM', 'XScreen']);

export function sourceEdition(source: string | undefined): RulesVersion {
  return source !== undefined && SOURCES_2024.has(source) ? '2024' : '2014';
}

let rulesBooks: ReadonlySet<string> = new Set();

/**
 * Publish the books the newest registry read as 2024 rules. The registry build
 * calls this before it hands the registry out, as it does for homebrew titles.
 * Wholesale, so a rollback to an older release drops a book it does not have.
 */
export function setRulesBooks(books: ReadonlySet<string>): void {
  rulesBooks = books;
}

/**
 * Whether a book counts as 2024 rules, for a label that holds only a source code
 * and so has no row to ask. Module state because a label is all this decides:
 * before the first registry build a later book simply goes unlabelled.
 * `sourceEdition` and `editionOf` stay off this on purpose, since they decide
 * what a character may pick and must not depend on what has been built so far.
 */
export function isBook2024(source: string): boolean {
  return SOURCES_2024.has(source) || rulesBooks.has(source);
}

/**
 * The rules edition of one entity: its own mark, else its book's, else its
 * source. `normalizeDataset` sets `bookEdition`, so a feat left bare in a
 * 2024-rules book reads 2024 here without this having to know the book. A mark
 * the entity inherited from a copy counts as its own: a row that copies a
 * `classic` one is carrying 2014 content, whatever book it sits in.
 */
export function editionOf(e: Entity): RulesVersion {
  const edition = e.edition ?? e.bookEdition;
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
 *
 * `holderType` says what the list holds, so its reprint uids parse in their own
 * shape. It matters for subclasses (GAME-009): their uids are the four-segment
 * `ShortName|ClassName|ClassSource|SubclassSource`, which read as `Name|SOURCE`
 * put the class name in the source slot and never matched, so every legacy
 * subclass stood beside its 2024 printing. A subclass target names the
 * subclass by `shortName`, so the list is keyed by that too. A subclass uid in
 * the short `Name|SOURCE` form (homebrew only) no longer dedupes. With a
 * holder type set, only targets in that same bucket count: a subrace pointing
 * at a race, or an entry tagged as a feat, says nothing about this list.
 *
 * `keep` exempts the character's current pick, which must stay on screen
 * whatever its edition so the picker can show what is chosen.
 */
export function filterByRulesVersion<T extends Entity>(
  entities: T[],
  version: RulesVersion,
  options: { holderType?: EntityType; keep?: (e: T) => boolean } = {},
): T[] {
  const { holderType, keep } = options;
  if (version === '2014') {
    return entities.filter((e) => editionOf(e) === '2014' || keep?.(e) === true);
  }

  const uids = new Set<string>();
  for (const e of entities) {
    uids.add(`${String(e.name)}|${String(e.source)}`.toLowerCase());
    if (holderType === 'subclass' && typeof e.shortName === 'string' && e.shortName !== '') {
      uids.add(`${e.shortName}|${String(e.source)}`.toLowerCase());
    }
  }
  return entities.filter((e) => {
    if (editionOf(e) === '2024' || keep?.(e) === true) return true;
    // Superseded by a reprint that is actually in this list.
    return !reprintTargets(e, holderType).some(
      (r) =>
        (holderType === undefined || r.type === holderType) &&
        uids.has(`${r.name}|${r.source}`.toLowerCase()),
    );
  });
}
