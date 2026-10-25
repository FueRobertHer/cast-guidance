import { migrateCharacter } from '@/engine/migrate';
import { CHARACTER_SCHEMA_VERSION, type CharacterDoc } from '@/engine/types';
import { contentKey } from '@/lib/docDiff';
import { assertCharacterDoc, assertJsonWithinLimits } from '@/lib/guards';

/**
 * A synchronous safety net for character saves that a page teardown cuts off
 * (#123). The session flushes pending edits to IndexedDB on `pagehide`, but a
 * reload or a killed tab ends the document before that transaction commits,
 * and the edit is gone. Web Storage writes complete before the call returns,
 * so the lifecycle handler also copies every unsaved snapshot here, and the
 * next boot replays whatever IndexedDB never received.
 *
 * Written only from the lifecycle handler, never on each edit, and removed as
 * soon as the snapshot's write lands. The `cast-guidance:` prefix is what
 * `resetAppData` sweeps.
 *
 * One entry per character, shared by every tab: two tabs that both go away
 * holding unsaved edits to the same character overwrite each other here, and
 * the last to write the entry keeps it; the other tab's snapshot then rests
 * on its own pagehide save landing. Whatever is replayed is checked: the
 * replay is a save against the revision it reads (REL-007, #98), and an entry
 * built on a stored row that has changed since goes into the character's
 * history instead of over the row. A tab only ever removes the entry it wrote
 * itself, so a tab whose save lands later cannot delete another tab's newer
 * entry.
 */
export const SAVE_JOURNAL_PREFIX = 'cast-guidance:unsaved:';

/**
 * Longest entry written or read, in UTF-16 characters. A real character is a
 * few tens of kilobytes; this leaves room for long notes while keeping one
 * runaway document from filling the origin's storage.
 */
export const MAX_JOURNAL_CHARS = 1_000_000;

const MAX_LABEL_CHARS = 500;
const MAX_BASES = 4;
const VERSION = 1;

/**
 * A stored row the snapshot may be replayed over, by content, and the history
 * label to give the replay if that is what the row holds.
 */
export interface JournalBase {
  hash: string;
  label?: string;
}

export interface JournalEntry {
  doc: CharacterDoc;
  /**
   * Set when every edit in the snapshot was one the sheet made by itself
   * (current HP following the maximum). Such a snapshot is not worth a
   * history row, or a word to the player, when it cannot be replayed.
   * Optional and absent on older entries, so the format stays at version 1.
   */
  automatic?: boolean;
  /**
   * What the stored row held when the snapshot was made, or may hold if a
   * write already issued lands. Any other content means something else saved
   * since (another tab, say), and the snapshot is stale. Content rather than
   * time, so the check does not depend on the wall clock.
   */
  bases: JournalBase[];
}

/** An entry as read back, with its exact text so only that entry is removed. */
export interface StoredJournalEntry extends JournalEntry {
  text: string;
}

/** Resolves the storage area lazily: merely reading `localStorage` can throw. */
export type JournalStorage = () => Storage;

export function journalKey(id: string): string {
  return `${SAVE_JOURNAL_PREFIX}${id}`;
}

/**
 * A short, synchronous digest of a character's content (cyrb53, two seeds).
 * Bookkeeping fields are ignored, as {@link contentKey} ignores them.
 *
 * Base hashes are computed by the app that wrote the entry and compared by the
 * app that boots next, which after an update reload is a newer one. If the two
 * differ in `contentKey`, or a migration step rewrites the stored row's
 * content, no base matches, and an edit cut off by that reload is kept in
 * history rather than replayed. That fails safe (no stale overwrite), and is
 * rare (an update reload with an edit inside the save debounce), so the entry
 * carries no hash-scheme version; add one if either starts to change often.
 *
 * `revision` gives the hash a build from before the stored row's revision was
 * ignored would have computed for that row: such a build kept the revision it
 * read in the document, and hashed it with the rest.
 */
export function contentHash(doc: CharacterDoc, revision?: string): string {
  const text = contentKey(doc, revision);
  const digest = (seed: number): string => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  return `${digest(0)}.${digest(1)}`;
}

/**
 * Store one snapshot, replacing any entry for the same character. Returns the
 * text written, or undefined, with nothing thrown, when the entry is too large
 * or the storage refuses it (quota, blocked, private mode).
 */
export function writeJournalEntry(
  storage: JournalStorage,
  entry: JournalEntry,
): string | undefined {
  try {
    const text = JSON.stringify({
      v: VERSION,
      bases: entry.bases,
      doc: entry.doc,
      ...(entry.automatic === true && { automatic: true }),
    });
    if (text.length > MAX_JOURNAL_CHARS) return undefined;
    storage().setItem(journalKey(entry.doc.id), text);
    return text;
  } catch {
    return undefined;
  }
}

/** Remove a character's entry, but only while it is still `text`. */
export function removeJournalEntry(storage: JournalStorage, id: string, text: string): void {
  try {
    const area = storage();
    if (area.getItem(journalKey(id)) === text) area.removeItem(journalKey(id));
  } catch {
    // Unreachable storage holds nothing to remove; a stale entry is checked on replay.
  }
}

/** An entry this version cannot read but a later one may: it is left in place. */
class NotYetReadable extends Error {}

function parseBases(raw: unknown): JournalBase[] {
  if (!Array.isArray(raw) || raw.length > MAX_BASES) throw new Error('journal bases are invalid');
  return raw.map((base: unknown) => {
    if (base === null || typeof base !== 'object') throw new Error('journal base is invalid');
    const { hash, label } = base as Record<string, unknown>;
    if (typeof hash !== 'string' || hash.length > 64) throw new Error('journal hash is invalid');
    if (label !== undefined && (typeof label !== 'string' || label.length > MAX_LABEL_CHARS)) {
      throw new Error('journal label is invalid');
    }
    return { hash, label };
  });
}

/**
 * Validate one stored entry with the same guards an imported file crosses,
 * or throw. A journal can be stale, truncated, or written by another version
 * of the app, so nothing in it is trusted.
 */
function parseEntry(id: string, text: string): StoredJournalEntry {
  if (text.length > MAX_JOURNAL_CHARS) throw new Error('journal entry is too large');
  const raw: unknown = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('journal entry is not an object');
  }
  const { v, bases, doc, automatic } = raw as Record<string, unknown>;
  // Only a later format is worth keeping; any other version is corrupt.
  if (Number.isInteger(v) && (v as number) > VERSION) {
    throw new NotYetReadable('journal entry is from a newer version');
  }
  if (v !== VERSION) throw new Error('journal version is invalid');
  const parsedBases = parseBases(bases);
  assertJsonWithinLimits(doc, undefined, 'journal entry');
  // Before the shape check: a newer schema may have changed a field's type,
  // and that entry is for a later app to replay, not corrupt.
  const schemaVersion =
    doc !== null && typeof doc === 'object'
      ? (doc as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (Number.isInteger(schemaVersion) && (schemaVersion as number) > CHARACTER_SCHEMA_VERSION) {
    throw new NotYetReadable('journaled character is from a newer version');
  }
  assertCharacterDoc(doc);
  const migrated = migrateCharacter(doc);
  if (migrated.id !== id) throw new Error('journal entry belongs to another character');
  return {
    doc: migrated,
    bases: parsedBases,
    text,
    ...(automatic === true && { automatic: true }),
  };
}

/**
 * Every valid entry in the journal. Entries that fail validation can never
 * become valid, so they are removed as they are found; those from a newer
 * version of the app are kept for it. A storage that cannot be read at all
 * yields nothing.
 */
export function readJournal(storage: JournalStorage): StoredJournalEntry[] {
  const entries: StoredJournalEntry[] = [];
  try {
    const area = storage();
    const keys: string[] = [];
    for (let i = 0; i < area.length; i++) {
      const key = area.key(i);
      if (key?.startsWith(SAVE_JOURNAL_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const text = area.getItem(key);
      if (text === null) continue;
      try {
        entries.push(parseEntry(key.slice(SAVE_JOURNAL_PREFIX.length), text));
      } catch (error) {
        if (!(error instanceof NotYetReadable)) area.removeItem(key);
      }
    }
  } catch {
    // Blocked or broken storage: there is nothing to replay.
  }
  return entries;
}
