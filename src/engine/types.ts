/**
 * The contract between storage, the derivation engine, and the UI.
 * Principle: a CharacterDoc stores CHOICES + PLAY STATE, never derived
 * results; overrides are inputs. Everything else is recomputed on read.
 */
import type { TableRuleChoices } from './castGuidance';
import type { MomentsInForce } from './moments';

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** 0 = none, 1 = proficient, 2 = expertise. */
export type ProfLevel = 0 | 1 | 2;

export interface EntityRef {
  name: string;
  source: string;
}

/** Data entities are treated as unknown-shaped JSON with tolerant readers. */
export type DataEntity = Record<string, unknown>;

/**
 * Minimal lookup surface the engine needs; adapters wrap the registry. Rule
 * packs come through `byType` too, as `RULE_PACK_TYPE` (`castGuidance.ts`).
 */
export interface EngineContext {
  get(type: string, name: string, source?: string): DataEntity | undefined;
  byType(type: string): readonly DataEntity[];
  /**
   * The app's own table rules, chosen in Settings. Absent, or a rule absent,
   * means as written for the character's edition. A character's own choice and
   * a pack applied to it come first (`rulesFor`, Phase 4).
   */
  rules?: Partial<TableRuleChoices>;
}

export const CHARACTER_SCHEMA_VERSION = 1;

export interface ClassLevelEntry {
  ref: EntityRef;
  subclass?: EntityRef;
  levels: number;
  /** Per level gained: rolled value or 'avg'. Index 0 = first level in this class. */
  hp: Array<number | 'avg'>;
}

export interface EquipmentEntry {
  id: string;
  ref?: EntityRef;
  custom?: {
    name: string;
    note?: string;
    weightLb?: number;
    acBonus?: number;
    attack?: { toHitBonus: number; damage: string; damageType?: string };
  };
  qty: number;
  equipped: boolean;
  attuned: boolean;
  location?: string;
}

export type OverridePath =
  | 'ac'
  | 'maxHp'
  | 'initiative'
  | 'profBonus'
  | 'speed.walk'
  | 'passivePerception'
  | `ability.${Ability}`
  | `save.${Ability}.prof`
  | `skill.${string}.prof`
  | `skill.${string}.bonus`;

export interface PlayState {
  currentHp: number;
  tempHp: number;
  /**
   * The effect in play whose temporary hit points these are (Heroism's), so
   * they go when it ends. Absent when they came from anywhere else: any other
   * write to `tempHp` deletes it.
   */
  tempHpFrom?: string;
  /** die label ('d10') -> spent count */
  hitDiceSpent: Record<string, number>;
  /** index 0 = level-1 slots spent */
  slotsSpent: number[];
  pactSlotsSpent: number;
  /**
   * Mystic Arcanum spell levels (6 to 9) cast since the last long rest, in
   * order. Absent rather than empty when none is, so older docs read the same.
   */
  arcanumUsed?: number[];
  /**
   * Active conditions. `ignored` is the player switching a condition's effects
   * off (a ruling at the table): it stays listed, and nothing applies.
   */
  conditions: Array<{ id: string; level?: number; ignored?: boolean }>;
  deathSaves: { success: number; fail: number };
  /** `level` is the slot a cast spent, which its dice on later turns scale with. */
  concentratingOn?: { label: string; level?: number };
  /** keyed to derived resources (rage, ki, …) */
  resources: Array<{ key: string; used: number }>;
  inspiration: boolean;
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
  xp: number;
  /**
   * Per-turn action economy; true = used this turn. Optional for older docs.
   * `extra` names the boxes an effect adds that are used (Haste's action),
   * absent when none is.
   */
  turn?: { action: boolean; bonus: boolean; reaction: boolean; extra?: string[] };
  /**
   * False for a freshly built character: the sheet fills currentHp to the
   * derived max the first time HP exists, then flips this true. Undefined on
   * pre-existing docs, which are left exactly as saved.
   */
  hpInitialized?: boolean;
  /**
   * What is helping (or hindering) the character right now: Bless, Rage, a
   * potion. Absent rather than empty when there are none, so older docs read
   * the same; writers delete it when the last one ends.
   */
  activeEffects?: ActiveEffect[];
}

/**
 * One effect on the character during play. It stores what it does, with every
 * question it asked already answered (a slot level, a damage type, the bard's
 * die), never a pointer into a catalog: the sheet works it out with nothing
 * else loaded, and an effect the player described is stored the same way.
 */
export interface ActiveEffect {
  /** This instance: two Blesses from two clerics are two effects. */
  id: string;
  /** What the chip says: "Bless", "Protection: fire". */
  name: string;
  /**
   * The named effect it is, when that is not its name: a Potion of Speed is
   * Haste. Effects of one name never add up (see `countingEffects`).
   */
  same?: string;
  parts: EffectPart[];
  lasts?: EffectDuration;
  /** New turns until it ends: 1 is the start of your next turn, 2 the end of it. */
  turnsLeft?: number;
  /** This character cast it, so it ends when their concentration does. */
  mine?: boolean;
  /** Switched off: still listed, nothing applies. Writers delete it rather than store false. */
  off?: boolean;
}

/**
 * An effect the player described and kept to add again: what it does and how
 * long it lasts, and the temporary hit points it gives as it lands.
 */
export interface KeptEffect {
  id: string;
  name: string;
  parts: EffectPart[];
  lasts?: EffectDuration;
  tempHp?: number;
}

/** How long an effect lasts, for what a rest ends. The app counts neither rounds nor hours. */
export interface EffectDuration {
  /** Its longest duration: a short rest ends an hour or less, a long rest 8 hours or less. */
  minutes?: number;
  /** It lasts until you finish a rest of this kind. */
  rest?: 'short' | 'long';
  concentration?: boolean;
  /**
   * It ends early when the character is knocked unconscious (2014 Rage) or
   * Incapacitated (2024 Rage). Dropping to 0 HP does both.
   */
  endsWhen?: 'unconscious' | 'incapacitated';
}

/**
 * Which rolls a die or advantage reaches. Every field given must hold; one
 * left out does not narrow it. Initiative counts as a Dexterity check, and a
 * death save as a save with no ability.
 */
export interface RollFilter {
  rolls: Array<'attack' | 'save' | 'check'>;
  /** The ability the roll is made with: a save's, a check's, or an attack's. */
  abilities?: Ability[];
  /** Checks with one of these skills. */
  skills?: string[];
  /** Checks made with any skill, not a bare ability check (2024 Guidance). */
  skilled?: boolean;
  attack?: 'weapon' | 'spell';
  range?: 'melee' | 'ranged';
  /** Attacks with this class's spells (2024 Innate Sorcery: Sorcerer). */
  className?: string;
}

export interface CharacterDoc {
  id: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  name: string;
  rulesVersion: '2014' | '2024';
  allowedSources: string[];
  dataTag: string;

  abilities: {
    method: 'standard' | 'pointbuy' | 'roll' | 'manual';
    base: Record<Ability, number>;
  };
  /**
   * How HP is gained per level (level 1 is always the max die):
   * 'average' (PHB default), 'rolled' (per-level values in classes[].hp),
   * 'max' (table rule: full die every level), 'rolledAtLeastAverage' (the
   * roll, never under the average). The character's own HP each level rule
   * (`engine/rules.ts`). Optional; absent follows the app, else 'average'.
   */
  hpMethod?: TableRuleChoices['hpEachLevel'];
  /**
   * When this character's one-use dice (2014 Guidance and Bardic Inspiration)
   * are offered: after the roll, as written, or before it, a house rule.
   * Optional; absent follows the app's choice in Settings (`lib/oneUseDice`).
   */
  oneUseDice?: 'after' | 'before';
  /**
   * This character's own table rules, where they differ from the app's
   * (`engine/rules.ts`). HP each level is `hpMethod` and one-use dice is
   * `oneUseDice`, so they are not here. Optional; absent follows the app.
   */
  tableRules?: Partial<Omit<TableRuleChoices, 'hpEachLevel' | 'oneUseDice'>>;
  /**
   * Whether this character's table uses optional class features: the ones the
   * data marks as variants (Tasha's on 2014 classes, a book's on 2024 ones).
   * On, each is a pick under its class; off, the classes stay as printed.
   * Optional; absent is off.
   */
  optionalClassFeatures?: boolean;
  /**
   * Effects the player described and kept, found by + Effect's search for
   * next time. Optional; absent is none. Stored as effects are, so a kept one
   * lands as a copy with an id of its own.
   */
  keptEffects?: KeptEffect[];
  race?: EntityRef;
  subrace?: EntityRef;
  background?: EntityRef;
  classes: ClassLevelEntry[];
  feats: Array<{ ref: EntityRef; instanceId: string }>;

  /** ONE namespace for every pick, keyed by stable ChoicePrompt ids. */
  choices: Record<string, string[] | string | number>;

  equipment: EquipmentEntry[];
  spellcasting: Record<string, { known: EntityRef[]; prepared: EntityRef[] }>;
  /**
   * Spells the player added that nothing in the build grants: a gift or a curse
   * from the DM, by the table's call. Optional; absent is none.
   */
  addedSpells?: AddedSpell[];

  /** User "misc modifier" rows — first-class effects. */
  customEffects: EffectInput[];
  overrides: Partial<Record<OverridePath, { value: number; note?: string }>>;

  play: PlayState;
  homebrewDeps: string[];
  notes: string;
}

/** A spell the player added outside the build (`CharacterDoc.addedSpells`). */
export interface AddedSpell {
  spell: EntityRef;
  /** The ability it casts with, chosen when it was added. */
  ability: Ability;
  /**
   * How often it casts with no slot, at its own level: once per long rest, once
   * per short or long rest, or at will. A cantrip is at will whatever this says.
   */
  uses: 'long' | 'short' | 'will';
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface EffectOrigin {
  label: string;
  uid: string;
  /**
   * `active`: an effect on the character during play, its `uid` the effect's id.
   * `added`: a spell the player added (`CharacterDoc.addedSpells`).
   */
  type:
    | 'race'
    | 'background'
    | 'class'
    | 'subclass'
    | 'feat'
    | 'item'
    | 'custom'
    | 'curated'
    | 'active'
    | 'added';
  /** The rule pack whose patch this comes from, shown beside what it changes. */
  pack?: string;
}

/**
 * A state the app can see, which an effect may hold only while (H10). `effect`
 * is an effect of that name in play (raging); `condition` one in play, by name.
 */
export type WhileState =
  | { state: 'bloodied' | 'zeroHp' | 'concentrating' | 'noArmor' | 'shield' }
  | { state: 'effect'; name: string }
  | { state: 'condition'; condition: string };

/** What a formula reads when it is worked out (see `formula.ts`). */
export interface FormulaScope {
  level: number;
  /** The level of the class the entry belongs to; the character's level for any other entry. */
  classLevel: number;
  prof: number;
  hp: number;
  maxHp: number;
  mod: Record<Ability, number>;
  score: Record<Ability, number>;
}

/** A parsed formula. Only `formula.ts` makes them; nothing stored is one. */
export interface FormulaLike {
  readonly text: string;
  readonly cost: number;
  evaluate(scope: FormulaScope): number;
}

/** The effect fields a formula may fill (`FORMULA_FIELDS` in `castGuidance.ts`). */
export type FormulaField = 'amount' | 'min' | 'max' | 'range' | 'speed' | 'base' | 'regainOnShort';

/**
 * A number an entry's formula fills in at fold time, once abilities and hit
 * points exist (`derive.ts`). The field holds 0 until then.
 */
export interface FormulaSlot {
  field: FormulaField;
  formula: FormulaLike;
  /** `classLevel` as the entry was collected. */
  classLevel: number;
}

/**
 * A bonus worked out once ability scores and proficiency are known: a flat
 * number; the proficiency bonus itself (`profBonus`, which a roll takes only
 * once) or a bonus merely the same size (`equalToProfBonus`, which stacks with
 * it); or an ability modifier. `abilityModMin1` is at least +1, for features
 * that say "a minimum of +1"; `abilityModMin0` is at least +0, for features that
 * say "you can", since nobody adds a negative modifier they can leave off.
 */
export type BonusAmount =
  | number
  | 'profBonus'
  | 'equalToProfBonus'
  | `abilityMod:${Ability}`
  | `abilityModMin0:${Ability}`
  | `abilityModMin1:${Ability}`;

/**
 * What an action takes from the turn. `none` takes nothing: a rider on a hit or on
 * a spell (Stunning Strike, Quickened Spell), where tapping it must only spend.
 */
export type ActionEconomy = 'action' | 'bonus' | 'reaction' | 'none';

export interface ActionCost {
  /** The key of the resource it spends. */
  resource: string;
  /** How many. `varies` is the player's call, so nothing spends by itself. */
  amount: number | 'varies';
  /** The base use is free and the pool pays for more (2024 Patient Defense). */
  optional?: boolean;
  /**
   * It takes a use of the feature as well (Hand of Ultimate Mercy). Otherwise a pool
   * sharing the action's name is not touched.
   */
  ownUseToo?: boolean;
}

/**
 * Paying a pool to get a use back (Psi-Powered Leap). It sits beside `cost` because
 * using the feature spends none of it: the price is for the next use.
 */
export interface ActionBuyBack {
  /** The key of the resource it pays from. */
  resource: string;
  amount: number;
  /** The key of the use it gives back, when that use does not share the action's name. */
  own?: string;
}

/** What using an action gives back, as well as what it spends (2014 Psionic Power's die). */
export interface ActionRegain {
  /** The key of the resource it refills. */
  resource: string;
  amount: number;
}

/** What a walking speed bonus does not hold with (`speedBonus.unless`). */
export type SpeedBonusUnless = 'heavyArmor' | 'armorOrShield';

/**
 * One thing that changes the sheet, and where it comes from. `while`: it counts
 * only while every state holds. `formulas`: numbers worked out at fold time.
 * Both come from an entry's own mechanics (`effects/mechanics.ts`).
 */
export type EffectInput = {
  origin: EffectOrigin;
  while?: readonly WhileState[];
  formulas?: readonly FormulaSlot[];
} & (
  | { kind: 'abilityMin'; ability: Ability; min: number }
  /**
   * `max`: the score may go this high with it, past the usual 20 (Primal Champion's 24).
   * What else adds to the score is held to 20 first.
   */
  | { kind: 'abilityBonus'; ability: Ability; amount: number; max?: number }
  | { kind: 'skillProf'; skill: string; level: ProfLevel }
  | { kind: 'saveProf'; ability: Ability }
  | { kind: 'toolProf'; name: string }
  | { kind: 'armorProf'; name: string }
  | { kind: 'weaponProf'; name: string }
  | { kind: 'weaponProfFilter'; filter: string } // "type=martial weapon|property=light"
  /**
   * Spells added to a spellcasting class's list (an expanded spell list: a Warlock
   * patron's, Divine Soul's, a dragonmark's), to learn or prepare as the class's
   * own. `spells` are refs as the data writes them ("burning hands",
   * "armor of agathys|xphb"); `filters` are spell filters ("level=1|class=Cleric").
   * A class's or subclass's widens that class; any other origin's, every one.
   */
  | { kind: 'spellListAdd'; spells: string[]; filters: string[] }
  /**
   * A kind of weapon whose mastery property the character can use, by its base
   * item's name ("Longsword"): a 2024 class's Weapon Mastery pick, Weapon Master's.
   */
  | { kind: 'weaponMastery'; name: string }
  | { kind: 'language'; name: string }
  | { kind: 'acFormula'; label: string; base: number; addAbilities: Ability[]; dexMax?: number }
  | { kind: 'acBonus'; amount: number }
  /** Armor Class can't be less than this, whatever else counts (Barkskin). */
  | { kind: 'acMin'; min: number }
  | { kind: 'hpPerLevel'; amount: number }
  /** A flat rise in the hit point maximum (Aid). */
  | { kind: 'maxHpBonus'; amount: number }
  | { kind: 'initiativeBonus'; amount: BonusAmount }
  /**
   * `unless` the character wears heavy armor, or any armor or a shield: a bonus that
   * holds only without them (Fast Movement, Unarmored Movement).
   */
  | { kind: 'speedBonus'; amount: number; unless?: SpeedBonusUnless }
  /**
   * Walking speed times this, after every addition and after what conditions
   * take away (Haste). Two of them do not multiply: the largest counts.
   */
  | { kind: 'speedMultiplier'; factor: number }
  /** A way to move besides walking, at a speed of its own or the walking speed (Fly, Spider Climb). */
  | { kind: 'moveSpeed'; mode: 'fly' | 'climb' | 'swim'; speed: number | 'walk' }
  | {
      /**
       * To hit with weapon attacks unless `attack` says otherwise; `spell` reaches
       * spell attacks, which have one modifier for melee and ranged, so only
       * `scope: 'all'` reaches them. `ability` limits it to attacks made with it.
       * `weapon` limits it to one carried weapon, by its equipment entry's id
       * (Magic Weapon): no other attack, natural or unarmed, gets it.
       */
      kind: 'attackBonus';
      scope: 'melee' | 'ranged' | 'all';
      amount: number;
      attack?: 'weapon' | 'spell' | 'any';
      ability?: Ability;
      weapon?: string;
    }
  /**
   * Weapon damage; `ability` limits it to attacks made with it (Rage:
   * Strength), `weapon` to one carried weapon, as for `attackBonus`.
   */
  | {
      kind: 'damageBonus';
      scope: 'melee' | 'ranged' | 'all';
      amount: number;
      ability?: Ability;
      weapon?: string;
    }
  /**
   * A die of extra damage on every weapon hit, rolled apart (Enlarge), or on
   * one carried weapon's when `weapon` names it (Elemental Weapon).
   * `weaponsOnly`: on carried weapons' hits alone, not an unarmed strike's or a
   * natural weapon's (the 2014 Improved Divine Smite's "melee weapon").
   */
  | {
      kind: 'damageDie';
      scope: 'melee' | 'ranged' | 'all';
      dice: string;
      damageType?: string;
      weapon?: string;
      weaponsOnly?: boolean;
    }
  /** Spell save DC; `className` limits it to that class's spells (2024 Innate Sorcery). */
  | { kind: 'spellDcBonus'; amount: number; className?: string }
  /**
   * Added to a spell's damage rolls (Agonizing Blast's Charisma). Every limit
   * given must hold: a spell named in `spells`, one cast as a spell of the class
   * `className`, a cantrip when `cantrips`, one of the `school` ("V"). `oneRoll`:
   * to one damage roll of each cast, not to each (Empowered Evocation).
   */
  | {
      kind: 'spellDamageBonus';
      amount: BonusAmount;
      spells?: string[];
      className?: string;
      cantrips?: boolean;
      school?: string;
      oneRoll?: boolean;
    }
  /** A flat bonus to saving throws, every one or those of `abilities`. */
  | { kind: 'saveBonus'; amount: BonusAmount; abilities?: Ability[] }
  | {
      /**
       * Half the proficiency bonus on checks that do not already add it (Jack
       * of All Trades, Remarkable Athlete). `abilities` limits it to checks of
       * those abilities, every check when absent; `skillsOnly` limits it to
       * skills the character lacks (the 2024 Jack of All Trades), so plain
       * ability checks and initiative go without.
       */
      kind: 'halfProf';
      round: 'down' | 'up';
      abilities?: Ability[];
      skillsOnly?: boolean;
    }
  | ({ kind: 'checkBonus'; amount: BonusAmount } & (
      | { skills: string[] }
      /** Every check of the ability: its skills, the plain check, and initiative for DEX. */
      | { ability: Ability }
      /** Every ability check, initiative too: a described "+1 to checks". */
      | { every: true }
    ))
  | { kind: 'passivePerceptionBonus'; amount: number }
  | { kind: 'sense'; sense: string; range: number }
  /**
   * Half damage of a type, or of every type when `damageType` is `all`
   * (Warding Bond). `note` says when it holds ("nonmagical"), for the player.
   */
  | { kind: 'resist'; damageType: string; note?: string }
  /** No damage of a type, or of every type when `damageType` is `all`. */
  | { kind: 'immune'; damageType: string; note?: string }
  /** Double damage of a type. */
  | { kind: 'vulnerable'; damageType: string }
  /** A condition that cannot be put on the character ("paralyzed by magic" in `note`). */
  | { kind: 'conditionImmune'; condition: string; note?: string }
  /** A die added to every roll the filter reaches, rolled in with it (Bless). */
  | { kind: 'rollDie'; dice: string; on: RollFilter }
  /**
   * A die offered after a roll it fits, for the player to add (Guidance,
   * Bardic Inspiration). `once`: spent when added. `ifFailed`: only on a roll
   * that failed, which the player says (2024 Bardic Inspiration).
   */
  | { kind: 'rollOffer'; dice: string; on: RollFilter; once?: boolean; ifFailed?: boolean }
  | { kind: 'rollAdvantage'; mode: 'adv' | 'dis'; on: RollFilter }
  /** Temporary hit points at the start of each of the character's turns (Heroism). */
  | { kind: 'tempHpEachTurn'; amount: number }
  /** One more thing to do each turn, with what it may be spent on (Haste). */
  | { kind: 'extraAction'; label: string; note?: string }
  /** Attacks score a critical hit on this number or higher on the d20. */
  | { kind: 'critRange'; min: number }
  /**
   * A line the player should know, with nothing to work out: what helps, what
   * protects, what it costs, or plain information. What counts only against
   * one creature, or one kind of creature, is a line too: the sheet never
   * knows the target.
   */
  | { kind: 'cue'; tone: 'help' | 'ward' | 'warn' | 'info'; text: string }
  | {
      kind: 'resource';
      key: string;
      label: string;
      max:
        | number
        | 'profBonus'
        | 'twiceProfBonus'
        | `abilityMod:${Ability}`
        | `abilityModPlus1:${Ability}`
        | `level:${string}`;
      /** The least `max` comes to, where the text sets a floor (Death Coil's one die). */
      min?: number;
      resetOn: 'short' | 'long';
      /**
       * When true, same-key resources from other sources add to the pool
       * (superiority dice from Battle Master + Martial Adept + Superior
       * Technique stack). Default is first-wins (curated beats prose-scan dup).
       */
      stack?: boolean;
      /** How many of these points cannot become a spell slot (Metamagic Adept's). */
      noSlotConversion?: number;
      /**
       * How many come back on a short rest, with `resetOn: 'long'` still bringing
       * them all back (2024 Rage, one at a time).
       */
      regainOnShort?: number;
      /**
       * Dice of them that come back at dawn (an item's charges), which the
       * sheet counts at a long rest; absent, a long rest brings them all back.
       */
      regainRoll?: string;
    }
  | {
      /** A feature that gives another feature's pool `regainOnShort` (Advanced Artifice). */
      kind: 'resourceRegain';
      key: string;
      amount: number;
    }
  | {
      kind: 'action';
      economy: ActionEconomy;
      label: string;
      roll?: string;
      /** The roll is hit points regained, not damage dealt. */
      heals?: boolean;
      /** The roll is neither damage nor healing: a bonus die, temporary hit points. */
      plainDice?: boolean;
      /** Extra mechanics line, e.g. "lightning · 5 by 30 ft. line". */
      note?: string;
      /**
       * Target save + what sets the DC: one of the caster's abilities (8+mod+prof),
       * the higher of Strength and Dexterity (`strOrDex`, a maneuver's), their spell
       * save DC, or nothing when the prose states no DC to show.
       */
      save?: { targetAbility: Ability; dcAbility?: Ability | 'strOrDex' | 'spell' };
      /** The pool using it spends, when that pool is not the one sharing its name. */
      cost?: ActionCost;
      /** The pool that pays for another use once there are none left. */
      buyBack?: ActionBuyBack;
      /** The pool using it refills. */
      regains?: ActionRegain;
      /**
       * Using it spends no use of the pool sharing its name, which another chip of
       * the same feature spends: the bonus action commanding what it summoned, a
       * reaction while it lasts.
       */
      spendsNoUse?: boolean;
    }
  | {
      /** A racial natural weapon (Ram, Cat's Claws, Bite, …): an unarmed strike
       * with its own damage die and type. Rendered as its own attack row. */
      kind: 'naturalWeapon';
      label: string;
      dice: string;
      damageType: string;
      /** Usually STR, but some bites add CON (Dhampir) rather than STR. */
      ability: Ability;
    }
  | {
      /** A feature that only enlarges the ordinary punch (Unarmed Fighting,
       * Tavern Brawler). Folded into the built-in Unarmed Strike row, since a
       * row of its own would sit next to that one as a strictly better copy. */
      kind: 'unarmedDamage';
      label: string;
      dice: string;
    }
  | {
      kind: 'grantSpell';
      spell: EntityRef;
      ability?: Ability;
      usage?: string;
      /** Set when the grant is limited ("1/day"): the resource holding its uses. */
      resourceKey?: string;
      /** It takes one of the places in its origin class's spells known. */
      countsAsKnown?: boolean;
      /**
       * This row is the way to cast the spell with slots, beside a limited row
       * for its free uses, so a character with no slots to spend has no such row.
       */
      slotsOnly?: boolean;
    }
  | { kind: 'note'; text: string }
);

/**
 * The kinds an effect in play may carry. Each reaches numbers or rolls only,
 * never a pick, a pool or a spell, so an effect cannot change the build.
 */
export const ACTIVE_PART_KINDS = [
  'abilityMin',
  'acBonus',
  'acFormula',
  'acMin',
  'attackBonus',
  'checkBonus',
  'conditionImmune',
  'critRange',
  'cue',
  'damageBonus',
  'damageDie',
  'extraAction',
  'immune',
  'initiativeBonus',
  'maxHpBonus',
  'moveSpeed',
  'resist',
  'rollAdvantage',
  'rollDie',
  'rollOffer',
  'saveBonus',
  'sense',
  'spellDcBonus',
  'speedBonus',
  'speedMultiplier',
  'tempHpEachTurn',
  'vulnerable',
] as const satisfies ReadonlyArray<EffectInput['kind']>;

export type ActivePartKind = (typeof ACTIVE_PART_KINDS)[number];

type NoOrigin<E> = E extends unknown ? Omit<E, 'origin' | 'while' | 'formulas'> : never;
/** An amount stored in play is a number: an ally's bonus is worked out on their sheet. */
type PlainAmount<E> = E extends { amount: unknown } ? Omit<E, 'amount'> & { amount: number } : E;

/**
 * One thing an effect in play does: an `EffectInput` with no origin. This is
 * stored in the character document, so these kinds' fields are a storage
 * format now: add fields as optional, and never rename one. `same` names the
 * effect this part counts as, when only part of an effect is another one (a
 * Potion of Heroism's d4 is Bless; its temp HP are not).
 */
export type EffectPart = PlainAmount<NoOrigin<Extract<EffectInput, { kind: ActivePartKind }>>> & {
  same?: string;
};

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

export interface ChoiceOption {
  id: string;
  label: string;
  /** One-line summary shown under the label (e.g. what a feat does). */
  description?: string;
  disabled?: { reason: string };
  /**
   * Non-blocking, accessible cue that the option looks inadvisable (e.g. an
   * unmet feat prerequisite). Unlike `disabled`, the option stays selectable —
   * "guidance, not gatekeeping".
   */
  advisory?: string;
  /**
   * The option's full rules text, for an info sheet beside it, when it is a
   * class or subclass feature (a branch of Blessed Strikes, Hunter's Prey, …).
   */
  entries?: unknown;
}

export interface ChoicePrompt {
  /** Stable key into doc.choices, e.g. "race:half-elf|phb:skill:0". */
  id: string;
  origin: EffectOrigin;
  kind:
    | 'skill'
    | 'language'
    | 'tool'
    | 'ability'
    | 'abilityWeighted'
    | 'expertise'
    | 'asiOrFeat'
    | 'feat'
    | 'optionalfeature'
    /** One branch of a pick-one class or subclass feature (see `collectPick`). */
    | 'feature'
    /** A spell the player picks (see `spellQuery`). */
    | 'spell'
    /** Any mix of skills and tools, as Skilled asks for. */
    | 'skillOrTool'
    | 'damageType'
    | 'generic';
  label: string;
  count: number;
  /** Whether the same option may fill more than one pick (ASI +2 is the main case). */
  allowRepeat?: boolean;
  /** Whether an option another prompt of this kind has picked is closed (see `markHeldPicks`). */
  distinct?: boolean;
  options: ChoiceOption[];
  /**
   * What a `spell` prompt may offer, when that takes the spell files to work out.
   * Those download on demand and class lists live outside the registry, so the
   * engine cannot list the spells: `options` then holds only the saved picks, and
   * the page showing the prompt fills in the rest.
   */
  spellQuery?: SpellQuery;
}

/** A filter on spells, every part of which must hold. An empty list does not filter. */
export interface SpellQuery {
  levels: number[];
  /** The spell is on any of these classes' lists. */
  classes: string[];
  /** School codes, in capitals as the data writes them. */
  schools: string[];
  ritual: boolean;
  /** Spell attack codes, in lower case. */
  attacks: string[];
  /** The books a spell is printed in, in capitals, and the books it is not. */
  sources?: string[];
  notSources?: string[];
}

// ---------------------------------------------------------------------------
// Derived sheet
// ---------------------------------------------------------------------------

export interface DerivedValue {
  value: number;
  base: number;
  overridden: boolean;
  parts: Array<{ label: string; amount: number }>;
}

export interface DerivedAbility extends DerivedValue {
  mod: number;
}

/**
 * Damage that rides along on a hit but is rolled apart from the weapon's own
 * die: a flaming sword's 1d4 fire beside its 1d6 slashing. It stays a separate
 * expression because the two types take resistance independently (a fire-immune
 * target eats the slashing and nothing else), and because a rider never picks
 * up the ability modifier or magic bonus that the weapon die does.
 */
export interface DamageRider {
  dice: string;
  damageType?: string;
  /** What adds it, when an effect does (Enlarge), so two riders of the same dice stay apart. */
  label?: string;
}

/** A die or advantage an effect brings to rolls, as `DerivedSheet.rollRiders` lists it. */
export type RollRider = {
  on: RollFilter;
  origin: string;
  /** The effect in play it comes from, so spending a one-use die can end it. */
  effectId?: string;
} & (
  | { kind: 'die'; dice: string }
  | { kind: 'offer'; dice: string; once?: boolean; ifFailed?: boolean }
  | { kind: 'advantage'; mode: 'adv' | 'dis' }
);

/** Part of an effect in play that counts for nothing, and the effect that counts instead. */
export interface NotCounted {
  effectId: string;
  effectName: string;
  /** The named effect both are: "Bless". */
  same: string;
  /** The effect of that name that counts. */
  countedFrom: string;
}

export interface AttackRow {
  label: string;
  toHit: DerivedValue;
  damage: string;
  damageType?: string;
  versatileDamage?: string;
  /** What adds to the damage beyond the ability and the weapon's own bonus (Rage), when anything does. */
  damageFrom?: string[];
  /** Those of `damageFrom` whose bonuses come to less than zero (a homebrew condition's -2), when any do. */
  damageAgainst?: string[];
  extraDamage: DamageRider[];
  properties: string[];
  range?: string;
  /** The ability it attacks with, and whether it is a ranged attack: what an effect's filter reads (Rage: melee Strength). */
  ability?: Ability;
  ranged?: boolean;
  origin: string;
  /** The equipment entry it attacks with, for a carried weapon: what an effect on one weapon names. */
  weaponId?: string;
  /** The weapon is a magic item, so Magic Weapon and Elemental Weapon cannot take it. */
  magical?: true;
}

/** A `spellDamageBonus` on the sheet: its amount worked out, and its limits as written. */
export interface SpellDamageBonus {
  amount: number;
  origin: string;
  spells?: string[];
  className?: string;
  cantrips?: true;
  school?: string;
  oneRoll?: true;
}

export interface FeatureCard {
  name: string;
  level?: number;
  origin: EffectOrigin;
  entries: unknown;
}

/**
 * How a class relates to its spells (GAME-002):
 * - `known`: a fixed set of chosen spells (sorcerer, bard, ranger);
 * - `prepared`: prepares a changeable subset of the whole class list (cleric,
 *   druid, paladin, artificer);
 * - `spellbook`: learns spells into a book, then prepares a subset (wizard);
 * - `pact`: Pact Magic — known spells cast with pact slots (warlock);
 * - `none`: not a spellcaster.
 */
export type SpellcastingMode = 'known' | 'prepared' | 'spellbook' | 'pact' | 'none';

export interface SpellcastingBlock {
  classUid: string;
  /** What casts: the class, or the subclass when it is `fromSubclass`. */
  className: string;
  /**
   * Set when the spellcasting comes from a subclass (Eldritch Knight, Arcane
   * Trickster): its spell list is that subclass's, and `className` here names
   * the class whose levels count.
   */
  fromSubclass?: { className: string; shortName: string };
  /**
   * The spell levels this class can learn, from its own table as if it were
   * the only class, since a multiclass caster learns per class. `upTo` is the
   * highest open at its current level (0 before its first, as for a 2014
   * paladin at level 1); `unlocksAt[n - 1]` is the class level that opens
   * spell level n, null where none does. Absent when the data cannot say, so
   * nothing is held back.
   */
  learnable?: { upTo: number; unlocksAt: (number | null)[] };
  ability: Ability;
  mode: SpellcastingMode;
  saveDc: DerivedValue;
  attackMod: DerivedValue;
  /** index 0 = level-1 slots */
  slots: number[];
  pactSlots?: { count: number; level: number };
  /**
   * Mystic Arcanum, on a pact caster only: the spell levels (6 to 9) it has an
   * arcanum at by its own level, each cast once per long rest without a slot.
   * Present, empty before the first, on every pact caster: its spells of 6th
   * level and up are arcana in both editions, never spells known or prepared.
   */
  mysticArcanum?: number[];
  cantripsKnown?: number;
  preparedMax?: number;
  /**
   * Leveled spells known at this level from the class's spells-known progression,
   * when it has one (undefined otherwise). Only meaningful as a cap for known/pact
   * casters — the UI surfaces the over-limit cue for those modes only.
   */
  spellsKnownMax?: number;
  /**
   * What widens this class's spell list (`spellListAdd`), by what gives it: a
   * Warlock's patron, a Divine Soul, a dragonmark. The picker offers these too.
   */
  expanded?: Array<{ from: string; spells: string[]; filters: string[] }>;
}

export interface DerivedResource {
  key: string;
  label: string;
  max: number;
  resetOn: 'short' | 'long';
  origin: string;
  /** How many of these points cannot become a spell slot. */
  noSlotConversion?: number;
  /** How many come back on a short rest, when `resetOn` is `long`. */
  regainOnShort?: number;
  /** Dice of them that come back on a long rest (at dawn), in place of all of them. */
  regainRoll?: string;
}

export interface DerivedSheet {
  abilities: Record<Ability, DerivedAbility>;
  profBonus: DerivedValue;
  saves: Record<Ability, { total: DerivedValue; prof: boolean }>;
  /**
   * Plain ability checks, no skill: the modifier plus whatever adds to every
   * check of it. `halfProf` when half proficiency is part of it.
   */
  checks: Record<Ability, { total: DerivedValue; halfProf: boolean }>;
  skills: Record<
    string,
    {
      total: DerivedValue;
      /** Effective level, after any manual override. */
      prof: ProfLevel;
      /** What the build itself grants, which is what clearing an override restores. */
      profBase: ProfLevel;
      /** Half proficiency is part of the total (never with `prof` above 0). */
      halfProf: boolean;
      /**
       * Every origin in the build that grants it, proficiency or expertise,
       * once each, in collection order.
       */
      sources: EffectOrigin[];
      /**
       * What would still make it proficient under a different background:
       * proficiency grants only, less the background's own and its feat's.
       */
      sourcesBesideBackground: EffectOrigin[];
      ability: Ability;
    }
  >;
  passivePerception: DerivedValue;
  ac: DerivedValue;
  acFormulaLabel: string;
  /**
   * What could have set Armor Class and did not: a formula below the best
   * (Mage Armor under Unarmored Defense), one an override set aside, or a floor
   * the AC is already over (Barkskin's 16 under 18).
   */
  acNotCounted: Array<{ label: string; value: number; why: 'lower' | 'override' | 'floor' }>;
  /** The heavy armor worn, by name, for what it rules out (Rage). */
  heavyArmor?: string;
  initiative: DerivedValue;
  speedWalk: DerivedValue;
  /**
   * Walking speed is multiplied by `factor` after conditions take their share
   * (Haste doubles a speed exhaustion has cut). 1 with no sources when nothing does.
   */
  speedMultiplier: { factor: number; sources: string[] };
  /** Ways to move besides walking, the best of each, before `speedMultiplier`. */
  otherSpeeds: Array<{ mode: 'fly' | 'climb' | 'swim'; value: number; origin: string }>;
  maxHp: DerivedValue;
  /** die label ('d10') -> count */
  hitDice: Record<string, number>;
  totalLevel: number;
  classLabel: string;
  senses: Array<{ sense: string; range: number; origin: string }>;
  /** `damageType` is `all` for every type (Warding Bond). */
  resists: Array<{ damageType: string; origin: string; note?: string }>;
  immunities: Array<{ damageType: string; origin: string; note?: string }>;
  vulnerabilities: Array<{ damageType: string; origin: string }>;
  conditionImmunities: Array<{ condition: string; origin: string; note?: string }>;
  /** Dice and advantage effects bring to rolls; the roll decides which reach it. */
  rollRiders: RollRider[];
  extraActions: Array<{ label: string; note?: string; origin: string }>;
  /** The lowest d20 that crits on an attack, when something lowers it from 20. */
  critRange?: { min: number; origin: string };
  /** What adds to spells' damage, worked out, with the limits of each (`spellDamageBonus`). */
  spellDamageBonuses: SpellDamageBonus[];
  /** The most temporary hit points offered at the start of each turn. */
  tempHpEachTurn?: { amount: number; origin: string };
  cues: Array<{ tone: 'help' | 'ward' | 'warn' | 'info'; text: string; origin: string }>;
  /**
   * What happens at moments the app sees (H9): the moments of the entries the
   * character has and of rule packs applied to them, with what their amounts
   * read (`moments.ts`). Absent when there are none.
   */
  moments?: MomentsInForce;
  /**
   * The table rules this character plays by (`rules.ts`): their own, a pack's,
   * the app's, else as written. Absent when every one is as written for their
   * edition; read it through `sheetRules`.
   */
  rules?: TableRuleChoices;
  /** Effects in play that count for nothing because one of the same name does. */
  effectsNotCounted: NotCounted[];
  languages: string[];
  armorProfs: string[];
  weaponProfs: string[];
  toolProfs: string[];
  attacks: AttackRow[];
  spellcasting: SpellcastingBlock[];
  actions: Array<{
    economy: ActionEconomy;
    label: string;
    roll?: string;
    /** The roll is hit points regained, not damage dealt. */
    heals?: boolean;
    /** The roll is neither damage nor healing: a bonus die, temporary hit points. */
    plainDice?: boolean;
    origin: string;
    /** Extra mechanics line, e.g. "lightning · 5 by 30 ft. line". */
    note?: string;
    /** The ability the target saves with + the computed DC, when there is one to show. */
    save?: { targetAbility: Ability; dc?: number };
    /** The pool it spends, only when this sheet has that pool. */
    cost?: ActionCost;
    /** The pool that buys a use back, only when this sheet has that pool. */
    buyBack?: ActionBuyBack;
    /** The pool using it refills. */
    regains?: ActionRegain;
    /** Another chip of the same feature spends the pool sharing its name. */
    spendsNoUse?: boolean;
  }>;
  resources: DerivedResource[];
  features: FeatureCard[];
  /** Innate / granted spells (racial, feat, domain). Cast without preparation. */
  grantedSpells: Array<{
    name: string;
    source: string;
    ability?: Ability;
    /** 'prepared' = always-prepared (domain/oath/circle), cast with class slots.
     * "1/day" / "2/rest" = an innate grant with its own pool of uses. */
    usage?: string;
    /** The resource holding a limited grant's uses, spent when it is cast. */
    resourceKey?: string;
    origin: string;
    /**
     * The class whose spell it is, when its class or subclass grants it (a
     * Draconic Sorcerer's Chromatic Orb is a Sorcerer spell); none for a
     * species', feat's or item's.
     */
    className?: string;
    /** The player added it (`CharacterDoc.addedSpells`); nothing in the build grants it. */
    added?: true;
  }>;
  warnings: string[];
  /**
   * A class this character has was not in the game data, because it is still
   * landing or is gone. It derives no slots or pools, so those limits are unknown.
   */
  classDataMissing: boolean;
  /**
   * How many optional class features this character's classes have at their
   * levels, taken or not. Build offers the rule only where there are some.
   */
  classVariantCount: number;
  pending: ChoicePrompt[];
  /** Choices already made — powers "change this pick" in the build editor. */
  resolvedChoices: Array<{ prompt: ChoicePrompt; selected: string[] }>;
}

/** 18 skills and their abilities — game constants. */
export const SKILLS: ReadonlyArray<{ name: string; ability: Ability }> = [
  { name: 'Acrobatics', ability: 'dex' },
  { name: 'Animal Handling', ability: 'wis' },
  { name: 'Arcana', ability: 'int' },
  { name: 'Athletics', ability: 'str' },
  { name: 'Deception', ability: 'cha' },
  { name: 'History', ability: 'int' },
  { name: 'Insight', ability: 'wis' },
  { name: 'Intimidation', ability: 'cha' },
  { name: 'Investigation', ability: 'int' },
  { name: 'Medicine', ability: 'wis' },
  { name: 'Nature', ability: 'int' },
  { name: 'Perception', ability: 'wis' },
  { name: 'Performance', ability: 'cha' },
  { name: 'Persuasion', ability: 'cha' },
  { name: 'Religion', ability: 'int' },
  { name: 'Sleight of Hand', ability: 'dex' },
  { name: 'Stealth', ability: 'dex' },
  { name: 'Survival', ability: 'wis' },
];

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function refUid(ref: EntityRef): string {
  return `${ref.name}|${ref.source}`.toLowerCase();
}

/**
 * The subclass a class's levels picked, by its name and book; of several with
 * that name and book (a book's subclass offered to two classes, as a Fight
 * Club file's Mage of Silverquill is to the bard and the warlock), the one on
 * that class, else the first.
 */
export function subclassOf(ctx: EngineContext, entry: ClassLevelEntry): DataEntity | undefined {
  const ref = entry.subclass;
  if (ref === undefined) return undefined;
  const first = ctx.get('subclass', ref.name, ref.source);
  const className = entry.ref.name.toLowerCase();
  const onClass = (s: DataEntity) =>
    typeof s.className === 'string' && s.className.toLowerCase() === className;
  if (first === undefined || onClass(first)) return first;
  const uid = refUid(ref);
  const same = (s: DataEntity) =>
    typeof s.name === 'string' &&
    typeof s.source === 'string' &&
    refUid({ name: s.name, source: s.source }) === uid;
  return ctx.byType('subclass').find((s) => same(s) && onClass(s)) ?? first;
}

export function emptyPlayState(): PlayState {
  return {
    currentHp: 0,
    tempHp: 0,
    hitDiceSpent: {},
    slotsSpent: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pactSlotsSpent: 0,
    conditions: [],
    deathSaves: { success: 0, fail: 0 },
    resources: [],
    inspiration: false,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    xp: 0,
    hpInitialized: false,
  };
}

export function newCharacterDoc(id: string, name: string, dataTag: string): CharacterDoc {
  const now = new Date().toISOString();
  return {
    id,
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    name,
    rulesVersion: '2014',
    allowedSources: [],
    dataTag,
    abilities: {
      method: 'standard',
      base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    },
    classes: [],
    feats: [],
    choices: {},
    equipment: [],
    spellcasting: {},
    customEffects: [],
    overrides: {},
    play: emptyPlayState(),
    homebrewDeps: [],
    notes: '',
  };
}
