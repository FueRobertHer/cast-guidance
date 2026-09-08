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

/**
 * The leading code of a 5etools item type. Imported files write the source
 * alongside it ("S|XPHB"); the builder writes the bare code. Both mean shield.
 */
export function baseTypeCode(type: unknown): string | undefined {
  return typeof type === 'string' ? type.split('|')[0] : undefined;
}

const WEAPON_TYPE_CODES = new Set(['M', 'R']);
const ARMOR_TYPE_CODES = new Set(['LA', 'MA', 'HA', 'S']);

/** Whether a type carries its own damage dice, or its own base AC. */
export const isWeaponType = (type: unknown) => WEAPON_TYPE_CODES.has(baseTypeCode(type) ?? '');
export const isArmorType = (type: unknown) => ARMOR_TYPE_CODES.has(baseTypeCode(type) ?? '');

/** Fields whose form control disappears when the type stops using them. */
const WEAPON_FIELDS = ['dmg1', 'dmgType', 'extraDamage', 'bonusWeapon'];
const ARMOR_FIELDS = ['ac'];

/**
 * The entity with the fields its type doesn't use removed.
 *
 * The form hides a control the moment the type stops using it, but hiding is
 * not forgetting: a base AC typed while the item was heavy armor stayed on the
 * ring it became, invisible in the form and intact in the file, waiting to be
 * read again by anything that trusts the field. Save what the form showed.
 */
export function pruneItemFields(extra: Json): Json {
  const next = { ...extra };
  if (!isWeaponType(extra.type)) for (const k of WEAPON_FIELDS) delete next[k];
  if (!isArmorType(extra.type)) for (const k of ARMOR_FIELDS) delete next[k];
  return next;
}
