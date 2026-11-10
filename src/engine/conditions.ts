/**
 * What conditions and exhaustion do to a character's own d20 tests, speed and
 * hit point maximum, in both rules editions (the 2014 PHB's appendix A, the
 * 2024 PHB's rules glossary). Pure tables and functions: the sheet asks what
 * applies to a roll and shows it as a cue the player can still override.
 *
 * Effects that hinge on someone else (advantage on attacks against you, a hit
 * from within 5 feet turning critical) are notes only: the sheet rolls the
 * character's dice, never the attacker's. So are effects that depend on what
 * the roll is about, which the sheet cannot know (a check that needs sight, an
 * attack on anyone but the grappler).
 */
import type { Ability } from './types';

export type Edition = '2014' | '2024';

/** A play-state condition as `PlayState.conditions` stores it. */
export interface ActiveCondition {
  id: string;
  level?: number;
  /** The player switched its effects off: listed, but nothing applies. */
  ignored?: boolean;
}

/**
 * A d20 test the sheet rolls. A death save is a save with no ability;
 * initiative is a Dexterity check with rules of its own besides. The detail an
 * effect in play may ask about (Reckless Attack: melee weapon attacks with
 * Strength) is optional, and a filter that needs it does not reach a test
 * without it.
 */
export type D20Test =
  | {
      kind: 'attack';
      attack?: 'weapon' | 'spell';
      range?: 'melee' | 'ranged';
      ability?: Ability;
      /** The class whose spell this is, for a spell attack. */
      className?: string;
    }
  | { kind: 'check'; ability?: Ability; skill?: string }
  | { kind: 'initiative' }
  | { kind: 'save'; ability?: Ability };

/** A condition the character is immune to, and what makes them so (`DerivedSheet.conditionImmunities`). */
export interface ConditionImmunity {
  condition: string;
  origin: string;
}

export interface ConditionOptions {
  /**
   * Conditions the character is immune to. One in play is held off: listed,
   * and nothing applies, as if switched off. So is one another condition
   * brings (an Unconscious character immune to Prone is not prone).
   */
  immune?: ReadonlyArray<ConditionImmunity>;
}

type TestKind = D20Test['kind'];

interface RollRule {
  on: TestKind;
  mode: 'adv' | 'dis' | 'fail';
  /** Only these abilities' checks or saves; any when absent. */
  abilities?: readonly Ability[];
}

interface ConditionRules {
  /** Conditions it brings with it: Paralyzed is Incapacitated too. */
  includes?: readonly string[];
  /** Conditions it switches off: a Petrified creature is immune to poison. */
  suppresses?: readonly string[];
  rolls?: readonly RollRule[];
  /** What it says about rolls it cannot settle alone. */
  notes?: ReadonlyArray<{ on: readonly TestKind[]; text: string }>;
  /** Speed 0. */
  immobile?: true;
  /** Damage types it resists ("all"). */
  resist?: readonly string[];
  /** About attacks against the character: information, not a roll. */
  against?: readonly string[];
}

const ADV_AGAINST = 'Attack rolls against you have advantage';
const CRIT_AGAINST = 'Hits from within 5 ft are critical hits';
const PRONE_AGAINST = 'Attack rolls against you have advantage within 5 ft, disadvantage beyond';
const STR_DEX: readonly Ability[] = ['str', 'dex'];
const FAILS_STR_DEX: RollRule = { on: 'save', mode: 'fail', abilities: STR_DEX };
const INCAPACITATED = ['Incapacitated'];

/** The rules both editions share; `RULES_2024` overrides where they part. */
const RULES_2014: Record<string, ConditionRules> = {
  Blinded: {
    rolls: [{ on: 'attack', mode: 'dis' }],
    notes: [{ on: ['check'], text: 'you fail checks that need sight' }],
    against: [ADV_AGAINST],
  },
  Charmed: { notes: [{ on: ['attack'], text: "you can't attack the charmer" }] },
  Deafened: { notes: [{ on: ['check'], text: 'you fail checks that need hearing' }] },
  Frightened: {
    rolls: [
      { on: 'attack', mode: 'dis' },
      { on: 'check', mode: 'dis' },
    ],
    notes: [
      { on: ['attack', 'check', 'initiative'], text: 'only while the source of fear is in sight' },
    ],
  },
  Grappled: { immobile: true },
  Incapacitated: {},
  Invisible: {
    rolls: [{ on: 'attack', mode: 'adv' }],
    against: ['Attack rolls against you have disadvantage'],
  },
  Paralyzed: {
    includes: INCAPACITATED,
    rolls: [FAILS_STR_DEX],
    immobile: true,
    against: [ADV_AGAINST, CRIT_AGAINST],
  },
  Petrified: {
    includes: INCAPACITATED,
    suppresses: ['Poisoned'],
    rolls: [FAILS_STR_DEX],
    immobile: true,
    resist: ['all'],
    against: [ADV_AGAINST, 'You resist all damage'],
  },
  Poisoned: {
    rolls: [
      { on: 'attack', mode: 'dis' },
      { on: 'check', mode: 'dis' },
    ],
  },
  Prone: {
    rolls: [{ on: 'attack', mode: 'dis' }],
    against: [PRONE_AGAINST],
  },
  Restrained: {
    rolls: [
      { on: 'attack', mode: 'dis' },
      { on: 'save', mode: 'dis', abilities: ['dex'] },
    ],
    immobile: true,
    against: [ADV_AGAINST],
  },
  Stunned: {
    includes: INCAPACITATED,
    rolls: [FAILS_STR_DEX],
    immobile: true,
    against: [ADV_AGAINST],
  },
  Unconscious: {
    includes: ['Incapacitated', 'Prone'],
    rolls: [FAILS_STR_DEX],
    immobile: true,
    against: [ADV_AGAINST, CRIT_AGAINST],
  },
};

const RULES_2024: Record<string, ConditionRules> = {
  ...RULES_2014,
  // Its attack penalty depends on the target, so it is a note.
  Grappled: {
    immobile: true,
    notes: [{ on: ['attack'], text: 'disadvantage against anyone but the grappler' }],
  },
  Incapacitated: { rolls: [{ on: 'initiative', mode: 'dis' }] },
  Invisible: {
    rolls: [
      { on: 'attack', mode: 'adv' },
      { on: 'initiative', mode: 'adv' },
    ],
    notes: [{ on: ['attack'], text: 'not against a creature that can see you' }],
    against: ['Attack rolls against you have disadvantage'],
  },
  // 2024 drops "can't move" from Stunned.
  Stunned: { includes: INCAPACITATED, rolls: [FAILS_STR_DEX], against: [ADV_AGAINST] },
};

const RULES: Record<Edition, Record<string, ConditionRules>> = {
  '2014': RULES_2014,
  '2024': RULES_2024,
};

const clampLevel = (level: number | undefined) => Math.max(0, Math.min(6, level ?? 0));

/** The names an immunity holds off, compared without case: data says "frightened". */
function heldNames(options: ConditionOptions): Set<string> {
  return new Set((options.immune ?? []).map((i) => i.condition.trim().toLowerCase()));
}

/** Switched off or held off: in play, applying nothing. */
function applies(c: ActiveCondition, held: ReadonlySet<string>): boolean {
  return c.ignored !== true && !held.has(c.id.toLowerCase());
}

/** The exhaustion level in force: none when switched off or held off. */
function exhaustionLevel(
  conditions: ReadonlyArray<ActiveCondition>,
  options: ConditionOptions,
): number {
  const held = heldNames(options);
  const exhaustion = conditions.find((c) => c.id === 'Exhaustion' && applies(c, held));
  return clampLevel(exhaustion?.level);
}

/**
 * The conditions in play an immunity holds off, each with what holds it off,
 * for its chip. A condition only brought along by another one has no chip.
 */
export function heldOff(
  conditions: ReadonlyArray<ActiveCondition>,
  options: ConditionOptions,
): Array<{ id: string; by: string[] }> {
  const out: Array<{ id: string; by: string[] }> = [];
  for (const c of conditions) {
    const by = (options.immune ?? [])
      .filter((i) => i.condition.trim().toLowerCase() === c.id.toLowerCase())
      .map((i) => i.origin);
    if (by.length > 0) out.push({ id: c.id, by: [...new Set(by)] });
  }
  return out;
}

/**
 * The conditions in force that leave the character Incapacitated, by the chip
 * that does it (Incapacitated, or Paralyzed, Petrified, Stunned or
 * Unconscious, which bring it), and whether they are Unconscious. One
 * switched off or held off counts for nothing, and an immunity to
 * Incapacitated holds it off however it comes.
 */
export function outOfAction(
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
  options: ConditionOptions = {},
): { incapacitated: string[]; unconscious: boolean } {
  const held = heldNames(options);
  const active = conditions.filter((c) => applies(c, held));
  const table = RULES[edition];
  const incapacitated = held.has('incapacitated')
    ? []
    : active
        .filter((c) => c.id === 'Incapacitated' || table[c.id]?.includes?.includes('Incapacitated'))
        .map((c) => c.id);
  return { incapacitated, unconscious: active.some((c) => c.id === 'Unconscious') };
}

/**
 * Exhaustion's roll rules at a level. 2014 is the cumulative table (level 1
 * checks, level 3 attacks and saves); 2024 has none of these and takes 2 per
 * level off every d20 test instead (see `d20Effects`).
 */
function exhaustionRules(level: number, edition: Edition): ConditionRules {
  if (edition === '2024' || level < 1) return {};
  const rolls: RollRule[] = [{ on: 'check', mode: 'dis' }];
  if (level >= 3) rolls.push({ on: 'attack', mode: 'dis' }, { on: 'save', mode: 'dis' });
  return { rolls };
}

/** Each condition in force, with the rules it carries, named for the chip that caused it. */
function inForce(
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
  options: ConditionOptions = {},
): Array<{ source: string; rules: ConditionRules }> {
  const table = RULES[edition];
  const held = heldNames(options);
  const active = conditions.filter((c) => applies(c, held));
  const suppressed = new Set(active.flatMap((c) => table[c.id]?.suppresses ?? []));
  const out: Array<{ source: string; rules: ConditionRules }> = [];
  for (const c of active) {
    if (c.id === 'Exhaustion') {
      const level = clampLevel(c.level);
      if (level > 0)
        out.push({ source: `Exhaustion ${level}`, rules: exhaustionRules(level, edition) });
      continue;
    }
    const rules = table[c.id];
    if (rules === undefined || suppressed.has(c.id)) continue;
    out.push({ source: c.id, rules });
    for (const included of rules.includes ?? []) {
      const more = table[included];
      if (more !== undefined && !held.has(included.toLowerCase()))
        out.push({ source: c.id, rules: more });
    }
  }
  return out;
}

/** The ability a test is made with: initiative is a Dexterity check. */
export function testAbility(test: D20Test): Ability | undefined {
  return test.kind === 'initiative' ? 'dex' : test.ability;
}

/** Does a rule reach this test? Initiative takes the check rules too. */
function reaches(rule: RollRule, test: D20Test): boolean {
  const kindMatches = rule.on === test.kind || (test.kind === 'initiative' && rule.on === 'check');
  if (!kindMatches) return false;
  if (rule.abilities === undefined) return true;
  const ability = testAbility(test);
  return ability !== undefined && rule.abilities.includes(ability);
}

/** What the conditions in force do to one d20 test, each effect naming its sources. */
export interface D20Effects {
  advantage: string[];
  disadvantage: string[];
  /** Sources that make it fail whatever the roll. */
  autoFail: string[];
  /** 2024 exhaustion: a negative amount off the roll. */
  penalty?: { amount: number; source: string };
  /** Information only: what the sheet cannot decide for this roll. */
  notes: Array<{ source: string; text: string }>;
}

const addOnce = (list: string[], source: string) => {
  if (!list.includes(source)) list.push(source);
};

export function d20Effects(
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
  test: D20Test,
  options: ConditionOptions = {},
): D20Effects {
  const effects: D20Effects = { advantage: [], disadvantage: [], autoFail: [], notes: [] };
  for (const { source, rules } of inForce(conditions, edition, options)) {
    for (const rule of rules.rolls ?? []) {
      if (!reaches(rule, test)) continue;
      const list =
        rule.mode === 'adv'
          ? effects.advantage
          : rule.mode === 'dis'
            ? effects.disadvantage
            : effects.autoFail;
      addOnce(list, source);
    }
    for (const note of rules.notes ?? []) {
      if (note.on.includes(test.kind) && !effects.notes.some((n) => n.text === note.text)) {
        effects.notes.push({ source, text: note.text });
      }
    }
  }
  // 2024: "When you make a D20 Test, the roll is reduced by 2 times your
  // Exhaustion level." Attacks, checks (initiative among them) and saves
  // (death saves among them) are all D20 Tests.
  const level = exhaustionLevel(conditions, options);
  if (edition === '2024' && level > 0) {
    effects.penalty = { amount: -2 * level, source: `Exhaustion ${level}` };
  }
  return effects;
}

/** True when nothing applies to the roll (notes aside). */
export function noD20Effect(effects: D20Effects): boolean {
  return (
    effects.advantage.length === 0 &&
    effects.disadvantage.length === 0 &&
    effects.autoFail.length === 0 &&
    effects.penalty === undefined
  );
}

export interface D20Resolution {
  advantage: 'adv' | 'dis' | undefined;
  /** Advantage and disadvantage both present, so the roll is a plain d20. */
  cancelled: boolean;
  penalty: number;
  autoFail: boolean;
}

/**
 * How a roll is made under the effects that reach it. Any advantage and any
 * disadvantage cancel to a single d20, however many of each there are; more
 * than one of a kind is still one. With `effects` undefined (the player
 * ignored them for this roll) it is a single d20. A mode the roll prompt picks
 * is applied after this, as the last word (`d20Ask`).
 */
export function resolveD20(effects: D20Effects | undefined): D20Resolution {
  const adv = (effects?.advantage.length ?? 0) > 0;
  const dis = (effects?.disadvantage.length ?? 0) > 0;
  return {
    advantage: adv && !dis ? 'adv' : dis && !adv ? 'dis' : undefined,
    cancelled: adv && dis,
    penalty: effects?.penalty?.amount ?? 0,
    autoFail: (effects?.autoFail.length ?? 0) > 0,
  };
}

/**
 * Walking speed under the conditions in force, and the sources that changed
 * it, in order. Exhaustion first (2014: halved from level 2, round down, 0 from
 * level 5; 2024: 5 ft less per level), then an effect's multiplier (Haste
 * doubles what exhaustion left: 30 less 5 is 25, doubled 50), then speed 0
 * from a condition, which nothing lifts.
 */
export function conditionSpeed(
  base: number,
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
  options: ConditionOptions & {
    /** `DerivedSheet.speedMultiplier`. */
    multiplier?: { factor: number; sources: readonly string[] };
  } = {},
): { value: number; sources: string[] } {
  let value = base;
  const sources: string[] = [];
  const level = exhaustionLevel(conditions, options);
  if (level > 0) {
    const after =
      edition === '2024'
        ? Math.max(0, value - 5 * level)
        : level >= 5
          ? 0
          : level >= 2
            ? Math.floor(value / 2)
            : value;
    if (after !== value) sources.push(`Exhaustion ${level}`);
    value = after;
  }
  const multiplier = options.multiplier;
  if (multiplier !== undefined && multiplier.factor !== 1) {
    const after = Math.floor(value * multiplier.factor);
    if (after !== value) for (const source of multiplier.sources) addOnce(sources, source);
    value = after;
  }
  for (const { source, rules } of inForce(conditions, edition, options)) {
    if (rules.immobile !== true) continue;
    addOnce(sources, source);
    value = 0;
  }
  return { value, sources };
}

/**
 * The hit point maximum under exhaustion: 2014 halves it from level 4 (round
 * down, never below 1 for a character who has hit points). 2024 leaves it be.
 */
export function conditionMaxHp(
  max: number,
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
  options: ConditionOptions = {},
): { value: number; source?: string } {
  if (edition === '2024') return { value: max };
  const level = exhaustionLevel(conditions, options);
  if (level < 4 || max <= 0) return { value: max };
  return { value: Math.max(1, Math.floor(max / 2)), source: `Exhaustion ${level}` };
}

/** What the conditions in force say about attacks against the character, by line. */
export function attacksAgainst(
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
  options: ConditionOptions = {},
): Array<{ text: string; sources: string[] }> {
  const out: Array<{ text: string; sources: string[] }> = [];
  for (const { source, rules } of inForce(conditions, edition, options)) {
    for (const text of rules.against ?? []) {
      const line = out.find((l) => l.text === text);
      if (line === undefined) out.push({ text, sources: [source] });
      else addOnce(line.sources, source);
    }
  }
  // Beyond 5 ft, Prone's disadvantage cancels another condition's advantage,
  // so the two read as one line (Unconscious brings both).
  const adv = out.find((l) => l.text === ADV_AGAINST);
  const prone = out.find((l) => l.text === PRONE_AGAINST);
  if (adv !== undefined && prone !== undefined) {
    adv.text = 'Attack rolls against you have advantage within 5 ft, a straight roll beyond';
    for (const source of prone.sources) addOnce(adv.sources, source);
    out.splice(out.indexOf(prone), 1);
  }
  return out;
}

/** Damage the conditions in force resist (a Petrified character resists all), named for the condition. */
export function conditionDefenses(
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
  options: ConditionOptions = {},
): Array<{ damageType: string; origin: string }> {
  const out: Array<{ damageType: string; origin: string }> = [];
  for (const { source, rules } of inForce(conditions, edition, options)) {
    for (const damageType of rules.resist ?? []) {
      if (!out.some((d) => d.damageType === damageType && d.origin === source))
        out.push({ damageType, origin: source });
    }
  }
  return out;
}
