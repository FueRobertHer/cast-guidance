/**
 * Passive / always-available capabilities worth reminding a player about on
 * the Play tab: things you can just DO that don't otherwise appear as a
 * limited-use action chip (Extra Attack is the canonical example a new player
 * forgets). Keyed by the feature's base name, lowercased; the value is a short
 * "what it lets you do". Tapping the chip still opens the feature's full text.
 */
import type { FeatureCard } from '@/engine/types';
// Relative: `scripts/data-judge.ts` loads this file under plain Bun.
import { stripTrailingParenthetical } from '../../lib/trailingParenthetical';

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
  // The top of `data:judge --report capability`. One line serves every printing
  // of a name, so a line has to be true of them all.
  'feral senses':
    'You sense unseen creatures within 30 feet and can fight them without disadvantage.',
  'saint of forge and fire':
    'Immune to fire; in heavy armor, resist nonmagical bludgeoning, piercing, and slashing.',
  'aura of hate': 'You and nearby fiends and undead add your CHA to melee weapon damage.',
  'fiery soul': 'Immune to fire; your fire ignores resistance and treats immunity as resistance.',
  'spell resistance': 'Advantage on saves against spells, and resistance to their damage.',
  'fire in the veins': 'Resistance to fire damage; your spells ignore fire resistance.',
  'grave touched':
    'Once per turn, make your damage necrotic, with an extra die in your Form of Dread.',
  'battle ready': 'Use INT instead of STR or DEX when you attack with a magic weapon.',
  'extra attack improvement': 'The Attack action now gives you three attacks.',
  'supernatural resistance': 'Resist bludgeoning, piercing, and slashing from nonmagical weapons.',
  'improved divine smite': 'Every melee weapon hit deals an extra 1d8 radiant damage.',
  'divine fury': 'While raging, your first hit each turn deals extra necrotic or radiant damage.',
  'elemental epitome':
    'While attuned, resist one element and add a Martial Arts die to one unarmed hit a turn.',
  'superior critical': 'Your weapons now score critical hits on a roll of 18, 19, or 20.',
  'aura of conquest':
    "Creatures frightened of you can't move in your aura and take psychic damage there.",
  'aura of alacrity': 'Your speed rises by 10 feet, and allies in your aura gain 10 feet too.',
  'divine strike': 'Once per turn, add extra damage when you hit with a weapon.',
  'potent psionics':
    'Once per turn, add psychic damage to a weapon hit; add INT to psionic talent damage.',
  'lightning launcher': "Your armor's ranged attack: 1d6 lightning, plus 1d6 on one hit each turn.",
  'aura of protection': 'You and nearby allies add your CHA modifier to saving throws.',
  'umbral sight': "Gain darkvision, and you're invisible in darkness to creatures relying on it.",
  'thunder gauntlets':
    'Your gauntlets hit for 1d8 thunder, and targets have disadvantage attacking anyone else.',
  'distant strike':
    'Teleport 10 feet before each attack; hit two targets to earn an attack on a third.',
  'soul of the forge': 'Resistance to fire damage, and +1 AC while in heavy armor.',
  'fancy footwork':
    "A creature you melee on your turn can't make opportunity attacks against you that turn.",
  'ki-empowered strikes': 'Your unarmed strikes count as magical against resistance and immunity.',
  elusive: "Attackers can't have advantage on you unless you're incapacitated.",
  'gathered swarm':
    'Once per turn after a hit, your swarm deals 1d6, moves the target, or moves you.',
  'hold the line':
    'Foes moving within your reach provoke opportunity attacks; a hit drops their speed to 0.',
  'twinkling constellations':
    'Starry Form: Archer and Chalice use 2d8, Dragon flies, and you can switch each turn.',
  'psychic defenses':
    'Resistance to psychic damage, and advantage on saves against charm and fear.',
  'supernatural defense':
    "Add 1d6 to saves your Slayer's Prey forces and to checks to escape its grapple.",
  'aura of warding':
    'You and allies in your aura resist spell damage (2024 rules: necrotic, psychic, radiant).',
  'unyielding spirit': 'Advantage on saves against being paralyzed or stunned.',
  'three extra attacks': 'The Attack action now gives you four attacks.',
  'hex warrior': 'Use CHA instead of STR or DEX with your bound weapon; rebind it on a long rest.',
  "giant's havoc":
    'While raging, gain 5 feet of reach, grow to Large, and add rage damage to thrown hits.',
  'elemental cleaver':
    'While raging, your infused weapon deals 1d6 extra elemental damage and can be thrown.',
  'potent cantrips': 'Add your spellcasting modifier to cantrip damage.',
  stormborn:
    'Fly at your walking speed: outdoors as a Tempest cleric, in Wrath of the Sea as a druid.',
  'potent cantrip': 'Foes who avoid your damaging cantrip still take half its damage.',
  'improved circle forms':
    'In Wild Shape, your attacks can deal radiant damage, and add WIS to CON saves.',
  'two extra attacks': 'The Attack action now gives you three attacks.',
  "ranger's companion":
    'Your beast acts on your initiative; use your action to command it to attack.',
  // Race traits: these live nested inside the race's feature card, so the
  // collector below walks named sub-entries too.
  'magic resistance': 'Advantage on saving throws against spells.',
  'mirthful leaps': 'Add a d8 to the distance of your long and high jumps.',
  'fey ancestry': "Advantage on saves against being charmed; magic can't put you to sleep.",
  brave: 'Advantage on saving throws against being frightened.',
  'halfling nimbleness': 'Move through the space of any creature larger than you.',
  'savage attacks': 'Add one extra weapon damage die on a melee critical hit.',
  'firearms mastery':
    "Ignore loading on firearms, and long range doesn't give you disadvantage with them.",
  hawkeyed: "Long range doesn't give you disadvantage on ranged weapon attacks.",
  'pack tactics': 'Advantage on attacks when an ally is within 5 feet of your target.',
  'dwarven resilience': 'Advantage on saves against poison, and resistance to poison damage.',
  'long-limbed': 'Your melee attacks reach 5 feet farther on your turn.',
  'duergar resilience':
    'Advantage on saves against poison, illusions, charm, and paralysis; resist poison damage.',
  'construct resilience': 'Advantage on saves against poison, and resistance to poison damage.',
  'poison resilience': 'Advantage on saves against poison, and resistance to poison damage.',
};

/** Strip a trailing "(…)" annotation and lowercase, matching curated keys. */
export function capabilityKey(name: string): string {
  return stripTrailingParenthetical(name).trim().toLowerCase();
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
