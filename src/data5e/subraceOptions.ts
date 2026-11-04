import type { Entity } from './copyMod';

interface Ref {
  name: string;
  source: string;
}

/**
 * The subraces a picker offers for one race: those whose `raceName` and
 * `raceSource` name that race's own printing, with the character's current
 * pick kept whatever it names, so it can still be seen and unselected.
 *
 * A subrace belongs to one printing, not to every race of that name. Matched
 * on the name alone, VGM's Fallen, Protector and Scourge were offered under
 * MPMM's and the 2024 Aasimar, which have none, and the 2024 Elf, Dwarf and
 * Human offered the 2014 PHB's High Elf, Hill Dwarf and Variant Human. A
 * subrace with no `raceSource` (hand-written homebrew) goes by the name alone.
 * A nameless subrace is the race's own base entry, never a pick.
 */
export function subraceOptions(all: readonly Entity[], raceRef: Ref, held?: Ref): Entity[] {
  const raceName = raceRef.name.toLowerCase();
  const raceSource = raceRef.source.toLowerCase();
  const heldUid = held === undefined ? undefined : `${held.name}|${held.source}`.toLowerCase();
  return all.filter((s) => {
    if (typeof s.name !== 'string') return false;
    if (heldUid !== undefined && `${s.name}|${String(s.source)}`.toLowerCase() === heldUid) {
      return true;
    }
    if (String(s.raceName ?? '').toLowerCase() !== raceName) return false;
    return typeof s.raceSource !== 'string' || s.raceSource.toLowerCase() === raceSource;
  });
}
