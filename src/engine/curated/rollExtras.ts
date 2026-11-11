/**
 * What features, feats, optional features and species traits add to the
 * character's own d20 tests at the roll, beyond advantage that simply holds
 * (`ROLL_ADVANTAGES`). Like that table, a row here adds to what the prose scan
 * or a curated row reads from the same feature.
 *
 * Two kinds of row:
 *   - free: a die that rolls in with every roll it fits, since adding it costs
 *     nothing and never hurts (the dragonmark intuitions' d4);
 *   - paid (`PaidRoll`): a die, a flat bonus or advantage the roll prompt
 *     offers, paid for as the feature's Use is (a pool's use, the turn's
 *     reaction). Where that price comes from is the sheet's business
 *     (`pricedRollEffects`): the feature's own action, as the spend links set
 *     it, else the pool named for the feature. A row the sheet finds no price
 *     for is not offered.
 *
 * A third kind, a reroll (`Reroll`): one made as the d20 lands, since it never
 * makes the roll worse (Halfling Luck's natural 1), or one the result offers,
 * paid as the feature's Use is (Indomitable) or free (`free`), its limit said
 * in its `when` for the player to keep (Fanatical Focus, once a Rage).
 *
 * Kept out on purpose:
 *   - what sets the d20 rather than rerolling it (Stroke of Luck, Reliable
 *     Talent, Portent), and Curving Shot, which rerolls against another target;
 *   - a price the player picks (Focused Aim's 1 to 3 ki), or a bonus the app
 *     cannot count (Saving Face, the allies you can see);
 *   - what lasts the turn or adds damage too (Fighting Spirit, Feinting
 *     Attack), and Grappling Strike, which needs a hit first;
 *   - a die paid with Hit Point Dice (Symbiotic Being), or with Heroic
 *     Inspiration (Zhentarim Ruffian), which no pool counts;
 *   - other creatures' rolls (Bardic Inspiration, War God's Blessing) and tool
 *     checks, which no roll on the sheet names.
 *
 * Keys are those of `ROLL_ADVANTAGES`.
 */
import type { Collector } from '../effects/base';
import type { BonusAmount, EffectOrigin, PaidRoll, Reroll, RollFilter, WhileState } from '../types';
import { rageDamage } from './namedEffects';
import { ATTACKS, CHECKS, D20_TESTS, INITIATIVE, SAVES, saves, skills } from './rollAdvantages';

/** A reroll's bonus by the feature's class level: the level itself, or Rage's damage at it. */
type RerollRow = Omit<Reroll, 'bonus'> & { bonus?: 'classLevel' | 'rageDamage' };

type ExtraRow = (
  | { free: true; on: RollFilter; dice: string; reroll?: undefined }
  | ({ free?: undefined; on: RollFilter; reroll?: undefined } & PaidRoll)
  | { free?: undefined; on: RollFilter; reroll: RerollRow; while?: readonly WhileState[] }
) & {
  /** The level the feature is gained at, where one feature prints two cards. */
  level?: number;
};

/** A die that rolls in, free, with every roll it fits. */
const free = (on: RollFilter, dice = '1d4'): ExtraRow => ({ free: true, on, dice });
/** The paying pool's own die (a superiority die, a Bardic Inspiration die). */
const poolDie = (on: RollFilter, rest: Omit<PaidRoll, 'poolDie'> = {}): ExtraRow => ({
  on,
  poolDie: true,
  ...rest,
});
const paidDice = (on: RollFilter, dice: string, rest: Omit<PaidRoll, 'dice'> = {}): ExtraRow => ({
  on,
  dice,
  ...rest,
});
/** A flat bonus, added once the d20 shows. */
const paidBonus = (
  on: RollFilter,
  bonus: BonusAmount,
  rest: Omit<PaidRoll, 'bonus' | 'after'> = {},
): ExtraRow => ({ on, bonus, after: true, ...rest });
/** Advantage, claimed and paid before the d20. */
const paidAdvantage = (on: RollFilter, when?: string): ExtraRow => ({
  on,
  advantage: true,
  ...(when !== undefined ? { when } : {}),
});

/** A reroll, offered on the result unless `auto`. */
const reroll = (on: RollFilter, row: RerollRow = {}): Extract<ExtraRow, { reroll: RerollRow }> => ({
  on,
  reroll: row,
});
/** "Reroll a 1 ... you must use the new roll": made as the d20 lands. */
const LUCK: RerollRow = { die: 'one', atMost: 1, auto: true, free: true };
const RAGING: readonly WhileState[] = [{ state: 'effect', name: 'Rage' }];

const FAILED = { ifFailed: true } as const;
/** "Isn't expended" on a failure: the player takes it off a roll that still failed. */
const FAILED_KEPT = { ifFailed: true, spentOnSuccess: true } as const;
const SKILLED: RollFilter = { rolls: ['check'], skilled: true };
const CHECKS_AND_SAVES: RollFilter = { rolls: ['check', 'save'] };
const WEAPON_ATTACKS: RollFilter = { rolls: ['attack'], attack: 'weapon' };
const STRENGTH: RollFilter = { rolls: ['attack', 'check', 'save'], abilities: ['str'] };
const SPELL_ATTACKS: RollFilter = { rolls: ['attack'], attack: 'spell' };

export const ROLL_EXTRAS: Record<string, readonly ExtraRow[]> = {
  // --- Classes ---------------------------------------------------------------
  'tactical mind|fighter|xphb': [paidDice(CHECKS, '1d10', FAILED_KEPT)],
  // 2014: "makes an ability check or a saving throw"; 2024: "fails" one.
  'flash of genius|artificer|tce': [
    paidBonus(CHECKS_AND_SAVES, 'abilityModMin0:int', { reaction: true }),
  ],
  'flash of genius|artificer|efa': [
    paidBonus(CHECKS_AND_SAVES, 'abilityModMin1:int', { reaction: true, ifFailed: true }),
  ],
  'indomitable|fighter|phb': [reroll(SAVES, FAILED)],
  // Three cards, at 9, 13 and 17.
  'indomitable|fighter|xphb': [{ ...reroll(SAVES, { ...FAILED, bonus: 'classLevel' }), level: 9 }],
  'indomitable|warrior sidekick|tce': [reroll(SAVES, FAILED)],
  'diamond soul|monk|phb': [reroll(SAVES, FAILED)],
  'disciplined survivor|monk|xphb': [reroll(SAVES, FAILED)],
  'magical guidance|sorcerer|tce': [reroll(CHECKS, FAILED)],

  // --- Subclasses -------------------------------------------------------------
  'peerless skill|college of lore|phb': [poolDie(CHECKS)],
  'peerless skill|college of lore|xphb': [poolDie({ rolls: ['attack', 'check'] }, FAILED_KEPT)],
  // Both printings carry a second, empty card a level on.
  'channel divinity: guided strike|war domain|phb': [{ ...paidBonus(ATTACKS, 10), level: 2 }],
  // A Reaction only for another creature's roll.
  'guided strike|war domain|xphb': [paidBonus(ATTACKS, 10, { ...FAILED, reaction: false })],
  'guided strike|oath of conquest|xge': [paidBonus(ATTACKS, 10)],
  'channel divinity: feat of strength|strength domain (psa)|psa': [
    { ...paidBonus(STRENGTH, 10), level: 2 },
  ],
  'psi-bolstered knack|soulknife|tce': [
    poolDie(SKILLED, { ...FAILED_KEPT, when: 'Only with a skill you are proficient in' }),
  ],
  'psi-bolstered knack|soulknife|xphb': [
    poolDie(SKILLED, { ...FAILED_KEPT, when: 'Only with a skill you are proficient in' }),
  ],
  'homing strikes|soulknife|tce': [
    poolDie(WEAPON_ATTACKS, { ...FAILED_KEPT, when: 'Only with your Psychic Blades' }),
  ],
  'homing strikes|soulknife|xphb': [
    poolDie(WEAPON_ATTACKS, { ...FAILED_KEPT, when: 'Only with your Psychic Blade' }),
  ],
  'arcane deflection|war magic|xge': [paidBonus(SAVES, 4, { reaction: true, ifFailed: true })],
  'tides of chaos|wild magic|phb': [paidAdvantage(D20_TESTS)],
  'tides of chaos|wild magic sorcery|xphb': [paidAdvantage(D20_TESTS)],
  'fanatical focus|path of the zealot|xge': [
    { ...reroll(SAVES, { ...FAILED, free: true, when: 'Once a Rage' }), while: RAGING },
  ],
  'fanatical focus|path of the zealot|xphb': [
    {
      ...reroll(SAVES, { ...FAILED, free: true, bonus: 'rageDamage', when: 'Once a Rage' }),
      while: RAGING,
    },
  ],
  'unerring accuracy|way of the kensei|xge': [
    reroll(WEAPON_ATTACKS, {
      ...FAILED,
      free: true,
      when: 'Only with a monk weapon, on your turn, once a turn',
    }),
  ],
  // The reaction alone: the feature's use went as it began.
  'living legend|oath of glory|tce': [
    reroll(SAVES, {
      ...FAILED,
      free: true,
      reaction: true,
      when: 'Only while Living Legend lasts',
    }),
  ],
  'living legend|oath of glory|xphb': [
    reroll(SAVES, {
      ...FAILED,
      free: true,
      reaction: true,
      when: 'Only while Living Legend lasts',
    }),
  ],
  // Its use goes only once it turns a failure into a success, which the player marks.
  'draconic disciple|way of the ascendant dragon|ftd': [
    reroll(skills('Intimidation', 'Persuasion'), {
      ...FAILED,
      free: true,
      reaction: true,
      when: 'Once it turns a failure into a success, not again until a long rest',
    }),
  ],

  // --- Optional features: maneuvers ----------------------------------------
  // 2014: "before or after making the attack roll"; 2024: on a miss.
  'precision attack|phb': [poolDie(WEAPON_ATTACKS)],
  'precision attack|xphb': [poolDie(ATTACKS, FAILED)],
  'ambush|tce': [poolDie(skills('Stealth')), poolDie(INITIATIVE)],
  'ambush|xphb': [poolDie(skills('Stealth')), poolDie(INITIATIVE)],
  'commanding presence|tce': [poolDie(skills('Intimidation', 'Performance', 'Persuasion'))],
  'commanding presence|xphb': [poolDie(skills('Intimidation', 'Performance', 'Persuasion'))],
  'tactical assessment|tce': [poolDie(skills('Investigation', 'History', 'Insight'))],
  'tactical assessment|xphb': [poolDie(skills('Investigation', 'History', 'Insight'))],

  // --- Optional features: metamagic ----------------------------------------
  'seeking spell|tce': [reroll(SPELL_ATTACKS, FAILED)],
  'seeking spell|xphb': [reroll(SPELL_ATTACKS, FAILED)],

  // --- Feats ---------------------------------------------------------------------
  'lucky|xphb': [paidAdvantage(D20_TESTS)],
  // "Roll an additional d20 ... You choose which of the d20s is used."
  'lucky|phb': [reroll(D20_TESTS, { die: 'extra' })],
  'elven accuracy|xge': [
    reroll(
      { rolls: ['attack'], abilities: ['dex', 'int', 'wis', 'cha'] },
      { die: 'low', auto: true, free: true },
    ),
  ],
  "boon of fortune's favor|frhof": [
    reroll(SAVES, { ...FAILED, free: true, when: 'Once until the start of your next turn' }),
  ],
  'aberrant dragonmark|efa': [paidDice(saves('con'), '1d4', { reaction: true, ifFailed: true })],
  'transmuted anatomy|au': [paidDice(saves('con'), '1d4', { reaction: true, ifFailed: true })],
  'arcane omens|au': [paidDice(SAVES, '1d4', { reaction: true, ifFailed: true })],
  'spell resistant|au': [
    paidDice(SAVES, '1d6', { ifFailed: true, when: 'Only against a spell or magical effect' }),
  ],
  'survivor|rhw': [
    paidBonus(SAVES, 'equalToProfBonus', {
      reaction: true,
      ifFailed: true,
      when: 'Only to avoid or end being Charmed or Frightened',
    }),
    reroll(INITIATIVE, { die: 'one', atMost: 9, free: true }),
  ],
  'arcane eloquence|au': [free(skills('Deception', 'Intimidation', 'Persuasion'))],
  'arcane undertaker|au': [free(skills('History', 'Medicine'))],
  'mark of detection|efa': [free(skills('Investigation', 'Insight'))],
  'mark of finding|efa': [free(skills('Perception', 'Survival'))],
  'mark of handling|efa': [free(skills('Nature', 'Animal Handling'))],
  'mark of healing|efa': [free(skills('Medicine'))],
  'mark of hospitality|efa': [free(skills('Persuasion'))],
  'mark of making|efa': [free(skills('Arcana'))],
  'mark of passage|efa': [free(skills('Athletics', 'Acrobatics'))],
  'mark of scribing|efa': [free(skills('History'))],
  'mark of sentinel|efa': [free(skills('Insight', 'Perception'))],
  'mark of shadow|efa': [free(skills('Stealth', 'Performance'))],
  'mark of storm|efa': [free(skills('Acrobatics'))],
  'mark of warding|efa': [free(skills('Investigation'))],

  // --- Species traits ---------------------------------------------------------------
  // Named for the species: a halfling's `lucky|phb` would be the 2014 feat.
  'lucky|halfling|phb': [reroll(D20_TESTS, LUCK)],
  'luck|halfling|xphb': [reroll(D20_TESTS, LUCK)],
  'lucky|kor|psz': [reroll(D20_TESTS, LUCK)],
  'luck|kithkin|lfl': [reroll(D20_TESTS, LUCK)],
  'luck|kithkin; lorwyn|lfl': [reroll(D20_TESTS, LUCK)],
  'luck|kithkin; shadowmoor|lfl': [reroll(D20_TESTS, LUCK)],
  'khenra twins|khenra|psa': [
    reroll(D20_TESTS, {
      die: 'one',
      atMost: 1,
      free: true,
      when: 'Only while your twin lives and you can see them',
    }),
  ],
  'kenku recall|kenku|mpmm': [paidAdvantage(SKILLED, 'Only with a skill you are proficient in')],
  'lucky footwork|harengon|mpmm': [
    paidDice(saves('dex'), '1d4', {
      reaction: true,
      ifFailed: true,
      when: 'Only while you are not Prone and can move',
    }),
  ],
  'lucky footwork|harengon|wbtw': [
    paidDice(saves('dex'), '1d4', {
      reaction: true,
      ifFailed: true,
      when: 'Only while you are not Prone and can move',
    }),
  ],
  // "Immediately after seeing the number on the d20".
  'knowledge from a past life|reborn|vrgr': [paidDice(SKILLED, '1d6', { after: true })],
  'knowledge from a past life|reborn|rhw': [paidDice(CHECKS, '1d6', FAILED)],
  'built for success|autognome|aag': [paidDice(D20_TESTS, '1d4')],
  'built for success|mechagnome|wow': [paidDice(D20_TESTS, '1d4')],
  // The 2014 dragonmarks' intuitions.
  "warder's intuition|erlw": [free(skills('Investigation'))],
  'cunning intuition|erlw': [free(skills('Performance', 'Stealth'))],
  'gifted scribe|erlw': [free(skills('History'))],
  'deductive intuition|erlw': [free(skills('Investigation', 'Insight'))],
  "windwright's intuition|erlw": [free(skills('Acrobatics'))],
  "hunter's intuition|erlw": [free(skills('Perception', 'Survival'))],
  'medical intuition|erlw': [free(skills('Medicine'))],
  'ever hospitable|erlw': [free(skills('Persuasion'))],
  'wild intuition|erlw': [free(skills('Animal Handling', 'Nature'))],
  "artisan's intuition|erlw": [free(skills('Arcana'))],
  'intuitive motion|erlw': [free(skills('Acrobatics'))],
  "sentinel's intuition|erlw": [free(skills('Insight', 'Perception'))],
};

/**
 * Add the rows of the first key that has any, as `ROLL_ADVANTAGES` is read:
 * a free die as `rollDie`, a paid extra as `rollPaid`, a reroll as
 * `rollReroll`, its bonus worked out at the feature's `classLevel`. Says
 * whether a key had rows.
 */
export function emitRollExtras(
  col: Collector,
  keys: readonly string[],
  origin: EffectOrigin,
  level?: number,
  classLevel?: number,
): boolean {
  for (const key of keys) {
    const rows = ROLL_EXTRAS[key.toLowerCase()];
    if (rows === undefined) continue;
    for (const row of rows) {
      if (row.level !== undefined && row.level !== level) continue;
      if (row.reroll !== undefined) {
        const { bonus, ...rest } = row.reroll;
        const amount =
          bonus === undefined || classLevel === undefined
            ? 0
            : bonus === 'classLevel'
              ? classLevel
              : rageDamage(classLevel);
        col.add({
          kind: 'rollReroll',
          on: row.on,
          ...rest,
          ...(amount > 0 ? { bonus: amount } : {}),
          ...(row.while !== undefined ? { while: [...row.while] } : {}),
          origin,
        });
        continue;
      }
      if (row.free === true) {
        col.add({ kind: 'rollDie', dice: row.dice, on: row.on, origin });
        continue;
      }
      const { free: _free, level: _level, reroll: _reroll, on, ...paid } = row;
      col.add({ kind: 'rollPaid', on, ...paid, origin });
    }
    return true;
  }
  return false;
}
