/** Board 4's speed, senses and initiative. */

import type { KindSpec, Options } from './kit/types';
import { amount, amountField, omit, word } from './kit/words';

const KINDS_SENSE: Options = [
  ['darkvision', 'Darkvision'],
  ['blindsight', 'Blindsight'],
  ['tremorsense', 'Tremorsense'],
  ['truesight', 'Truesight'],
];

/** What a speed bonus cannot be worn with (`unless`), as Fast Movement and Unarmored Movement say. */
const UNLESS: Options = [
  ['', 'Any or none'],
  ['heavyArmor', 'Not heavy armor'],
  ['armorOrShield', 'No armor or shield'],
];

/** A number typed in, as stored: one with a decimal point stays a number too. */
const decimal = (text: string): unknown => {
  const t = text.trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : t;
};

/** The heading its cards are listed under on the add sheet. */
export const group = 'Speed, senses and initiative';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['initiativeBonus'],
    add: 'Initiative',
    does: 'Raises or lowers Initiative, or adds your proficiency bonus to it, as Alert does',
    make: () => ({ kind: 'initiativeBonus', amount: 1 }),
    fields: [
      {
        key: 'profBonus',
        label: 'Adds',
        type: 'pick',
        options: [
          ['', 'A number'],
          ['prof', 'Proficiency bonus'],
        ],
        value: (e) => (e.profBonus === true ? 'prof' : ''),
        // The proficiency bonus takes the amount's place, and a number puts one back.
        apply: (e, v) =>
          v === 'prof'
            ? { ...omit(e, ['amount']), profBonus: true }
            : { ...omit(e, ['profBonus']), amount: e.amount ?? 1 },
      },
      amountField,
    ],
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
    does: 'Raises or lowers your walking speed',
    make: () => ({ kind: 'speedBonus', amount: 5 }),
    fields: [
      amountField,
      {
        key: 'unless',
        label: 'Armor',
        type: 'pick',
        options: UNLESS,
        apply: (e, v) => (v === '' ? omit(e, ['unless']) : { ...e, unless: v }),
      },
    ],
    line: (e) =>
      `${amount(e.amount)} ft to your Speed${e.unless === 'heavyArmor' ? ', unless you wear heavy armor' : e.unless === 'armorOrShield' ? ', while you wear no armor and hold no shield' : ''}`,
  },
  {
    kinds: ['moveSpeed'],
    add: 'Fly, swim or climb',
    does: 'A flying, swimming or climbing speed',
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
    does: 'Darkvision, blindsight, tremorsense or truesight',
    make: () => ({ kind: 'sense', sense: 'darkvision', range: 60 }),
    fields: [
      { key: 'sense', label: 'Sense', type: 'pick', options: KINDS_SENSE },
      { key: 'range', label: 'Range in feet', type: 'amount' },
    ],
    line: (e) => `${word(KINDS_SENSE, e.sense)} ${amount(e.range, false)} ft`,
  },
  {
    kinds: ['speedMultiplier'],
    add: 'Speed multiplied',
    does: 'Multiplies your walking speed, as Haste doubles it',
    make: () => ({ kind: 'speedMultiplier', factor: 2 }),
    // Not a number a formula or a level table may give: a box of its own.
    fields: [{ key: 'factor', label: 'Times', type: 'amount' }],
    line: (e) => `Walking speed times ${String(e.factor)}`,
    set: (e, key, _v, text) =>
      key === 'factor' ? { next: { ...e, factor: decimal(text) } } : undefined,
    // The sheet keeps the largest, from 1: a smaller one never slows you.
    ownProblems: (problems, e) =>
      typeof e.factor === 'number' && e.factor > 0 && e.factor <= 1
        ? [...problems, 'times a number above 1: the sheet only makes your Speed larger this way']
        : problems,
  },
  {
    kinds: ['passivePerceptionBonus'],
    add: 'Passive Perception',
    does: 'Raises or lowers passive Perception, as Observant does',
    make: () => ({ kind: 'passivePerceptionBonus', amount: 5 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to passive Perception`,
    notInPlay: true,
  },
];
