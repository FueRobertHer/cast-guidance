import type { DerivedResource, DerivedSheet } from '@/engine/types';
import { stripTrailingParenthetical } from '@/lib/trailingParenthetical';

type SheetAction = DerivedSheet['actions'][number];

export interface ActionSpend {
  key: string;
  max: number;
  amount: number;
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
}

const SLOT_WORD = { action: 'action', bonus: 'bonus action', reaction: 'reaction' } as const;

function titleFor(economy: SheetAction['economy'], spendWords: readonly string[]): string {
  const parts = [
    ...(economy === 'none' ? [] : [`marks your ${SLOT_WORD[economy]}`]),
    ...(spendWords.length > 0 ? [`spends ${spendWords.join(' and ')}`] : []),
  ];
  return `Use: ${parts.join(' and ')}`;
}

/**
 * What using an action spends. With no cost, a use of the pool sharing its name.
 * With a cost, what the cost names: a pool that shares the name then belongs to
 * another clause of the feature (Waxing and Waning's free spells) or another source
 * altogether (a race's Darkness), so it pays only when the cost says so (Hand of
 * Ultimate Mercy).
 */
export function actionUse(
  action: SheetAction,
  resources: readonly DerivedResource[],
  usedOf: (key: string) => number,
): ActionUse {
  const { cost, economy, label } = action;
  const pool = cost !== undefined ? resources.find((r) => r.key === cost.resource) : undefined;
  const own =
    cost === undefined || cost.ownUseToo === true
      ? resources.find((r) => r.label.toLowerCase() === label.toLowerCase())
      : undefined;

  const ownLeft = own !== undefined ? own.max - usedOf(own.key) : undefined;
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
  const poolLeft = pool.max - usedOf(pool.key);
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
