/**
 * Spell pools the data release writes as `daily`, so a long rest refills them,
 * when the printed text gives them back on a short or long rest. Each is a fact
 * of the rules, read from that origin's own prose. Keyed `type:uid` of the origin
 * granting the spells, with the spells whose pools refill on a short rest, or
 * `every` for each pool it opens, a pick's included.
 */
const SHORT_REST_SPELLS: Readonly<Record<string, 'every' | readonly string[]>> = {
  'feat:fey teleportation|xge': ['misty step'],
  'feat:boon of siberys|efa': 'every',
  // Legacy of Minauros. Its arcane lock really is once per long rest.
  'race:mammon|mtf': ["tenser's floating disk"],
};

/** Whether this origin's pool of these spells refills on a short rest, whatever the data says. */
export function refillsOnShortRest(
  origin: { type: string; uid: string },
  spells: ReadonlyArray<{ name: string }>,
): boolean {
  const listed = SHORT_REST_SPELLS[`${origin.type}:${origin.uid}`];
  if (listed === undefined) return false;
  return listed === 'every' || spells.every((s) => listed.includes(s.name.toLowerCase()));
}
