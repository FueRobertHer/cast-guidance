import {
  type ActionCost,
  type DerivedResource,
  type DerivedSheet,
  HIT_DIE_COST,
  type PlayState,
  SLOT_COST,
  type SlotPrice,
} from '@/engine/types';
import { stripTrailingParenthetical } from '@/lib/trailingParenthetical';
import { slotPriceWords } from './slotCost';

type SheetAction = DerivedSheet['actions'][number];

export interface ActionSpend {
  key: string;
  max: number;
  amount: number;
}

/** The button that buys a use back, shown only when none are left. */
export interface ActionRestore {
  /** The use it gives back, as the Resources row names it. */
  label: string;
  own: { key: string; max: number };
  /** The pool it pays from; none when a spell slot pays (`slot`), picked in the roll prompt. */
  spend?: ActionSpend;
  slot?: SlotPrice;
  ariaLabel: string;
  disabled: boolean;
  title: string;
}

export interface ActionUse {
  /** What tapping Use spends. */
  spends: readonly ActionSpend[];
  /** It takes no slot and spends nothing by itself, so a Use button would do nothing. */
  noButton: boolean;
  disabled: boolean;
  title: string;
  /** How many uses are left and what the pool takes, for the caption. */
  caption: readonly string[];
  /** The second button, when the base use is free and the pool pays for more. */
  paid?: {
    label: string;
    ariaLabel: string;
    spends: readonly ActionSpend[];
    disabled: boolean;
    title: string;
  };
  restore?: ActionRestore;
  /** What tapping Use gives back, as well as what it spends. */
  regains?: { key: string; max: number; amount: number };
  /** Use pays with a spell slot as well, picked in the roll prompt: the price and what it buys. */
  slot?: ActionCost;
  /** Use pays with a Hit Point Die as well, and heals by it. */
  hitDie?: ActionCost;
}

/** What the character has left to pay a spell slot or Hit Point Die price with. */
export interface Paying {
  slotsLeft: (price: SlotPrice) => number;
  hitDiceLeft: number;
}

const NOTHING_TO_PAY: Paying = { slotsLeft: () => 0, hitDiceLeft: 0 };

/** "Spell slots: level 5+", "Pact slots", as a caption starts. */
function slotHeading(price: SlotPrice): string {
  const name = price.pactOnly === true ? 'Pact slots' : 'Spell slots';
  const min = price.minLevel ?? 1;
  return min > 1 ? `${name}: level ${String(min)}+` : name;
}

const SLOT_WORD = { action: 'action', bonus: 'bonus action', reaction: 'reaction' } as const;

function titleFor(economy: SheetAction['economy'], spendWords: readonly string[]): string {
  const parts = [
    ...(economy === 'none' ? [] : [`marks your ${SLOT_WORD[economy]}`]),
    ...(spendWords.length > 0 ? [`spends ${spendWords.join(' and ')}`] : []),
  ];
  return `Use: ${parts.join(' and ')}`;
}

const sharingName = (resources: readonly DerivedResource[], label: string) =>
  resources.find((r) => r.label.toLowerCase() === label.toLowerCase());

/**
 * The price of another use, for the caption, and the button once none are left. A
 * use on another row is named, since the chip's own name does not say which it is
 * (Telekinetic Master's chip is its bonus attack, and the use is the spell's).
 */
function buyBackOf(
  action: SheetAction,
  resources: readonly DerivedResource[],
  leftOf: (r: DerivedResource) => number,
  paying: Paying,
): { caption: string; restore?: ActionRestore } | undefined {
  const { buyBack, label } = action;
  if (buyBack === undefined) return undefined;
  const use =
    buyBack.own !== undefined
      ? resources.find((r) => r.key === buyBack.own)
      : sharingName(resources, label);
  if (use === undefined) return undefined;
  const which = use.label.toLowerCase() === label.toLowerCase() ? '' : ` ${use.label}`;
  if (buyBack.resource === SLOT_COST) {
    const left = paying.slotsLeft(buyBack);
    const words = slotPriceWords(buyBack);
    const caption = `${slotHeading(buyBack)} to restore${which}, ${String(left)} left`;
    if (leftOf(use) > 0) return { caption };
    const price: SlotPrice = {
      ...(buyBack.minLevel !== undefined ? { minLevel: buyBack.minLevel } : {}),
      ...(buyBack.pactOnly === true ? { pactOnly: true } : {}),
    };
    return {
      caption,
      restore: {
        label: use.label,
        own: { key: use.key, max: use.max },
        slot: price,
        ariaLabel: `Restore ${use.label}, spending ${words}`,
        disabled: left === 0,
        title:
          left === 0
            ? `No slot left to pay: it takes ${words}`
            : `Restore: spends ${words} for one more use`,
      },
    };
  }
  const pool = resources.find((r) => r.key === buyBack.resource);
  if (pool === undefined) return undefined;

  const { amount } = buyBack;
  const name = stripTrailingParenthetical(pool.label);
  const poolLeft = leftOf(pool);
  const caption = `${name}: ${amount} to restore${which}, ${poolLeft} of ${pool.max} left`;
  if (leftOf(use) > 0) return { caption };

  const short = poolLeft < amount;
  return {
    caption,
    restore: {
      label: use.label,
      own: { key: use.key, max: use.max },
      spend: { key: pool.key, max: pool.max, amount },
      ariaLabel: `Restore ${use.label}, spending ${amount} ${name}`,
      disabled: short,
      title: short ? `Not enough ${name}` : `Restore: spends ${amount} ${name} for one more use`,
    },
  };
}

/**
 * Add what Use refills. With nothing spent there is nothing to refill, so a tap would
 * only cost the use: the button goes off and says why.
 */
function withRegain(
  use: ActionUse,
  action: SheetAction,
  resources: readonly DerivedResource[],
  leftOf: (r: DerivedResource) => number,
): ActionUse {
  const { regains } = action;
  const pool =
    regains !== undefined ? resources.find((r) => r.key === regains.resource) : undefined;
  if (regains === undefined || pool === undefined) return use;
  const { amount } = regains;
  const name = stripTrailingParenthetical(pool.label);
  const left = leftOf(pool);
  const full = left >= pool.max;
  const title = use.disabled
    ? use.title
    : full
      ? `No ${name} to regain`
      : `${use.title} and regains ${amount} ${name}`;
  return {
    ...use,
    regains: { key: pool.key, max: pool.max, amount },
    caption: [...use.caption, `${name}: regains ${amount}, ${left} of ${pool.max} left`],
    disabled: use.disabled || full,
    title,
  };
}

/**
 * What an action spends and what can buy it back. See `spendingOf` for the first,
 * which a buy-back never touches: using the feature costs the use, not the price.
 */
export function actionUse(
  action: SheetAction,
  resources: readonly DerivedResource[],
  usedOf: (key: string) => number,
  paying: Paying = NOTHING_TO_PAY,
): ActionUse {
  // Uses can sit past the maximum after a character loses a level, until the player clamps them.
  const leftOf = (r: DerivedResource) => Math.max(0, r.max - usedOf(r.key));
  const use = withRegain(spendingOf(action, resources, leftOf, paying), action, resources, leftOf);
  const buyBack = buyBackOf(action, resources, leftOf, paying);
  if (buyBack === undefined) return use;
  return {
    ...use,
    caption: [...use.caption, buyBack.caption],
    ...(buyBack.restore !== undefined ? { restore: buyBack.restore } : {}),
  };
}

/**
 * Pay for a use and get it back, in one update. All of it or none: a tap that beat
 * the last render must not take the price for a use that is already back, or a price
 * the pool no longer has. A count past the maximum comes back to one use left. A
 * slot's price is the caller's to spend, once this says the use came back.
 */
export function applyRestore(entries: PlayState['resources'], restore: ActionRestore): boolean {
  const entryOf = (key: string) => entries.find((r) => r.key === key);
  const { own, spend } = restore;
  const ownEntry = entryOf(own.key);
  const poolEntry = spend !== undefined ? entryOf(spend.key) : undefined;
  if (ownEntry === undefined || ownEntry.used < own.max) return false;
  if (spend !== undefined && (poolEntry?.used ?? 0) + spend.amount > spend.max) return false;
  ownEntry.used = own.max - 1;
  if (spend === undefined) return true;
  if (poolEntry !== undefined) poolEntry.used += spend.amount;
  else entries.push({ key: spend.key, used: spend.amount });
  return true;
}

/**
 * What using an action spends. With no cost, a use of the pool sharing its name.
 * With a cost, what the cost names: a pool that shares the name then belongs to
 * another clause of the feature (Waxing and Waning's free spells) or another source
 * altogether (a race's Darkness), so it pays only when the cost says so (Hand of
 * Ultimate Mercy). A chip whose feature's use another chip spends (`spendsNoUse`)
 * takes none of it.
 */
function spendingOf(
  action: SheetAction,
  resources: readonly DerivedResource[],
  leftOf: (r: DerivedResource) => number,
  paying: Paying,
): ActionUse {
  const { cost, economy, label } = action;
  const pool = cost !== undefined ? resources.find((r) => r.key === cost.resource) : undefined;
  const own =
    action.spendsNoUse !== true && (cost === undefined || cost.ownUseToo === true)
      ? sharingName(resources, label)
      : undefined;

  const ownLeft = own !== undefined ? leftOf(own) : undefined;
  const ownSpend: ActionSpend[] =
    own !== undefined ? [{ key: own.key, max: own.max, amount: 1 }] : [];
  const ownWords = own !== undefined ? [`a ${own.label} use`] : [];
  const outOfUses = ownLeft === 0;
  const uses = own !== undefined ? [`${ownLeft} of ${own.max} left`] : [];

  if (cost?.resource === SLOT_COST || cost?.resource === HIT_DIE_COST) {
    return paidInSlotOrDie(cost, economy, resources, leftOf, paying, {
      ownSpend,
      ownWords,
      outOfUses,
      uses,
    });
  }

  if (pool === undefined || cost === undefined) {
    return {
      spends: ownSpend,
      noButton: economy === 'none' && own === undefined,
      disabled: outOfUses,
      title: outOfUses ? 'No uses left' : titleFor(economy, ownWords),
      caption: uses,
    };
  }

  const name = stripTrailingParenthetical(pool.label);
  const poolLeft = leftOf(pool);
  const inPool = `${poolLeft} of ${pool.max} left`;

  if (cost.amount === 'varies') {
    return {
      spends: ownSpend,
      noButton: economy === 'none' && own === undefined,
      disabled: outOfUses,
      title: outOfUses ? 'No uses left' : titleFor(economy, ownWords),
      caption: [...uses, `${name}: you choose, ${inPool}`],
    };
  }

  const { amount } = cost;
  const spend: ActionSpend = { key: pool.key, max: pool.max, amount };
  const words = `${amount} ${name}`;
  const short = poolLeft < amount;
  const blockedTitle = outOfUses ? 'No uses left' : `Not enough ${name}`;

  if (cost.optional === true) {
    return {
      spends: ownSpend,
      noButton: economy === 'none' && own === undefined,
      disabled: outOfUses,
      title: outOfUses ? 'No uses left' : titleFor(economy, ownWords),
      caption: [...uses, `${name}: ${amount} for more, ${inPool}`],
      paid: {
        label: `+${words}`,
        ariaLabel: `Use ${label}, spending ${words}`,
        spends: [...ownSpend, spend],
        disabled: outOfUses || short,
        title: outOfUses || short ? blockedTitle : titleFor(economy, [...ownWords, words]),
      },
    };
  }

  return {
    spends: [...ownSpend, spend],
    noButton: false,
    disabled: outOfUses || short,
    title: outOfUses || short ? blockedTitle : titleFor(economy, [...ownWords, words]),
    caption: [...uses, `${name}: ${amount}, ${inPool}`],
  };
}

/**
 * Use paying with a spell slot or a Hit Point Die, picked as it is paid: what
 * is left of them, and the pool a slot refills (Font of Magic), which must have
 * points spent for a slot to turn into.
 */
function paidInSlotOrDie(
  cost: ActionCost,
  economy: SheetAction['economy'],
  resources: readonly DerivedResource[],
  leftOf: (r: DerivedResource) => number,
  paying: Paying,
  own: { ownSpend: ActionSpend[]; ownWords: string[]; outOfUses: boolean; uses: string[] },
): ActionUse {
  const slot = cost.resource === SLOT_COST;
  const left = slot ? paying.slotsLeft(cost) : paying.hitDiceLeft;
  const words = slot ? slotPriceWords(cost) : 'a Hit Point Die';
  const refill =
    slot && cost.slotRefills !== undefined
      ? resources.find((r) => r.key === cost.slotRefills)
      : undefined;
  const refillName = refill !== undefined ? stripTrailingParenthetical(refill.label) : '';
  const blocked = own.outOfUses
    ? 'No uses left'
    : left === 0
      ? `None left to pay: it takes ${words}`
      : refill !== undefined && leftOf(refill) >= refill.max
        ? `No ${refillName} to regain`
        : undefined;
  const regains =
    refill !== undefined ? ` and regains as many ${refillName} as the slot's level` : '';
  return {
    spends: own.ownSpend,
    noButton: false,
    disabled: blocked !== undefined,
    title: blocked ?? `${titleFor(economy, [...own.ownWords, words])}${regains}`,
    caption: [
      ...own.uses,
      `${slot ? slotHeading(cost) : 'Hit Point Dice'}: ${String(left)} left`,
      ...(refill !== undefined
        ? [
            `${refillName}: regains the slot's level, ${String(leftOf(refill))} of ${String(refill.max)} left`,
          ]
        : []),
    ],
    ...(slot ? { slot: cost } : { hitDie: cost }),
  };
}
