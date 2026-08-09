/**
 * Write rules for the builder's weapon-damage fields.
 *
 * A dropdown always shows *something*, so an untouched damage-type select
 * displays a type the entity never actually got. That reads as a filled-in
 * form and saves as untyped damage, which is worse than an obviously blank
 * one: nothing looks wrong until a flaming sword deals its 1d4 as no element
 * at all. These functions are the other half of the default, stamping what the
 * form shows into the entity the moment there are dice for it to describe.
 */

type Json = Record<string, unknown>;

/** A sword cuts and an arrow punctures: the archetype for each weapon class. */
export function defaultDamageType(itemType: unknown): string {
  return itemType === 'R' ? 'P' : 'S';
}

/**
 * Riders exist to name a second element, so fire is the one worth assuming.
 * Nothing rides along on a hit dealing more of what the weapon already dealt.
 */
export const DEFAULT_RIDER_TYPE = 'F';

/**
 * Patch for the weapon's own damage. The type tags along only when dice arrive
 * and the author has not already chosen one, so re-typing the dice never
 * overwrites a deliberate pick.
 */
export function damagePatch(dice: string, currentType: unknown, itemType: unknown): Json {
  return dice !== '' && currentType === undefined
    ? { dmg1: dice, dmgType: defaultDamageType(itemType) }
    : { dmg1: dice };
}

/**
 * The rider list after editing the first rider's `key`. The form edits only
 * that one, which covers every weapon anyone has asked for, so a hand-written
 * second rider rides along untouched rather than vanishing on the next save.
 *
 * No dice means no rider: clearing the box drops it entirely rather than
 * leaving a `{ dmgType: 'F' }` that renders as nothing but survives export.
 */
export function nextRiders(
  riders: readonly Json[],
  key: 'dmg' | 'dmgType',
  value: string,
): Json[] | undefined {
  const first: Json = { dmgType: DEFAULT_RIDER_TYPE, ...riders[0], [key]: value };
  const rest = riders.slice(1);
  const next = typeof first.dmg === 'string' && first.dmg.trim() !== '' ? [first, ...rest] : rest;
  return next.length > 0 ? next : undefined;
}
