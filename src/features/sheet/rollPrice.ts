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
 */
export function pricedRollEffects(
  riders: RollEffects,
  sheet: Pick<DerivedSheet, 'actions' | 'resources'>,
  play: Pick<PlayState, 'resources' | 'turn'> | undefined,
): RollEffects {
  const { paid = [], rerolls = [], ...rest } = riders;
  if (riders.paid === undefined && riders.rerolls === undefined) return riders;
  // Made as the d20 lands: what is marked so, and a floor, which always holds.
  const auto = rerolls.filter((r) => r.auto === true || r.floor !== undefined);
  // What costs nothing and never hurts rolls with no play state too.
  const out = auto.length > 0 ? { ...rest, rerolls: auto } : rest;
  if (play === undefined) return out;
  const offers = [...out.offers];
  const declare = [...(out.declare ?? [])];
  const rerollOffers: NonNullable<RollEffects['rerollOffers']> = [];
  for (const r of rerolls) {
    if (r.auto === true || r.die === 'low' || r.floor !== undefined) continue;
    // The reaction alone is a price with no action or pool behind it.
    const price =
      r.free !== true
        ? offerPrice(sheet, play, r.source, r.reaction)
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
    const price = offerPrice(sheet, play, p.source, p.reaction);
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
  };
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
 * Pay for an extra, all of it or none: false, paying nothing, when a use or the
 * reaction is gone (a tap that beat the last render).
 */
export function payOffer(play: PlayState, pay: OfferPay): boolean {
  const entryOf = (key: string) => play.resources.find((r) => r.key === key);
  if (pay.spends.some((s) => (entryOf(s.key)?.used ?? 0) + s.amount > s.max)) return false;
  if (pay.reaction && play.turn?.reaction === true) return false;
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

/** Give back what paying for an extra took: its uses, and the reaction it marked. */
export function refundOffer(play: PlayState, pay: OfferPay): void {
  for (const { key, amount } of pay.spends) {
    const entry = play.resources.find((r) => r.key === key);
    if (entry !== undefined) entry.used = Math.max(0, entry.used - amount);
  }
  if (pay.reaction && play.turn !== undefined) play.turn = { ...play.turn, reaction: false };
}
