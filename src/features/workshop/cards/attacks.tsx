/** Board 4's attacks and damage: to hit, and weapon damage. */

import type { Eff, KindSpec, Options } from './kit/types';
import { amount, amountField, asWritten, omit } from './kit/words';

const SCOPE: Options = [
  ['all', 'All'],
  ['melee', 'Melee'],
  ['ranged', 'Ranged'],
];
/**
 * The Attack rolls card's Which for a bonus to every attack, weapon and spell
 * (`attack: 'any'`): no scope, so a file's scope is never taken for it.
 */
const EVERY_ATTACK = ':every';
/** An attack bonus that reaches spell attacks as well as weapon attacks (`slots.ts`). */
const everyAttack = (e: Eff) => e.attack === 'any' && (e.scope === 'all' || e.scope === undefined);

export const cards: readonly KindSpec[] = [
  {
    kinds: ['attackBonus'],
    add: 'Attack rolls',
    make: () => ({ kind: 'attackBonus', amount: 1, scope: 'all' }),
    fields: [
      amountField,
      {
        key: 'scope',
        label: 'Which',
        type: 'pick',
        // Short enough for its half of the card at phone width; the line says the rest.
        options: [...SCOPE, [EVERY_ATTACK, 'Every attack']],
        // A level table shows as its own choice (`asWritten`).
        value: (e) =>
          asWritten(e.scope) !== undefined
            ? ''
            : everyAttack(e)
              ? EVERY_ATTACK
              : String(e.scope ?? 'all'),
        // A spell attack is one modifier for melee and ranged alike, so only a
        // bonus to every attack reaches it; melee or ranged are weapon attacks.
        apply: (e, v) =>
          v === EVERY_ATTACK
            ? { ...e, scope: 'all', attack: 'any' }
            : { ...omit(e, ['attack']), scope: v },
      },
    ],
    line: (e) =>
      everyAttack(e)
        ? `${amount(e.amount)} to every attack roll, weapon and spell`
        : `${amount(e.amount)} to ${e.scope === 'all' || e.scope === undefined ? '' : `${String(e.scope)} `}attack rolls`,
  },
  {
    kinds: ['damageBonus'],
    add: 'Damage',
    make: () => ({ kind: 'damageBonus', amount: 1, scope: 'all' }),
    fields: [amountField, { key: 'scope', label: 'Which', type: 'pick', options: SCOPE }],
    line: (e) =>
      `${amount(e.amount)} to ${e.scope === 'all' || e.scope === undefined ? '' : `${String(e.scope)} `}damage rolls`,
  },
];
