/**
 * Board 4's armor, hit points and defenses: Armor Class and other ways to work
 * it out, the hit point maximum, damage and conditions.
 */

import { AbilityTicks } from './kit/abilityTicks';
import type { Eff, KindSpec, Options } from './kit/types';
import {
  ABILITY,
  amount,
  amountField,
  byAnswerWords,
  isByAnswer,
  listed,
  omit,
  word,
} from './kit/words';

const DAMAGE: Options = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
].map((t) => [t, t] as const);
const CONDITION: Options = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
].map((c) => [c, c] as const);

/**
 * How much of the Dexterity modifier an AC worked out another way counts
 * (`dexMax`). A cap holds a bonus down, never a penalty (`calc/ac.ts` takes
 * the smaller), so "Up to +0" still counts a negative modifier: no Dexterity
 * at all is its tick left empty.
 */
const DEX_MAX: Options = [
  ['', 'In full'],
  ['0', 'Up to +0'],
  ['1', 'Up to +1'],
  ['2', 'Up to +2'],
  ['3', 'Up to +3'],
];

/**
 * A cap on Dexterity means Dexterity counts: picking one ticks it, in the
 * order the ticks store, and unticking it takes the cap away, so the box and
 * the line never say different things.
 */
const withDex = (e: Eff): Eff => {
  const held = Array.isArray(e.addAbilities) ? e.addAbilities.map(String) : [];
  if (held.includes('dex')) return e;
  const known = new Set(ABILITY.map(([v]) => v));
  const order = ABILITY.map(([v]) => v).filter((v) => v === 'dex' || held.includes(v));
  return { ...e, addAbilities: [...order, ...held.filter((v) => !known.has(v))] };
};
const capGoesWithDex = (e: Eff): Eff =>
  Array.isArray(e.addAbilities) && e.addAbilities.includes('dex') ? e : omit(e, ['dexMax']);

/** The heading its cards are listed under on the add sheet. */
export const group = 'Defenses and hit points';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['acBonus'],
    add: 'Armor Class',
    does: 'Raises or lowers Armor Class',
    make: () => ({ kind: 'acBonus', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to Armor Class`,
  },
  {
    kinds: ['maxHpBonus'],
    add: 'Hit points',
    does: 'Raises or lowers your hit point maximum',
    make: () => ({ kind: 'maxHpBonus', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to your hit point maximum`,
  },
  {
    kinds: ['hpPerLevel'],
    add: 'Hit points per level',
    does: 'Raises your hit point maximum for each level',
    make: () => ({ kind: 'hpPerLevel', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} hit point maximum for each level`,
  },
  {
    kinds: ['tempHpEachTurn'],
    add: 'Temporary HP each turn',
    does: 'Temporary hit points at the start of each of your turns, as Heroism gives',
    make: () => ({ kind: 'tempHpEachTurn', amount: 5 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount, false)} temporary hit points at the start of each turn`,
  },
  {
    kinds: ['resist', 'immune', 'vulnerable'],
    add: 'Resistance',
    does: 'Resistance, immunity or vulnerability to a damage type',
    make: () => ({ kind: 'resist', damageType: 'fire' }),
    fields: [
      {
        key: 'kind',
        label: 'Kind',
        type: 'pick',
        options: [
          ['resist', 'Resistance'],
          ['immune', 'Immunity'],
          ['vulnerable', 'Vulnerability'],
        ],
      },
      { key: 'damageType', label: 'Damage', type: 'pick', options: DAMAGE },
    ],
    line: (e) =>
      `${e.kind === 'immune' ? 'Immunity' : e.kind === 'vulnerable' ? 'Vulnerability' : 'Resistance'} ${isByAnswer(e.damageType) ? byAnswerWords(e.damageType) : `to ${String(e.damageType)} damage`}`,
    picks: (ask) => (ask === 'damage' ? 'damageType' : undefined),
  },
  {
    kinds: ['conditionImmune'],
    add: 'Condition immunity',
    does: 'Immunity to a condition, such as Frightened or Poisoned',
    make: () => ({ kind: 'conditionImmune', condition: 'Frightened' }),
    fields: [{ key: 'condition', label: 'Condition', type: 'pick', options: CONDITION }],
    line: (e) => `Immune to the ${String(e.condition)} condition`,
  },
  {
    kinds: ['acFormula'],
    add: 'Another way to work out AC',
    does: 'Armor Class worked out another way, such as 13 plus Dexterity, as natural armor or Unarmored Defense gives',
    make: () => ({ kind: 'acFormula', base: 13, addAbilities: ['dex'] }),
    fields: [
      { key: 'base', label: 'Base', type: 'amount' },
      {
        key: 'dexMax',
        label: 'Dexterity counts',
        type: 'pick',
        options: DEX_MAX,
        apply: (e, v) =>
          v === ''
            ? omit(e, ['dexMax'])
            : withDex({ ...e, dexMax: /^\d+$/.test(v) ? Number(v) : v }),
      },
    ],
    line: (e) => {
      const plus = Array.isArray(e.addAbilities) ? e.addAbilities : [];
      const capped =
        e.dexMax !== undefined && plus.includes('dex')
          ? ` (Dexterity up to +${String(e.dexMax)})`
          : '';
      return `Armor Class is ${amount(e.base, false)}${plus.length > 0 ? ` plus ${listed(plus.map((a) => word(ABILITY, a)))}` : ''}${capped}`;
    },
    boxes: (p) => (
      <AbilityTicks
        effect={p.effect}
        field="addAbilities"
        legend="Plus the modifier of"
        title={p.title}
        onChange={(next) => p.onChange(capGoesWithDex(next))}
      />
    ),
  },
  {
    kinds: ['acMin'],
    add: 'Armor Class is at least',
    does: 'Sets a minimum for Armor Class, as Barkskin does',
    make: () => ({ kind: 'acMin', min: 16 }),
    fields: [{ key: 'min', label: 'At least', type: 'amount' }],
    line: (e) => `Armor Class is at least ${amount(e.min, false)}`,
  },
];
