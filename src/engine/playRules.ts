/**
 * What effects in play do at the table: the dice and advantage one roll takes
 * (`rollEffects`), and how much of a hit gets through (`damageTaken`). Pure:
 * the sheet asks, shows the answer, and the player can still say otherwise.
 */
import {
  type ActiveCondition,
  type ConditionOptions,
  conditionDefenses,
  type D20Test,
  type Edition,
  testAbility,
} from './conditions';
import type { DerivedSheet, PaidRoll, Reroll, RollFilter } from './types';

/**
 * What paying for a feature's extra takes, as its Use does: pool uses (each
 * with the pool's size, so paying never runs past it) and the turn's reaction.
 * `words` says it as Use's title does: "spends 1 Superiority Dice".
 * `inspiration` spends the character's Inspiration, and `foretold` uses up one
 * of a pool's foretold numbers (Portent's 17), as well as its use.
 */
export interface OfferPay {
  spends: ReadonlyArray<{ key: string; max: number; amount: number }>;
  reaction: boolean;
  words: string;
  inspiration?: boolean;
  foretold?: { key: string; v: number };
}

/** What effects in play bring to one d20 test, each named for its effect. */
export interface RollEffects {
  /** Dice that roll in with the d20: Bless's d4. */
  dice: Array<{ dice: string; source: string; effectId?: string }>;
  /**
   * Dice offered once the roll is seen: Guidance, Bardic Inspiration. `once`
   * spends the effect; `ifFailed` keeps the die when it does not turn a
   * failure into a success (2024 Bardic Inspiration).
   */
  offers: Array<{
    dice: string;
    source: string;
    effectId?: string;
    once: boolean;
    ifFailed: boolean;
    /**
     * A feature's own extra, priced (`PaidRoll`): what adding it pays, when it
     * holds, whether only once the d20 shows, and whether a roll that still
     * fails gives the use back when it is taken off.
     */
    pay?: OfferPay;
    when?: string;
    after?: boolean;
    spentOnSuccess?: boolean;
  }>;
  /** Sources of advantage, which reach the roll as a feature's do (`advantageFrom`). */
  advantage: string[];
  disadvantage: string[];
  /**
   * What the player may say holds for this roll, which the app cannot see:
   * flanking, under the table's rule, on a melee attack. Said, it brings
   * advantage (`mode`) or a bonus to hit. `when` says when it holds.
   */
  declare?: Array<{
    source: string;
    mode?: 'adv';
    bonus?: number;
    when: string;
    /** Paid for as the feature's Use is (2024 Lucky's Luck Point), as the roll lands. */
    pay?: OfferPay;
  }>;
  /**
   * What the character's own features add when paid for (`PaidRoll`), once a
   * source, before the sheet prices them against what is left and turns them
   * into offers and claims (`pricedRollEffects`).
   */
  paid?: Array<{ source: string } & Omit<PaidRoll, 'bonus'> & { bonus?: number }>;
  /**
   * Rerolls and sets the character's own features give (`Reroll`), once a
   * source. An `auto` one is made as the d20 lands, and a `floor` always is
   * (Indomitable Might); the rest wait for the sheet to price them into
   * `rerollOffers`, and with no price they offer nothing.
   */
  rerolls?: Array<{ source: string } & Omit<Reroll, 'floorScore'> & { floor?: number }>;
  /** Rerolls and sets the result offers, priced as each feature's Use is (`pricedRollEffects`). */
  rerollOffers?: Array<{
    source: string;
    die: 'all' | 'one' | 'extra';
    atMost?: number;
    /** A set, not a reroll: the kept d20 counts as this (`Reroll.to`). */
    to?: number;
    ifFailed: boolean;
    bonus?: number;
    pay?: OfferPay;
    when?: string;
  }>;
  /**
   * Numbers a long rest foretold (Portent), any of which the prompt may put in
   * place of the d20 before the roll, each priced: the pool's use and the
   * number itself. Only the sheet sets these (`pricedRollEffects`).
   */
  foretold?: Array<{ source: string; v: number; pay: OfferPay }>;
  /** The kind of roll the test is (initiative is a check), which its roll carries. */
  test?: RollFilter['rolls'][number];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Does an effect's filter reach this test? Initiative is a Dexterity check, a
 * death save a save with no ability. Abilities narrow every roll; skills, or
 * any skill, narrow checks, and so does a skill the character is proficient
 * in; and attack type, range and a spell's class narrow attacks. A filter that asks what the test does not say (a skill, an
 * attack's range) does not reach it. One for initiative alone reaches no other
 * check, and one for a death or concentration save no other save.
 */
export function filterReaches(on: RollFilter, test: D20Test): boolean {
  const kind = test.kind === 'initiative' ? 'check' : test.kind;
  if (!on.rolls.includes(kind)) return false;
  if (on.initiative === true && test.kind !== 'initiative') return false;
  if (on.save !== undefined && (test.kind !== 'save' || test.purpose !== on.save)) return false;
  if (on.abilities !== undefined) {
    const ability = testAbility(test);
    if (ability === undefined || !on.abilities.includes(ability)) return false;
  }
  if ((on.skills !== undefined || on.skilled === true) && kind === 'check') {
    const skill = test.kind === 'check' ? test.skill : undefined;
    if (skill === undefined) return false;
    if (on.skills !== undefined && !on.skills.some((s) => same(s, skill))) return false;
  }
  if (on.proficient === true && (test.kind !== 'check' || test.proficient !== true)) return false;
  if (test.kind === 'attack') {
    if (on.attack !== undefined && test.attack !== on.attack) return false;
    if (on.range !== undefined && test.range !== on.range) return false;
  }
  if (on.className !== undefined) {
    const className = test.kind === 'attack' ? test.className : undefined;
    if (className === undefined || !same(className, on.className)) return false;
  }
  return true;
}

/** When flanking holds, said in the roll prompt (2014 DMG, optional rule). */
const FLANKING_WHEN = 'Only with an ally next to the target, on its opposite side';

/**
 * The dice, offers and advantage the effects in play bring to one d20 test,
 * and flanking on a melee attack when the table plays with it (`sheet.rules`).
 * An advantage that holds only sometimes (`when`: Brave against being
 * Frightened) is offered to declare, as flanking is, once a source. A death
 * save is never against a threat, so it takes only those that name it, and
 * the same goes for what a feature adds when paid for (`paid`).
 */
export function rollEffects(
  sheet: Pick<DerivedSheet, 'rollRiders' | 'rules'>,
  test: D20Test,
): RollEffects {
  const out: RollEffects = {
    dice: [],
    offers: [],
    advantage: [],
    disadvantage: [],
    test: test.kind === 'initiative' ? 'check' : test.kind,
  };
  const flanking = sheet.rules?.flanking ?? 'off';
  if (flanking !== 'off' && test.kind === 'attack' && test.range === 'melee') {
    out.declare = [
      {
        source: 'Flanking',
        ...(flanking === 'advantage' ? { mode: 'adv' as const } : { bonus: 2 }),
        when: FLANKING_WHEN,
      },
    ];
  }
  for (const r of sheet.rollRiders) {
    if (!filterReaches(r.on, test)) continue;
    const id = r.effectId === undefined ? {} : { effectId: r.effectId };
    if (r.kind === 'die') out.dice.push({ dice: r.dice, source: r.origin, ...id });
    else if (r.kind === 'offer')
      out.offers.push({
        dice: r.dice,
        source: r.origin,
        ...id,
        once: r.once === true,
        ifFailed: r.ifFailed === true,
      });
    else if (r.kind === 'paid') {
      if (test.kind === 'save' && test.purpose === 'death' && r.on.save !== 'death') continue;
      // Initiative has no failure to turn into a success (Tactical Mind).
      if (test.kind === 'initiative' && r.ifFailed === true) continue;
      const paid = out.paid ?? [];
      if (paid.some((p) => same(p.source, r.origin))) continue;
      const { kind: _kind, on: _on, origin, effectId: _effectId, ...rest } = r;
      paid.push({ source: origin, ...rest });
      out.paid = paid;
    } else if (r.kind === 'reroll') {
      if (test.kind === 'initiative' && r.ifFailed === true) continue;
      // Once a source and die: a 2014 halfling's Lucky trait and the Lucky feat share a name.
      const rerolls = out.rerolls ?? [];
      if (
        rerolls.some(
          (p) =>
            same(p.source, r.origin) && p.die === r.die && p.to === r.to && p.floor === r.floor,
        )
      )
        continue;
      const { kind: _kind, on: _on, origin, effectId: _effectId, ...rest } = r;
      rerolls.push({ source: origin, ...rest });
      out.rerolls = rerolls;
    } else if (r.when !== undefined) {
      // Only advantage is declared; no table or reader gives a disadvantage a `when`.
      if (r.mode !== 'adv') continue;
      if (test.kind === 'save' && test.purpose === 'death' && r.on.save !== 'death') continue;
      const declare = out.declare ?? [];
      if (!declare.some((d) => same(d.source, r.origin)))
        declare.push({ source: r.origin, mode: 'adv', when: r.when });
      out.declare = declare;
    } else {
      const list = r.mode === 'adv' ? out.advantage : out.disadvantage;
      if (!list.includes(r.origin)) list.push(r.origin);
    }
  }
  return out;
}

/** What the character resists, is immune to and is vulnerable to, each named for its source. */
export interface Defenses {
  /** A `note` says when it holds (Stoneskin: nonmagical): the sheet asks, then passes only what holds. */
  resist: ReadonlyArray<{ damageType: string; origin: string; note?: string }>;
  immune: ReadonlyArray<{ damageType: string; origin: string; note?: string }>;
  vulnerable: ReadonlyArray<{ damageType: string; origin: string }>;
}

/** The sheet's defenses and the conditions' together: a Petrified character resists all. */
export function defensesInForce(
  sheet: Pick<DerivedSheet, 'resists' | 'immunities' | 'vulnerabilities' | 'conditionImmunities'>,
  conditions: ReadonlyArray<ActiveCondition>,
  edition: Edition,
): Defenses {
  const options: ConditionOptions = { immune: sheet.conditionImmunities };
  return {
    resist: [...sheet.resists, ...conditionDefenses(conditions, edition, options)],
    immune: sheet.immunities,
    vulnerable: sheet.vulnerabilities,
  };
}

/** Damage of one type in a hit, as rolled. No type is damage nothing names. */
export interface DamageHit {
  amount: number;
  type?: string;
}

export interface DamageOptions {
  /** A successful save that halves the damage. */
  half?: boolean;
  /**
   * A flat reduction to the hit (Heavy Armor Master), once across the types it
   * names, or across every type when it names none.
   */
  reduce?: { amount: number; types?: readonly string[]; source: string };
}

/** One thing that changed a type's damage, in the order applied, for the sentence that says why. */
export type DamageStep =
  | { kind: 'immune'; sources: string[] }
  | { kind: 'half'; to: number }
  | { kind: 'reduced'; by: number; to: number; source: string }
  | { kind: 'resisted'; to: number; sources: string[] }
  | { kind: 'vulnerable'; to: number; sources: string[] };

export interface DamageTaken {
  /** What reaches the character: temporary hit points take it first, then hit points. */
  total: number;
  parts: Array<{ type?: string; rolled: number; taken: number; steps: DamageStep[] }>;
}

/** Does a defense of this type cover damage of that one? "all" covers everything, even untyped. */
const covers = (defense: string, type: string | undefined) =>
  same(defense, 'all') || (type !== undefined && same(defense, type));

const sourcesFor = (
  list: ReadonlyArray<{ damageType: string; origin: string }>,
  type: string | undefined,
) => [...new Set(list.filter((d) => covers(d.damageType, type)).map((d) => d.origin))];

/**
 * How much of one hit gets through, type by type: immunity stops a type
 * outright; otherwise half on a save, then a flat reduction, then resistance,
 * then vulnerability, each once however many sources give it, and every halving
 * rounds down (15 resisted is 7, and vulnerable too is 14). Parts of one type
 * are one instance of damage, so they are added before anything applies. The
 * reduction is the hit's, not each type's: what is left of it after one type
 * moves on to the next it names, in the order given.
 */
export function damageTaken(
  hits: readonly DamageHit[],
  defenses: Defenses,
  options: DamageOptions = {},
): DamageTaken {
  const byType: Array<{ type?: string; rolled: number }> = [];
  for (const hit of hits) {
    if (!Number.isFinite(hit.amount)) continue;
    const amount = Math.max(0, Math.floor(hit.amount));
    const type = hit.type?.trim() === '' ? undefined : hit.type?.trim();
    const entry = byType.find((e) =>
      e.type === undefined || type === undefined ? e.type === type : same(e.type, type),
    );
    if (entry !== undefined) entry.rolled += amount;
    else byType.push({ ...(type === undefined ? {} : { type }), rolled: amount });
  }

  const reduce = options.reduce;
  const reaches = (type: string | undefined) =>
    reduce !== undefined &&
    (reduce.types === undefined ||
      reduce.types.length === 0 ||
      (type !== undefined && reduce.types.some((t) => same(t, type))));
  let reductionLeft = Math.max(0, reduce?.amount ?? 0);

  const parts: DamageTaken['parts'] = [];
  for (const { type, rolled } of byType) {
    const steps: DamageStep[] = [];
    const immune = sourcesFor(defenses.immune, type);
    let value = rolled;
    if (immune.length > 0) {
      steps.push({ kind: 'immune', sources: immune });
      value = 0;
    } else {
      if (options.half === true) {
        value = Math.floor(value / 2);
        steps.push({ kind: 'half', to: value });
      }
      if (reduce !== undefined && reductionLeft > 0 && value > 0 && reaches(type)) {
        const by = Math.min(value, reductionLeft);
        reductionLeft -= by;
        value -= by;
        steps.push({ kind: 'reduced', by, to: value, source: reduce.source });
      }
      const resisted = sourcesFor(defenses.resist, type);
      if (resisted.length > 0) {
        value = Math.floor(value / 2);
        steps.push({ kind: 'resisted', to: value, sources: resisted });
      }
      const vulnerable = sourcesFor(defenses.vulnerable, type);
      if (vulnerable.length > 0) {
        value *= 2;
        steps.push({ kind: 'vulnerable', to: value, sources: vulnerable });
      }
    }
    parts.push({ ...(type === undefined ? {} : { type }), rolled, taken: value, steps });
  }
  return { total: parts.reduce((n, p) => n + p.taken, 0), parts };
}
