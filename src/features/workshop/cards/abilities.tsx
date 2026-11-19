/** Board 4's abilities and proficiencies: scores, skills, saves, tools, weapons, languages. */
import { SKILLS } from '@/engine/types';
import type { KindSpec } from './kit/types';
import { ABILITY, amount, amountField, word } from './kit/words';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['abilityBonus'],
    add: 'Ability score',
    make: () => ({ kind: 'abilityBonus', ability: 'str', amount: 1 }),
    fields: [{ key: 'ability', label: 'Ability', type: 'pick', options: ABILITY }, amountField],
    line: (e) => `${amount(e.amount)} ${word(ABILITY, e.ability)}`,
    picks: (ask) => (ask === 'save' ? 'ability' : undefined),
  },
  {
    kinds: ['abilityMin'],
    add: 'Ability score is at least',
    make: () => ({ kind: 'abilityMin', ability: 'str', min: 19 }),
    fields: [
      { key: 'ability', label: 'Ability', type: 'pick', options: ABILITY },
      { key: 'min', label: 'At least', type: 'amount' },
    ],
    line: (e) => `${word(ABILITY, e.ability)} is at least ${amount(e.min, false)}`,
  },
  {
    kinds: ['skillProf'],
    add: 'Skill',
    make: () => ({ kind: 'skillProf', skill: 'Perception', level: 1 }),
    fields: [
      {
        key: 'skill',
        label: 'Skill',
        type: 'pick',
        options: SKILLS.map((s) => [s.name, s.name] as const),
      },
      {
        key: 'level',
        label: 'Level',
        type: 'pick',
        options: [
          ['1', 'Proficiency'],
          ['2', 'Expertise'],
        ],
      },
    ],
    line: (e) => `${e.level === 2 ? 'Expertise' : 'Proficiency'} in ${String(e.skill)}`,
    picks: (ask) => (ask === 'skill' ? 'skill' : undefined),
  },
  {
    kinds: ['saveProf'],
    add: 'Save proficiency',
    make: () => ({ kind: 'saveProf', ability: 'wis' }),
    fields: [{ key: 'ability', label: 'Ability', type: 'pick', options: ABILITY }],
    line: (e) => `Proficiency in ${word(ABILITY, e.ability)} saving throws`,
    picks: (ask) => (ask === 'save' ? 'ability' : undefined),
  },
  {
    kinds: ['language'],
    add: 'Language',
    make: () => ({ kind: 'language', name: 'Elvish' }),
    fields: [{ key: 'name', label: 'Language', type: 'text' }],
    line: (e) => `You know ${String(e.name)}`,
  },
  {
    kinds: ['toolProf'],
    add: 'Tool',
    make: () => ({ kind: 'toolProf', name: "Thieves' Tools" }),
    fields: [{ key: 'name', label: 'Tool', type: 'text' }],
    line: (e) => `Proficiency with ${String(e.name)}`,
  },
  {
    kinds: ['weaponProf'],
    add: 'Weapon',
    make: () => ({ kind: 'weaponProf', name: 'longsword' }),
    fields: [{ key: 'name', label: 'Weapon', type: 'text' }],
    line: (e) => `Proficiency with ${String(e.name)}`,
  },
];
