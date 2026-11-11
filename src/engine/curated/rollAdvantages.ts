/**
 * Advantage on the character's own d20 tests that features, feats, optional
 * features and species traits state only in prose. Like the standing table
 * (`STANDING`), a row here adds to what the prose scan or a curated row reads
 * from the same feature; neither reads advantage today.
 *
 * A row with no `when` holds whenever its rolls are made (Feral Instinct on
 * initiative), or while a state the app can see holds (`while`: Bloodied). A
 * row with `when` holds only in a situation the app cannot see (Brave, against
 * being Frightened): the roll prompt offers it to claim, and `when` says when.
 * Every `when` starts "Only", as the prompt and the Defenses sheet read it.
 *
 * Kept out on purpose:
 *   - advantage paid for at the roll (Tides of Chaos, 2024 Lucky, Kenku Recall):
 *     the paid extras' table (`ROLL_EXTRAS`), which spends its use;
 *   - advantage for allies or against the character (Wolf totem, Zealous
 *     Presence, Alert), which is not this character's roll;
 *   - Rage, Reckless Attack and 2024 Innate Sorcery, whose effects in play
 *     already give it;
 *   - tool checks (Fisher's fishing tackle), which no roll on the sheet names.
 *
 * Keys, all lowercase:
 *   - class and subclass features: `featureName|class or subclass name|source`
 *   - feats and optional features: `name|source`
 *   - species traits: `traitName|race or subrace name|source`, then
 *     `traitName|source` (the race's or subrace's book)
 */
import type { Collector } from '../effects/base';
import type { Ability, EffectOrigin, RollFilter, WhileState } from '../types';

interface AdvantageRow {
  on: RollFilter;
  /** When it holds, which the player says at the roll: "Only against spells". */
  when?: string;
  /** A state the app can see that it holds only while. */
  while?: readonly WhileState[];
  /** The level the feature is gained at, for option features of one name (Bear at 6). */
  level?: number;
}

export const INITIATIVE: RollFilter = { rolls: ['check'], initiative: true };
const DEATH: RollFilter = { rolls: ['save'], save: 'death' };
const CONCENTRATION: RollFilter = { rolls: ['save'], abilities: ['con'], save: 'concentration' };
export const ATTACKS: RollFilter = { rolls: ['attack'] };
const MELEE: RollFilter = { rolls: ['attack'], range: 'melee' };
export const SAVES: RollFilter = { rolls: ['save'] };
export const CHECKS: RollFilter = { rolls: ['check'] };
export const D20_TESTS: RollFilter = { rolls: ['attack', 'check', 'save'] };
export const saves = (...abilities: Ability[]): RollFilter => ({ rolls: ['save'], abilities });
export const checks = (...abilities: Ability[]): RollFilter => ({ rolls: ['check'], abilities });
export const checksAndSaves = (...abilities: Ability[]): RollFilter => ({
  rolls: ['check', 'save'],
  abilities,
});
export const skills = (...names: string[]): RollFilter => ({ rolls: ['check'], skills: names });
const MENTAL = saves('int', 'wis', 'cha');
const BLOODIED: readonly WhileState[] = [{ state: 'bloodied' }];

const always = (on: RollFilter): AdvantageRow => ({ on });
const only = (on: RollFilter, when: string): AdvantageRow => ({ on, when });

const AGAINST_CHARMED = 'Only against being Charmed';
const AGAINST_FRIGHTENED = 'Only against being Frightened';
const AGAINST_CHARMED_FRIGHTENED = 'Only against being Charmed or Frightened';
const AGAINST_POISON = 'Only against poison';
const AGAINST_POISONED = 'Only against being Poisoned';
const AGAINST_SPELLS = 'Only against spells';
const AGAINST_MAGIC = 'Only against magic';
const HALF_SPEED = 'Only if you move no more than half your speed this turn';

export const ROLL_ADVANTAGES: Record<string, readonly AdvantageRow[]> = {
  // --- Classes ---------------------------------------------------------------
  'feral instinct|barbarian|phb': [always(INITIATIVE)],
  'feral instinct|barbarian|xphb': [always(INITIATIVE)],
  'danger sense|barbarian|phb': [only(saves('dex'), 'Only against effects you can see')],
  // "Unless you have the Incapacitated condition": Paralyzed, Stunned and
  // Unconscious fail Dexterity saves outright, which the conditions already say.
  'danger sense|barbarian|xphb': [always(saves('dex'))],
  'countercharm|bard|phb': [
    only(
      SAVES,
      'Only while your Countercharm performance lasts, against being Charmed or Frightened',
    ),
  ],
  'studied attacks|fighter|xphb': [
    only(ATTACKS, 'Only on your next attack against a creature you missed since your last turn'),
  ],
  'favored enemy|ranger|phb': [
    only(skills('Survival'), 'Only to track your favored enemies'),
    only(checks('int'), 'Only to recall information about your favored enemies'),
  ],
  "land's stride|ranger|phb": [only(SAVES, 'Only against magical plants that impede movement')],
  'precise hunter|ranger|xphb': [
    only(ATTACKS, "Only against the creature marked by your Hunter's Mark"),
  ],
  'steady aim|rogue|tce': [only(ATTACKS, 'Only on your next attack this turn after Steady Aim')],
  'steady aim|rogue|xphb': [only(ATTACKS, 'Only on your next attack this turn after Steady Aim')],
  'battle readiness|warrior sidekick|tce': [always(INITIATIVE)],

  // --- Subclasses ------------------------------------------------------------
  'dampening field|armorer|tce': [only(skills('Stealth'), 'Only in your Infiltrator armor')],
  'infiltrator|armorer|efa': [only(skills('Stealth'), 'Only in your Infiltrator armor')],
  'perfected armor|armorer|efa': [
    only(checksAndSaves('str'), 'Only while your Giant Stature lasts'),
  ],
  'bear|path of the totem warrior|phb': [
    { ...only(checks('str'), 'Only to push, pull, lift or break objects'), level: 6 },
  ],
  'dance virtuoso|college of dance|xphb': [only(skills('Performance'), 'Only when you dance')],
  'channel divinity: invoke duplicity|trickery domain|phb': [
    only(ATTACKS, 'Only when you and your illusion are both within 5 feet of the target'),
  ],
  'channel divinity: invoke duplicity|ambition domain (psa)|psa': [
    only(ATTACKS, 'Only when you and your illusion are both within 5 feet of the target'),
  ],
  'invoke duplicity|trickery domain|xphb': [
    only(ATTACKS, 'Only when you and your illusion are both within 5 feet of the target'),
  ],
  'blessing of the trickster|trickery domain|xphb': [
    only(skills('Stealth'), 'Only while your Blessing of the Trickster is on you'),
  ],
  'divine foreknowledge|knowledge domain|frhof': [
    only(D20_TESTS, 'Only while Divine Foreknowledge lasts'),
    // D20 Tests take in death saves, which take only rows naming them.
    only(DEATH, 'Only while Divine Foreknowledge lasts'),
  ],
  'vigilant blessing|twilight domain|tce': [
    only(INITIATIVE, 'Only on your next initiative roll after you bless yourself'),
  ],
  'spirit totem|circle of the shepherd|xge': [
    only(checksAndSaves('str'), "Only in your Bear Spirit's aura"),
  ],
  "land's stride|circle of the land|phb": [
    only(SAVES, 'Only against magical plants that impede movement'),
  ],
  'born to the saddle|cavalier|xge': [only(SAVES, 'Only to avoid falling off your mount')],
  'unwavering mark|cavalier|xge': [
    only(ATTACKS, 'Only on the bonus action attack Unwavering Mark gives'),
  ],
  'remarkable athlete|champion|xphb': [always(INITIATIVE), always(skills('Athletics'))],
  'survivor|champion|xphb': [always(DEATH)],
  "giant's might|rune knight|tce": [only(checksAndSaves('str'), "Only while Giant's Might lasts")],
  'visage of the astral self|way of the astral self|tce': [
    only(skills('Insight', 'Intimidation'), 'Only while your astral visage is summoned'),
  ],
  'shadow step|way of shadow|phb': [
    only(MELEE, 'Only on your first melee attack after Shadow Step this turn'),
  ],
  'shadow step|warrior of shadow|xphb': [
    only(MELEE, 'Only on your first melee attack after Shadow Step this turn'),
  ],
  'exalted champion|oath of the crown|scag': [
    only(saves('wis'), 'Only while Exalted Champion lasts'),
  ],
  'unyielding spirit|oath of the crown|scag': [
    only(SAVES, 'Only against being Paralyzed or Stunned'),
  ],
  'holy nimbus|oath of devotion|phb': [
    only(SAVES, 'Only while Holy Nimbus lasts, against spells cast by fiends or undead'),
  ],
  'holy nimbus|oath of devotion|xphb': [
    only(SAVES, 'Only while Holy Nimbus lasts, against a Fiend or an Undead'),
  ],
  'living legend|oath of glory|tce': [only(checks('cha'), 'Only while Living Legend lasts')],
  'living legend|oath of glory|xphb': [only(checks('cha'), 'Only while Living Legend lasts')],
  'peerless athlete|oath of glory|tce': [
    only(skills('Athletics', 'Acrobatics'), 'Only while Peerless Athlete lasts'),
  ],
  'peerless athlete|oath of glory|xphb': [
    only(skills('Athletics', 'Acrobatics'), 'Only while Peerless Athlete lasts'),
  ],
  'vow of enmity|oath of vengeance|phb': [
    only(ATTACKS, 'Only against the target of your Vow of Enmity'),
  ],
  'vow of enmity|oath of vengeance|xphb': [
    only(ATTACKS, 'Only against the target of your Vow of Enmity'),
  ],
  'mortal bulwark|oath of the watchers|tce': [
    only(
      ATTACKS,
      'Only while Mortal Bulwark lasts, against aberrations, celestials, elementals, fey and fiends',
    ),
  ],
  "watcher's will|oath of the watchers|tce": [only(MENTAL, "Only while Watcher's Will lasts")],
  'beguiling twist|fey wanderer|tce': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
  'beguiling twist|fey wanderer|xphb': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
  'steel will|hunter|phb': [only(SAVES, AGAINST_FRIGHTENED)],
  'assassinate|assassin|phb': [
    only(ATTACKS, 'Only against a creature that has not taken a turn in this combat'),
  ],
  'assassinate|assassin|xphb': [
    always(INITIATIVE),
    only(ATTACKS, 'Only in the first round, against a creature that has not taken a turn'),
  ],
  'impostor|assassin|phb': [
    only(skills('Deception'), 'Only to avoid detection while you pass as someone else'),
  ],
  'versatile trickster|arcane trickster|phb': [
    only(ATTACKS, 'Only against a creature your Mage Hand distracts this turn'),
  ],
  'steady eye|inquisitive|xge': [only(skills('Perception', 'Investigation'), HALF_SPEED)],
  'tokens of the departed|phantom|tce': [
    only(DEATH, 'Only while a soul trinket is on your person'),
    only(saves('con'), 'Only while a soul trinket is on your person'),
  ],
  'tokens of the departed|phantom|rhw': [
    only(DEATH, 'Only while you have a soul trinket'),
    only(saves('con'), 'Only while you have a soul trinket'),
  ],
  'strike fear|scion of the three|frhof': [
    only(ATTACKS, 'Only against a creature Frightened by your Strike Fear'),
  ],
  'ambush master|scout|xge': [always(INITIATIVE)],
  'elegant maneuver|swashbuckler|xge': [
    only(skills('Acrobatics', 'Athletics'), 'Only after Elegant Maneuver this turn'),
  ],
  'supreme sneak|thief|phb': [only(skills('Stealth'), HALF_SPEED)],
  'psychic defenses|aberrant mind|tce': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
  'psychic defenses|aberrant sorcery|xphb': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
  'lunar empowerment|lunar sorcery|dsotdq': [
    only(skills('Investigation', 'Perception'), 'Only within the bright light you shed'),
  ],
  'clairvoyant combatant|great old one patron|xphb': [
    only(ATTACKS, 'Only against the creature bonded by Clairvoyant Combatant'),
  ],
  'among the dead|the undying|scag': [only(SAVES, 'Only against disease')],
  'spell resistance|school of abjuration|phb': [only(SAVES, AGAINST_SPELLS)],
  'spell resistance|abjurer|xphb': [only(SAVES, AGAINST_SPELLS)],
  'bladesong|bladesinging|tce': [only(skills('Acrobatics'), 'Only while Bladesong lasts')],
  'bladesong|bladesinger|frhof': [only(skills('Acrobatics'), 'Only while Bladesong lasts')],
  'one with the word|order of scribes|tce': [
    only(skills('Arcana'), 'Only with your spellbook on your person'),
  ],

  // --- Feats -----------------------------------------------------------------
  'durable|xphb': [always(DEATH)],
  'war caster|phb': [always(CONCENTRATION)],
  'war caster|xphb': [always(CONCENTRATION)],
  'actor|phb': [
    only(skills('Deception', 'Performance'), 'Only to pass yourself off as someone else'),
  ],
  'actor|xphb': [
    only(skills('Deception', 'Performance'), 'Only to convince others you are who you disguise as'),
  ],
  'arathi heritage|wow': [only(SAVES, AGAINST_CHARMED)],
  'boon of bloodshed|frhof': [
    only(ATTACKS, 'Only on your next attack after an enemy you can see drops to 0 Hit Points'),
  ],
  'child of the sun|lfl': [only(SAVES, 'Only against being Blinded')],
  'dungeon delver|phb': [
    only(skills('Perception', 'Investigation'), 'Only to find secret doors'),
    only(SAVES, 'Only against traps'),
  ],
  'enclave magic|frhof': [only(CHECKS, 'Only to Influence Beasts')],
  'grappler|phb': [only(ATTACKS, 'Only against a creature you are grappling')],
  'grappler|xphb': [only(ATTACKS, 'Only against a creature you are grappling')],
  'infernal constitution|xge': [only(SAVES, AGAINST_POISONED)],
  "lords' alliance agent|frhof": [
    only(ATTACKS, 'Only against an enemy that just hurt an ally within 5 feet of you'),
  ],
  'mage slayer|phb': [only(SAVES, 'Only against spells cast within 5 feet of you')],
  'mounted combatant|phb': [
    only(MELEE, 'Only while mounted, against an unmounted creature smaller than your mount'),
  ],
  'mounted combatant|xphb': [
    only(
      ATTACKS,
      'Only while mounted, against an unmounted creature near your mount and smaller than it',
    ),
  ],
  "order's resilience|frhof": [
    only(saves('str'), 'Only within 5 feet of an ally who is not Incapacitated'),
  ],
  'purple dragon commandant|frhof': [{ on: ATTACKS, while: BLOODIED }],
  'skulker|xphb': [only(skills('Stealth'), 'Only to Hide during combat')],
  'squat nimbleness|xge': [only(skills('Athletics', 'Acrobatics'), 'Only to escape a grapple')],
  'treacherous allure|abh': [only(ATTACKS, 'Only against a Charmed creature')],
  'vampire hunter|abh': [only(CHECKS, 'Only to escape a grapple or nonmagical restraints')],

  // --- Optional features -----------------------------------------------------
  'eldritch mind|tce': [always(CONCENTRATION)],
  'eldritch mind|xphb': [always(CONCENTRATION)],
  'extended spell|xphb': [only(CONCENTRATION, 'Only for a spell you extended')],
  'cloud rune|tce': [always(skills('Sleight of Hand', 'Deception'))],
  'frost rune|tce': [always(skills('Animal Handling', 'Intimidation'))],
  'stone rune|tce': [always(skills('Insight'))],
  'storm rune|tce': [always(skills('Arcana'))],
  'hill rune|tce': [only(SAVES, AGAINST_POISONED)],

  // --- Species traits --------------------------------------------------------
  'amorphous|aag': [only(CHECKS, 'Only to start or escape a grapple')],
  'ambusher|dmg': [only(ATTACKS, 'Only in the first round, against a surprised creature')],
  'bloodied frenzy|wow': [{ on: ATTACKS, while: BLOODIED }],
  'brave|lfl': [only(SAVES, AGAINST_FRIGHTENED)],
  'brave|phb': [only(SAVES, AGAINST_FRIGHTENED)],
  'brave|psz': [only(SAVES, AGAINST_FRIGHTENED)],
  'brave|xphb': [only(SAVES, AGAINST_FRIGHTENED)],
  'chameleon carapace|aag': [
    only(skills('Stealth'), 'Only to hide where your carapace matches the surroundings'),
  ],
  'chameleon skin|dmg': [only(skills('Stealth'), 'Only to hide')],
  'construct resilience|efa': [only(SAVES, AGAINST_POISONED)],
  'constructed resilience|erlw': [only(SAVES, AGAINST_POISONED)],
  // The Dhampir's Deathless Nature (same book) is not needing to breathe.
  'deathless nature|reborn|vrgr': [
    only(SAVES, 'Only against disease or being Poisoned'),
    always(DEATH),
  ],
  'dual mind|efa': [always(saves('wis', 'cha'))],
  'dual mind|erlw': [always(saves('wis'))],
  'duergar resilience|mtf': [
    only(SAVES, 'Only against poison, illusions, or being Charmed or Paralyzed'),
  ],
  'dwarven resilience|mpmm': [only(SAVES, AGAINST_POISONED)],
  'dwarven resilience|phb': [only(SAVES, AGAINST_POISON)],
  'dwarven resilience|psk': [only(SAVES, AGAINST_POISON)],
  'dwarven resilience|wow': [only(SAVES, AGAINST_POISONED)],
  'dwarven resilience|xphb': [only(SAVES, AGAINST_POISONED)],
  'earthen resilience|wow': [only(SAVES, AGAINST_POISONED)],
  'escaped death|rhw': [always(DEATH)],
  'expert duplication|mpmm': [only(CHECKS, 'Only to make an exact copy of writing or craftwork')],
  'expert forgery|vgm': [only(CHECKS, 'Only to forge or copy an object')],
  'fearless|dsotdq': [only(SAVES, AGAINST_FRIGHTENED)],
  'feast of blood|psx': [only(checksAndSaves('str', 'dex'), 'Only while Feast of Blood lasts')],
  'fey ancestry|aag': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|efa': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|lfl': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|mpmm': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|phb': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|psk': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|psz': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|wow': [only(SAVES, AGAINST_CHARMED)],
  'fey ancestry|xphb': [only(SAVES, AGAINST_CHARMED)],
  'gnome cunning|dmg': [only(MENTAL, AGAINST_MAGIC)],
  'gnome cunning|phb': [only(MENTAL, AGAINST_MAGIC)],
  'gnomish cunning|wow': [always(MENTAL)],
  'gnomish cunning|xphb': [always(MENTAL)],
  'gnomish magic resistance|mpmm': [only(MENTAL, AGAINST_SPELLS)],
  'hippo build|aag': [always(checksAndSaves('str'))],
  'incisive sense|egw': [always(skills('Investigation', 'Insight'))],
  'keen hearing and smell|dmg': [
    only(skills('Perception'), 'Only when it relies on hearing or smell'),
  ],
  'keen smell|ggr': [
    only(skills('Perception', 'Survival', 'Investigation'), 'Only when it involves smell'),
  ],
  'kobold legacy (defiance)|mpmm': [only(SAVES, AGAINST_FRIGHTENED)],
  'labyrinthine recall|mpmm': [only(skills('Survival'), 'Only to navigate or track')],
  'large form|xphb': [only(checks('str'), 'Only while in Large Form')],
  'lavastep grit|psz': [only(skills('Stealth'), 'Only to hide in rocky or underground places')],
  'leviathan will|lr': [
    only(
      SAVES,
      'Only against being Charmed, Frightened, Paralyzed, Poisoned, Stunned or put to sleep',
    ),
  ],
  'loxodon serenity|ggr': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
  'magic resistance|mot': [only(SAVES, 'Only against spells and other magical effects')],
  'magic resistance|mpmm': [only(SAVES, AGAINST_SPELLS)],
  'magic resistance|vgm': [only(SAVES, 'Only against spells and other magical effects')],
  'mechanical nature|aag': [only(SAVES, 'Only against being Paralyzed or Poisoned')],
  'mechanical nature|wow': [only(SAVES, 'Only against being Paralyzed or Poisoned')],
  'mental discipline|mpmm': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
  'mental discipline|mtf': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
  'natural resilience|aag': [only(SAVES, AGAINST_POISONED)],
  'pack tactics|dmg': [
    only(ATTACKS, 'Only with an ally who is not Incapacitated within 5 feet of the target'),
  ],
  'pack tactics|vgm': [
    only(ATTACKS, 'Only with an ally who is not Incapacitated within 5 feet of the target'),
  ],
  'poison resilience|mpmm': [only(SAVES, AGAINST_POISONED)],
  'powerful build|xphb': [only(CHECKS, 'Only to end the Grappled condition')],
  'psionic fortitude|mpmm': [only(SAVES, 'Only against being Charmed or Stunned')],
  'shape-shifter|efa': [only(checks('cha'), 'Only while shape-shifted')],
  'shell defense|mpmm': [only(saves('str', 'con'), 'Only while in your shell')],
  'shell defense|ttp': [only(saves('str', 'con'), 'Only while in your shell')],
  'shifting (wildhunt)|efa': [only(checks('wis'), 'Only while shifted')],
  'shifting (wildhunt)|mpmm': [only(checks('wis'), 'Only while shifted')],
  // Every Eberron shifter has a Shifting Feature; only the Wildhunt's gives advantage.
  'shifting feature|wildhunt|erlw': [only(checks('wis'), 'Only while shifted')],
  'slippery|dmg': [only(checksAndSaves('str', 'dex'), 'Only to escape a grapple')],
  'speech of beast and leaf|mpmm': [only(checks('cha'), 'Only to influence beasts and plants')],
  'speech of beast and leaf|vgm': [only(checks('cha'), 'Only to influence beasts and plants')],
  'stone camouflage|dmg': [only(skills('Stealth'), 'Only to hide in rocky terrain')],
  'stone camouflage|mtf': [only(skills('Stealth'), 'Only to hide in rocky terrain')],
  'stone camouflage|scag': [only(skills('Stealth'), 'Only to hide in rocky terrain')],
  'stout resilience|phb': [only(SAVES, AGAINST_POISON)],
  'swamp camouflage|dmg': [only(skills('Stealth'), 'Only to hide in swampy terrain')],
  'telepathic insight|ai': [always(saves('wis', 'cha'))],
  'vedalken cunning|psk': [only(MENTAL, AGAINST_MAGIC)],
  'vedalken dispassion|ggr': [always(MENTAL)],
  'will of the forsaken|wow': [only(SAVES, AGAINST_CHARMED_FRIGHTENED)],
};

/**
 * Adds the rows of the first key that has any, as advantage from `origin`,
 * and returns whether one did. `level` picks among option features of one
 * name; a row with none holds at every level.
 */
export function emitRollAdvantages(
  col: Collector,
  keys: readonly string[],
  origin: EffectOrigin,
  level?: number,
): boolean {
  for (const key of keys) {
    const rows = ROLL_ADVANTAGES[key.toLowerCase()];
    if (rows === undefined) continue;
    for (const row of rows) {
      if (row.level !== undefined && row.level !== level) continue;
      col.add({
        kind: 'rollAdvantage',
        mode: 'adv',
        on: row.on,
        ...(row.when !== undefined ? { when: row.when } : {}),
        ...(row.while !== undefined ? { while: [...row.while] } : {}),
        origin,
      });
    }
    return true;
  }
  return false;
}
