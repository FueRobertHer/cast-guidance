import type { RollResult } from './types';

/**
 * The working of a roll, as "[4,(1)] +3": every die face in order, dropped
 * ones in parentheses, then the flat modifiers. Shown under the total in both
 * the toast and the tray's history, which is why it lives here rather than in
 * either of them.
 */
export function rollDetail(result: RollResult): string {
  return result.terms
    .map((t) =>
      t.kind === 'dice'
        ? `[${t.rolls.map((x) => (x.kept ? x.v : `(${x.v})`)).join(',')}]`
        : t.kind === 'multiplier'
          ? `×${t.detail.kind === 'dice' ? `[${t.detail.rolls.map((x) => x.v).join(',')}]` : t.value}`
          : t.value >= 0
            ? `+${t.value}`
            : `${t.value}`,
    )
    .join(' ');
}
