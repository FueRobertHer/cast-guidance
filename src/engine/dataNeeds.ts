import { lookupItem } from './effects/item';
import type { CharacterDoc, EngineContext } from './types';

/**
 * What a derivation of this character reads that `ctx` does not hold.
 *
 * Everything else the engine looks up (species, backgrounds, feats, base items)
 * ships in the essentials pack every page already waits for. These two do not:
 * a class's hit die, proficiencies, features and slots are in its class file,
 * and most equipped gear is in items.json. Without them `deriveSheet` still
 * returns a complete-looking sheet, because level and proficiency bonus come
 * from the character itself, so a missing file reads as wrong numbers rather
 * than as a failure. Spells stay out of this on purpose: the numbers never read
 * a spell's file.
 */
export interface CharacterDataNeeds {
  /** Names of the character's classes with no entry. */
  classes: readonly string[];
  /** Whether any equipped item has no entry. Unequipped gear changes no number. */
  items: boolean;
}

export function missingCharacterData(doc: CharacterDoc, ctx: EngineContext): CharacterDataNeeds {
  return {
    classes: doc.classes
      .filter((entry) => ctx.get('class', entry.ref.name, entry.ref.source) === undefined)
      .map((entry) => entry.ref.name),
    items: doc.equipment.some(
      (entry) =>
        entry.equipped &&
        entry.ref !== undefined &&
        lookupItem({ ctx }, entry.ref.name, entry.ref.source) === undefined,
    ),
  };
}

export function hasMissingData(needs: CharacterDataNeeds): boolean {
  return needs.classes.length > 0 || needs.items;
}
