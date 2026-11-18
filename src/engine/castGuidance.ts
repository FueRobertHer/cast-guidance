/**
 * The `castGuidance` field (ADR-001): the one key a homebrew file adds for
 * mechanics no standard field can hold. Other tools ignore it. It is a format
 * of its own, versioned from the first file, that `readMechanics` maps onto
 * the engine's effects; the engine can change without breaking shared files.
 *
 * This module declares every part of that format and the contracts later
 * phases plug into (moments, table rules, rule packs), so they add files
 * rather than edit this one. It holds types, limits and two small readers;
 * the effect reader is `effects/mechanics.ts`, the formula parser `formula.ts`.
 *
 * Every reader of this format reads known keys only, never spreads the raw
 * object, and keeps to the limits below: an imported file is hostile until
 * read.
 */
import type {
  Ability,
  ActionBuyBack,
  ActionCost,
  ActionEconomy,
  EffectDuration,
  EffectInput,
  RollFilter,
} from './types';

/** The version this build writes. It reads every version it ever shipped. */
export const CAST_GUIDANCE_VERSION = 1;

/**
 * What a reader accepts; past these, the rest is a problem, never a crash. A
 * rule pack past any of them is refused when it is added (`data5e/rulePack.ts`),
 * so a pack that is applied counts in full.
 */
export const CAST_GUIDANCE_LIMITS = {
  /** Effects one entry, one patch or one moment's `addEffect` may carry. */
  effectsPerEntry: 64,
  /** Drops one entry may carry. */
  dropsPerEntry: 64,
  /** Prices one entry or one patch may put on what it inherits (`amend`). */
  amendsPerEntry: 64,
  /** What one moment does (`do`). */
  outcomesPerMoment: 64,
  patchesPerPack: 500,
  momentsPerPack: 200,
  cuesPerPack: 200,
  /** Characters in a patch's `target` (`feature|class` names two things). */
  targetLength: 200,
  /** Characters a pack's Apply to may name. */
  charactersPerPack: 1_000,
  /** States one effect may hold `while`; every one must hold. */
  statesPerEffect: 8,
  /** Characters in one formula. */
  formulaLength: 200,
  /** Levels of one formula's tree. */
  formulaDepth: 32,
  /** Rows in one `byLevel` table. */
  byLevelRows: 30,
  /** Rows in one table of words by an answer or a spell granted (`byAnswer`, `byGrant`). */
  answerRows: 30,
  /** Formula steps worked out in one derive; past it, the rest count as 0. */
  formulaStepsPerDerive: 20_000,
  /** The largest number, either way, a stored amount or a formula's result may be. */
  amountLimit: 999_999,
  /** Characters in a label, a name or a key. */
  labelLength: 100,
  /** Characters in a cue's or a note's text. */
  textLength: 500,
} as const;

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

/** The names a formula may read (see `formula.ts`). */
export type FormulaName =
  | 'level'
  | 'classLevel'
  | 'prof'
  | 'hp'
  | 'maxHp'
  | `mod.${Ability}`
  | `score.${Ability}`;

/**
 * A number in a stored effect: a plain number, a formula (`{ "f": "max(1, mod.cha)" }`)
 * or a table by class level (`{ "byLevel": { "1": 2, "9": 3 } }`, the value at the
 * highest level reached, 0 below the first).
 */
export type StoredAmount = number | { f: string } | { byLevel: Record<string, number> };

const ABILITY_NAMES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ALL_NAMES: readonly FormulaName[] = [
  'level',
  'classLevel',
  'prof',
  'hp',
  'maxHp',
  ...ABILITY_NAMES.map((a) => `mod.${a}` as const),
  ...ABILITY_NAMES.map((a) => `score.${a}` as const),
];
const NO_HP: readonly FormulaName[] = ALL_NAMES.filter((n) => n !== 'hp' && n !== 'maxHp');

/**
 * The names each kind's formulas may read, so nothing loops: a number the scores
 * fold in cannot read a score, and one the hit point maximum folds in cannot read
 * hit points. `why` is the problem's wording when a formula reaches past them.
 */
export function formulaNamesFor(kind: EffectInput['kind']): {
  names: ReadonlySet<FormulaName>;
  why?: string;
} {
  if (kind === 'abilityBonus' || kind === 'abilityMin') {
    return {
      names: new Set<FormulaName>(['level', 'classLevel', 'prof']),
      why: 'it changes the ability scores, so it can read only level, classLevel and prof',
    };
  }
  if (kind === 'hpPerLevel' || kind === 'maxHpBonus') {
    return {
      names: new Set(NO_HP),
      why: 'it changes the hit point maximum, so it cannot read hp or maxHp',
    };
  }
  return { names: new Set(ALL_NAMES) };
}

/**
 * The kinds whose numbers fold before the hit point maximum is known: the scores,
 * then the maximum itself. Formulas for these are worked out first (`derive.ts`),
 * and none of them may hold `while` bloodied.
 */
export const EARLY_KINDS: ReadonlySet<EffectInput['kind']> = new Set([
  'abilityBonus',
  'abilityMin',
  'hpPerLevel',
  'maxHpBonus',
]);

// ---------------------------------------------------------------------------
// States (H10)
// ---------------------------------------------------------------------------

/**
 * A state the app can see, stored as a word or a one-key object:
 * `"bloodied"` (at or under half its hit points), `"zeroHp"`, `"concentrating"`,
 * `"noArmor"` (wearing none), `"shield"` (holding one), `{ "effect": "Rage" }`
 * (an effect of that name in play), `{ "condition": "Prone" }`.
 */
export type StoredState =
  | 'bloodied'
  | 'zeroHp'
  | 'concentrating'
  | 'noArmor'
  | 'shield'
  | { effect: string }
  | { condition: string };

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * One stored effect, version 1. Its kinds and fields are the engine's
 * `EffectInput` as it was when version 1 shipped, without `origin`, except:
 * numbers may be `StoredAmount`s (see `FORMULA_FIELDS`), a resource's `resetOn`
 * is stored as `reset`, an initiative bonus of the proficiency bonus counted
 * once (`amount: 'profBonus'`) is stored as `profBonus: true`, an AC formula's
 * `label` may be left out (it is then named for what gives it), any effect
 * that reaches only numbers and rolls may hold only `while` the states listed
 * (all of them), and any effect may count under one rules version alone
 * (`edition`).
 *
 * The reader (`readMechanics`) checks each kind's fields one by one; an unknown
 * kind or a bad value is a problem, and that effect does not count.
 */
export interface StoredEffect {
  kind: string;
  while?: StoredState | StoredState[];
  /** The rules version it counts under (the character's `rulesVersion`); absent, both. */
  edition?: (typeof EFFECT_EDITIONS)[number];
  [field: string]: unknown;
}

/** The rules versions one stored effect may count under alone (`StoredEffect.edition`). */
export const EFFECT_EDITIONS = ['2014', '2024'] as const;

/** Stored effect fields that may be a `StoredAmount`, by kind. Others are plain values. */
export const FORMULA_FIELDS: Readonly<Partial<Record<EffectInput['kind'], readonly string[]>>> = {
  abilityBonus: ['amount'],
  abilityMin: ['min'],
  acBonus: ['amount'],
  acMin: ['min'],
  acFormula: ['base'],
  hpPerLevel: ['amount'],
  maxHpBonus: ['amount'],
  initiativeBonus: ['amount'],
  speedBonus: ['amount'],
  moveSpeed: ['speed'],
  attackBonus: ['amount'],
  damageBonus: ['amount'],
  spellDcBonus: ['amount'],
  spellDamageBonus: ['amount'],
  saveBonus: ['amount'],
  checkBonus: ['amount'],
  passivePerceptionBonus: ['amount'],
  sense: ['range'],
  tempHpEachTurn: ['amount'],
  critRange: ['min'],
  rollPaid: ['bonus'],
  rollReroll: ['bonus'],
  resource: ['max', 'min', 'regainOnShort'],
  resourceRegain: ['amount'],
};

/** An inherited effect a copy leaves out, by kind and, for kinds with one, label. */
export interface StoredDrop {
  kind: string;
  label?: string;
}

/**
 * A new price for an action an entry inherits (rule pack port 3g), never for one
 * its author wrote: its first inherited action, or with `label` each inherited
 * action of exactly that name, as the sheet names it. `cost` replaces what using
 * it spends; a `cost` with no `resource` changes only how many it spends of what
 * it spends now (Flurry of Blows at 2, ki or Focus). `buyBack` replaces what buys
 * a use back.
 */
export interface StoredAmend {
  label?: string;
  cost?: ActionCost | AmendedAmount;
  buyBack?: ActionBuyBack;
}

/** A `cost` that keeps what the action spends and changes how many. */
export interface AmendedAmount {
  amount: number | 'varies';
}

/**
 * An entry's own `castGuidance`. `effects` add to what the entry inherits (the
 * curated row for its key or for `basedOn`, else the prose scan); `drop` leaves
 * inherited ones out; `amend` prices inherited actions; `replace: true` inherits
 * nothing ("Start from nothing").
 */
export interface StoredEntryGuidance {
  v: number;
  effects?: StoredEffect[];
  drop?: StoredDrop[];
  amend?: StoredAmend[];
  replace?: boolean;
  /** The official entry this one was copied from, `name|source`. */
  basedOn?: string;
  /** What the original looked like when copied, for "The original changed since you copied it". */
  basedOnFingerprint?: string;
  /** What happens at moments the app sees (Phase 2). */
  moments?: StoredMoment[];
}

// ---------------------------------------------------------------------------
// Moments (H9)
// ---------------------------------------------------------------------------

/** Moments the app already sees, where a pack or an entry may act. */
export const MOMENTS = [
  'zeroHp',
  'natural20',
  'natural1',
  'castAtLevel',
  'shortRest',
  'longRest',
  'turnStart',
  'conditionAdded',
  'conditionEnded',
] as const;

export type MomentId = (typeof MOMENTS)[number];

/** What a moment does. Amounts may be formulas, worked out when it happens. */
export type MomentOutcome =
  | { kind: 'addCondition'; condition: string; level?: number }
  | { kind: 'addEffect'; name: string; effects: StoredEffect[]; lasts?: EffectDuration }
  | { kind: 'regain'; resource: string; amount: StoredAmount }
  | { kind: 'spend'; resource: string; amount: StoredAmount }
  | { kind: 'tempHp'; amount: StoredAmount }
  | { kind: 'cue'; text: string; tone?: CueTone }
  | { kind: 'offer'; label: string; dice?: string };

/**
 * "Dropping to 0 HP gives a level of exhaustion" is
 * `{ "at": "zeroHp", "do": [{ "kind": "addCondition", "condition": "Exhaustion" }] }`.
 */
export interface StoredMoment {
  at: MomentId;
  /** `natural20` and `natural1`: the rolls it holds for; every d20 roll when absent. */
  rolls?: RollFilter['rolls'];
  /** `castAtLevel`: the least slot level it holds for. */
  level?: number;
  /** `conditionAdded` and `conditionEnded`: the condition. */
  condition?: string;
  do: MomentOutcome[];
}

export type CueTone = 'help' | 'ward' | 'warn' | 'info';

/**
 * A rule the app cannot count, said where it matters: at a moment, at levelling
 * up, or on a kind of roll. "Gritty: a long rest needs a safe haven."
 */
export interface StoredCue {
  at: MomentId | 'levelUp' | 'attack' | 'save' | 'check';
  text: string;
  tone?: CueTone;
}

// ---------------------------------------------------------------------------
// Table rules (D4)
// ---------------------------------------------------------------------------

/**
 * The table rules and their values, the as-written one first. One engine
 * function reads each (`rules.ts` resolves them). `hpEachLevel` takes the
 * per-character `hpMethod`'s values and `oneUseDice` the per-character field
 * of that name; the Rules board's other values are added after Phase 1's.
 */
export const TABLE_RULES = {
  /** Critical damage: double the dice, the dice's maximum plus a roll, or double the total. */
  critDamage: ['doubleDice', 'maxPlusRoll', 'doubleTotal'],
  /** Rests: standard, gritty (8 hours and 7 days), heroic (5 minutes and 1 hour). */
  restLength: ['standard', 'gritty', 'heroic'],
  /**
   * Hit points each level after the first: the fixed amount, the roll, the
   * die's maximum, or the roll but never under the fixed amount.
   */
  hpEachLevel: ['average', 'rolled', 'max', 'rolledAtLeastAverage'],
  /**
   * Hit points back on a long rest: all of them, half the maximum, or none
   * (only what spending hit dice heals).
   */
  hpOnLongRest: ['all', 'half', 'hitDice'],
  /** Flanking: off, advantage, or +2 to hit (offered on melee attacks). */
  flanking: ['off', 'advantage', 'plusTwo'],
  /** Guidance and Bardic Inspiration: offered after the roll, or before it. */
  oneUseDice: ['after', 'before'],
} as const;

export type TableRuleId = keyof typeof TABLE_RULES;
export type TableRuleChoices = { [K in TableRuleId]: (typeof TABLE_RULES)[K][number] };

const firstOf = (): TableRuleChoices => ({
  critDamage: 'doubleDice',
  restLength: 'standard',
  hpEachLevel: 'average',
  hpOnLongRest: 'all',
  flanking: 'off',
  oneUseDice: 'after',
});

/** Each rule as written, per edition: what a character with no choice anywhere plays by. */
export const AS_WRITTEN: Readonly<Record<'2014' | '2024', Readonly<TableRuleChoices>>> = {
  '2014': firstOf(),
  '2024': firstOf(),
};

/** Table rules from a stored object: known ids with known values, the rest problems. */
export function readTableRules(raw: unknown): {
  rules: Partial<TableRuleChoices>;
  problems: string[];
} {
  const rules: Record<string, string> = {};
  const problems: string[] = [];
  const read = () => ({ rules: rules as Partial<TableRuleChoices>, problems });
  if (raw === undefined) return read();
  if (!isRecord(raw)) {
    problems.push('table rules: not a list of rules');
    return read();
  }
  for (const [id, value] of Object.entries(raw)) {
    if (!Object.hasOwn(TABLE_RULES, id)) {
      problems.push(`table rules: unknown rule "${clip(id)}"`);
      continue;
    }
    const values: readonly string[] = TABLE_RULES[id as TableRuleId];
    if (typeof value === 'string' && values.includes(value)) rules[id] = value;
    else problems.push(`table rules: ${id} is one of ${values.join(', ')}`);
  }
  return read();
}

// ---------------------------------------------------------------------------
// Rule packs (D5)
// ---------------------------------------------------------------------------

/**
 * The registry type rule packs reach the engine as, one entry per pack, in the
 * player's order. A pack is a homebrew file whose `_meta.castGuidance` is a
 * `StoredPackGuidance`; `data5e/rulePack.ts` reads it into a `RulePackEntry`.
 */
export const RULE_PACK_TYPE = 'rulePack';

/**
 * A change to an existing entry's mechanics, by key: `name|source` for most
 * entries, `feature|class` or `feature|subclass` for a class or subclass
 * feature (`Rage|Barbarian`), `trait|species` for a species trait. `effects`
 * replaces the entry's mechanics; `add` adds to them; `amend` prices the actions
 * it inherits, after the entry's own `amend`. Two adds both count; of two
 * replacements, or two prices on one action, the pack later in the player's
 * order wins.
 */
export interface StoredPatch {
  target: string;
  effects?: StoredEffect[];
  add?: StoredEffect[];
  amend?: StoredAmend[];
}

/**
 * A rule pack file's `_meta.castGuidance`. Data only: nothing in it is run, and a
 * formula is read by the app's own small grammar (`formula.ts`). A cue at a moment
 * shows when that moment happens, as a moment's `cue` outcome does.
 */
export interface StoredPackGuidance {
  v: number;
  tableRules?: Partial<TableRuleChoices>;
  patches?: StoredPatch[];
  moments?: StoredMoment[];
  cues?: StoredCue[];
}

/** The parts a pack's `castGuidance` may hold; any other key is not read. */
export const PACK_PARTS = ['v', 'tableRules', 'patches', 'moments', 'cues'] as const;

/**
 * Who a pack reaches. Kept on the stored pack, dropped when it is shared: nothing
 * from a pack applies to a character the player did not apply it to.
 */
export interface PackAppliesTo {
  /** Characters, by id. Everything in the pack reaches these, its table rules over the app's. */
  characters: string[];
  /**
   * Every character ("Every character" on the review sheet): its patches,
   * moments and cues reach every one, and its table rules are the app's default,
   * under a choice made in Settings and under each character's own.
   */
  appDefault?: boolean;
}

/** A rule pack as the registry lists it (`RULE_PACK_TYPE`), in the player's order. */
export interface RulePackEntry {
  /** Shown on what it changes, so nobody wonders why a feature reads differently. */
  name: string;
  source: string;
  castGuidance: StoredPackGuidance;
  appliesTo?: PackAppliesTo;
}

// ---------------------------------------------------------------------------
// Built-in rule sets
// ---------------------------------------------------------------------------

/**
 * The registry type the app's own rule sets reach the engine as (`src/rules/`,
 * loaded by `data5e/builtInRules.ts`). Their rows sit at layer 3 of the seam,
 * what an entry inherits, so a player's pack and an entry's own mechanics
 * still come first. See
 * `docs/rule-sets.md`.
 */
export const RULE_SET_TYPE = 'ruleSet';

/**
 * The part each row belongs to. `curated` is the entry's curated row, found
 * under its curated keys (`docs/rule-sets.md`): a feat or optional feature by
 * `name|source`, a class feature by `name|class`, a subclass feature by
 * `name|subclass full name`, a species trait by `trait:<name>`, a class by
 * `class:<name|source>`. `standing` is defenses, senses and speeds a class or
 * subclass feature or an optional feature adds beside what its prose scan or
 * curated row reads, found under its curated keys. `rollAdvantage` and
 * `rollExtra` are what a
 * feature adds to the character's own d20 tests (the tables that were
 * `ROLL_ADVANTAGES` and `ROLL_EXTRAS`), found under the roll keys, which name
 * the book: `brave|phb`, `feral instinct|barbarian|phb`. `spend` is what a
 * feature's action costs or buys a use back with (the link tables that were
 * `SPEND_LINKS` and `SLOT_LINKS`), found under the roll keys: a row's `links`
 * price the action the feature emitted, or add one. `wornTags` is what wearing
 * an item gives where its data's tags say otherwise (the table that was
 * `ITEM_TAG_FIXES`), found under the item's own `name|source`: the kinds of
 * tag it `replaces`, and its effects in their place. `charges` is the charges a
 * carried item casts spells with (the table that was `ITEM_CHARGES`), found
 * under the item's `name|source` as the equipment entry names it: how many it
 * holds, the dice that come back at dawn, and what each spell costs.
 */
export const RULE_SET_PARTS = [
  'curated',
  'standing',
  'rollAdvantage',
  'rollExtra',
  'spend',
  'wornTags',
  'charges',
] as const;

/**
 * The kinds of what an item's data tags give while it is worn, in the order the
 * item call site reads them, which a `wornTags` row `replaces`: its defenses
 * (`resist`, `immune`, `vulnerable`, `conditionImmune`) and its save bonus.
 */
export const WORN_TAG_KINDS = [
  'resist',
  'immune',
  'vulnerable',
  'conditionImmune',
  'saveBonus',
] as const;

/** Whether a built-in row turns the prose scan off for its entry, or runs beside it. */
export const RULE_SET_SCANS = ['replace', 'keep'] as const;

/** The editions a rule set says it is written for. A label, not a filter: rows match by printing. */
export const RULE_SET_EDITIONS = ['2014', '2024', 'both'] as const;

/** What the rule set reader accepts. Its own limits: these files ship with the app. */
export const RULE_SET_LIMITS = {
  rowsPerSet: 5_000,
  keysPerRow: 16,
  /** The highest feature level a row may name. */
  level: 20,
  /** The most charges a `charges` row's item holds. */
  charges: 99,
  /** The most spells a `charges` row's item casts. */
  chargeSpells: 20,
} as const;

/** One row of a built-in rule set. */
export interface StoredRuleRow {
  part: (typeof RULE_SET_PARTS)[number];
  /** Lowercased keys, as the part's call sites look rows up: `stunning strike|monk`. */
  keys: string[];
  /** `curated` rows only. Absent: `replace`, as a curated row does. */
  scan?: (typeof RULE_SET_SCANS)[number];
  /**
   * Every part but `curated`: the row counts only for the feature gained at
   * this level, which tells apart features of one name (Storm Herald's Desert
   * at 3, 6 and 14). Absent: at every level.
   */
  level?: number;
  /** Every part but `spend` and `charges`. */
  effects?: StoredEffect[];
  /** `spend` rows only: the prices it puts on the feature's actions, in order. */
  links?: StoredSpendLink[];
  /**
   * `wornTags` rows only: the kinds of the item's data tags it stands in for
   * (`WORN_TAG_KINDS`). Its `effects` are what the item gives of those kinds
   * instead, often none; the kinds it leaves out are read from the data.
   */
  replaces?: Array<(typeof WORN_TAG_KINDS)[number]>;
  /** `charges` rows only: how many charges the item holds. */
  charges?: number;
  /** `charges` rows only: the charges that come back at dawn, as dice (`1d6+4`). */
  regain?: string;
  /** `charges` rows only: the spells its charges cast, and what each costs. */
  spells?: StoredChargeSpell[];
}

/** One spell a `charges` row's item casts with its charges. */
export interface StoredChargeSpell {
  /** The spell, by name in lower case: any printing of it casts from the item. */
  spell: string;
  /** Charges it costs at its own level. */
  cost: number;
  /** One more charge for each level above its own, up to this spell level. Absent: its own level only. */
  upTo?: number;
}

/**
 * One price a `spend` row puts on a feature's action (`linkPrice` in
 * `spendLinks.ts`). What it does turns on how the price is paid: a pool's price
 * replaces the one the action has, while a spell slot's or a Hit Point Die's
 * fills only an empty one, as it runs after a pool's under one key.
 */
export type StoredSpendLink =
  | {
      /** What using it spends, on the first action of the feature, or a new one. */
      cost: ActionCost;
      /** The slice of the turn it takes: given when the action is new, or the scan says another. */
      economy?: ActionEconomy;
      /** Its own new action, by this name, rather than the feature's (Combat Wild Shape's healing). */
      label?: string;
      /** The action's note, when it has none. */
      note?: string;
    }
  | {
      /** What buys a use back once none are left. */
      buyBack: ActionBuyBack;
      /** The action it shows on, by name, when that is another feature's (Totems). */
      onAction?: string;
      /**
       * The use it gives back: a spell the feature's class or subclass grants,
       * by name ("Telekinesis" or "telekinesis", as its pool is keyed either way).
       */
      ownSpell?: string;
      /** Its uses, when the feature has no pool counting them: named for the feature. */
      uses?: { key: string; max: number; resetOn: 'short' | 'long' };
    };

/** A built-in rule set file. */
export interface StoredRuleSet {
  type: typeof RULE_SET_TYPE;
  v: number;
  name: string;
  edition?: (typeof RULE_SET_EDITIONS)[number];
  rows: StoredRuleRow[];
}

// ---------------------------------------------------------------------------
// Shared reading helpers
// ---------------------------------------------------------------------------

/** A JSON object (not an array, not null). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A key's own value: never one an object inherits (`constructor`, `__proto__`). */
export function own(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

/** A value cut short for a problem's wording. Never throws, whatever a file holds. */
export function clip(v: unknown): string {
  const s =
    typeof v === 'object' && v !== null ? (Array.isArray(v) ? 'a list' : 'an object') : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}...` : s;
}

/** Which version a stored `castGuidance` is, or why it cannot be read. */
export function guidanceVersion(raw: Record<string, unknown>): { v: number } | { problem: string } {
  const v = own(raw, 'v');
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    return { problem: 'its mechanics have no version, so they do not count' };
  }
  if (v > CAST_GUIDANCE_VERSION) {
    return { problem: 'made with a newer Cast Guidance: update to use its mechanics' };
  }
  return { v };
}
