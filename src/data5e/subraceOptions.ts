import type { Entity } from './copyMod';

interface Ref {
  name: string;
  source: string;
}

/**
 * Whether a subrace belongs to this printing of a race: its `raceName` and
 * `raceSource` name it. A subrace with no `raceSource` (hand-written homebrew)
 * goes by the name alone.
 */
export function subraceBelongsTo(
  subrace: { raceName?: unknown; raceSource?: unknown },
  raceRef: Ref,
): boolean {
  if (String(subrace.raceName ?? '').toLowerCase() !== raceRef.name.toLowerCase()) return false;
  const source = subrace.raceSource;
  return typeof source !== 'string' || source.toLowerCase() === raceRef.source.toLowerCase();
}

/**
 * The subraces a picker offers for one race: those that belong to that race's
 * own printing, with the character's current pick kept whatever it names, so
 * it can still be seen and unselected.
 *
 * A subrace belongs to one printing, not to every race of that name. Matched
 * on the name alone, VGM's Fallen, Protector and Scourge were offered under
 * MPMM's and the 2024 Aasimar, which have none, and the 2024 Elf, Dwarf and
 * Human offered the 2014 PHB's High Elf, Hill Dwarf and Variant Human.
 * A nameless subrace is the race's own base entry, never a pick.
 *
 * Two races can each have a subrace of the same name and source (Ixalan|PSX
 * for the Goblin and the Vampire). A held pick is the race's own one when it
 * has one; only otherwise is another race's kept, and only one of them.
 */
export function subraceOptions(all: readonly Entity[], raceRef: Ref, held?: Ref): Entity[] {
  const uidOf = (s: Entity) => `${String(s.name)}|${String(s.source)}`.toLowerCase();
  const heldUid = held === undefined ? undefined : `${held.name}|${held.source}`.toLowerCase();
  const named = all.filter((s) => typeof s.name === 'string');
  const own = named.filter((s) => subraceBelongsTo(s, raceRef));
  const kept =
    heldUid === undefined || own.some((s) => uidOf(s) === heldUid)
      ? undefined
      : named.find((s) => uidOf(s) === heldUid);
  return named.filter((s) => s === kept || own.includes(s));
}
