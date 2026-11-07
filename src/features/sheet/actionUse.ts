import type { DerivedResource, DerivedSheet, PlayState } from '@/engine/types';
import { stripTrailingParenthetical } from '@/lib/trailingParenthetical';

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
  spend: ActionSpend;
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
): { caption: string; restore?: ActionRestore } | undefined {
  const { buyBack, label } = action;
  if (buyBack === undefined) return undefined;
  const pool = resources.find((r) => r.key === buyBack.resource);
  const use =
    buyBack.own !== undefined
      ? resources.find((r) => r.key === buyBack.own)
      : sharingName(resources, label);
  if (pool === undefined || use === undefined) return undefined;

  const { amount } = buyBack;
  const name = stripTrailingParenthetical(pool.label);
  const poolLeft = leftOf(pool);
  const which = use.label.toLowerCase() === label.toLowerCase() ? '' : ` ${use.label}`;
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
 * What an action spends and what can buy it back. See `spendingOf` for the first,
 * which a buy-back never touches: using the feature costs the use, not the price.
 */
export function actionUse(
  action: SheetAction,
  resources: readonly DerivedResource[],
  usedOf: (key: string) => number,
): ActionUse {
  // Uses can sit past the maximum after a character loses a level, until the player clamps them.
  const leftOf = (r: DerivedResource) => Math.max(0, r.max - usedOf(r.key));
  const spending = spendingOf(action, resources, leftOf);
  const buyBack = buyBackOf(action, resources, leftOf);
  if (buyBack === undefined) return spending;
  return {
    ...spending,
    caption: [...spending.caption, buyBack.caption],
    ...(buyBack.restore !== undefined ? { restore: buyBack.restore } : {}),
  };
}

/**
 * Pay for a use and get it back, in one update. All of it or none: a tap that beat
 * the last render must not take the price for a use that is already back, or a price
 * the pool no longer has. A count past the maximum comes back to one use left.
 */
export function applyRestore(entries: PlayState['resources'], restore: ActionRestore): void {
  const entryOf = (key: string) => entries.find((r) => r.key === key);
  const { own, spend } = restore;
  const ownEntry = entryOf(own.key);
  const poolEntry = entryOf(spend.key);
  if (ownEntry === undefined || ownEntry.used < own.max) return;
  if ((poolEntry?.used ?? 0) + spend.amount > spend.max) return;
  ownEntry.used = own.max - 1;
  if (poolEntry !== undefined) poolEntry.used += spend.amount;
  else entries.push({ key: spend.key, used: spend.amount });
}

/**
 * What using an action spends. With no cost, a use of the pool sharing its name.
 * With a cost, what the cost names: a pool that shares the name then belongs to
 * another clause of the feature (Waxing and Waning's free spells) or another source
 * altogether (a race's Darkness), so it pays only when the cost says so (Hand of
 * Ultimate Mercy).
 */
function spendingOf(
  action: SheetAction,
  resources: readonly DerivedResource[],
  leftOf: (r: DerivedResource) => number,
): ActionUse {
  const { cost, economy, label } = action;
  const pool = cost !== undefined ? resources.find((r) => r.key === cost.resource) : undefined;
  const own =
    cost === undefined || cost.ownUseToo === true ? sharingName(resources, label) : undefined;

  const ownLeft = own !== undefined ? leftOf(own) : undefined;
  const ownSpend: ActionSpend[] =
    own !== undefined ? [{ key: own.key, max: own.max, amount: 1 }] : [];
  const ownWords = own !== undefined ? [`a ${own.label} use`] : [];
  const outOfUses = ownLeft === 0;
  const uses = own !== undefined ? [`${ownLeft} of ${own.max} left`] : [];

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
