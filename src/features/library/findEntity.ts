/**
 * The entity a Library detail URL names.
 *
 * The Library's own links name it as `name|source`, and a bare name takes the
 * first source that has it. A reference tag in rules text can name a book or a
 * subclass in 5etools' terms instead (`libraryPath` in the entry renderer says
 * why). A book path with no source is one of those, since the Library never
 * links a book without its source, so its id comes first: a homebrew book
 * called "DMG" must not stand in for the one whose id is DMG. A subclass
 * reference is tried once the usual key finds nothing.
 */
import type { Entity } from '@/data5e/copyMod';
import type { EntityRegistry, EntityType } from '@/data5e/normalize';

const lower = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : undefined);

export function findEntity(
  registry: EntityRegistry,
  type: EntityType,
  uid: string,
): Entity | undefined {
  const [name, source] = uid.split('|');
  if (type === 'book' && source === undefined) {
    const book = bookById(registry, uid);
    if (book !== undefined) return book;
  }
  return (
    registry.get(type, name ?? '', source !== undefined && source !== '' ? source : undefined) ??
    registry.get(type, uid) ??
    (type === 'subclass' ? subclassByRef(registry, uid) : undefined)
  );
}

/** `{@book}` names a book by its id; a homebrew book without one, by source. */
function bookById(registry: EntityRegistry, id: string): Entity | undefined {
  const wanted = id.toLowerCase();
  const books = registry.byType('book');
  return books.find((b) => lower(b.id) === wanted) ?? books.find((b) => lower(b.source) === wanted);
}

/** `{@subclass}` names one as `shortName|className|classSource|source`. */
function subclassByRef(registry: EntityRegistry, ref: string): Entity | undefined {
  const parts = ref.toLowerCase().split('|');
  if (parts.length !== 4) return undefined;
  const [shortName, className, classSource, source] = parts;
  return registry
    .byType('subclass')
    .find(
      (s) =>
        (lower(s.shortName) === shortName || lower(s.name) === shortName) &&
        lower(s.className) === className &&
        lower(s.classSource) === classSource &&
        lower(s.source) === source,
    );
}
