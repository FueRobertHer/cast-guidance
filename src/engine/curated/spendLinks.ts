/**
 * Which pool each feature spends. An action spends a pool by name alone otherwise,
 * so Cutting Words never touches Bardic Inspiration and a monk's Flurry of Blows
 * never touches Focus.
 *
 * Generated once from Jev's confident `spend-<pool>` answers, then read row by row
 * against the features: a person decides what is here, and `bun run data:judge --
 * --report spend` lists what is not. These are facts of the game rules, fine to
 * commit.
 *
 * Keys name the printing, because the printings disagree (Heightened Spell costs 3
 * in 2014 and 2 in 2024): class features `name|class|source`, subclass features
 * `name|subclass|source`, feats and optional features `name|source`, all lowercase.
 *
 * A row from `restore` is the other kind of spending: the pool buys a use back, and
 * using the feature costs nothing. Those paid in spell slots or Hit Point Dice stay
 * out, as every cost in them does.
 */
import type { Collector } from '../effects/base';
import type { ActionBuyBack, ActionCost, ActionEconomy, EffectOrigin } from '../types';

type Amount = ActionCost['amount'];

interface SpendRow {
  amount: Amount;
  /** The slot it takes. Given when no action row exists yet, or when the scanner's is wrong. */
  economy?: ActionEconomy;
  /** The base use is free, and the pool pays for more. */
  optional?: boolean;
  /** It takes a use of the feature as well as the cost. */
  ownUseToo?: boolean;
  restores?: undefined;
}

/** What a buy-back needs beyond its price, when the sheet does not line up by name. */
interface Restores {
  /**
   * The use, when it does not share the action's name: a spell the feature's
   * own subclass or class grants, by the name its pool is keyed by
   * (`additionalSpells`). The key is built from the subclass the sheet walks,
   * so a renamed copy of the subclass finds its own pool.
   */
  ownSpell?: string;
  /** The action to hang it on, when that is another feature's. */
  onAction?: string;
  /** Its uses, when the feature has no row counting them. Labelled with the feature's name. */
  uses?: { key: string; max: number; resetOn: 'short' | 'long' };
}

interface RestoreRow {
  amount: number;
  restores: Restores;
  economy?: undefined;
  optional?: undefined;
  ownUseToo?: undefined;
}

type Row = SpendRow | RestoreRow;

export type SpendLink = Row & { resource: string };

/** Has its own action in the turn, at this amount. */
const on = (economy: ActionEconomy, amount: Amount = 1): Row => ({ amount, economy });
/** Rides on a hit, a spell or a roll: tapping it spends and takes nothing from the turn. */
const rider = (amount: Amount = 1): Row => ({ amount, economy: 'none' });
/** Free to use, with more for this much (2024 Patient Defense). */
const paid = (economy?: ActionEconomy, amount = 1): Row => ({
  amount,
  optional: true,
  ...(economy !== undefined ? { economy } : {}),
});
/** This much buys back the feature's own use, once none are left. */
const restore = (amount: number, restores: Restores = {}): Row => ({ amount, restores });

function pool(
  resource: string,
  rows: Readonly<Record<string, Amount | Row>>,
): Record<string, SpendLink> {
  const out: Record<string, SpendLink> = {};
  for (const [key, row] of Object.entries(rows)) {
    out[key] = typeof row === 'object' ? { resource, ...row } : { resource, amount: row };
  }
  return out;
}

export const SPEND_LINKS: Readonly<Record<string, SpendLink>> = {
  // Written under its 2024 name; `costOnSheet` finds a 2014 monk's ki.
  ...pool('focus', {
    'flurry of blows|monk|phb': 1,
    'patient defense|monk|phb': 1,
    'step of the wind|monk|phb': 1,
    'deflect missiles|monk|phb': paid(),
    'quickened healing|monk|tce': on('action', 2),
    'focused aim|monk|tce': rider('varies'),
    'stunning strike|monk|phb': 1,
    'diamond soul|monk|phb': rider(),
    'empty body|monk|phb': on('action', 'varies'),
    'flurry of blows|monk|xphb': 1,
    'patient defense|monk|xphb': paid(),
    'step of the wind|monk|xphb': paid(),
    'deflect attacks|monk|xphb': paid(),
    'stunning strike|monk|xphb': 1,
    'disciplined survivor|monk|xphb': rider(),
    'superior defense|monk|xphb': rider(3),
    'ascendant aspect|way of the ascendant dragon|ftd': rider(),
    'quivering palm|way of the open hand|phb': rider(3),
    'shadow arts|way of shadow|phb': on('action', 2),
    'mastery of death|way of the long death|scag': rider(),
    'touch of the long death|way of the long death|scag': on('action', 'varies'),
    'arms of the astral self|way of the astral self|tce': 1,
    'visage of the astral self|way of the astral self|tce': 1,
    'awakened astral self|way of the astral self|tce': 5,
    'hand of harm|way of mercy|tce': rider(),
    'hand of healing|way of mercy|tce': paid('action'),
    'hand of ultimate mercy|way of mercy|tce': { amount: 5, ownUseToo: true },
    'redirect attack|way of the drunken master|xge': 1,
    "drunkard's luck|way of the drunken master|xge": rider(2),
    'one with the blade|way of the kensei|xge': rider(),
    'sharpen the blade|way of the kensei|xge': 'varies',
    // The bolt alone is part of the Attack action and spends nothing. This is the bonus attacks.
    'radiant sun bolt|way of the sun soul|xge': 1,
    'searing arc strike|way of the sun soul|xge': 'varies',
    'searing sunburst|way of the sun soul|xge': on('action', 'varies'),
    'elemental attunement|warrior of the elements|xphb': rider(),
    'elemental burst|warrior of the elements|xphb': on('action', 2),
    'hand of harm|warrior of mercy|xphb': rider(),
    'hand of healing|warrior of mercy|xphb': paid('action'),
    'hand of ultimate mercy|warrior of mercy|xphb': { amount: 5, ownUseToo: true },
    'quivering palm|warrior of the open hand|xphb': rider(4),
    'darkness|warrior of shadow|xphb': on('action'),
    'improved shadow step|warrior of shadow|xphb': rider(),
    'cloak of shadows|warrior of shadow|xphb': on('action', 3),
    'breath of winter|phb': on('action', 6),
    'clench of the north wind|phb': on('action', 3),
    'eternal mountain defense|phb': on('action', 5),
    'fangs of the fire snake|phb': rider('varies'),
    'fist of four thunders|phb': on('action', 2),
    'flames of the phoenix|phb': on('action', 4),
    'gong of the summit|phb': on('action', 3),
    'mist stance|phb': on('action', 4),
    'ride the wind|phb': on('action', 4),
    'river of hungry flame|phb': on('action', 5),
    'rush of the gale spirits|phb': on('action', 2),
    'shape the flowing river|phb': on('action'),
    'sweeping cinder strike|phb': on('action', 2),
    'unbroken air|phb': on('action', 'varies'),
    'water whip|phb': on('action', 'varies'),
    'wave of rolling earth|phb': on('action', 6),
    'aspect of the wyrm|way of the ascendant dragon|ftd': restore(3, {
      uses: { key: 'aspect-of-the-wyrm', max: 1, resetOn: 'long' },
    }),
    'breath of the dragon|way of the ascendant dragon|ftd': restore(2),
    'redirect attack|warrior of mystic brews|wow': 1,
    'enhancing a magical beverage|warrior of mystic brews|wow': rider(),
  }),
  ...pool('sorcery-points', {
    'magical guidance|sorcerer|tce': rider(),
    'waxing and waning|lunar sorcery|dsotdq': 1,
    'elemental affinity|draconic bloodline|phb': rider(),
    'draconic presence|draconic bloodline|phb': on('action', 5),
    'bend luck|wild magic|phb': 2,
    'revelation in flesh|aberrant mind|tce': 'varies',
    'bastion of law|clockwork soul|tce': on('action', 'varies'),
    'empowered healing|divine soul|xge': rider(),
    'eyes of the dark|shadow magic|xge': paid('action', 2),
    'hound of ill omen|shadow magic|xge': 3,
    'umbral form|shadow magic|xge': 6,
    'beasts of ill omen|shadow sorcery|rhw': 3,
    'revelation in flesh|aberrant sorcery|xphb': 'varies',
    'bastion of law|clockwork sorcery|xphb': on('action', 'varies'),
    'bend luck|wild magic sorcery|xphb': 1,
    'careful spell|phb': rider(),
    'careful spell|xphb': rider(),
    'distant spell|phb': rider(),
    'distant spell|xphb': rider(),
    'empowered spell|phb': rider(),
    'empowered spell|xphb': rider(),
    'extended spell|phb': rider(),
    'extended spell|xphb': rider(),
    'heightened spell|phb': rider(3),
    'heightened spell|xphb': rider(2),
    'quickened spell|phb': rider(2),
    'quickened spell|xphb': rider(2),
    'seeking spell|tce': rider(2),
    'seeking spell|xphb': rider(),
    'subtle spell|phb': rider(),
    'subtle spell|xphb': rider(),
    'transmuted spell|tce': rider(),
    'transmuted spell|xphb': rider(),
    'twinned spell|phb': rider('varies'),
    'twinned spell|xphb': rider(),
    // Once per benefit, three benefits. The sheet does not track which was used, so
    // repeating one while another is left is a manual pip tap.
    'lunar phenomenon|lunar sorcery|dsotdq': restore(5, {
      uses: { key: 'lunar-phenomenon', max: 3, resetOn: 'long' },
    }),
    'warping implosion|aberrant mind|tce': restore(5),
    'warping implosion|aberrant sorcery|xphb': restore(5),
    'trance of order|clockwork soul|tce': restore(5),
    'trance of order|clockwork sorcery|xphb': restore(5),
    'clockwork cavalcade|clockwork soul|tce': restore(7),
    'clockwork cavalcade|clockwork sorcery|xphb': restore(7),
    'umbral form|shadow sorcery|rhw': restore(6),
    'dragon wings|draconic sorcery|xphb': restore(3),
    'crown of spellfire|spellfire sorcery|frhof': restore(5),
    'sorcery incarnate|sorcerer|xphb': restore(2, { onAction: 'Innate Sorcery' }),
  }),
  ...pool('superiority-dice', {
    'ambush|tce': rider(),
    'ambush|xphb': rider(),
    'bait and switch|tce': rider(),
    'bait and switch|xphb': rider(),
    'brace|tce': 1,
    "commander's strike|phb": on('bonus'),
    "commander's strike|xphb": on('bonus'),
    'commanding presence|tce': rider(),
    'commanding presence|xphb': rider(),
    'disarming attack|phb': rider(),
    'disarming attack|xphb': rider(),
    'distracting strike|phb': rider(),
    'distracting strike|xphb': rider(),
    'evasive footwork|phb': rider(),
    'evasive footwork|xphb': 1,
    'feinting attack|phb': on('bonus'),
    'feinting attack|xphb': 1,
    'goading attack|phb': rider(),
    'goading attack|xphb': rider(),
    'grappling strike|tce': 1,
    'lunging attack|phb': rider(),
    'lunging attack|xphb': 1,
    'maneuvering attack|phb': rider(),
    'maneuvering attack|xphb': rider(),
    'menacing attack|phb': rider(),
    'menacing attack|xphb': rider(),
    'parry|phb': 1,
    'parry|xphb': 1,
    'precision attack|phb': rider(),
    'precision attack|xphb': rider(),
    'pushing attack|phb': rider(),
    'pushing attack|xphb': rider(),
    'quick toss|tce': 1,
    'rally|phb': on('bonus'),
    'rally|xphb': 1,
    'riposte|phb': 1,
    'riposte|xphb': 1,
    'sweeping attack|phb': rider(),
    'sweeping attack|xphb': rider(),
    'tactical assessment|tce': rider(),
    'tactical assessment|xphb': rider(),
    'trip attack|phb': rider(),
    'trip attack|xphb': rider(),
    'know your enemy|battle master|xphb': restore(1),
    'battle shout|wow': 1,
    'demoralizing shout|wow': 1,
    'heroic leap|wow': 1,
    'mortal strike|wow': rider(),
    'warding maneuver|wow': 1,
  }),
  // 2024 Turn Undead and Divine Spark are options of the parent feature and never name the pool.
  ...pool('channel-divinity', {
    'channel divinity: harness divine power|cleric|tce': 1,
    'channel divinity: turn undead|cleric|phb': on('action'),
    'channel divinity: touch of death|death domain|dmg': rider(),
    'channel divinity: knowledge of the ages|knowledge domain|phb': on('action'),
    'channel divinity: read thoughts|knowledge domain|phb': on('action'),
    'channel divinity: preserve life|life domain|phb': on('action'),
    'channel divinity: preserve life|solidarity domain (psa)|psa': on('action'),
    'channel divinity: radiance of the dawn|light domain|phb': on('action'),
    'channel divinity: charm animals and plants|nature domain|phb': on('action'),
    'channel divinity: destructive wrath|tempest domain|phb': rider(),
    'channel divinity: invoke duplicity|trickery domain|phb': on('action'),
    'channel divinity: invoke duplicity|ambition domain (psa)|psa': on('action'),
    'channel divinity: cloak of shadows|trickery domain|phb': on('action'),
    'channel divinity: guided strike|war domain|phb': rider(),
    "channel divinity: war god's blessing|war domain|phb": 1,
    'channel divinity: cloak of shadows|ambition domain (psa)|psa': on('action'),
    "oketra's blessing|solidarity domain (psa)|psa": 1,
    'channel divinity: feat of strength|strength domain (psa)|psa': rider(),
    "rhonas's blessing|strength domain (psa)|psa": 1,
    'channel divinity: consuming fervor|zeal domain (psa)|psa': rider(),
    'channel divinity: arcane abjuration|arcana domain|scag': on('action'),
    "channel divinity: order's demand|order domain|tce": on('action'),
    'channel divinity: balm of peace|peace domain|tce': on('action'),
    'channel divinity: twilight sanctuary|twilight domain|tce': on('action'),
    "channel divinity: artisan's blessing|forge domain|xge": rider(),
    'channel divinity: path to the grave|grave domain|xge': on('action'),
    'modify magic|arcana domain|au': rider(),
    'mind magic|knowledge domain|frhof': on('action'),
    'path to the grave|grave domain|rhw': 1,
    'divine reaper|grave domain|rhw': rider(),
    'preserve life|life domain|xphb': on('action'),
    'radiance of the dawn|light domain|xphb': on('action'),
    'invoke duplicity|trickery domain|xphb': 1,
    'guided strike|war domain|xphb': 1,
    "war god's blessing|war domain|xphb": on('bonus'),
    'divine spark|cleric|xphb': on('action'),
    'turn undead|cleric|xphb': on('action'),
    'dispelling recovery|arcana domain|au': restore(1),
    'holy bolt|discipline domain|wow': 1,
    'luminous barrier|discipline domain|wow': 1,
    'shadowform|shadow domain|wow': 1,
  }),
  // Divine Sense, Champion Challenge and Dreadful Aspect never name the pool either.
  ...pool('channel-divinity-paladin', {
    'channel divinity: harness divine power|paladin|tce': 1,
    'abjure foes|paladin|xphb': on('action'),
    'control undead|oathbreaker|dmg': on('action'),
    "nature's wrath|oath of the ancients|phb": on('action'),
    'turn the faithless|oath of the ancients|phb': on('action'),
    'sacred weapon|oath of devotion|phb': on('action'),
    'turn the unholy|oath of devotion|phb': on('action'),
    'abjure enemy|oath of vengeance|phb': on('action'),
    'vow of enmity|oath of vengeance|phb': 1,
    'turn the tide|oath of the crown|scag': 1,
    'inspiring smite|oath of glory|tce': 1,
    'peerless athlete|oath of glory|tce': 1,
    'abjure the extraplanar|oath of the watchers|tce': on('action'),
    "watcher's will|oath of the watchers|tce": on('action'),
    'conquering presence|oath of conquest|xge': on('action'),
    'guided strike|oath of conquest|xge': rider(),
    'emissary of peace|oath of redemption|xge': 1,
    'rebuke the violent|oath of redemption|xge': 1,
    'elemental smite|oath of the noble genies|frhof': rider(),
    "nature's wrath|oath of the ancients|xphb": on('action'),
    'sacred weapon|oath of devotion|xphb': rider(),
    'inspiring smite|oath of glory|xphb': rider(),
    'peerless athlete|oath of glory|xphb': 1,
    'vow of enmity|oath of vengeance|xphb': rider(),
    'divine sense|paladin|xphb': 1,
    'champion challenge|oath of the crown|scag': 1,
    'dreadful aspect|oathbreaker|dmg': on('action'),
    'beacon of light|oath of the holy|wow': on('action'),
    'runic power|oath of the ebon blade|wow': rider(),
  }),
  ...pool('psi-warrior-dice', {
    'protective field|psi warrior|tce': 1,
    'psionic strike|psi warrior|tce': rider(),
    'guarded mind|psi warrior|tce': rider(),
    'protective field|psi warrior|xphb': 1,
    'psionic strike|psi warrior|xphb': rider(),
    'guarded mind|psi warrior|xphb': rider(),
    'telekinetic movement|psi warrior|tce': restore(1),
    'telekinetic movement|psi warrior|xphb': restore(1),
    'psi-powered leap|psi warrior|tce': restore(1),
    'psi-powered leap|psi warrior|xphb': restore(1),
    'bulwark of force|psi warrior|tce': restore(1),
    'bulwark of force|psi warrior|xphb': restore(1),
    // The chip is the bonus attack, and the use is the granted spell's.
    'telekinetic master|psi warrior|tce': restore(1, { ownSpell: 'telekinesis' }),
    'telekinetic master|psi warrior|xphb': restore(1, { ownSpell: 'telekinesis' }),
  }),
  ...pool('soulknife-dice', {
    'psi-bolstered knack|soulknife|tce': rider(),
    'psychic whispers|soulknife|tce': paid('action'),
    'homing strikes|soulknife|tce': rider(),
    'psychic teleportation|soulknife|tce': 1,
    'psi-bolstered knack|soulknife|xphb': rider(),
    'psychic whispers|soulknife|xphb': paid('action'),
    'homing strikes|soulknife|xphb': rider(),
    'psychic teleportation|soulknife|xphb': 1,
    'psychic veil|soulknife|tce': restore(1),
    'psychic veil|soulknife|xphb': restore(1),
    'rend mind|soulknife|tce': restore(3),
    'rend mind|soulknife|xphb': restore(3),
  }),
  ...pool('bardic-inspiration', {
    'cutting words|college of lore|phb': 1,
    'peerless skill|college of lore|phb': rider(),
    'unsettling words|college of eloquence|tce': 1,
    'tales from beyond|college of spirits|vrgr': on('bonus'),
    'mantle of inspiration|college of glamour|xge': 1,
    'defensive flourish|college of swords|xge': rider(),
    'mobile flourish|college of swords|xge': 1,
    'slashing flourish|college of swords|xge': rider(),
    'psychic blades|college of whispers|xge': rider(),
    "moon's inspiration|college of the moon|frhof": rider(),
    'spirits from beyond|college of spirits|rhw': 1,
    'agile strikes|college of dance|xphb': rider(),
    'inspiring movement|college of dance|xphb': 1,
    'tandem footwork|college of dance|xphb': rider(),
    'mantle of inspiration|college of glamour|xphb': 1,
    'cutting words|college of lore|xphb': 1,
    'peerless skill|college of lore|xphb': rider(),
    'beguiling magic|college of glamour|xphb': restore(1),
  }),
  ...pool('wild-shape', {
    'wild companion|druid|tce': on('action'),
    'wild companion|druid|xphb': paid('action'),
    'combat wild shape|circle of the moon|phb': paid(),
    'elemental wild shape|circle of the moon|phb': rider(2),
    'symbiotic entity|circle of spores|tce': on('action'),
    'starry form|circle of stars|tce': 1,
    'summon wildfire spirit|circle of wildfire|tce': on('action'),
    "land's aid|circle of the land|xphb": on('action'),
    "nature's sanctuary|circle of the land|xphb": on('action'),
    'wrath of the sea|circle of the sea|xphb': 1,
    'oceanic gift|circle of the sea|xphb': rider('varies'),
    'starry form|circle of the stars|xphb': 1,
  }),
  ...pool('lay-on-hands', {
    'lay on hands|paladin|phb': 'varies',
    'lay on hands|paladin|xphb': 'varies',
    'restoring touch|paladin|xphb': rider('varies'),
  }),
  // The Death Knight's d8s, where a paladin has Lay on Hands.
  ...pool('death-coil', {
    'death coil|death knight|wow': 'varies',
  }),
  ...pool('rage', {
    'intimidating presence|path of the berserker|xphb': restore(1),
    'zealous presence|path of the zealot|xphb': restore(1),
    'echo of the elements|path of the elements|wow': on('action'),
    'totems|shaman|wow': restore(1, { onAction: 'Primal Knowledge Totem' }),
  }),
  ...pool('second-wind', {
    'tactical mind|fighter|xphb': rider(),
  }),
  ...pool('indomitable', {
    'shared resilience|banneret|frhof': 1,
  }),
  ...pool('breath-weapon', {
    'dragon fear|xge': on('action'),
  }),
  ...pool('soul-fragments', {
    'double jump|demon hunter|wow': 1,
    'soul cleave|demon hunter|wow': rider(),
    'disrupt|demon hunter|wow': on('reaction', 2),
    'warglaive mastery|demon hunter|wow': 1,
  }),
};

/**
 * Hang a feature's cost on the action it already emitted, or add one for a feature
 * that spends a pool with no action row of its own. Runs after the curated entry or
 * the scan, so a table row reaches both. Says whether the table has a row for `key`.
 */
export function linkSpend(
  col: Collector,
  key: string,
  label: string,
  origin: EffectOrigin,
): boolean {
  const link = SPEND_LINKS[key.toLowerCase()];
  if (link === undefined) return false;
  if (link.restores !== undefined) {
    linkBuyBack(col, link.resource, link.amount, link.restores, label, origin);
    return true;
  }
  const cost: ActionCost = {
    resource: link.resource,
    amount: link.amount,
    ...(link.optional === true ? { optional: true } : {}),
    ...(link.ownUseToo === true ? { ownUseToo: true } : {}),
  };
  const own = col.effects.find((e) => e.kind === 'action' && e.origin === origin);
  if (own?.kind === 'action') {
    own.cost = cost;
    if (link.economy !== undefined) own.economy = link.economy;
    return true;
  }
  col.add({ kind: 'action', economy: link.economy ?? 'none', label, cost, origin });
  return true;
}

/**
 * Hang a buy-back on the action showing that use, or add one that takes no slot:
 * the features with no action of their own alter something else (Crown of Spellfire)
 * or ride on a hit (Rend Mind). A scanned row for the same uses comes first and wins.
 */
function linkBuyBack(
  col: Collector,
  resource: string,
  amount: number,
  { ownSpell, onAction, uses }: Restores,
  label: string,
  origin: EffectOrigin,
): void {
  if (uses !== undefined) col.add({ kind: 'resource', label, ...uses, origin });
  // Keyed as `additionalSpells` keys a granted spell's pool: by the origin's uid.
  const own = ownSpell !== undefined ? `spell:${origin.uid}:${ownSpell}` : undefined;
  const buyBack: ActionBuyBack = { resource, amount, ...(own !== undefined ? { own } : {}) };
  const target = col.effects.find(
    (e) =>
      e.kind === 'action' && (onAction !== undefined ? e.label === onAction : e.origin === origin),
  );
  if (target?.kind === 'action') target.buyBack = buyBack;
  else col.add({ kind: 'action', economy: 'none', label: onAction ?? label, buyBack, origin });
}
