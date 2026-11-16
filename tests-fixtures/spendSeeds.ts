/**
 * What a feature may have emitted before its spend links run, by its own origin
 * or by another's: the states in which a key's code rows (`SPEND_LINKS`,
 * `SLOT_LINKS`) and its built-in `spend` row must leave the same effects. The
 * spend link tests and `scripts/rules-probe.ts` link every key in each.
 */
import type { SpendLinkRow } from '../src/engine/effects/mechanics';
import type { EffectInput, EffectOrigin } from '../src/engine/types';

/** Add what a feature emitted before its links: `own` is its origin, `onAction` the action its buy-back names. */
export type SpendSeed = (
  add: (e: EffectInput) => void,
  own: EffectOrigin,
  onAction: string,
) => void;

const other: EffectOrigin = { label: 'Another', uid: 'another', type: 'class' };
const pool = { resource: 'other-pool', amount: 2 };

export const SPEND_SEEDS: Readonly<Record<string, SpendSeed>> = {
  'no action': () => {},
  'an action': (add, own) =>
    add({ kind: 'action', economy: 'bonus', label: 'Feature', origin: own }),
  'an action with a cost': (add, own) =>
    add({ kind: 'action', economy: 'bonus', label: 'Feature', cost: { ...pool }, origin: own }),
  'an action with a buy-back': (add, own) =>
    add({ kind: 'action', economy: 'bonus', label: 'Feature', buyBack: { ...pool }, origin: own }),
  'an action with a note': (add, own) =>
    add({ kind: 'action', economy: 'bonus', label: 'Feature', note: 'A note.', origin: own }),
  'two actions': (add, own) => {
    add({ kind: 'action', economy: 'reaction', label: 'Feature', origin: own });
    add({ kind: 'action', economy: 'bonus', label: 'Feature Two', cost: { ...pool }, origin: own });
  },
  "another feature's action it names": (add, _own, onAction) =>
    add({ kind: 'action', economy: 'bonus', label: onAction, origin: other }),
  "another feature's action it names, with a buy-back": (add, _own, onAction) =>
    add({ kind: 'action', economy: 'bonus', label: onAction, buyBack: { ...pool }, origin: other }),
  both: (add, own, onAction) => {
    add({ kind: 'action', economy: 'action', label: onAction, origin: other });
    add({ kind: 'action', economy: 'bonus', label: 'Feature', cost: { ...pool }, origin: own });
  },
};

/** The action a key's buy-back names, for the seeds that hold one; else a name no link uses. */
export function onActionOf(links: readonly SpendLinkRow[]): string {
  return (
    links.flatMap((l) => ('buyBack' in l && l.onAction !== undefined ? [l.onAction] : []))[0] ??
    'Another Feature'
  );
}
