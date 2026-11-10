export type KeepMode = 'kh' | 'kl' | 'dh' | 'dl';

export interface DiceTermAst {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: { mode: KeepMode; n: number };
}

export interface ModTermAst {
  kind: 'mod';
  sign: 1 | -1;
  value: number;
}

export type TermAst = DiceTermAst | ModTermAst;

export interface DiceAst {
  expr: string;
  terms: TermAst[];
  /** Optional factor applied to the sum, e.g. `1d4×10` or `1d10×1d10`. */
  multiplier?: TermAst;
}

export interface DiceRollDetail {
  kind: 'dice';
  sign: 1 | -1;
  sides: number;
  rolls: Array<{ v: number; kept: boolean }>;
}

export interface ModDetail {
  kind: 'mod';
  /** Signed value. */
  value: number;
}

export interface MultiplierDetail {
  kind: 'multiplier';
  value: number;
  detail: DiceRollDetail | ModDetail;
}

/**
 * What a roll is for, set where it starts (DS-001): a d20 test, damage, or
 * healing. It picks the roll's colour and icon, since the dice alone cannot
 * tell a heal from a hit.
 */
export type RollKind = 'd20' | 'damage' | 'heal';

/**
 * A die an effect offers once the roll is seen (Guidance, Bardic Inspiration):
 * the toast shows it, and adding it is the player's call. `once` spends the
 * effect (`effectId`); `ifFailed` is 2024 Bardic, which only a failed roll takes.
 */
export interface RollOffer {
  dice: string;
  source: string;
  effectId?: string;
  once: boolean;
  ifFailed: boolean;
}

export interface RollResult {
  expr: string;
  label?: string;
  origin?: string;
  /** Absent on rolls made before kinds existed, and on dice with no known use. */
  kind?: RollKind;
  total: number;
  /**
   * Collision-proof id, assigned when the roll enters the log. Two rolls in the
   * same millisecond would share `at`, so identity/removal key off this instead.
   */
  id?: string;
  /** Epoch ms. */
  at: number;
  terms: Array<DiceRollDetail | ModDetail | MultiplierDetail>;
  meta?: {
    advantage?: 'adv' | 'dis';
    critical?: boolean;
    /** Present when the roll leads with a d20 — powers nat 20/1 highlighting. */
    d20?: { natural: number };
    /**
     * What the character's conditions did to the roll, in words
     * ("Disadvantage: Poisoned · −4: Exhaustion 2").
     */
    cue?: string;
    /** A condition makes it fail whatever the dice say (a Stunned DEX save). */
    autoFail?: boolean;
    /** Dice an effect added, by term index, named for it ("d4 [3] Bless"). */
    from?: Array<{ term: number; source: string }>;
    /** Dice effects offer after the roll; absent when nothing could change it (a natural 20 attack). */
    offers?: RollOffer[];
    /** The roll this one went with: damage tapped while its attack waited. */
    withRoll?: string;
    /**
     * An attack roll: whose (the character's id), which attack (a weapon's or
     * a spell's name), and whether its d20 landed in the character's crit
     * range. Damage that goes with it reads this (`stores/heldRoll`
     * `attackInPlay`) to roll its dice twice.
     */
    attack?: { by: string; of: string; crit: boolean };
  };
}

export interface RollOptions {
  /** Rewrites a leading plain 1d20 into 2d20kh1 / 2d20kl1. */
  advantage?: 'adv' | 'dis';
  /** Doubles dice counts (never modifiers) — damage crits. */
  critical?: boolean;
  label?: string;
  origin?: string;
  kind?: RollKind;
  /** Injectable RNG for tests: returns an int in [1, sides]. */
  rng?: (sides: number) => number;
}

export class DiceSyntaxError extends Error {
  readonly expr: string;
  readonly pos: number;

  constructor(message: string, expr: string, pos: number) {
    super(`${message} (in "${expr}" at position ${pos})`);
    this.name = 'DiceSyntaxError';
    this.expr = expr;
    this.pos = pos;
  }
}
