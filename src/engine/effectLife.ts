/**
 * How effects in play begin and end: added (Aid lifts current hit points with
 * the maximum), ended by hand, by a rest or by the turn count, by a new
 * concentration, and the temporary hit points one gives each turn. Like the
 * rest rules, each function changes the play state it is given (a draft) and
 * says what it did, so the sheet can show it. Nothing calls these yet.
 *
 * Entries the app cannot read (written by a newer version) are left exactly as
 * stored, unless ended by id.
 */
import { countingEffects, readActiveEffects } from './activeEffects';
import { type ConditionImmunity, conditionMaxHp, type Edition } from './conditions';
import type { ActiveEffect, PlayState } from './types';

/** What changing effects needs to know of the sheet, to keep current HP within the maximum. */
export interface HpLimits {
  /** `DerivedSheet.maxHp.value`: the maximum with the effects in play now, before conditions. */
  maxHp: number;
  edition: Edition;
  /** `DerivedSheet.conditionImmunities`: an exhaustion held off halves nothing. */
  immune?: ReadonlyArray<ConditionImmunity>;
}

/** What a change to the effects in play did. */
export interface EffectChange {
  /** Effects that ended, by name, in the order they were added. */
  ended: string[];
  /**
   * How far the HP maximum moved (Aid's +5 gone is -5). A rest that refills
   * hit points refills to the maximum plus this, so Aid does not outlive it.
   */
  maxHpChange: number;
}

const isEffect = (e: unknown): e is ActiveEffect =>
  e !== null && typeof e === 'object' && typeof (e as ActiveEffect).id === 'string';

const lower = (s: string) => s.trim().toLowerCase();

/** The effect answers to this name: its own, or the named effect it is. */
function answersTo(e: ActiveEffect, label: string): boolean {
  return [e.name, e.same].some((n) => typeof n === 'string' && lower(n) === lower(label));
}

/** Cast by this character and held by their concentration. */
const heldByMe = (e: ActiveEffect) => e.mine === true && e.lasts?.concentration === true;

/** What the effects in play add to the HP maximum, under the rule that one name counts once. */
export function maxHpFrom(effects: unknown): number {
  const { inputs } = countingEffects(readActiveEffects(effects).effects);
  return inputs.reduce((n, e) => n + (e.kind === 'maxHpBonus' ? e.amount : 0), 0);
}

/** Store the list, deleting it when the last effect goes, as older documents never had one. */
function store(play: PlayState, list: unknown[]): void {
  if (list.length === 0) delete play.activeEffects;
  else play.activeEffects = list as ActiveEffect[];
}

/**
 * Current HP once the maximum moved by `change`, from the maximum `hp` gives:
 * down under a maximum that fell, and, when an effect that raises both was
 * added, up by as much, never past the new maximum in force (2014 exhaustion
 * halves Aid's +5 too).
 */
function settleHp(play: PlayState, change: number, hp: HpLimits, raise: boolean): void {
  if (change === 0) return;
  const floor = hp.maxHp > 0 ? 1 : 0;
  const raw = Math.max(floor, hp.maxHp + change);
  const max = conditionMaxHp(raw, play.conditions, hp.edition, { immune: hp.immune }).value;
  // A maximum still filling itself in (a new character) needs no help.
  if (change > 0 && raise && play.hpInitialized !== false) {
    const wasDown = play.currentHp <= 0;
    play.currentHp += Math.max(0, Math.min(change, max - play.currentHp));
    if (wasDown && play.currentHp > 0) play.deathSaves = { success: 0, fail: 0 };
  }
  if (change < 0 && play.currentHp > max) play.currentHp = max;
}

/**
 * Take every effect `pick` chooses out of play, with what it held: temporary
 * hit points it gave go with it, and ending the effect the character
 * concentrates on ends the concentration. Hit points are the caller's to settle.
 */
function dropWhere(play: PlayState, pick: (e: ActiveEffect) => boolean): ActiveEffect[] {
  const list: unknown[] = play.activeEffects ?? [];
  const ending = list.filter((e): e is ActiveEffect => isEffect(e) && pick(e));
  if (ending.length === 0) return [];
  const kept = list.filter((e) => !ending.includes(e as ActiveEffect));
  store(play, kept);

  if (play.tempHpFrom !== undefined && ending.some((e) => e.id === play.tempHpFrom)) {
    play.tempHp = 0;
    delete play.tempHpFrom;
  }
  const focus = play.concentratingOn?.label;
  if (
    focus !== undefined &&
    ending.some((e) => heldByMe(e) && answersTo(e, focus)) &&
    !kept.some((e) => isEffect(e) && heldByMe(e) && answersTo(e, focus))
  ) {
    delete play.concentratingOn;
  }
  return ending;
}

/** End every effect `pick` chooses, bringing current HP under a maximum that fell. */
function endWhere(play: PlayState, pick: (e: ActiveEffect) => boolean, hp: HpLimits): EffectChange {
  const before = maxHpFrom(play.activeEffects);
  const ending = dropWhere(play, pick);
  const change = maxHpFrom(play.activeEffects) - before;
  settleHp(play, change, hp, false);
  return { ended: ending.map((e) => e.name), maxHpChange: change };
}

/**
 * Put an effect in play, or replace the one with its id. Aid raises current HP
 * with the maximum; a drain brings it down under it. One the character casts
 * with concentration ends their other concentration effects, a recast of the
 * same spell among them, and becomes what they concentrate on.
 */
export function applyEffect(
  play: PlayState,
  effect: ActiveEffect,
  hp: HpLimits,
): EffectChange & { hpGained: number } {
  const added = structuredClone(effect);
  if (added.off !== true) delete added.off;
  if (added.mine !== true) delete added.mine;

  // What ends and what comes in are one change to the maximum, settled once:
  // a recast that ends a casting worth +10 and brings another heals nothing.
  const maxBefore = maxHpFrom(play.activeEffects);
  let ended: ActiveEffect[] = [];
  if (heldByMe(added)) {
    // Read first: ending a recast's earlier casting lets go of the level it held.
    const focus = play.concentratingOn;
    ended = dropWhere(play, (e) => heldByMe(e) && e.id !== added.id);
    play.concentratingOn =
      focus !== undefined && answersTo(added, focus.label) ? focus : { label: added.name };
  }

  const list: unknown[] = play.activeEffects ?? [];
  const at = list.findIndex((e) => isEffect(e) && e.id === added.id);
  store(play, at < 0 ? [...list, added] : list.map((e, i) => (i === at ? added : e)));
  const change = maxHpFrom(play.activeEffects) - maxBefore;
  const hpBefore = play.currentHp;
  settleHp(play, change, hp, true);
  return {
    ended: ended.map((e) => e.name),
    maxHpChange: change,
    hpGained: Math.max(0, play.currentHp - hpBefore),
  };
}

/** End one effect by id: by hand, or because its one use was spent. */
export function endEffect(play: PlayState, id: string, hp: HpLimits): EffectChange {
  return endWhere(play, (e) => e.id === id, hp);
}

/**
 * Switch an effect off (still listed, nothing applies) or back on. Current HP
 * comes under a maximum that fell, but switching Aid back on heals nothing:
 * the hit points it gave came with the casting, not the switch.
 */
export function setEffectOff(
  play: PlayState,
  id: string,
  off: boolean,
  hp: HpLimits,
): EffectChange {
  const effect = (play.activeEffects ?? []).find((e) => isEffect(e) && e.id === id);
  if (effect === undefined || (effect.off === true) === off) return { ended: [], maxHpChange: 0 };
  const before = maxHpFrom(play.activeEffects);
  if (off) effect.off = true;
  else delete effect.off;
  const change = maxHpFrom(play.activeEffects) - before;
  settleHp(play, change, hp, false);
  return { ended: [], maxHpChange: change };
}

/**
 * Concentrate on something new, or on nothing: every effect the character
 * holds by concentration under another name ends (casting Haste ends Bless).
 * One under the new name stays, since the cast that put it in play comes first.
 * Recasting at another level keeps the level given; with none given, the level
 * already held stays.
 */
export function setConcentration(
  play: PlayState,
  next: { label: string; level?: number } | undefined,
  hp: HpLimits,
): EffectChange {
  const focus = play.concentratingOn;
  if (next === undefined) delete play.concentratingOn;
  else
    play.concentratingOn =
      next.level === undefined && focus !== undefined && lower(focus.label) === lower(next.label)
        ? { label: next.label, ...(focus.level === undefined ? {} : { level: focus.level }) }
        : next;
  return endWhere(
    play,
    (e) => heldByMe(e) && (next === undefined || !answersTo(e, next.label)),
    hp,
  );
}

/**
 * The effects a rest ends: a short rest (an hour) ends what lasts an hour or
 * less and what lasts until a short rest; a long rest (eight hours) ends what
 * lasts eight hours or less and what lasts until any rest. An effect with no
 * duration stays until ended by hand. Call it before hit points refill, and
 * refill to the maximum plus `maxHpChange`.
 */
export function restEndings(play: PlayState, rest: 'short' | 'long', hp: HpLimits): EffectChange {
  const limit = rest === 'short' ? 60 : 480;
  return endWhere(
    play,
    (e) => {
      // Read as the reader does: a duration that is not one is none.
      const lasts: unknown = e.lasts;
      if (lasts === null || typeof lasts !== 'object') return false;
      const { rest: until, minutes } = lasts as Record<string, unknown>;
      if (until === 'short' || (until === 'long' && rest === 'long')) return true;
      return typeof minutes === 'number' && minutes >= 0 && minutes <= limit;
    },
    hp,
  );
}

/**
 * The start of the character's turn: each effect counting turns has one fewer
 * (one at 1 ends now), and then the best temporary hit points an effect gives
 * each turn are offered, kept only if more than the character has.
 */
export function newTurn(
  play: PlayState,
  hp: HpLimits,
): EffectChange & { tempHp?: { amount: number; source: string; kept: boolean } } {
  // Settled before counting down, so one at 2 goes to 1 and waits a turn.
  const ending = new Set<ActiveEffect>();
  for (const e of play.activeEffects ?? []) {
    // A count is a whole number, as the reader takes it; anything else counts nothing.
    if (!isEffect(e) || !Number.isInteger(e.turnsLeft)) continue;
    const left = e.turnsLeft as number;
    if (left <= 1) ending.add(e);
    else e.turnsLeft = left - 1;
  }
  const change = endWhere(play, (e) => ending.has(e), hp);

  let best: { amount: number; source: string; id: string } | undefined;
  for (const e of countingEffects(readActiveEffects(play.activeEffects).effects).inputs) {
    if (
      e.kind === 'tempHpEachTurn' &&
      e.amount > 0 &&
      (best === undefined || e.amount > best.amount)
    )
      best = { amount: e.amount, source: e.origin.label, id: e.origin.uid ?? '' };
  }
  if (best === undefined) return change;
  const kept = keepHigherTemp(play, best.amount, best.id);
  return { ...change, tempHp: { amount: best.amount, source: best.source, kept } };
}

/**
 * Temporary hit points never add up: the new amount is kept only when it is
 * more than what is there. `from` is the effect giving them, so they go when it
 * ends; without one they belong to no effect.
 */
export function keepHigherTemp(play: PlayState, amount: number, from?: string): boolean {
  if (!(amount > play.tempHp)) return false;
  play.tempHp = amount;
  if (from === undefined || from === '') delete play.tempHpFrom;
  else play.tempHpFrom = from;
  return true;
}
