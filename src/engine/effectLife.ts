/**
 * How effects in play begin and end: added (Aid lifts current hit points with
 * the maximum), ended by hand, by a rest or by the turn count, by a new
 * concentration, by a condition or a drop to 0 HP, and the temporary hit
 * points one gives each turn. Like the rest rules, each function changes the
 * play state it is given (a draft) and says what it did, so the sheet can show
 * it. Nothing calls these yet.
 *
 * Entries the app cannot read (written by a newer version) are left exactly as
 * stored, unless ended by id.
 *
 * Moments (H9, `moments.ts`) fire here when `HpLimits.moments` is given: at 0
 * HP (`knockedOut`), as a condition comes on (`conditionEndings`) or comes off
 * (`conditionEnded`), at the start of a turn (`newTurn`), on casting
 * (`spellCast`) and after a rest (`restTaken`). Without it, nothing fires and
 * every result is as it was.
 */
import { countingEffects, readActiveEffects } from './activeEffects';
import type { MomentId } from './castGuidance';
import {
  type ConditionImmunity,
  conditionMaxHp,
  type Edition,
  heldOff,
  outOfAction,
} from './conditions';
import {
  amountNow,
  CHAIN_DEPTH,
  effectNow,
  emptyReport,
  joinReports,
  levelsOf,
  type MomentChain,
  type MomentDetail,
  type MomentReport,
  type MomentsInForce,
  momentsAt,
  newChain,
  poolNamed,
  type ReadMoment,
  type ReadOutcome,
  reportIsEmpty,
  scopeFor,
} from './moments';
import { REST_MINUTES } from './rules';
import type { ActiveEffect, PlayState } from './types';

type RestLength = keyof typeof REST_MINUTES;

/** What changing effects needs to know of the sheet, to keep current HP within the maximum. */
export interface HpLimits {
  /** `DerivedSheet.maxHp.value`: the maximum with the effects in play now, before conditions. */
  maxHp: number;
  edition: Edition;
  /** `DerivedSheet.conditionImmunities`: an exhaustion held off halves nothing. */
  immune?: ReadonlyArray<ConditionImmunity>;
  /** The character's moments (`momentsInForce`). Absent, no moment fires. */
  moments?: MomentsInForce;
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
  /** What the moments it set off did, for the sheet to say. Absent when none fired. */
  moments?: MomentReport;
}

const isEffect = (e: unknown): e is ActiveEffect =>
  e !== null && typeof e === 'object' && typeof (e as ActiveEffect).id === 'string';

const lower = (s: string) => s.trim().toLowerCase();

/** The effect answers to this name: its own, or the named effect it is. */
function answersTo(e: ActiveEffect, label: string): boolean {
  return [e.name, e.same].some((n) => typeof n === 'string' && lower(n) === lower(label));
}

/** Cast by this character and held by their concentration. */
export const heldByMe = (e: ActiveEffect) => e.mine === true && e.lasts?.concentration === true;

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
 * The DC of the Constitution save to keep concentrating through damage: 10 or
 * half the damage taken, rounded down, whichever is higher. 2024 caps it at 30.
 */
export function concentrationDc(damage: number, edition: Edition): number {
  const dc = Math.max(10, Math.floor(damage / 2));
  return edition === '2024' ? Math.min(30, dc) : dc;
}

/** What ends an effect early, read as the reader does: anything else ends it never. */
function endsWhen(e: ActiveEffect): 'unconscious' | 'incapacitated' | undefined {
  const lasts: unknown = e.lasts;
  if (lasts === null || typeof lasts !== 'object') return undefined;
  const when = (lasts as Record<string, unknown>).endsWhen;
  return when === 'unconscious' || when === 'incapacitated' ? when : undefined;
}

/**
 * The character is out of action: Incapacitated breaks their concentration
 * (2014 PHB "Concentration", 2024 Incapacitated) and ends what it held, and
 * ends an effect that lasts only until then (2024 Rage); Unconscious also ends
 * one that lasts until they are knocked out (2014 Rage). Settled once.
 */
function endOutOfAction(
  play: PlayState,
  out: { incapacitated: boolean; unconscious: boolean },
  hp: HpLimits,
): EffectChange {
  if (!out.incapacitated && !out.unconscious) return { ended: [], maxHpChange: 0 };
  if (out.incapacitated) delete play.concentratingOn;
  return endWhere(
    play,
    (e) => {
      const when = endsWhen(e);
      if (out.incapacitated && (heldByMe(e) || when === 'incapacitated')) return true;
      return out.unconscious && when === 'unconscious';
    },
    hp,
  );
}

/**
 * What the condition `id` ends as it comes on (added, or switched back on):
 * Incapacitated, or a condition that brings it (Paralyzed, Petrified, Stunned,
 * Unconscious), breaks concentration in both rules versions and ends what it
 * held and 2024 Rage; Unconscious ends 2014 Rage too. One switched off or held
 * off ends nothing. Only `id` counts: what the player kept up under a
 * condition already on (the sheet warns, never blocks) stays.
 *
 * Then the `conditionAdded` moments for it fire, unless it is switched off or
 * held off. Switching one back on is no new condition: the strip passes limits
 * with no moments for that, as switching one off fires nothing either.
 */
export function conditionEndings(play: PlayState, id: string, hp: HpLimits): EffectChange {
  return conditionCame(play, id, hp, newChain());
}

function conditionCame(
  play: PlayState,
  id: string,
  hp: HpLimits,
  chain: MomentChain,
): EffectChange {
  const came = play.conditions.filter((c) => c.id === id);
  const out = outOfAction(came, hp.edition, { immune: hp.immune });
  const change = endOutOfAction(
    play,
    { incapacitated: out.incapacitated.length > 0, unconscious: out.unconscious },
    hp,
  );
  const applied = came.filter((c) => c.ignored !== true);
  if (applied.length === 0 || heldOff(applied, { immune: hp.immune }).length > 0) return change;
  return fire(play, 'conditionAdded', { condition: id }, hp, chain, change);
}

/**
 * The condition `id` came off (removed, whether or not it was switched off):
 * its `conditionEnded` moments fire, unless the character could not have it.
 * Call it after taking the condition out.
 */
export function conditionEnded(play: PlayState, id: string, hp: HpLimits): EffectChange {
  const none: EffectChange = { ended: [], maxHpChange: 0 };
  if (heldOff([{ id }], { immune: hp.immune }).length > 0) return none;
  return fire(play, 'conditionEnded', { condition: id }, hp, newChain(), none);
}

/**
 * Dropping to 0 hit points, or dying: the character falls unconscious in both
 * rules versions, so their concentration and Rage end as Unconscious ends them.
 * Then the `zeroHp` moments fire, when the sheet the limits came from had the
 * character above 0 HP: a hit at 0 HP is no new drop.
 */
export function knockedOut(play: PlayState, hp: HpLimits): EffectChange {
  const change = endOutOfAction(play, { incapacitated: true, unconscious: true }, hp);
  if (hp.moments === undefined || hp.moments.hpWhenDerived <= 0) return change;
  return fire(play, 'zeroHp', {}, hp, newChain(), change);
}

/**
 * A d20 test the character rolled came up a natural 20 or a natural 1: its
 * `natural20` or `natural1` moments fire, one that names the rolls it holds
 * for only on those (`roll`: attack, save or check). Call it once a roll, in a
 * change of its own after the roll lands.
 */
export function naturalRolled(
  play: PlayState,
  natural: 20 | 1,
  roll: NonNullable<MomentDetail['roll']>,
  hp: HpLimits,
): EffectChange {
  return fire(play, natural === 20 ? 'natural20' : 'natural1', { roll }, hp, newChain(), {
    ended: [],
    maxHpChange: 0,
  });
}

/**
 * The character cast a spell, spending a slot of `level` (0 for a cantrip, the
 * spell's own level for a cast that spends no slot): its `castAtLevel` moments
 * fire. Call it in the same change as the cast.
 */
export function spellCast(play: PlayState, level: number, hp: HpLimits): EffectChange {
  return fire(play, 'castAtLevel', { level }, hp, newChain(), { ended: [], maxHpChange: 0 });
}

// ---------------------------------------------------------------------------
// Moments (H9)
// ---------------------------------------------------------------------------

/** Join a later change onto an earlier one: what ended, the maximum's move, and moments. */
function joinChanges(into: EffectChange, more: EffectChange): EffectChange {
  into.ended.push(...more.ended);
  into.maxHpChange += more.maxHpChange;
  if (more.moments !== undefined) {
    const report = into.moments ?? emptyReport();
    joinReports(report, more.moments);
    into.moments = report;
  }
  return into;
}

/**
 * Fire the moments `at` sets off, after `before` (what the step that set them
 * off already did, joined into the result). Each fires once a chain, in order,
 * and each outcome reads the HP maximum as the outcomes before it left it.
 */
function fire(
  play: PlayState,
  at: MomentId,
  detail: MomentDetail,
  hp: HpLimits,
  chain: MomentChain,
  before: EffectChange,
): EffectChange {
  const inForce = hp.moments;
  if (inForce === undefined) return before;
  const due = momentsAt(inForce, at, detail).filter((m) => !chain.fired.has(m));
  if (due.length === 0) return before;
  const report = emptyReport();
  if (chain.depth >= CHAIN_DEPTH) {
    report.problems.push(`Moments set each other off ${CHAIN_DEPTH} deep; the rest did not happen`);
    return joinChanges(before, { ended: [], maxHpChange: 0, moments: report });
  }
  const change: EffectChange = { ended: [], maxHpChange: 0, moments: report };
  chain.depth++;
  for (const m of due) {
    // An earlier moment's outcome can set this one off first, in a nested step.
    if (chain.fired.has(m)) continue;
    chain.fired.add(m);
    for (const o of m.do) {
      const now = { ...hp, maxHp: hp.maxHp + before.maxHpChange + change.maxHpChange };
      joinChanges(change, outcome(play, o, m, inForce, now, chain));
    }
  }
  chain.depth--;
  if (reportIsEmpty(report)) delete change.moments;
  return joinChanges(before, change);
}

/** What one outcome does to the play state. */
function outcome(
  play: PlayState,
  o: ReadOutcome,
  m: ReadMoment,
  inForce: MomentsInForce,
  hp: HpLimits,
  chain: MomentChain,
): EffectChange {
  const report = emptyReport();
  const change: EffectChange = { ended: [], maxHpChange: 0, moments: report };
  const from = m.from;
  const scope = () => scopeFor(inForce, m, { hp: play.currentHp, maxHp: hp.maxHp });
  switch (o.kind) {
    case 'addCondition':
      joinChanges(change, addCondition(play, o.condition, o.level, from, hp, chain));
      break;
    case 'addEffect': {
      // One of the same name already in play (not the character's own casting) is replaced.
      const same = (play.activeEffects ?? []).find(
        (e) => isEffect(e) && !heldByMe(e) && answersTo(e, o.name),
      );
      const { effect, dropped } = effectNow(o, scope(), chain, same?.id);
      for (const part of dropped) {
        report.problems.push(
          `${from}: ${o.name}, effect ${part}: an effect in play cannot hold it with these numbers`,
        );
      }
      if (effect === undefined) {
        report.problems.push(`${from}: ${o.name} has nothing an effect in play can do`);
        break;
      }
      const added = applyEffect(play, effect, hp);
      change.ended.push(...added.ended);
      change.maxHpChange += added.maxHpChange;
      report.done.push({ text: effect.name, from });
      break;
    }
    case 'regain':
    case 'spend': {
      const pool = poolNamed(inForce, o.resource);
      if (pool === undefined) {
        report.problems.push(`${from}: no pool named ${o.resource}`);
        break;
      }
      const amount = amountNow(o.amount, scope(), chain);
      const entry = play.resources.find((r) => r.key === pool.key);
      // A pool spent past its maximum (the maximum shrank) counts as all spent:
      // it spends nothing more, and regains from its maximum down.
      const was = Math.min(entry?.used ?? 0, pool.max);
      const next =
        o.kind === 'regain' ? Math.max(0, was - amount) : Math.min(pool.max, was + amount);
      const moved = Math.abs(next - was);
      if (moved === 0) break;
      if (entry !== undefined) entry.used = next;
      else play.resources.push({ key: pool.key, used: next });
      report.done.push({
        text: `${pool.label}: ${o.kind === 'regain' ? 'regained' : 'spent'} ${moved}`,
        from,
      });
      break;
    }
    case 'tempHp': {
      const amount = amountNow(o.amount, scope(), chain);
      if (amount > 0 && keepHigherTemp(play, amount)) {
        report.done.push({
          text: `${amount} temporary hit point${amount === 1 ? '' : 's'}`,
          from,
        });
      }
      break;
    }
    case 'cue':
      report.cues.push({ text: o.text, tone: o.tone, from });
      break;
    case 'offer':
      report.offers.push({
        label: o.label,
        ...(o.dice !== undefined ? { dice: o.dice } : {}),
        from,
      });
      break;
  }
  if (reportIsEmpty(report)) delete change.moments;
  return change;
}

/**
 * Put a condition on, as the condition strip does: one the character cannot
 * have is held off and not added; Exhaustion gains `levels`, up to its sixth;
 * any other already on stays as it is. One newly on ends what it ends
 * (`conditionEndings`) and sets off its own moments.
 */
function addCondition(
  play: PlayState,
  name: string,
  levels: number,
  from: string,
  hp: HpLimits,
  chain: MomentChain,
): EffectChange {
  const report = emptyReport();
  const none: EffectChange = { ended: [], maxHpChange: 0, moments: report };
  const by = heldOff([{ id: name }], { immune: hp.immune })[0]?.by;
  if (by !== undefined) {
    report.problems.push(`${from}: you cannot be ${name.toLowerCase()} (${by.join(', ')})`);
    return none;
  }
  const most = levelsOf(name);
  const on = play.conditions.find((c) => c.id.toLowerCase() === name.toLowerCase());
  if (on !== undefined) {
    if (most === 1) return { ended: [], maxHpChange: 0 };
    const level = Math.min(most, (on.level ?? 1) + levels);
    if (level === (on.level ?? 1)) return { ended: [], maxHpChange: 0 };
    on.level = level;
    report.done.push({ text: `${on.id} ${level}`, from });
    return none;
  }
  const level = Math.min(most, levels);
  play.conditions.push(most === 1 ? { id: name } : { id: name, level });
  report.done.push({ text: most === 1 ? name : `${name} ${level}`, from });
  return joinChanges(none, conditionCame(play, name, hp, chain));
}

/**
 * The effects a rest ends: a short rest (an hour, as written) ends what lasts
 * that long or less and what lasts until a short rest; a long rest (eight
 * hours) ends what lasts that long or less and what lasts until any rest. The
 * table's rest length (`REST_MINUTES`) sets how long each takes. An effect
 * with no duration stays until ended by hand. Call it before hit points
 * refill, and refill to the maximum plus `maxHpChange`.
 */
export function restEndings(
  play: PlayState,
  rest: 'short' | 'long',
  hp: HpLimits,
  length: RestLength = 'standard',
): EffectChange {
  return endWhere(play, (e) => endsAtRest(e, rest, length), hp);
}

/** Does this rest end the effect, by what it lasts? See `restEndings`. */
export function endsAtRest(
  e: ActiveEffect,
  rest: 'short' | 'long',
  length: RestLength = 'standard',
): boolean {
  // Read as the reader does: a duration that is not one is none.
  const lasts: unknown = e.lasts;
  if (lasts === null || typeof lasts !== 'object') return false;
  const { rest: until, minutes } = lasts as Record<string, unknown>;
  if (until === 'short' || (until === 'long' && rest === 'long')) return true;
  const limit = (REST_MINUTES[length] ?? REST_MINUTES.standard)[rest];
  return typeof minutes === 'number' && minutes >= 0 && minutes <= limit;
}

/**
 * A rest was taken. Call it last, once the rest has given back what it gives,
 * so what its moments give is not reset by it: the `conditionEnded` moments of
 * each condition the rest took off (`ended`: a long rest's last level of
 * Exhaustion) fire, then the rest's own (`shortRest` or `longRest`). `before`
 * is the rest's own change, the effects it ended, joined into the result.
 */
export function restTaken(
  play: PlayState,
  rest: 'short' | 'long',
  hp: HpLimits,
  before: EffectChange = { ended: [], maxHpChange: 0 },
  ended: readonly string[] = [],
): EffectChange {
  let change = before;
  for (const id of ended) {
    change = joinChanges(
      change,
      conditionEnded(play, id, { ...hp, maxHp: hp.maxHp + change.maxHpChange }),
    );
  }
  return fire(play, rest === 'short' ? 'shortRest' : 'longRest', {}, hp, newChain(), change);
}

/**
 * End the effects with these ids at once (a rest's ticked list): one change to
 * the maximum, settled once, as `restEndings` does.
 */
export function endEffects(play: PlayState, ids: ReadonlySet<string>, hp: HpLimits): EffectChange {
  return endWhere(play, (e) => ids.has(e.id), hp);
}

/**
 * The start of the character's turn: each effect counting turns has one fewer
 * (one at 1 ends now), then the `turnStart` moments fire, and then the best
 * temporary hit points an effect gives each turn are offered, kept only if
 * more than the character has.
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
  const change = fire(
    play,
    'turnStart',
    {},
    hp,
    newChain(),
    endWhere(play, (e) => ending.has(e), hp),
  );

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
