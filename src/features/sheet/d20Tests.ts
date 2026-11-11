import { useState } from 'react';
import { canReroll, rerollD20 } from '@/dice/reroll';
import { cryptoRng, roll } from '@/dice/roll';
import type { RollOffer, RollResult } from '@/dice/types';
import {
  type ActiveCondition,
  type D20Effects,
  type D20Resolution,
  noD20Effect,
  resolveD20,
} from '@/engine/conditions';
import type { OfferPay, RollEffects } from '@/engine/playRules';
import type { Ability } from '@/engine/types';
import { signed } from '@/lib/signed';
import { namedFirst, whenLanded } from '@/stores/heldRoll';
import { rollOffersStore } from '@/stores/rollOffers';
import { type ChipLook, type ChipWear, isChipLook } from '@/ui/ChipFace';

/**
 * The sheet's d20 tests under the character's conditions: the words a cue
 * and a roll result use, the roll itself, and the one-roll override. The
 * rules are the engine's (`engine/conditions.ts`); this is how they read.
 */

const names = (sources: readonly string[]) => sources.join(', ');

/** A penalty as the sheet prints a modifier: a true minus sign. */
const minus = (amount: number) => `−${Math.abs(amount)}`;

/**
 * An effect line per kind, for a cue: "Disadvantage: Poisoned", "−4:
 * Exhaustion 2". `advantageFrom` is a feature's advantage on these rolls (War
 * Caster, Durable), named beside the conditions it can cancel so the cue
 * says what the roll will do; on its own it is no cue.
 */
export function effectLines(
  conditions: D20Effects,
  advantageFrom: readonly string[] = [],
): string[] {
  if (noD20Effect(conditions)) return [];
  const e = { ...conditions, advantage: [...conditions.advantage, ...advantageFrom] };
  const lines: string[] = [];
  if (e.autoFail.length > 0) lines.push(`Fails automatically: ${names(e.autoFail)}`);
  if (e.advantage.length > 0 && e.disadvantage.length > 0) {
    lines.push(
      `Advantage (${names(e.advantage)}) and disadvantage (${names(e.disadvantage)}) cancel`,
    );
  } else if (e.advantage.length > 0) {
    lines.push(`Advantage: ${names(e.advantage)}`);
  } else if (e.disadvantage.length > 0) {
    lines.push(`Disadvantage: ${names(e.disadvantage)}`);
  }
  if (e.penalty !== undefined) lines.push(`${minus(e.penalty.amount)}: ${e.penalty.source}`);
  return lines;
}

/** Notes as a cue shows them: "Blinded: you fail checks that need sight". */
export function noteLines(e: D20Effects): string[] {
  return e.notes.map((n) => `${n.source}: ${n.text}`);
}

/** "STR", "STR and DEX", "STR, DEX and CON". */
function abilityList(abilities: readonly Ability[]): string {
  const caps = abilities.map((a) => a.toUpperCase());
  return caps.length < 2 ? caps.join('') : `${caps.slice(0, -1).join(', ')} and ${caps.at(-1)}`;
}

/**
 * The cue for the six saves, whose effects differ by ability: a source that
 * reaches every save reads as a plain line ("Disadvantage: Exhaustion 3"),
 * one that reaches some names them ("STR and DEX saves fail automatically:
 * Stunned", "Disadvantage on DEX saves: Restrained").
 */
export function saveEffectLines(per: Readonly<Record<Ability, D20Effects>>): string[] {
  const abilities = Object.keys(per) as Ability[];
  const grouped = (pick: (e: D20Effects) => readonly string[]) => {
    // Sources, then the abilities each reaches, grouped by the same abilities.
    const reach = new Map<string, Ability[]>();
    for (const a of abilities) {
      for (const source of pick(per[a])) reach.set(source, [...(reach.get(source) ?? []), a]);
    }
    const groups = new Map<string, { abilities: Ability[]; sources: string[] }>();
    for (const [source, list] of reach) {
      const key = list.join();
      const group = groups.get(key) ?? { abilities: list, sources: [] };
      group.sources.push(source);
      groups.set(key, group);
    }
    return [...groups.values()].map((g) => ({
      ...g,
      every: g.abilities.length === abilities.length,
    }));
  };
  const lines: string[] = [];
  for (const g of grouped((e) => e.autoFail)) {
    lines.push(
      g.every
        ? `Fails automatically: ${names(g.sources)}`
        : `${abilityList(g.abilities)} saves fail automatically: ${names(g.sources)}`,
    );
  }
  for (const [word, pick] of [
    ['Advantage', (e: D20Effects) => e.advantage],
    ['Disadvantage', (e: D20Effects) => e.disadvantage],
  ] as const) {
    for (const g of grouped(pick)) {
      lines.push(
        g.every
          ? `${word}: ${names(g.sources)}`
          : `${word} on ${abilityList(g.abilities)} saves: ${names(g.sources)}`,
      );
    }
  }
  const penalty = abilities.map((a) => per[a].penalty).find((p) => p !== undefined);
  if (penalty !== undefined) lines.push(`${minus(penalty.amount)}: ${penalty.source}`);
  return lines;
}

/** What the conditions did to one roll, for its result. */
function rollCue(e: D20Effects, r: D20Resolution): string {
  const parts: string[] = [];
  if (r.autoFail) parts.push(`Fails automatically: ${names(e.autoFail)}`);
  if (r.cancelled) {
    parts.push(`Advantage and disadvantage cancel: ${names([...e.advantage, ...e.disadvantage])}`);
  } else if (r.advantage === 'adv' && e.advantage.length > 0) {
    parts.push(`Advantage: ${names(e.advantage)}`);
  } else if (r.advantage === 'dis' && e.disadvantage.length > 0) {
    parts.push(`Disadvantage: ${names(e.disadvantage)}`);
  }
  if (e.penalty !== undefined) parts.push(`${minus(e.penalty.amount)}: ${e.penalty.source}`);
  return parts.join(' · ');
}

const NO_EFFECTS: D20Effects = { advantage: [], disadvantage: [], autoFail: [], notes: [] };

/** A d20 test's mode, as the roll prompt offers it. */
export type RollMode = 'dis' | 'normal' | 'adv';

/** What the roll prompt chose for one roll. Anything left out is as the sheet set it. */
export interface D20Choice {
  mode?: RollMode;
  /** Per `rollsIn`: false leaves that die out of this roll. */
  rollsIn?: readonly boolean[];
  /** Per `once`: true adds that one-use die before the d20 is rolled. */
  named?: readonly boolean[];
  /**
   * The table's house rule (`lib/oneUseDice`, "before"): a one-use die not
   * added in the prompt is not offered after the roll either.
   */
  dropUnnamed?: boolean;
  /** Per `thisTurn`: true declares it for the turn. */
  declared?: readonly boolean[];
  /** Which of `foretold` is the d20 (Portent's 17), in place of rolling it. */
  foretold?: number;
}

/**
 * What the roll prompt offers to declare for the rest of the turn (Reckless
 * Attack, on the turn's first attack). Declared, its mode counts on this roll
 * as an effect's does and its cost is said by Roll; as the roll lands,
 * `declare` puts it in play, where it reaches the turn's later rolls itself.
 * One that holds for this roll alone (`thisRoll`: flanking, a table rule the
 * app cannot see) puts nothing in play, and may add a bonus instead of a mode.
 */
export interface TurnExtra {
  source: string;
  mode?: 'adv' | 'dis';
  /** Declared, what it adds to this roll (flanking's +2 under the table's rule). */
  bonus?: number;
  /** What declaring it costs, in words; for one that holds for this roll alone, when it holds. */
  cost: string;
  declare: () => void;
  /**
   * Paid for as the roll is made, before the d20 (2024 Lucky's Luck Point):
   * false, with nothing left to pay with, leaves it out of the roll.
   */
  paid?: () => boolean;
  /** It holds for this roll alone, not the rest of the turn. */
  thisRoll?: boolean;
}

/**
 * A sheet's d20 test before its d20 is rolled: what the roll prompt shows and
 * presets, and `roll`, which makes it under what the prompt chose.
 */
export interface D20Ask {
  readonly kind: 'ask';
  label: string;
  /** The mode the sheet sets: the conditions', features' and effects' combined. */
  preset: RollMode;
  /** Dice that roll in unless the prompt takes them out (Bless). */
  rollsIn: ReadonlyArray<{ dice: string; source: string }>;
  /** One-use dice the prompt offers before the roll (2014 Guidance and Bardic Inspiration). */
  once: readonly RollOffer[];
  /**
   * What the prompt offers to declare for the turn (Reckless Attack), then
   * what may hold for this roll alone (flanking, from `riders.declare`).
   */
  thisTurn: readonly TurnExtra[];
  /**
   * Numbers foretold that may be the d20 instead of a roll (Portent), each with
   * what using it pays. One chosen, no d20 is rolled, so the mode counts for nothing.
   */
  foretold: ReadonlyArray<{ source: string; v: number; pay: OfferPay }>;
  /** An attack, which a natural 1 or 20 settles. */
  attack: boolean;
  /** A condition makes it fail whatever the d20 shows. */
  autoFail: boolean;
  /** Conditions reach it and are not ignored: a mode other than the preset sets them aside. */
  conditions: boolean;
  /** The mode the sheet sets with what `choice` declares counted: `preset` when it declares nothing. */
  presetFor(choice?: D20Choice): RollMode;
  /**
   * What the roll will carry as its cue in this mode, with what `choice`
   * declares, '' when nothing: the prompt's why line.
   */
  cueFor(mode: RollMode, choice?: D20Choice): string;
  /** The roll in words before it is made: "d20 +7 + d4 Bless, disadvantage". */
  formula(choice?: D20Choice): string;
  roll(choice?: D20Choice): RollResult;
}

/** "1d8" as a chip says it: "d8". */
const dieWord = (dice: string) => dice.replace(/^1d/, 'd');

/** "spends 1 Luck Points" as a sentence starts. */
const capitalized = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/**
 * What the roll's cue says when the prompt chose a mode the sheet did not set:
 * advantage or disadvantage chosen, or the sheet's set aside for this roll.
 */
function chosenCue(mode: RollMode, preset: RollMode, e: D20Effects): string {
  if (mode === 'adv' || mode === 'dis') {
    const word = mode === 'adv' ? 'Advantage' : 'Disadvantage';
    const over = mode === 'adv' ? e.disadvantage : e.advantage;
    return over.length > 0
      ? `${word} chosen for this roll, over ${names(over)}`
      : `${word} chosen for this roll`;
  }
  const word = preset === 'adv' ? 'Advantage' : 'Disadvantage';
  const sources = preset === 'adv' ? e.advantage : e.disadvantage;
  return sources.length > 0
    ? `${word} set aside for this roll: ${names(sources)}`
    : `${word} set aside for this roll`;
}

/**
 * A d20 test (`expr` leads with 1d20) under the conditions' effects, asked before it is rolled: the roll prompt shows what
 * the sheet sets and why, and `roll` makes it under what the prompt chose.
 * Advantage and disadvantage combine and cancel, the 2024 exhaustion penalty
 * is a term of its own, and an automatic failure is marked on the result,
 * never hidden: the dice still show. `ignored` is the player's override for
 * this one roll, which leaves a feature's advantage (`advantageFrom`: War
 * Caster, Durable), which is not a condition's to ignore.
 * A mode the prompt picks over the sheet's is the last word on advantage, and
 * the cue says what it set aside.
 *
 * `riders` is what effects in play bring (`rollEffects`): their dice roll in
 * (Bless, named in the working) unless the prompt takes them out, their
 * advantage and disadvantage count as a feature's do, and the dice they offer
 * ride on the result for the toast. The one-use dice among them (2014 Guidance
 * and Bardic) are offered in the prompt too: one added there rolls in and is
 * spent, and the rest come back after the roll unless the table's house rule
 * says otherwise (`dropUnnamed`). Nothing is offered after a roll nothing could
 * change: an automatic failure, or a natural 1 or 20 on a roll the natural
 * settles (`settlesOnNatural`: attacks and death saves), or an attack's crit.
 *
 * `thisTurn` is what the prompt offers to declare for the turn (Reckless
 * Attack): declared, its advantage counts as an effect's does, so the preset
 * and the cue follow it (`presetFor`), and it goes in play as the roll lands.
 * What the riders say may hold for this roll (`declare`: flanking) joins it,
 * declared the same way: its advantage counts, or its bonus is added.
 *
 * `attack` marks an attack roll with whose it is and whether it crit (the kept
 * d20 at `critFrom` or above), which the damage that goes with it reads.
 */
export function d20Ask(
  expr: string,
  {
    label,
    effects,
    ignored = false,
    advantageFrom = [],
    riders,
    settlesOnNatural = false,
    attack,
    thisTurn = [],
  }: {
    label: string;
    effects?: D20Effects;
    ignored?: boolean;
    advantageFrom?: readonly string[];
    riders?: RollEffects;
    settlesOnNatural?: boolean;
    thisTurn?: readonly TurnExtra[];
    /**
     * An attack roll: the character's id, the attack's name, and the lowest
     * natural that crits (20 unless an effect lowers it).
     */
    attack?: { by: string; of: string; critFrom?: number | undefined };
  },
): D20Ask {
  const extras: readonly TurnExtra[] = [
    ...thisTurn,
    ...(riders?.declare ?? []).map((d): TurnExtra => {
      const { pay } = d;
      return {
        source: d.source,
        ...(d.mode === undefined ? {} : { mode: d.mode }),
        ...(d.bonus === undefined ? {} : { bonus: d.bonus }),
        // A paid claim (2024 Lucky) says its price, then when it holds.
        cost:
          pay === undefined
            ? d.when
            : [capitalized(pay.words), d.when].filter((w) => w !== '').join('. '),
        declare: () => undefined,
        // Paid as the roll is made, as the feature's Use would be.
        ...(pay === undefined
          ? {}
          : {
              paid: () =>
                rollOffersStore.getState().pay?.({ source: d.source, pay }, true) ?? false,
            }),
        thisRoll: true,
      };
    }),
  ];
  /** The bonuses `choice` declares (flanking's +2), each named for what gives it. */
  const bonusesFor = (choice: D20Choice | undefined) =>
    extras.filter(
      (t, i): t is TurnExtra & { bonus: number } =>
        choice?.declared?.[i] === true && t.bonus !== undefined && t.bonus !== 0,
    );
  const conditionsApply = effects !== undefined && !noD20Effect(effects);
  const kept = ignored || effects === undefined ? NO_EFFECTS : effects;
  const used = {
    ...kept,
    advantage: [...kept.advantage, ...advantageFrom, ...(riders?.advantage ?? [])],
    disadvantage: [...kept.disadvantage, ...(riders?.disadvantage ?? [])],
  };
  const resolution = resolveD20(used);
  const preset: RollMode = resolution.advantage ?? 'normal';
  /** The effects and how they resolve with what `choice` declares for the turn counted. */
  const under = (choice: D20Choice | undefined) => {
    const declared = extras.filter((_, i) => choice?.declared?.[i] === true);
    if (declared.length === 0) return { used, resolution };
    const sources = (mode: TurnExtra['mode']) =>
      declared.filter((d) => d.mode === mode).map((d) => d.source);
    const withDeclared = {
      ...used,
      advantage: [...used.advantage, ...sources('adv')],
      disadvantage: [...used.disadvantage, ...sources('dis')],
    };
    return { used: withDeclared, resolution: resolveD20(withDeclared) };
  };
  const presetFor = (choice?: D20Choice): RollMode =>
    under(choice).resolution.advantage ?? 'normal';
  const rollsIn = riders?.dice ?? [];
  const offers = riders?.offers ?? [];
  // Offered before the roll: only an automatic failure, which the cue says, asks nothing.
  const once = resolution.autoFail ? [] : offers.filter(namedFirst);
  const foretold = resolution.autoFail ? [] : (riders?.foretold ?? []);
  /** The foretold number `choice` puts in place of the d20, if any. */
  const toldFor = (choice: D20Choice | undefined) =>
    choice?.foretold === undefined ? undefined : foretold[choice.foretold];
  const ignoredWords = ignored && conditionsApply ? 'Conditions ignored for this roll' : '';
  const cueFor = (mode: RollMode, choice?: D20Choice) => {
    const now = under(choice);
    const set = now.resolution.advantage ?? 'normal';
    const parts = [ignoredWords];
    const told = toldFor(choice);
    if (told !== undefined) {
      // No d20 is rolled, so no mode counts; what else the roll takes still does.
      const shown = mode !== 'normal' ? mode : set;
      if (shown !== 'normal') {
        const word = shown === 'adv' ? 'Advantage' : 'Disadvantage';
        parts.push(`${word} does not count: ${told.source} foretold the d20`);
      }
      if (used.penalty !== undefined) {
        parts.push(`${minus(used.penalty.amount)}: ${used.penalty.source}`);
      }
    } else if (mode === set) parts.push(rollCue(now.used, now.resolution));
    else {
      if (resolution.autoFail) parts.push(`Fails automatically: ${names(used.autoFail)}`);
      parts.push(chosenCue(mode, set, now.used));
      if (used.penalty !== undefined) {
        parts.push(`${minus(used.penalty.amount)}: ${used.penalty.source}`);
      }
    }
    for (const b of bonusesFor(choice)) parts.push(`${signed(b.bonus)}: ${b.source}`);
    return parts.filter((part) => part !== '').join(' · ');
  };
  /** The dice that roll in this time, in order: the effects' left in, then the one-use dice added. */
  const diceFor = (choice: D20Choice | undefined) => [
    ...rollsIn.filter((_, i) => choice?.rollsIn?.[i] !== false),
    ...once.filter((_, i) => choice?.named?.[i] === true),
  ];
  const modifier = expr.replace(/^1d20/, '');
  return {
    kind: 'ask',
    label,
    preset,
    rollsIn,
    once,
    thisTurn: extras,
    foretold,
    attack: settlesOnNatural,
    autoFail: resolution.autoFail,
    conditions: conditionsApply && !ignored,
    presetFor,
    cueFor,
    formula: (choice) => {
      const mode = choice?.mode ?? presetFor(choice);
      const dice = [
        ...diceFor(choice).map((d) => ` + ${dieWord(d.dice)} ${d.source}`),
        ...bonusesFor(choice).map((b) => ` ${signed(b.bonus)} ${b.source}`),
      ].join('');
      const penalty = resolution.penalty !== 0 ? ` ${minus(resolution.penalty)}` : '';
      const told = toldFor(choice);
      // A foretold d20 is the number, with no mode: "17 Portent +7".
      if (told !== undefined) {
        return `${told.v} ${told.source}${modifier === '' ? '' : ` ${modifier}`}${dice}${penalty}`;
      }
      const words = mode === 'adv' ? ', advantage' : mode === 'dis' ? ', disadvantage' : '';
      return `d20${modifier === '' ? '' : ` ${modifier}`}${dice}${penalty}${words}`;
    },
    roll: (choice) => {
      const told = toldFor(choice);
      const mode = told !== undefined ? 'normal' : (choice?.mode ?? presetFor(choice));
      const advantage = mode === 'normal' ? undefined : mode;
      // The effects' dice follow the modifiers, ahead of the exhaustion penalty.
      const dice = diceFor(choice);
      const withDice = [
        ...dice.map((d) => `+${d.dice}`),
        ...bonusesFor(choice).map((b) => (b.bonus < 0 ? `${b.bonus}` : `+${b.bonus}`)),
      ].reduce((e, term) => `${e}${term}`, expr);
      const full = resolution.penalty !== 0 ? `${withDice}${resolution.penalty}` : withDice;
      // What rerolls as the d20 lands (Halfling Luck's 1, Elven Accuracy), then what
      // sets it (Reliable Talent's 10), then a floor (Indomitable Might): never worse.
      const step = (r: { to?: number; floor?: number }) =>
        r.floor !== undefined ? 2 : r.to !== undefined ? 1 : 0;
      const made = (riders?.rerolls ?? [])
        .filter((r) => r.auto === true || r.floor !== undefined)
        .sort((a, b) => step(a) - step(b));
      // A foretold number is the d20, as if rolled (a 20 crits); the effects' dice still roll.
      let first = told !== undefined;
      const rng = (sides: number) => {
        if (first && sides === 20 && told !== undefined) {
          first = false;
          return told.v;
        }
        return cryptoRng(sides);
      };
      const rolled = roll(full, {
        label,
        advantage,
        kind: 'd20',
        ...(told !== undefined ? { rng } : {}),
      });
      const base: RollResult =
        told === undefined
          ? rolled
          : { ...rolled, meta: { ...rolled.meta, foretold: told.source } };
      const landed = made.reduce((r, how) => rerollD20(r, how) ?? r, base);
      // A set made as the d20 lands holds for a reroll after it too.
      const holds = made.flatMap((r) =>
        r.to === undefined ? [] : [{ source: r.source, to: r.to }],
      );
      const result: RollResult =
        holds.length > 0 ? { ...landed, meta: { ...landed.meta, holds } } : landed;
      // A d20 test's expression is the d20 and flat modifiers, so every die after
      // the first is an effect's, in order.
      const from: Array<{ term: number; source: string }> = [];
      result.terms.forEach((t, i) => {
        const d = i > 0 && t.kind === 'dice' ? dice[from.length] : undefined;
        if (d !== undefined) from.push({ term: i, source: d.source });
      });
      const natural = result.meta?.d20?.natural;
      // A crit is the kept die in the crit range: a 19 under Hexblade's Curse
      // settles the attack as a natural 20 does.
      const crit =
        attack !== undefined && natural !== undefined && natural >= (attack.critFrom ?? 20);
      const settled =
        resolution.autoFail || (settlesOnNatural && (natural === 1 || natural === 20 || crit));
      const named = once.filter((_, i) => choice?.named?.[i] === true);
      const after = settled
        ? []
        : offers.filter(
            (o) =>
              !named.includes(o) &&
              // The house rule is for an effect's die (2014 Guidance and
              // Bardic); a feature's own (Precision Attack) waits as written.
              !(choice?.dropUnnamed === true && namedFirst(o) && o.pay === undefined),
          );
      // A reroll still helps a natural 1 that missed, never a crit or an automatic failure.
      const rerolls =
        resolution.autoFail || (settlesOnNatural && (natural === 20 || crit))
          ? []
          : (riders?.rerollOffers ?? []).filter((o) => canReroll(result, o));
      const cue = cueFor(mode, choice);
      // The kind of roll, for a natural 20 or 1's moments (`useRollOfferSpending`).
      const test = riders?.test;
      if (
        cue === '' &&
        from.length === 0 &&
        after.length === 0 &&
        rerolls.length === 0 &&
        attack === undefined &&
        test === undefined
      ) {
        return result;
      }
      const critFrom = attack?.critFrom ?? 20;
      return {
        ...result,
        meta: {
          ...result.meta,
          ...(test === undefined ? {} : { test }),
          ...(attack === undefined
            ? {}
            : {
                attack: {
                  by: attack.by,
                  of: attack.of,
                  crit,
                  ...(critFrom < 20 ? { critFrom } : {}),
                },
              }),
          ...(cue === '' ? {} : { cue }),
          ...(resolution.autoFail ? { autoFail: true } : {}),
          ...(from.length > 0 ? { from } : {}),
          ...(after.length > 0 ? { offers: after } : {}),
          ...(rerolls.length > 0 ? { rerolls } : {}),
        },
      };
    },
  };
}

/**
 * A d20 test rolled at once, as the sheet sets it (`d20Ask`): the rolls settled
 * on the spot (a death save, a concentration save), which no prompt asks about.
 */
export function rollD20Test(expr: string, options: Parameters<typeof d20Ask>[1]): RollResult {
  return d20Ask(expr, options).roll();
}

/**
 * What a control wears, read only from the names its own words give (`sources`,
 * from a cue, a warning or the Speed label), so the two can never disagree. A
 * condition reaches it under its own name: an implied one (Unconscious's Prone
 * and Incapacitated) adds no look of its own, and one the rules suppress or the
 * player switched off adds none at all. The newest condition, the last one
 * added, comes first.
 *
 * Cast passes only `noActions`, so a worn Cast always means you can't cast.
 * Speed passes what `conditionSpeed` says changed it.
 */
export function conditionWear(
  conditions: readonly ActiveCondition[],
  sources: readonly string[],
  armed = false,
  penalty?: number,
): ChipWear {
  const reaching = new Set(
    sources.map((source) => (source.startsWith('Exhaustion') ? 'Exhaustion' : source)),
  );
  const looks: ChipLook[] = [];
  for (const { id } of conditions) {
    if (reaching.has(id) && isChipLook(id)) looks.unshift(id);
  }
  return { looks, ignored: armed, ...(penalty === undefined ? {} : { penalty }) };
}

/**
 * What a roll's control wears: every effect its cue says, failing a save
 * included. Notes alone (Charmed, 2024 Grappled) leave it plain. An attack chip
 * adds the "Can't take actions" warning (`noActions`).
 */
export function rollWear(
  conditions: readonly ActiveCondition[],
  effects: D20Effects,
  armed: boolean,
  noActions: readonly string[] = [],
): ChipWear {
  return conditionWear(
    conditions,
    [
      ...effects.advantage,
      ...effects.disadvantage,
      ...effects.autoFail,
      ...(effects.penalty === undefined ? [] : [effects.penalty.source]),
      ...noActions,
    ],
    armed,
    effects.penalty?.amount,
  );
}

/** A set of rolls that share a cue, and so its override. */
export type RollGroup = 'attack' | 'check' | 'save' | 'initiative' | 'death' | 'concentration';

/**
 * The cues' "Ignore once": armed per group, spent by the next roll of that
 * group. Held by the tab, so leaving it drops an armed override, and keyed
 * by the conditions, so changing them drops it too: it was about the
 * effects the cue showed when it was pressed.
 */
export function useIgnoreOnce(conditionsKey: string) {
  const [state, setState] = useState<{ key: string; armed: ReadonlySet<RollGroup> }>({
    key: conditionsKey,
    armed: new Set(),
  });
  const armed = state.key === conditionsKey ? state.armed : new Set<RollGroup>();
  const without = (group: RollGroup) => {
    const next = new Set(armed);
    next.delete(group);
    return next;
  };
  return {
    armed: (group: RollGroup) => armed.has(group),
    toggle: (group: RollGroup) =>
      setState({
        key: conditionsKey,
        armed: armed.has(group) ? without(group) : new Set(armed).add(group),
      }),
    /**
     * Whether the group was armed, disarming it once the roll lands (at once
     * outside `rollFrom`): call as its roll is made.
     * A roll no condition reaches (a WIS save under Restrained) leaves it
     * armed for the one that is.
     */
    take: (group: RollGroup, effects: D20Effects): boolean => {
      if (!armed.has(group) || noD20Effect(effects)) return false;
      // Spent once the roll lands: one that waits and is cancelled spends nothing.
      whenLanded(() =>
        setState((s) => {
          const now = new Set(s.key === conditionsKey ? s.armed : []);
          now.delete(group);
          return { key: conditionsKey, armed: now };
        }),
      );
      return true;
    },
  };
}
