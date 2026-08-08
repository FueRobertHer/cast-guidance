/**
 * Passive / always-available capabilities worth reminding a player about on
 * the Play tab: things you can just DO that don't otherwise appear as a
 * limited-use action chip (Extra Attack is the canonical example a new player
 * forgets). Keyed by the feature's base name, lowercased; the value is a short
 * "what it lets you do". Tapping the chip still opens the feature's full text.
 */
import type { FeatureCard } from '@/engine/types';

export const COMBAT_CAPABILITIES: Record<string, string> = {
  'extra attack': 'Attack more than once whenever you take the Attack action.',
  'martial arts': 'Use DEX for monk weapons and make an unarmed strike as a bonus action.',
  'cunning action': 'Dash, Disengage, or Hide as a bonus action every turn.',
  'reckless attack':
    'Attack melee with advantage, but attacks against you have advantage until your next turn.',
  'sneak attack': 'Once per turn, add extra damage when you have advantage or an ally is adjacent.',
  'divine smite': 'Spend a spell slot on a melee hit to deal extra radiant damage.',
  'uncanny dodge': 'Reaction: halve the damage from one attack that hits you.',
  evasion: 'Take no damage on a successful Dexterity save (and half on a failure).',
  'deft explorer': 'Extra proficiencies and expertise from your exploration knack.',
  'war magic': 'Make a weapon attack as a bonus action after you cast a cantrip.',
  'improved critical': 'Your weapon attacks score a critical hit on a roll of 19 or 20.',
  'danger sense': 'Advantage on Dexterity saves against effects you can see.',
  // Race traits: these live nested inside the race's feature card, so the
  // collector below walks named sub-entries too.
  'magic resistance': 'Advantage on saving throws against spells.',
  'mirthful leaps': 'Add a d8 to the distance of your long and high jumps.',
  'fey ancestry': "Advantage on saves against being charmed; magic can't put you to sleep.",
  brave: 'Advantage on saving throws against being frightened.',
  'halfling nimbleness': 'Move through the space of any creature larger than you.',
  'savage attacks': 'Add one extra weapon damage die on a melee critical hit.',
};

/** Strip a trailing "(…)" annotation and lowercase, matching curated keys. */
export function capabilityKey(name: string): string {
  return name
    .replace(/\s*\(.*\)\s*$/, '')
    .trim()
    .toLowerCase();
}

export interface CapabilityCard {
  key: string;
  name: string;
  origin: string;
  blurb: string;
  entries: unknown;
}

/**
 * Every feature (or named trait nested inside one; races hold their traits as
 * sub-entries of a single card) that matches the capability map. Deduped by
 * key; `excludeKeys` drops capabilities already shown as action chips.
 */
export function collectCapabilityCards(
  features: readonly FeatureCard[],
  excludeKeys: ReadonlySet<string> = new Set(),
): CapabilityCard[] {
  const seen = new Set<string>();
  const out: CapabilityCard[] = [];

  const consider = (name: string, origin: string, entries: unknown) => {
    const key = capabilityKey(name);
    const blurb = COMBAT_CAPABILITIES[key];
    if (blurb === undefined || excludeKeys.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ key, name, origin, blurb, entries });
  };

  const walk = (node: unknown, origin: string): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n, origin);
      return;
    }
    if (node !== null && typeof node === 'object') {
      const o = node as { name?: unknown; entries?: unknown; items?: unknown };
      if (typeof o.name === 'string') consider(o.name, origin, o.entries ?? []);
      walk(o.entries, origin);
      walk(o.items, origin);
    }
  };

  for (const f of features) {
    consider(f.name, f.origin.label, f.entries);
    walk(f.entries, f.origin.label);
  }
  return out;
}
