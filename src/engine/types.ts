/**
 * The contract between storage, the derivation engine, and the UI.
 * Principle: a CharacterDoc stores CHOICES + PLAY STATE, never derived
 * results; overrides are inputs. Everything else is recomputed on read.
 */

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

/** Minimal lookup surface the engine needs; adapters wrap the registry. */
export interface EngineContext {
  get(type: string, name: string, source?: string): DataEntity | undefined;
  byType(type: string): readonly DataEntity[];
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
  /** die label ('d10') -> spent count */
  hitDiceSpent: Record<string, number>;
  /** index 0 = level-1 slots spent */
  slotsSpent: number[];
  pactSlotsSpent: number;
  conditions: Array<{ id: string; level?: number }>;
  deathSaves: { success: number; fail: number };
  concentratingOn?: { label: string };
  /** keyed to derived resources (rage, ki, …) */
  resources: Array<{ key: string; used: number }>;
  inspiration: boolean;
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
  xp: number;
  /** Per-turn action economy; true = used this turn. Optional for older docs. */
  turn?: { action: boolean; bonus: boolean; reaction: boolean };
  /**
   * False for a freshly built character: the sheet fills currentHp to the
   * derived max the first time HP exists, then flips this true. Undefined on
   * pre-existing docs, which are left exactly as saved.
   */
  hpInitialized?: boolean;
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
   * 'max' (table rule: full die every level). Optional; default 'average'.
   */
  hpMethod?: 'average' | 'rolled' | 'max';
  race?: EntityRef;
  subrace?: EntityRef;
  background?: EntityRef;
  classes: ClassLevelEntry[];
  feats: Array<{ ref: EntityRef; instanceId: string }>;

  /** ONE namespace for every pick, keyed by stable ChoicePrompt ids. */
  choices: Record<string, string[] | string | number>;

  equipment: EquipmentEntry[];
  spellcasting: Record<string, { known: EntityRef[]; prepared: EntityRef[] }>;

  /** User "misc modifier" rows — first-class effects. */
  customEffects: EffectInput[];
  overrides: Partial<Record<OverridePath, { value: number; note?: string }>>;

  play: PlayState;
  homebrewDeps: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface EffectOrigin {
  label: string;
  uid: string;
  type: 'race' | 'background' | 'class' | 'subclass' | 'feat' | 'item' | 'custom' | 'curated';
}

export type EffectInput = { origin: EffectOrigin } & (
  | { kind: 'abilityBonus'; ability: Ability; amount: number }
  | { kind: 'abilityMin'; ability: Ability; min: number }
  | { kind: 'skillProf'; skill: string; level: ProfLevel }
  | { kind: 'saveProf'; ability: Ability }
  | { kind: 'toolProf'; name: string }
  | { kind: 'armorProf'; name: string }
  | { kind: 'weaponProf'; name: string }
  | { kind: 'language'; name: string }
  | { kind: 'acFormula'; label: string; base: number; addAbilities: Ability[]; dexMax?: number }
  | { kind: 'acBonus'; amount: number }
  | { kind: 'hpPerLevel'; amount: number }
  | { kind: 'initiativeBonus'; amount: number }
  | { kind: 'speedBonus'; amount: number }
  | { kind: 'attackBonus'; scope: 'melee' | 'ranged' | 'all'; amount: number }
  | { kind: 'damageBonus'; scope: 'melee' | 'ranged' | 'all'; amount: number }
  | { kind: 'sense'; sense: string; range: number }
  | { kind: 'resist'; damageType: string }
  | {
      kind: 'resource';
      key: string;
      label: string;
      max: number | 'profBonus' | `abilityMod:${Ability}` | `level:${string}`;
      resetOn: 'short' | 'long';
      /**
       * When true, same-key resources from other sources add to the pool
       * (superiority dice from Battle Master + Martial Adept + Superior
       * Technique stack). Default is first-wins (curated beats prose-scan dup).
       */
      stack?: boolean;
    }
  | {
      kind: 'action';
      economy: 'action' | 'bonus' | 'reaction';
      label: string;
      roll?: string;
      /** Extra mechanics line, e.g. "lightning · 5 by 30 ft. line". */
      note?: string;
      /** Target save + which of the caster's abilities sets the DC (8+mod+prof). */
      save?: { targetAbility: Ability; dcAbility: Ability };
    }
  | { kind: 'grantSpell'; spell: EntityRef; ability?: Ability; usage?: string }
  | { kind: 'note'; text: string }
);

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

export interface ChoiceOption {
  id: string;
  label: string;
  /** One-line summary shown under the label (e.g. what a feat does). */
  description?: string;
  disabled?: { reason: string };
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
    | 'generic';
  label: string;
  count: number;
  /** Whether the same option may fill more than one pick (ASI +2 is the main case). */
  allowRepeat?: boolean;
  options: ChoiceOption[];
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

export interface AttackRow {
  label: string;
  toHit: DerivedValue;
  damage: string;
  damageType?: string;
  versatileDamage?: string;
  properties: string[];
  range?: string;
  origin: string;
}

export interface FeatureCard {
  name: string;
  level?: number;
  origin: EffectOrigin;
  entries: unknown;
}

export interface SpellcastingBlock {
  classUid: string;
  className: string;
  ability: Ability;
  saveDc: DerivedValue;
  attackMod: DerivedValue;
  /** index 0 = level-1 slots */
  slots: number[];
  pactSlots?: { count: number; level: number };
  cantripsKnown?: number;
  preparedMax?: number;
}

export interface DerivedResource {
  key: string;
  label: string;
  max: number;
  resetOn: 'short' | 'long';
  origin: string;
}

export interface DerivedSheet {
  abilities: Record<Ability, DerivedAbility>;
  profBonus: DerivedValue;
  saves: Record<Ability, { total: DerivedValue; prof: boolean }>;
  skills: Record<string, { total: DerivedValue; prof: ProfLevel; ability: Ability }>;
  passivePerception: DerivedValue;
  ac: DerivedValue;
  acFormulaLabel: string;
  initiative: DerivedValue;
  speedWalk: DerivedValue;
  maxHp: DerivedValue;
  /** die label ('d10') -> count */
  hitDice: Record<string, number>;
  totalLevel: number;
  classLabel: string;
  senses: Array<{ sense: string; range: number; origin: string }>;
  resists: Array<{ damageType: string; origin: string }>;
  languages: string[];
  armorProfs: string[];
  weaponProfs: string[];
  toolProfs: string[];
  attacks: AttackRow[];
  spellcasting: SpellcastingBlock[];
  actions: Array<{
    economy: 'action' | 'bonus' | 'reaction';
    label: string;
    roll?: string;
    origin: string;
    /** Extra mechanics line, e.g. "lightning · 5 by 30 ft. line". */
    note?: string;
    /** Computed save DC + the ability the target saves with. */
    save?: { targetAbility: Ability; dc: number };
  }>;
  resources: DerivedResource[];
  features: FeatureCard[];
  /** Innate / granted spells (racial, feat, domain). Cast without preparation. */
  grantedSpells: Array<{
    name: string;
    source: string;
    ability?: Ability;
    /** 'prepared' = always-prepared (domain/oath/circle), cast with class slots. */
    usage?: string;
    origin: string;
  }>;
  warnings: string[];
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
