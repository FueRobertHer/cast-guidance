/**
 * Progressive download packs. `essentials` is the only pack anything waits on
 * (~350 KB wire); the rest stream in the background or load on demand.
 * Class and spell packs are dynamic — their file lists come from the two
 * index.json files that ship inside `essentials`.
 */
export type PackId =
  | 'essentials'
  | 'items-full'
  | 'library-extras'
  | `class:${string}`
  | `spells:${string}`;

export const ESSENTIALS_FILES: readonly string[] = [
  'races.json',
  'backgrounds.json',
  'feats.json',
  'items-base.json',
  'optionalfeatures.json',
  'skills.json',
  'languages.json',
  'senses.json',
  'actions.json',
  'conditionsdiseases.json',
  'class/index.json',
  'spells/index.json',
];

export const ITEMS_FULL_FILES: readonly string[] = ['items.json', 'magicvariants.json'];

export const LIBRARY_EXTRAS_FILES: readonly string[] = ['variantrules.json', 'books.json'];

export function classPackId(indexKey: string): PackId {
  return `class:${indexKey.toLowerCase()}`;
}

export function spellsPackId(sourceAbbrev: string): PackId {
  return `spells:${sourceAbbrev.toLowerCase()}`;
}
