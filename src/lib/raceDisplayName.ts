/**
 * A species as a player says it: "High Elf", "Hill Dwarf", "Lightfoot
 * Halfling", rather than the subrace alone ("High") or the race alone ("Elf").
 * The game data names a subrace by the word that tells it apart, so the race
 * goes after it, unless the name already carries the race ("Dragonborn
 * (Black)", or homebrew's "Moon Elf"). A variant or a setting's subrace,
 * written with a semicolon ("Variant; Mark of Finding", "Zendikar; Grotag
 * Tribe"), reads as the race with the rest in brackets. Undefined without a
 * race.
 */
export function raceDisplayName(
  race: { name: string } | undefined,
  subrace?: { name?: string },
): string | undefined {
  if (race === undefined) return undefined;
  const sub = subrace?.name?.trim() ?? '';
  if (sub === '') return race.name;
  if (sub.toLowerCase().includes(race.name.toLowerCase())) return sub;
  if (sub.includes(';')) return `${race.name} (${sub.replace(/^Variant;\s*/i, '')})`;
  return `${sub} ${race.name}`;
}
