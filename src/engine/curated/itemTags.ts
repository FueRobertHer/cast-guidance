import type { Ability } from '../types';

/** What wearing an item gives, where the data's tags say something else. */
export interface ItemTags {
  resist?: readonly string[];
  immune?: readonly string[];
  vulnerable?: readonly string[];
  conditionImmune?: readonly string[];
  /** A bonus to saving throws while worn, or `null` for none. */
  save?: { amount: number; abilities?: readonly Ability[] } | null;
}

const NOTHING_WORN: ItemTags = {
  resist: [],
  immune: [],
  vulnerable: [],
  conditionImmune: [],
  save: null,
};

const saves = (ability: Ability): ItemTags => ({ save: { amount: 1, abilities: [ability] } });

/**
 * The data tags an item with every defense and save bonus its text names, as
 * search filters do: a deck with what its cards give, a shield with what it
 * gives for a minute after a bonus action. These are the items in the pinned
 * release (v2.39.1) whose tags are not what wearing them gives, by
 * `name|source` in lower case. A field given replaces that tag; one left out
 * keeps it. What the sheet cannot know (an alignment, a slain elemental, a ruby
 * left in the helm) is read as met, and the item's own text says when.
 */
export const ITEM_TAG_FIXES: Readonly<Record<string, ItemTags>> = {
  // Used up or drawn: what they give lasts a while afterwards, as an effect in play.
  'deck of many more things|bmt': NOTHING_WORN,
  'deck of wonder|bmt': NOTHING_WORN,
  'muroosa balm|egw': NOTHING_WORN,
  // Switched on for a minute or a turn.
  'ghost step tattoo|tce': { conditionImmune: [] },
  'moon card|bmt': NOTHING_WORN,
  'ring of red fury|crcotn': { conditionImmune: [] },
  'rod of alertness|dmg': { save: null },
  'rod of alertness|xdmg': { save: null },
  'shield of the blazing dreadnought|bgg': { immune: [] },
  // One of the listed types, picked when attuning.
  'nightbringer|mcv2dc': { immune: [] },
  // Tags that differ from the text: a state without the resistance, a
  // condition read from "while you're not incapacitated", one left out.
  'mace of the black crown (awakened)|egw': { resist: ['poison'] },
  'mace of the black crown (dormant)|egw': { resist: [] },
  'netherese ring of protection|pabtso': { save: { amount: 1 } },
  'orcsplitter|pota': { conditionImmune: ['frightened'] },
  'periapt of proof against poison|xdmg': { conditionImmune: ['poisoned'] },
  // Saves of one ability.
  'chronolometer|ai': saves('int'),
  'dimensional loop|ai': saves('str'),
  'far gear|ai': saves('cha'),
  'ioun stone, self-preservation|llk': saves('int'),
  'rotor of return|ai': saves('con'),
  'timepiece of travel|ai': saves('dex'),
  'wheel of stars|ai': saves('wis'),
  // Death saves only, or saves against magic only.
  'ioun stone of vitality|imr': { save: null },
  'leather golem armor|llk': { save: null },
};
