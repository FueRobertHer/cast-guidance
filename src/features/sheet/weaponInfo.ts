import type { EntityRegistry } from '@/data5e/normalize';

/** Plain-English weapon property meanings, keyed by the lowercase display name. */
const PROPERTY_GLOSSARY: Record<string, string> = {
  ammunition: 'Needs ammo to fire; you draw one piece as part of the attack.',
  finesse: 'Use STR or DEX for attack and damage — whichever is higher.',
  heavy: 'Small creatures have disadvantage on attacks with it.',
  light: 'Ideal for two-weapon fighting (bonus-action off-hand attack).',
  loading: 'Only one shot per action, bonus action, or reaction.',
  reach: 'Adds 5 ft to your reach for attacks and opportunity attacks.',
  thrown: 'Can be thrown to make a ranged attack using the same ability.',
  'two-handed': 'Requires both hands to attack with.',
  versatile: 'One- or two-handed; two-handed uses the larger damage die.',
  special: 'Has unusual rules — see the weapon description.',
  reload: 'Must be reloaded after a number of shots.',
  'burst fire': 'Can spray a 10-ft cube; targets make a DEX save.',
};

/**
 * Synthetic "entries" for a weapon attack: the item's own prose (magic weapons)
 * followed by a plain-English gloss of each property, so a new player can tap a
 * weapon and learn what "finesse, thrown" actually means.
 */
export function weaponInfoEntries(
  registry: EntityRegistry | null,
  name: string,
  properties: readonly string[],
): unknown[] | undefined {
  const item = registry?.get('item', name) ?? registry?.get('baseitem', name) ?? undefined;
  const itemEntries = Array.isArray(item?.entries) ? item.entries : [];
  const propEntries = properties
    .map((p) => {
      const gloss = PROPERTY_GLOSSARY[p.toLowerCase()];
      return gloss !== undefined ? `${titleCase(p)}: ${gloss}` : undefined;
    })
    .filter((s): s is string => s !== undefined);
  const entries = [...itemEntries, ...propEntries];
  return entries.length > 0 ? entries : undefined;
}

function titleCase(s: string): string {
  return s.replace(/(^|\s|-)\w/g, (c) => c.toUpperCase());
}
