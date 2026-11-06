import { deriveSheet } from '@/engine/derive';
import type { CharacterDoc, ClassLevelEntry, DerivedSheet, EngineContext } from '@/engine/types';
import { ABILITIES, refUid } from '@/engine/types';
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
  const removed = pruneClass(structuredClone(doc), entry);
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

/** "saves move from a to b", "saves lose a", "saves gain b", or nothing if no entry differs. */
function listMove(
  label: string,
  from: readonly string[],
  to: readonly string[],
): string | undefined {
  // Two printings can spell one proficiency differently ("Ropes", "ropes").
  const without = (list: readonly string[], others: readonly string[]) =>
    listJoin(list.filter((n) => !others.some((o) => o.toLowerCase() === n.toLowerCase())));
  const lost = without(from, to);
  const gained = without(to, from);
  if (lost && gained) return `${label} move from ${lost} to ${gained}`;
  if (lost) return `${label} lose ${lost}`;
  if (gained) return `${label} gain ${gained}`;
  return undefined;
}

const proficientSaves = (sheet: DerivedSheet) =>
  ABILITIES.filter((a) => sheet.saves[a].prof).map((a) => a.toUpperCase());

/**
 * What removing a multiclass character's first class moves beyond its own picks,
 * as a sentence for the confirm, or nothing when `entry` is not that class or
 * nothing moves.
 *
 * Only the first row gets a class's saving throws, its full proficiency lists
 * and the full hit die at level 1 (`collectClasses`, `calcMaxHp`), and a class
 * added later goes on the end, so the next class keeps that place. Everything
 * here is read off the sheet derived without the class, so it holds for this
 * character: a save a feat also grants stays, an override stays.
 */
export function firstClassShift(
  doc: CharacterDoc,
  entry: ClassLevelEntry,
  ctx: EngineContext,
): string | undefined {
  const [first, next, ...rest] = doc.classes;
  if (!first || !next || refUid(first.ref) !== refUid(entry.ref)) return undefined;
  const opening = `${next.ref.name} becomes your first class, and a class you add later goes after it`;
  // A class with no data reads as no saves and no lists, which is not what moves.
  if ([first, next].some((c) => !ctx.get('class', c.ref.name, c.ref.source))) return `${opening}.`;

  const before = deriveSheet(doc, ctx);
  const without = structuredClone(doc);
  pruneClass(without, entry);
  without.classes.shift();
  const after = deriveSheet(without, ctx);

  // Any level taken off lowers max HP. It belongs here only when the class's
  // place matters: when the same classes in another order total differently,
  // so that removing this one costs more or less than removing it from the end.
  const hp = before.maxHp.value;
  const hpAfter = after.maxHp.value;
  const reordered = deriveSheet({ ...doc, classes: [next, ...rest, first] }, ctx);
  const hpMoves = hpAfter !== hp && reordered.maxHp.value !== hp;

  // A later class's skill list is the short multiclass one or none; first, it
  // asks for the full count, so more of it stands open unless its picks fill it.
  const skillPrefix = `class:${refUid(next.ref)}:skill:`;
  const skillsOpen = (sheet: DerivedSheet) =>
    sheet.pending.filter((p) => p.id.startsWith(skillPrefix)).reduce((n, p) => n + p.count, 0);

  const moves = [
    listMove('saving throws', proficientSaves(before), proficientSaves(after)),
    ...(['armor', 'weapon', 'tool'] as const).map((k) =>
      listMove(`${k} proficiencies`, before[`${k}Profs`], after[`${k}Profs`]),
    ),
    hpMoves ? `max HP goes from ${hp} to ${hpAfter}` : undefined,
    skillsOpen(after) > skillsOpen(before)
      ? `${next.ref.name} asks for more skill picks`
      : undefined,
  ].filter((m) => m !== undefined);
  if (moves.length === 0) return undefined;
  return `${opening}: ${moves.join('; ')}.`;
}
