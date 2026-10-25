import type { CharacterDoc, ClassLevelEntry } from '@/engine/types';
import { refUid } from '@/engine/types';
import { pruneClass } from './pruneChoices';

// Taking things away: what goes, said before or after (UX-004). Shared by the
// sheet's build page and the creator, so a confirm and an undo line read the
// same wherever the change was made.

export const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** "a", "a and b", "a, b and c". */
export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * How many picks a set of removed choice keys held, counting only prompts the
 * player can see now (`active`). A key can hold several picks (two skills
 * under one prompt), and a stored answer to a prompt no longer offered (an ASI
 * feat kept from a higher level) is not one the player would recognise, so
 * counting keys told a player with two skills that three picks went.
 */
export function pickCount(doc: CharacterDoc, keys: string[], active: ReadonlySet<string>): number {
  return keys.reduce((n, k) => {
    if (!active.has(k)) return n;
    const v = doc.choices[k];
    return n + (Array.isArray(v) ? v.length : v === undefined ? 0 : 1);
  }, 0);
}

/** "3 Testfolk picks cleared", or nothing when no picks went. */
export const picksCleared = (
  before: CharacterDoc,
  keys: string[],
  owner: string | undefined,
  active: ReadonlySet<string>,
) => {
  const n = pickCount(before, keys, active);
  return n === 0
    ? undefined
    : `${plural(n, owner === undefined ? 'pick' : `${owner} pick`)} cleared`;
};

/**
 * What removing a class takes with it, for the confirm and the undo bar: its
 * picks (with the feats it took at an ASI), its subclass and that subclass's
 * picks, and its spell list. Worked out on a copy, so it matches what
 * {@link pruneClass} will remove.
 */
export function classRemovalParts(
  doc: CharacterDoc,
  entry: ClassLevelEntry,
  active: ReadonlySet<string>,
): string[] {
  const uid = refUid(entry.ref);
  const probe = structuredClone(doc);
  probe.classes = probe.classes.filter((c) => refUid(c.ref) !== uid);
  const removed = pruneClass(probe, entry);
  const subKeys = removed.filter((k) => k.startsWith('subclass:'));
  const subPicks = pickCount(doc, subKeys, active);
  const ownPicks = pickCount(
    doc,
    removed.filter((k) => !k.startsWith('subclass:')),
    active,
  );
  const parts: string[] = [];
  if (ownPicks > 0) parts.push(plural(ownPicks, `${entry.ref.name} pick`));
  if (entry.subclass !== undefined) {
    parts.push(
      subPicks > 0
        ? `subclass ${entry.subclass.name} (${plural(subPicks, 'pick')})`
        : `subclass ${entry.subclass.name}`,
    );
  }
  const spells = doc.spellcasting[uid];
  if (spells !== undefined && spells.known.length + spells.prepared.length > 0) {
    const counts = [
      spells.known.length > 0 ? `${spells.known.length} known` : '',
      spells.prepared.length > 0 ? `${spells.prepared.length} prepared` : '',
    ].filter((c) => c !== '');
    parts.push(`its spell list (${counts.join(', ')})`);
  }
  return parts;
}
