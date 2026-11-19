/** Board 4's speed, senses and initiative. */

import type { KindSpec, Options } from './kit/types';
import { amount, amountField, omit, word } from './kit/words';

const KINDS_SENSE: Options = [
  ['darkvision', 'Darkvision'],
  ['blindsight', 'Blindsight'],
  ['tremorsense', 'Tremorsense'],
  ['truesight', 'Truesight'],
];

export const cards: readonly KindSpec[] = [
  {
    kinds: ['initiativeBonus'],
    add: 'Initiative',
    make: () => ({ kind: 'initiativeBonus', amount: 1 }),
    fields: [amountField],
    line: (e) =>
      e.profBonus === true
        ? 'Your proficiency bonus to Initiative, once however many add it'
        : `${amount(e.amount)} to Initiative`,
    // An amount typed in takes the place of the proficiency bonus.
    set: (e, key, v) =>
      key === 'amount' ? { next: { ...omit(e, ['profBonus']), amount: v } } : undefined,
  },
  {
    kinds: ['speedBonus'],
    add: 'Speed',
    make: () => ({ kind: 'speedBonus', amount: 5 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} ft to your Speed`,
  },
  {
    kinds: ['moveSpeed'],
    add: 'Fly, swim or climb',
    make: () => ({ kind: 'moveSpeed', mode: 'fly', speed: 'walk' }),
    fields: [
      {
        key: 'mode',
        label: 'Kind',
        type: 'pick',
        options: [
          ['fly', 'Fly'],
          ['swim', 'Swim'],
          ['climb', 'Climb'],
        ],
      },
      { key: 'speed', label: 'Feet, or walk', type: 'amount' },
    ],
    line: (e) =>
      `A ${String(e.mode)} speed ${e.speed === 'walk' ? 'equal to your Speed' : `of ${amount(e.speed, false)} ft`}`,
  },
  {
    kinds: ['sense'],
    add: 'Sense',
    make: () => ({ kind: 'sense', sense: 'darkvision', range: 60 }),
    fields: [
      { key: 'sense', label: 'Sense', type: 'pick', options: KINDS_SENSE },
      { key: 'range', label: 'Range in feet', type: 'amount' },
    ],
    line: (e) => `${word(KINDS_SENSE, e.sense)} ${amount(e.range, false)} ft`,
  },
];
