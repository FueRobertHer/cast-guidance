/**
 * "Trim to limit" (GAME-007): an opt-in way back under a class's spell limits.
 * Over-limit stays a valid state, so the sheet only offers this; nothing here
 * runs unless the player confirms. Pure so the confirm can list exactly what
 * the trim will remove before anything changes.
 *
 * Rules, in order, each counted the same way the over-limit cue counts:
 *  1. Cantrips over by n: forget the n most recently added cantrips.
 *  2. Leveled spells over by n (known/pact casters only): forget the n most
 *     recently added leveled spells. Forgetting also unprepares, as untoggling
 *     "known" does.
 *  3. Prepared over by n, recounted after 1 and 2: unprepare entries that an
 *     always-prepared grant already covers (losing nothing), then the most
 *     recently added. These stay known (or in the spellbook), exactly as
 *     tapping "prepared" off does.
 * A spell whose level can't be resolved is never forgotten (the cue does not
 * count it), but it still counts toward prepared, so it can be unprepared.
 */
import type { EntityRef, SpellcastingBlock, SpellcastingMode } from '@/engine/types';

export interface SpellLimits {
  cantrips?: number;
  prepared?: number;
  /** Leveled spells known; only set for known/pact casters. */
  known?: number;
}

export interface SpellTrimPlan {
  forgetCantrips: EntityRef[];
  forgetKnown: EntityRef[];
  /** Prepared by hand AND always prepared by a grant: unpreparing loses nothing. */
  unprepareRedundant: EntityRef[];
  unprepare: EntityRef[];
}

interface SpellLists {
  known: readonly EntityRef[];
  prepared: readonly EntityRef[];
}

const refUid = (r: EntityRef) => `${r.name}|${r.source}`.toLowerCase();

/**
 * The limits a class block is held to. Known/pact casters cap the leveled
 * spells they know; prepared/spellbook casters don't count "known" this way,
 * so that limit only applies to those modes. Shared by the cue and the trim so
 * the two can never disagree about what "over" means.
 */
export function spellLimits(
  block: Pick<SpellcastingBlock, 'mode' | 'cantripsKnown' | 'preparedMax' | 'spellsKnownMax'>,
): SpellLimits {
  const knownGated = block.mode === 'known' || block.mode === 'pact';
  return {
    cantrips: block.cantripsKnown,
    prepared: block.preparedMax,
    known: knownGated ? block.spellsKnownMax : undefined,
  };
}

/** Does an always-prepared grant cover this ref? Name only when the grant names no source. */
function coveredByGrant(ref: EntityRef, grants: readonly EntityRef[]): boolean {
  const uid = refUid(ref);
  const name = ref.name.toLowerCase();
  return grants.some((g) =>
    g.source.trim() === '' ? g.name.toLowerCase() === name : refUid(g) === uid,
  );
}

/** Remove the last entry with this uid; returns whether one was found. */
function removeLast(list: EntityRef[], uid: string): boolean {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    if (entry !== undefined && refUid(entry) === uid) {
      list.splice(i, 1);
      return true;
    }
  }
  return false;
}

/** Forget one copy of a spell; once none is known it can't stay prepared either. */
function forget(lists: { known: EntityRef[]; prepared: EntityRef[] }, ref: EntityRef): void {
  const uid = refUid(ref);
  removeLast(lists.known, uid);
  if (!lists.known.some((r) => refUid(r) === uid)) {
    lists.prepared = lists.prepared.filter((r) => refUid(r) !== uid);
  }
}

/** The n most recently added known entries whose level passes `match`. */
function latestKnown(
  known: readonly EntityRef[],
  n: number,
  match: (level: number) => boolean,
  levelOf: (ref: EntityRef) => number | undefined,
): EntityRef[] {
  const out: EntityRef[] = [];
  for (let i = known.length - 1; i >= 0 && out.length < n; i -= 1) {
    const ref = known[i];
    if (ref === undefined) continue;
    const lvl = levelOf(ref);
    if (lvl !== undefined && match(lvl)) out.push(ref);
  }
  return out;
}

export function planSpellTrim({
  state,
  limits,
  levelOf,
  alwaysPrepared = [],
}: {
  state: SpellLists;
  limits: SpellLimits;
  levelOf: (ref: EntityRef) => number | undefined;
  /**
   * Always-prepared grants that are safe to unprepare first. Pass none when
   * the character has more than one casting class: a grant isn't tied to a
   * class, so it can't be said to cover this class's preparations.
   */
  alwaysPrepared?: readonly EntityRef[];
}): SpellTrimPlan {
  const lists = { known: [...state.known], prepared: [...state.prepared] };
  const countAt = (match: (level: number) => boolean) =>
    lists.known.filter((r) => {
      const lvl = levelOf(r);
      return lvl !== undefined && match(lvl);
    }).length;

  const isCantrip = (lvl: number) => lvl === 0;
  const isLeveled = (lvl: number) => lvl > 0;

  const forgetCantrips =
    limits.cantrips !== undefined
      ? latestKnown(lists.known, countAt(isCantrip) - limits.cantrips, isCantrip, levelOf)
      : [];
  for (const ref of forgetCantrips) forget(lists, ref);

  const forgetKnown =
    limits.known !== undefined
      ? latestKnown(lists.known, countAt(isLeveled) - limits.known, isLeveled, levelOf)
      : [];
  for (const ref of forgetKnown) forget(lists, ref);

  const unprepareRedundant: EntityRef[] = [];
  const unprepare: EntityRef[] = [];
  // Raw length, as the cue counts it: cantrips and unresolved entries included.
  let over = limits.prepared !== undefined ? lists.prepared.length - limits.prepared : 0;
  const newestFirst = [...lists.prepared].reverse();
  for (const ref of newestFirst) {
    if (over <= 0) break;
    if (coveredByGrant(ref, alwaysPrepared)) {
      unprepareRedundant.push(ref);
      over -= 1;
    }
  }
  for (const ref of newestFirst) {
    if (over <= 0) break;
    if (!coveredByGrant(ref, alwaysPrepared)) {
      unprepare.push(ref);
      over -= 1;
    }
  }

  return { forgetCantrips, forgetKnown, unprepareRedundant, unprepare };
}

export function isEmptyTrim(plan: SpellTrimPlan): boolean {
  return (
    plan.forgetCantrips.length +
      plan.forgetKnown.length +
      plan.unprepareRedundant.length +
      plan.unprepare.length ===
    0
  );
}

/**
 * Apply a plan to one class's lists in place. Works by uid on whatever the
 * lists hold now, so it removes only what the confirm listed.
 */
export function applySpellTrim(
  sc: { known: EntityRef[]; prepared: EntityRef[] },
  plan: SpellTrimPlan,
): void {
  const lists = { known: sc.known, prepared: sc.prepared };
  for (const ref of [...plan.forgetCantrips, ...plan.forgetKnown]) forget(lists, ref);
  for (const ref of [...plan.unprepareRedundant, ...plan.unprepare]) {
    removeLast(lists.prepared, refUid(ref));
  }
  sc.known = lists.known;
  sc.prepared = lists.prepared;
}

const names = (refs: readonly EntityRef[]) => refs.map((r) => r.name).join(', ');

/** One plain line per kind of removal, for the confirm. */
export function describeTrim(plan: SpellTrimPlan, mode: SpellcastingMode): string[] {
  const lines: string[] = [];
  const n = plan.forgetCantrips.length;
  if (n > 0) lines.push(`Forget ${n === 1 ? 'cantrip' : 'cantrips'} ${names(plan.forgetCantrips)}`);
  if (plan.forgetKnown.length > 0) lines.push(`Forget ${names(plan.forgetKnown)}`);
  if (plan.unprepareRedundant.length > 0) {
    lines.push(`Unprepare ${names(plan.unprepareRedundant)} (always prepared anyway)`);
  }
  if (plan.unprepare.length > 0) {
    const kept = mode === 'spellbook' ? 'still in your spellbook' : 'still known';
    lines.push(`Unprepare ${names(plan.unprepare)} (${kept})`);
  }
  return lines;
}
