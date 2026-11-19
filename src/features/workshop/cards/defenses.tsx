/** Board 4's armor, hit points and defenses: Armor Class, the hit point maximum, damage and conditions. */

import type { KindSpec, Options } from './kit/types';
import { amount, amountField, byAnswerWords, isByAnswer } from './kit/words';

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
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
].map((c) => [c, c] as const);

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
];
