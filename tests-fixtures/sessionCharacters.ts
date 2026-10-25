import type { CharacterDoc } from '@/engine/types';
import type { SessionCharacters } from '@/stores/characterSession';

/**
 * A session's character store built from a plain read and write, for tests of
 * the save pipeline itself rather than of other tabs: every save is written,
 * unchecked, as the session wrote before the revision check (REL-007, #98).
 * The fakes stay reachable as `get` and `put`, mock state and all.
 */
export function unchecked<
  G extends (id: string) => Promise<CharacterDoc | undefined>,
  P extends (doc: CharacterDoc) => Promise<unknown>,
>(fakes: { get: G; put: P }): SessionCharacters & { get: G; put: P } {
  return {
    ...fakes,
    getWithRevision: async (id) => {
      const doc = await fakes.get(id);
      return doc === undefined ? undefined : { doc, revision: undefined };
    },
    save: async (doc) => {
      await fakes.put(doc);
      return { status: 'saved', revision: undefined };
    },
  };
}
