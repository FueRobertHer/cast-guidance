import { useState } from 'react';
import { roll } from '@/dice/roll';
import type { RollResult } from '@/dice/types';
import { type D20Effects, type D20Resolution, noD20Effect, resolveD20 } from '@/engine/conditions';
import type { Ability } from '@/engine/types';
import { currentAdvantage } from '@/stores/advMode';

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
    const sources = [...e.advantage, ...e.disadvantage];
    // The dock's mode can be the other half of the pair.
    parts.push(
      sources.length > 0
        ? `Advantage and disadvantage cancel: ${names(sources)}`
        : 'Advantage and disadvantage cancel',
    );
  } else if (r.advantage === 'adv' && e.advantage.length > 0) {
    parts.push(`Advantage: ${names(e.advantage)}`);
  } else if (r.advantage === 'dis' && e.disadvantage.length > 0) {
    parts.push(`Disadvantage: ${names(e.disadvantage)}`);
  }
  if (e.penalty !== undefined) parts.push(`${minus(e.penalty.amount)}: ${e.penalty.source}`);
  return parts.join(' · ');
}

const NO_EFFECTS: D20Effects = { advantage: [], disadvantage: [], autoFail: [], notes: [] };

/**
 * Rolls a d20 test (`expr` leads with 1d20) under the dock's mode and the
 * conditions' effects: advantage and disadvantage combine and cancel, the
 * 2024 exhaustion penalty is a term of its own, and an automatic failure is
 * marked on the result, never hidden: the dice still show. `ignored` is the
 * player's override for this one roll, which leaves the dock's mode, and a
 * feature's advantage (`advantageFrom`: War Caster, Durable), which is not a
 * condition's to ignore.
 */
export function rollD20Test(
  expr: string,
  {
    label,
    effects,
    ignored = false,
    advantageFrom = [],
  }: {
    label: string;
    effects?: D20Effects;
    ignored?: boolean;
    advantageFrom?: readonly string[];
  },
): RollResult {
  const conditionsApply = effects !== undefined && !noD20Effect(effects);
  const kept = ignored || effects === undefined ? NO_EFFECTS : effects;
  const used = { ...kept, advantage: [...kept.advantage, ...advantageFrom] };
  const resolution = resolveD20(currentAdvantage(), used);
  const full = resolution.penalty !== 0 ? `${expr}${resolution.penalty}` : expr;
  const result = roll(full, { label, advantage: resolution.advantage });
  const cue = [
    ignored && conditionsApply ? 'Conditions ignored for this roll' : '',
    rollCue(used, resolution),
  ]
    .filter((part) => part !== '')
    .join(' · ');
  if (cue === '') return result;
  return {
    ...result,
    meta: { ...result.meta, cue, ...(resolution.autoFail ? { autoFail: true } : {}) },
  };
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
     * Whether the group was armed, disarming it: call as its roll is made.
     * A roll no condition reaches (a WIS save under Restrained) leaves it
     * armed for the one that is.
     */
    take: (group: RollGroup, effects: D20Effects): boolean => {
      if (!armed.has(group) || noD20Effect(effects)) return false;
      setState({ key: conditionsKey, armed: without(group) });
      return true;
    },
  };
}
