/**
 * Which pool each feature spends, and how its action takes the price. An action
 * spends a pool by name alone otherwise, so Cutting Words never touches Bardic
 * Inspiration and a monk's Flurry of Blows never touches Focus.
 *
 * The prices are the built-in `spend` rows (`src/rules/cast-guidance/spend.json`,
 * rule pack port 3b to 3d), generated once from Jev's confident `spend-<pool>`
 * answers and read row by row against the features: a person decides what is
 * there, and `bun run data:judge -- --report spend` lists what is not. Prices
 * paid in spell slots or Hit Point Dice were read from each feature's own text
 * (data function pass item 10); paying one means choosing a slot's level or a
 * die's size, which the roll prompt asks. These are facts of the game rules,
 * fine to commit.
 *
 * Keys name the printing, because the printings disagree (Heightened Spell costs 3
 * in 2014 and 2 in 2024): class features `name|class|source`, subclass features
 * `name|subclass|source`, feats and optional features `name|source`, all lowercase.
 */
import { spellPoolKey } from '../effects/additionalSpells';
import type { Collector } from '../effects/base';
import { builtInRowsFor, playerBuyBack, type SpendLinkRow } from '../effects/mechanics';
import { type ActionBuyBack, type EffectOrigin, HIT_DIE_COST, SLOT_COST } from '../types';

/**
 * Hang a feature's costs on the action it already emitted, or add one for a feature
 * that spends with no action row of its own. Runs after the curated entry or the
 * scan, so a row reaches both. The built-in `spend` row under the first of `keys`
 * with one gives its links in order: a pool's price, then a slot's or a Hit Point
 * Die's. Says whether a row was found.
 */
export function linkSpend(
  col: Collector,
  keys: readonly string[],
  label: string,
  origin: EffectOrigin,
): boolean {
  const rows = builtInRowsFor(col, 'spend', keys);
  if (rows === undefined) return false;
  for (const row of rows) for (const link of row.links ?? []) linkPrice(col, link, label, origin);
  return true;
}

/**
 * One built-in link on the feature's action (`StoredSpendLink`). A pool's price
 * replaces the one the action has, as it runs first under a key; a spell slot's
 * or a Hit Point Die's runs after it, so it fills only an empty one: a cost goes
 * on an action with none (else on an action of its own), a buy-back on one with
 * none, and a buy-back for another feature's action adds nothing without it.
 */
function linkPrice(col: Collector, link: SpendLinkRow, label: string, origin: EffectOrigin): void {
  if ('cost' in link) {
    const fills = link.cost.resource === SLOT_COST || link.cost.resource === HIT_DIE_COST;
    const cost = structuredClone(link.cost);
    const { economy, note } = link;
    const own =
      link.label === undefined
        ? col.effects.find((e) => e.kind === 'action' && e.origin === origin)
        : undefined;
    if (own?.kind === 'action' && !(fills && own.cost !== undefined)) {
      own.cost = cost;
      if (economy !== undefined) own.economy = economy;
      if (note !== undefined && own.note === undefined) own.note = note;
      return;
    }
    col.add({
      kind: 'action',
      economy: economy ?? 'none',
      label: link.label ?? label,
      cost,
      origin,
      ...(note !== undefined ? { note } : {}),
    });
    return;
  }
  const fills = link.buyBack.resource === SLOT_COST;
  const { onAction, ownSpell, uses } = link;
  if (uses !== undefined) col.add({ kind: 'resource', label, ...uses, origin });
  // Keyed as `additionalSpells` keys a granted spell's pool: by the origin's uid
  // and the spell's name, so "Telekinesis" finds the pool as "telekinesis" does.
  const buyBack: ActionBuyBack = {
    ...structuredClone(link.buyBack),
    ...(ownSpell !== undefined ? { own: spellPoolKey(origin.uid, [ownSpell]) } : {}),
  };
  const target = col.effects.find(
    (e) =>
      e.kind === 'action' &&
      !(fills && e.buyBack !== undefined) &&
      (onAction !== undefined ? e.label === onAction : e.origin === origin),
  );
  // A player's own price (`amend`) on another feature's action stands.
  if (target?.kind === 'action') {
    if (!playerBuyBack(target)) target.buyBack = buyBack;
  } else if (!(fills && onAction !== undefined)) {
    col.add({ kind: 'action', economy: 'none', label: onAction ?? label, buyBack, origin });
  }
}
