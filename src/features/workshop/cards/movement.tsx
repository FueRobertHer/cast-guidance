/** Board 4's speed, senses and initiative. */

import { useState } from 'react';
import { fieldClass } from '@/ui/TextField';
import { Field, Select } from '../fields';
import type { Eff, KindSpec, Options } from './kit/types';
import { amount, amountField, offering, omit, word } from './kit/words';

const KINDS_SENSE: Options = [
  ['darkvision', 'Darkvision'],
  ['blindsight', 'Blindsight'],
  ['tremorsense', 'Tremorsense'],
  ['truesight', 'Truesight'],
];

/** What a speed bonus cannot be worn with (`unless`), as Fast Movement and Unarmored Movement say. */
const UNLESS: Options = [
  ['', 'Any armor, or none'],
  ['heavyArmor', 'Not in heavy armor'],
  ['armorOrShield', 'No armor and no shield'],
];

interface BoxProps {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}

/**
 * Speed multiplied's Times box. The box keeps what was typed ("1.0" on the
 * way to "1.05", or "2.0" left as it is) while the effect holds the number it
 * is; text that is no number is stored as typed, for the reader's problem line.
 * A draft gives way once the effect holds something else (changed elsewhere).
 */
function TimesBox({ effect, title, onChange }: BoxProps) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const shown =
    draft !== undefined && decimal(draft) === effect.factor
      ? draft
      : effect.factor === undefined
        ? ''
        : String(effect.factor);
  return (
    <Field label="Times">
      <input
        aria-label={`${title}: Times`}
        inputMode="decimal"
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          onChange({ ...effect, factor: decimal(e.target.value) });
        }}
        className={fieldClass}
      />
    </Field>
  );
}

/** A speed bonus's armor (`unless`), the width of the card so its words fit a phone. */
function UnlessBox({ effect, title, onChange }: BoxProps) {
  const value = effect.unless === undefined ? '' : String(effect.unless);
  return (
    <div className="col-span-2">
      <Field label="Armor">
        <Select
          aria-label={`${title}: Armor`}
          value={value}
          onChange={(e) =>
            onChange(
              e.target.value === ''
                ? omit(effect, ['unless'])
                : { ...effect, unless: e.target.value },
            )
          }
        >
          {offering(UNLESS, value, `${value}, as written`).map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/**
 * The proficiency bonus on Initiative (`profBonus`), counted once however many
 * add it (2024 Alert): it takes the amount's place, and unticked a number comes back.
 */
function ProfBonusTick({ effect, title, onChange }: BoxProps) {
  return (
    <label className="col-span-2 flex min-h-tap items-center gap-2.5 text-body">
      <input
        type="checkbox"
        className="size-4.5 accent-ink"
        aria-label={`${title}: Your proficiency bonus instead`}
        checked={effect.profBonus === true}
        onChange={(x) =>
          onChange(
            x.target.checked
              ? { ...omit(effect, ['amount']), profBonus: true }
              : { ...omit(effect, ['profBonus']), amount: effect.amount ?? 1 },
          )
        }
      />
      Your proficiency bonus instead
    </label>
  );
}

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
    fields: [amountField],
    line: (e) =>
      e.profBonus === true
        ? 'Your proficiency bonus to Initiative, once however many add it'
        : `${amount(e.amount)} to Initiative`,
    // An amount typed in takes the place of the proficiency bonus.
    set: (e, key, v) =>
      key === 'amount' ? { next: { ...omit(e, ['profBonus']), amount: v } } : undefined,
    // In play and at a moment an effect takes a plain number (the in-play and
    // moment readers refuse `profBonus`), so the tick is offered there only to
    // take back one a file holds.
    boxes: (p) =>
      ((p.inPlay !== true && p.atMoment !== true) || p.effect.profBonus === true) && (
        <ProfBonusTick effect={p.effect} title={p.title} onChange={p.onChange} />
      ),
  },
  {
    kinds: ['speedBonus'],
    add: 'Speed',
    does: 'Raises or lowers your walking speed',
    make: () => ({ kind: 'speedBonus', amount: 5 }),
    fields: [amountField],
    line: (e) =>
      `${amount(e.amount)} ft to your Speed${e.unless === 'heavyArmor' ? ', unless you wear heavy armor' : e.unless === 'armorOrShield' ? ', while you wear no armor and hold no shield' : ''}`,
    boxes: (p) => <UnlessBox effect={p.effect} title={p.title} onChange={p.onChange} />,
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
    // Not a number a formula or a level table may give, and one with a point
    // in it: a box of its own (`TimesBox`).
    fields: [],
    line: (e) => `Walking speed times ${String(e.factor)}`,
    boxes: (p) => <TimesBox effect={p.effect} title={p.title} onChange={p.onChange} />,
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
