/**
 * Passive / always-available combat capabilities worth reminding a player about
 * on the Play tab — things you can just DO that don't otherwise appear as a
 * limited-use action chip (Extra Attack is the canonical example a new player
 * forgets). Keyed by the feature's base name, lowercased; the value is a short
 * "what it lets you do". Tapping the chip still opens the feature's full text.
 */
export const COMBAT_CAPABILITIES: Record<string, string> = {
  'extra attack': 'Attack more than once whenever you take the Attack action.',
  'martial arts': 'Use DEX for monk weapons and make an unarmed strike as a bonus action.',
  'cunning action': 'Dash, Disengage, or Hide as a bonus action every turn.',
  'reckless attack':
    'Attack melee with advantage — but attacks against you have advantage until your next turn.',
  'sneak attack': 'Once per turn, add extra damage when you have advantage or an ally is adjacent.',
  'divine smite': 'Spend a spell slot on a melee hit to deal extra radiant damage.',
  'uncanny dodge': 'Reaction: halve the damage from one attack that hits you.',
  evasion: 'Take no damage on a successful Dexterity save (and half on a failure).',
  'deft explorer': 'Extra proficiencies and expertise from your exploration knack.',
  'war magic': 'Make a weapon attack as a bonus action after you cast a cantrip.',
  'improved critical': 'Your weapon attacks score a critical hit on a roll of 19 or 20.',
};

/** Strip a trailing "(…)" annotation and lowercase — matches curated keys. */
export function capabilityKey(name: string): string {
  return name
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .toLowerCase();
}
