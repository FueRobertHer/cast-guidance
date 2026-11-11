/**
 * What the character's own features add to a roll when paid for (`RollEffects.paid`,
 * from the extras' table), priced as each feature's Use is priced (`actionUse`), and
 * turned into what the roll prompt offers: a die or bonus to add, or advantage to
 * claim. What the character cannot pay now (no uses left, the reaction spent) is
 * not offered, and nor is what the sheet finds no price for.
 */
import type { OfferPay, RollEffects } from '@/engine/playRules';
import type { DerivedSheet, PlayState } from '@/engine/types';
import { actionUse } from './actionUse';

type SheetAction = DerivedSheet['actions'][number];
type Paid = NonNullable<RollEffects['paid']>[number];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The action whose Use pays for a feature's extra: one named for it ("Flash of
 * Genius", "Lucky Footwork"), else one from it that costs something ("Maneuvers:
 * Ambush" spends a superiority die), else one from it. With none, a pool named
 * for it (Kenku Recall), or the one pool it gives (2024 Lucky's Luck Points),
 * paid as a Use of its own would be.
 */
function payingAction(
  sheet: Pick<DerivedSheet, 'actions' | 'resources'>,
  source: string,
): SheetAction | undefined {
  const { actions, resources } = sheet;
  const action =
    actions.find((a) => same(a.label, source)) ??
    actions.find((a) => same(a.origin, source) && a.cost !== undefined) ??
    actions.find((a) => same(a.origin, source));
  if (action !== undefined) return action;
  const fromIt = resources.filter((r) => same(r.origin, source));
  const pool =
    resources.find((r) => same(r.label, source)) ?? (fromIt.length === 1 ? fromIt[0] : undefined);
  return pool !== undefined ? { economy: 'none', label: pool.label, origin: source } : undefined;
}

/**
 * What paying for a feature's extra takes now, and the paying pool's die (a
 * superiority die). Undefined when the sheet names no price for it, or the
 * character cannot pay: a pool is short, the reaction is spent. `reaction`
 * says what the row does over the action's own: true takes the reaction
 * whatever Use takes, false never does (2024 Guided Strike takes one only
 * for an ally's roll).
 */
export function offerPrice(
  sheet: Pick<DerivedSheet, 'actions' | 'resources'>,
  play: Pick<PlayState, 'resources' | 'turn'>,
  source: string,
  reaction?: boolean,
): { pay: OfferPay; die?: string } | undefined {
  const found = payingAction(sheet, source);
  const action: SheetAction | undefined =
    found !== undefined
      ? reaction === undefined
        ? found
        : { ...found, economy: reaction ? 'reaction' : 'none' }
      : reaction === true
        ? { economy: 'reaction', label: source, origin: source, spendsNoUse: true }
        : undefined;
  if (action === undefined) return undefined;
  const usedOf = (key: string) => play.resources.find((r) => r.key === key)?.used ?? 0;
  const use = actionUse(action, sheet.resources, usedOf);
  // A slot or a die is picked in the prompt as a cast, never added to a roll.
  if (use.noButton || use.disabled || use.slot !== undefined || use.hitDie !== undefined) {
    return undefined;
  }
  const takesReaction = action.economy === 'reaction';
  if (takesReaction && play.turn?.reaction === true) return undefined;
  // Only the reaction or uses pay: an action or a bonus action is no price at a roll.
  if (use.spends.length === 0 && !takesReaction) return undefined;
  const pay: OfferPay = {
    spends: use.spends.map(({ key, max, amount }) => ({ key, max, amount })),
    reaction: takesReaction,
    words: use.title.replace(/^Use: /, ''),
  };
  const first = pay.spends[0];
  const die =
    first !== undefined ? sheet.resources.find((r) => r.key === first.key)?.die : undefined;
  return { pay, ...(die !== undefined ? { die } : {}) };
}

/**
 * The roll's riders with the features' paid extras priced: each one the
 * character can pay becomes an offer (its die, the paying pool's die, or its
 * bonus) or, for advantage, a claim, carrying what paying takes. The rest go,
 * and all of them with no play state to pay from. A reroll the result offers
 * is priced the same way, unless it is free, or takes the reaction alone
 * (`free` with `reaction`: Living Legend); one made as the d20 lands stays.
 * What Inspiration pays for is offered only while the character has it, and
 * a foretelling pool's numbers (Portent) while it has a use left, each once.
 */
export function pricedRollEffects(
  riders: RollEffects,
  sheet: Pick<DerivedSheet, 'actions' | 'resources'>,
  play:
    | (Pick<PlayState, 'resources' | 'turn'> & Partial<Pick<PlayState, 'inspiration' | 'foretold'>>)
    | undefined,
): RollEffects {
  const { paid = [], rerolls = [], ...rest } = riders;
  const foretold = play === undefined ? [] : foretoldNumbers(sheet, play);
  if (riders.paid === undefined && riders.rerolls === undefined && foretold.length === 0) {
    return riders;
  }
  // Made as the d20 lands: what is marked so, and a floor, which always holds.
  const auto = rerolls.filter((r) => r.auto === true || r.floor !== undefined);
  // What costs nothing and never hurts rolls with no play state too.
  const out = auto.length > 0 ? { ...rest, rerolls: auto } : rest;
  if (play === undefined) return out;
  const priceOf = (source: string, reaction?: boolean, inspiration?: boolean) =>
    inspiration === true
      ? play.inspiration === true
        ? { pay: { spends: [], reaction: false, words: 'is spent', inspiration: true } }
        : undefined
      : offerPrice(sheet, play, source, reaction);
  const offers = [...out.offers];
  const declare = [...(out.declare ?? [])];
  const rerollOffers: NonNullable<RollEffects['rerollOffers']> = [];
  for (const r of rerolls) {
    if (r.auto === true || r.die === 'low' || r.floor !== undefined) continue;
    // The reaction alone is a price with no action or pool behind it.
    const price =
      r.free !== true
        ? priceOf(r.source, r.reaction, r.inspiration)
        : r.reaction === true
          ? offerPrice({ actions: [], resources: [] }, play, r.source, true)
          : { pay: undefined };
    if (price === undefined) continue;
    rerollOffers.push({
      source: r.source,
      die: r.die ?? 'all',
      ifFailed: r.ifFailed === true,
      ...(r.atMost !== undefined ? { atMost: r.atMost } : {}),
      ...(r.to !== undefined ? { to: r.to } : {}),
      ...(r.bonus !== undefined ? { bonus: r.bonus } : {}),
      ...(price.pay !== undefined ? { pay: price.pay } : {}),
      ...(r.when !== undefined ? { when: r.when } : {}),
    });
  }
  for (const p of paid) {
    const price = priceOf(p.source, p.reaction, p.inspiration);
    if (price === undefined) continue;
    const { pay, die } = price;
    if (p.advantage === true) {
      declare.push({ source: p.source, mode: 'adv', when: p.when ?? '', pay });
      continue;
    }
    const dice = diceOf(p, die);
    if (dice === undefined) continue;
    offers.push({
      dice,
      source: p.source,
      once: true,
      ifFailed: p.ifFailed === true,
      pay,
      ...(p.when !== undefined ? { when: p.when } : {}),
      ...(p.after === true || p.bonus !== undefined ? { after: true } : {}),
      ...(p.spentOnSuccess === true ? { spentOnSuccess: true } : {}),
    });
  }
  return {
    ...out,
    offers,
    ...(declare.length > 0 ? { declare } : {}),
    ...(rerollOffers.length > 0 ? { rerollOffers } : {}),
    ...(foretold.length > 0 ? { foretold } : {}),
  };
}

/**
 * The numbers a foretelling pool's long rest kept (Portent), each priced as
 * its use and the number itself, once a number: none while the pool has no use
 * left, which the player may have marked by hand.
 */
function foretoldNumbers(
  sheet: Pick<DerivedSheet, 'resources'>,
  play: Pick<PlayState, 'resources'> & Partial<Pick<PlayState, 'inspiration' | 'foretold'>>,
): NonNullable<RollEffects['foretold']> {
  const out: NonNullable<RollEffects['foretold']> = [];
  for (const pool of sheet.resources) {
    if (pool.foretell !== true) continue;
    const used = play.resources.find((r) => r.key === pool.key)?.used ?? 0;
    if (used >= pool.max) continue;
    // No more than the uses left, as the Play tab's row shows them.
    for (const v of new Set((play.foretold?.[pool.key] ?? []).slice(0, pool.max - used))) {
      out.push({
        source: pool.label,
        v,
        pay: {
          spends: [{ key: pool.key, max: pool.max, amount: 1 }],
          reaction: false,
          words: `uses the foretold ${v}`,
          foretold: { key: pool.key, v },
        },
      });
    }
  }
  return out;
}

/** What an extra adds: its die, the paying pool's die, or its bonus, as a roll reads it. */
function diceOf(p: Paid, poolDie: string | undefined): string | undefined {
  if (p.poolDie === true) return poolDie;
  if (p.dice !== undefined) return p.dice;
  // A modifier of +0 or less adds nothing worth a use.
  if (p.bonus !== undefined && p.bonus > 0) return String(p.bonus);
  return undefined;
}

/**
 * Pay for an extra, all of it or none: false, paying nothing, when a use, the
 * reaction, Inspiration or a foretold number is gone (a tap that beat the last
 * render).
 */
export function payOffer(play: PlayState, pay: OfferPay): boolean {
  const entryOf = (key: string) => play.resources.find((r) => r.key === key);
  if (pay.spends.some((s) => (entryOf(s.key)?.used ?? 0) + s.amount > s.max)) return false;
  if (pay.reaction && play.turn?.reaction === true) return false;
  if (pay.inspiration === true && !play.inspiration) return false;
  const told = pay.foretold;
  const numbers = told === undefined ? undefined : play.foretold?.[told.key];
  if (told !== undefined && !numbers?.includes(told.v)) return false;
  if (told !== undefined && numbers !== undefined) {
    const left = [...numbers];
    left.splice(left.indexOf(told.v), 1);
    const all = { ...play.foretold };
    if (left.length > 0) all[told.key] = left;
    else delete all[told.key];
    // Absent rather than empty, as `PlayState.foretold` says.
    if (Object.keys(all).length > 0) play.foretold = all;
    else delete play.foretold;
  }
  if (pay.inspiration === true) play.inspiration = false;
  if (pay.reaction) {
    play.turn = { ...(play.turn ?? { action: false, bonus: false }), reaction: true };
  }
  for (const { key, amount } of pay.spends) {
    const entry = entryOf(key);
    if (entry !== undefined) entry.used += amount;
    else play.resources.push({ key, used: amount });
  }
  return true;
}

/**
 * Give back what paying for an extra took: its uses, the reaction it marked,
 * Inspiration and a foretold number.
 */
export function refundOffer(play: PlayState, pay: OfferPay): void {
  for (const { key, amount } of pay.spends) {
    const entry = play.resources.find((r) => r.key === key);
    if (entry !== undefined) entry.used = Math.max(0, entry.used - amount);
  }
  if (pay.reaction && play.turn !== undefined) play.turn = { ...play.turn, reaction: false };
  if (pay.inspiration === true) play.inspiration = true;
  const told = pay.foretold;
  if (told !== undefined) {
    play.foretold = {
      ...play.foretold,
      [told.key]: [...(play.foretold?.[told.key] ?? []), told.v],
    };
  }
}
