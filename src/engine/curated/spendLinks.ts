/**
 * Which pool each feature spends, and how its action takes the price. An action
 * spends a pool by name alone otherwise, so Cutting Words never touches Bardic
 * Inspiration and a monk's Flurry of Blows never touches Focus.
 *
 * The prices are the built-in `spend` rows (`src/rules/cast-guidance/spend.json`,
 * rule pack port 3b and 3c), generated once from Jev's confident `spend-<pool>`
 * answers and read row by row against the features: a person decides what is
 * there, and `bun run data:judge -- --report spend` lists what is not. These are
 * facts of the game rules, fine to commit.
 *
 * Keys name the printing, because the printings disagree (Heightened Spell costs 3
 * in 2014 and 2 in 2024): class features `name|class|source`, subclass features
 * `name|subclass|source`, feats and optional features `name|source`, all lowercase.
 *
 * `SPEND_LINKS` keeps the one pool price whose key still has a `SLOT_LINKS` row
 * (prices paid in spell slots or Hit Point Dice), since a key leaves both code
 * tables at once.
 */
import type { StoredSpendLink } from '../castGuidance';
import { spellPoolKey } from '../effects/additionalSpells';
import type { Collector } from '../effects/base';
import { builtInRowsFor, type SpendLinkRow } from '../effects/mechanics';
import {
  type ActionBuyBack,
  type ActionCost,
  type ActionEconomy,
  type EffectOrigin,
  HIT_DIE_COST,
  SLOT_COST,
} from '../types';
import { linkSlotCost, SLOT_LINKS, slotLinkOf } from './slotLinks';

type Amount = ActionCost['amount'];

interface Row {
  amount: Amount;
  /** The slot it takes. Given when no action row exists yet, or when the scanner's is wrong. */
  economy?: ActionEconomy;
  /** The base use is free, and the pool pays for more. */
  optional?: boolean;
  /** It takes a use of the feature as well as the cost. */
  ownUseToo?: boolean;
}

export type SpendLink = Row & { resource: string };

/** Rides on a hit, a spell or a roll: tapping it spends and takes nothing from the turn. */
const rider = (amount: Amount = 1): Row => ({ amount, economy: 'none' });

function pool(
  resource: string,
  rows: Readonly<Record<string, Amount | Row>>,
): Record<string, SpendLink> {
  const out: Record<string, SpendLink> = {};
  for (const [key, row] of Object.entries(rows)) {
    out[key] = typeof row === 'object' ? { resource, ...row } : { resource, amount: row };
  }
  return out;
}

export const SPEND_LINKS: Readonly<Record<string, SpendLink>> = {
  // The rest moved to `src/rules/cast-guidance/spend.json` (rule pack port 3b
  // and 3c). A key leaves both tables at once, so Divine Reaper stays here until
  // its slot buy-back in `SLOT_LINKS` moves (3d).
  ...pool('channel-divinity', {
    'divine reaper|grave domain|rhw': rider(),
  }),
};

/** Whether either code table still has a row under a lowercased key. */
const inCode = (key: string): boolean =>
  Object.hasOwn(SPEND_LINKS, key) || Object.hasOwn(SLOT_LINKS, key);

/**
 * Hang a feature's costs on the action it already emitted, or add one for a feature
 * that spends with no action row of its own. Runs after the curated entry or the
 * scan, so a row reaches both. The built-in `spend` row under the first of `keys`
 * with one gives its links in order; while rows move out of code, a code row under
 * an earlier key still comes first (`builtInRowsFor`), and then the first key with
 * a row in either code table gives its pool's price, then its slot's or Hit Point
 * Die's. Says whether a row was found.
 */
export function linkSpend(
  col: Collector,
  keys: readonly string[],
  label: string,
  origin: EffectOrigin,
): boolean {
  const rows = builtInRowsFor(col, 'spend', keys, inCode);
  if (rows !== undefined) {
    for (const row of rows) for (const link of row.links ?? []) linkPrice(col, link, label, origin);
    return true;
  }
  return keys.some((key) => linkCodeRows(col, key, label, origin));
}

/** Both code tables' rows under one key: the pool's price, then the slot's or die's. */
export function linkCodeRows(
  col: Collector,
  key: string,
  label: string,
  origin: EffectOrigin,
): boolean {
  const pool = linkPool(col, key, label, origin);
  const slot = linkSlotCost(col, key, label, origin);
  return pool || slot;
}

/**
 * One built-in link on the feature's action (`StoredSpendLink`). A pool's price
 * replaces the one the action has, as it runs first under a key; a spell slot's
 * or a Hit Point Die's runs after it, so it fills only an empty one: a cost goes
 * on an action with none (else on an action of its own), a buy-back on one with
 * none, and a buy-back for another feature's action adds nothing without it.
 */
export function linkPrice(
  col: Collector,
  link: SpendLinkRow,
  label: string,
  origin: EffectOrigin,
): void {
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
  if (target?.kind === 'action') target.buyBack = buyBack;
  else if (!(fills && onAction !== undefined)) {
    col.add({ kind: 'action', economy: 'none', label: onAction ?? label, buyBack, origin });
  }
}

/**
 * A key's code rows as a `spend` row's links: the pool's, then the slot's or
 * die's. What a row moved into `src/rules/cast-guidance/spend.json` says, and
 * what the tests hold the built-in links to while both tables have rows.
 */
export function codeLinksOf(key: string): StoredSpendLink[] {
  const links: StoredSpendLink[] = [];
  const row = SPEND_LINKS[key];
  if (row !== undefined) {
    links.push({
      cost: {
        resource: row.resource,
        amount: row.amount,
        ...(row.optional === true ? { optional: true } : {}),
        ...(row.ownUseToo === true ? { ownUseToo: true } : {}),
      },
      ...(row.economy !== undefined ? { economy: row.economy } : {}),
    });
  }
  const slot = slotLinkOf(key);
  if (slot !== undefined) links.push(slot);
  return links;
}

function linkPool(col: Collector, key: string, label: string, origin: EffectOrigin): boolean {
  const link = SPEND_LINKS[key.toLowerCase()];
  if (link === undefined) return false;
  const cost: ActionCost = {
    resource: link.resource,
    amount: link.amount,
    ...(link.optional === true ? { optional: true } : {}),
    ...(link.ownUseToo === true ? { ownUseToo: true } : {}),
  };
  const own = col.effects.find((e) => e.kind === 'action' && e.origin === origin);
  if (own?.kind === 'action') {
    own.cost = cost;
    if (link.economy !== undefined) own.economy = link.economy;
    return true;
  }
  col.add({ kind: 'action', economy: link.economy ?? 'none', label, cost, origin });
  return true;
}
