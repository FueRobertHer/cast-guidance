/** Board 4's abilities and proficiencies: scores, skills, saves, tools, weapons, languages. */
import { SKILLS } from '@/engine/types';
import type { KindSpec } from './kit/types';
import { ABILITY, amount, amountField, word } from './kit/words';

/** The heading its cards are listed under on the add sheet. */
export const group = 'Abilities and proficiencies';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['abilityBonus'],
    add: 'Ability score',
    does: 'Raises or lowers an ability score',
    make: () => ({ kind: 'abilityBonus', ability: 'str', amount: 1 }),
    fields: [{ key: 'ability', label: 'Ability', type: 'pick', options: ABILITY }, amountField],
    line: (e) => `${amount(e.amount)} ${word(ABILITY, e.ability)}`,
    picks: (ask) => (ask === 'save' ? 'ability' : undefined),
  },
  {
    kinds: ['abilityMin'],
    add: 'Ability score is at least',
    does: 'Sets a minimum for an ability score, as some items do',
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
    does: 'Proficiency or expertise in a skill',
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
    does: 'Proficiency in a saving throw',
    make: () => ({ kind: 'saveProf', ability: 'wis' }),
    fields: [{ key: 'ability', label: 'Ability', type: 'pick', options: ABILITY }],
    line: (e) => `Proficiency in ${word(ABILITY, e.ability)} saving throws`,
    picks: (ask) => (ask === 'save' ? 'ability' : undefined),
  },
  {
    kinds: ['language'],
    add: 'Language',
    does: 'A language you speak, read and write',
    make: () => ({ kind: 'language', name: 'Elvish' }),
    fields: [{ key: 'name', label: 'Language', type: 'text' }],
    line: (e) => `You know ${String(e.name)}`,
  },
  {
    kinds: ['toolProf'],
    add: 'Tool',
    does: 'Proficiency with a tool or instrument',
    make: () => ({ kind: 'toolProf', name: "Thieves' Tools" }),
    fields: [{ key: 'name', label: 'Tool', type: 'text' }],
    line: (e) => `Proficiency with ${String(e.name)}`,
  },
  {
    kinds: ['weaponProf'],
    add: 'Weapon',
    does: 'Proficiency with a weapon',
    make: () => ({ kind: 'weaponProf', name: 'longsword' }),
    fields: [{ key: 'name', label: 'Weapon', type: 'text' }],
    line: (e) => `Proficiency with ${String(e.name)}`,
  },
];
