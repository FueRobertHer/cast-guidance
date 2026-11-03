/**
 * Where a reference tag in rules text links: its entity's page in the Library.
 *
 * Built from the tag alone, since rules text renders without the registry.
 * Most tags name their target as `name|source`, the key the Library looks an
 * entity up by. Two name it in 5etools' own terms instead, and the Library's
 * detail page resolves those (`findEntity`):
 * - `{@book display|id|chapter|section}` by the book's id, which is neither its
 *   name ("Player's Handbook (2014)") nor always its source (PS-K is PSK).
 * - `{@subclass shortName|class|classSource|source|display}` by all four
 *   parts, since a short name is not the subclass's name ("Berserker" is "Path
 *   of the Berserker") and is only unique within one class.
 */
import { parseEntityRef } from '../tags';
import { LINKED_TYPES } from './inlineTags';

/** The Library path for a linked tag, or undefined for a tag that links nowhere. */
export function libraryPath(tag: string, args: string[]): string | undefined {
  const type = LINKED_TYPES[tag];
  if (type === undefined) return undefined;
  return `/library/${type}/${encodeURIComponent(libraryUid(tag, args).toLowerCase())}`;
}

function libraryUid(tag: string, args: string[]): string {
  switch (tag) {
    case 'book':
      return args[1] ?? '';
    case 'subclass': {
      // As 5etools reads it: parts trimmed, and either source PHB when empty.
      const [shortName = '', className = '', classSource, source] = args.map((a) => a.trim());
      return [shortName, className, classSource || 'PHB', source || 'PHB'].join('|');
    }
    default: {
      const ref = parseEntityRef(args);
      return ref.source ? `${ref.name}|${ref.source}` : ref.name;
    }
  }
}
