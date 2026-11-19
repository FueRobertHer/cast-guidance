/** Board 4's abilities and proficiencies: scores, skills, saves, tools, armor, weapons, languages. */
import { SKILLS } from '@/engine/types';
import { AbilityTicks } from './kit/abilityTicks';
import type { KindSpec, Options } from './kit/types';
import { ABILITY, amount, amountField, listed, omit, word } from './kit/words';

/** How high a bonus may take a score (`max`); with none, 20. */
const LIMITS: Options = [
  ['', 'Up to 20'],
  ...Array.from({ length: 10 }, (_, i) => [String(21 + i), `Up to ${21 + i}`] as const),
];

/**
 * Armor training, in the data's own words, so it is the same training a class
 * gives (`class.ts`) and a feat's "proficiency with heavy armor" sees it.
 */
const ARMOR: Options = [
  ['light', 'Light'],
  ['medium', 'Medium'],
  ['heavy', 'Heavy'],
  ['shield', 'Shields'],
];
/** Armor training as a sentence says it: "heavy armor", "shields", or as written. */
const armorWords = (v: unknown) =>
  v === 'shield' ? 'shields' : ARMOR.some(([k]) => k === v) ? `${String(v)} armor` : String(v);

/** A picked value as stored: a whole number stays a number, anything else as picked. */
const whole = (v: string): unknown => (/^\d+$/.test(v) ? Number(v) : v);

/** The heading its cards are listed under on the add sheet. */
export const group = 'Abilities and proficiencies';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['abilityBonus'],
    add: 'Ability score',
    does: 'Raises or lowers an ability score, past 20 where it says how far',
    make: () => ({ kind: 'abilityBonus', ability: 'str', amount: 1 }),
    fields: [
      { key: 'ability', label: 'Ability', type: 'pick', options: ABILITY },
      amountField,
      {
        key: 'max',
        label: 'Limit',
        type: 'pick',
        options: LIMITS,
        apply: (e, v) => (v === '' ? omit(e, ['max']) : { ...e, max: whole(v) }),
      },
    ],
    line: (e) =>
      `${amount(e.amount)} ${word(ABILITY, e.ability)}${e.max === undefined ? '' : `, up to ${String(e.max)}`}`,
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
  {
    kinds: ['armorProf'],
    add: 'Armor training',
    does: 'Proficiency with light, medium or heavy armor, or with shields',
    make: () => ({ kind: 'armorProf', name: 'heavy' }),
    fields: [{ key: 'name', label: 'Armor', type: 'pick', options: ARMOR }],
    line: (e) => `Trained with ${armorWords(e.name)}`,
    notInPlay: true,
  },
  {
    kinds: ['weaponMastery'],
    add: 'Weapon mastery',
    does: "The mastery property of a kind of weapon you are proficient with, such as a longsword's Sap",
    make: () => ({ kind: 'weaponMastery', name: 'longsword' }),
    // The kind of weapon as the data names its base item: one weapon, in the singular.
    fields: [{ key: 'name', label: 'Kind of weapon', type: 'text' }],
    line: (e) => `You can use the mastery property of the ${String(e.name)}`,
    notInPlay: true,
  },
  {
    kinds: ['halfProf'],
    add: 'Half proficiency',
    does: 'Half your proficiency bonus on checks that lack it, as Jack of All Trades gives',
    make: () => ({ kind: 'halfProf', round: 'down' }),
    fields: [
      {
        key: 'round',
        label: 'Rounded',
        type: 'pick',
        options: [
          ['down', 'Down'],
          ['up', 'Up'],
        ],
        // A file that leaves it out rounds down.
        value: (e) => (e.round === undefined ? 'down' : String(e.round)),
      },
    ],
    line: (e) => {
      const of = Array.isArray(e.abilities) ? e.abilities.map((a) => word(ABILITY, a)) : [];
      const checks = `${e.skillsOnly === true ? 'skill ' : ''}checks`;
      return `Half your proficiency bonus, rounded ${e.round === 'up' ? 'up' : 'down'}, on ${of.length > 0 ? `${listed(of)} ` : ''}${checks} without it`;
    },
    boxes: (p) => (
      <>
        <label className="col-span-2 flex min-h-tap items-center gap-2.5 text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-ink"
            aria-label={`${p.title}: Skill checks only`}
            checked={p.effect.skillsOnly === true}
            onChange={(x) =>
              p.onChange(
                x.target.checked
                  ? { ...p.effect, skillsOnly: true }
                  : omit(p.effect, ['skillsOnly']),
              )
            }
          />
          Skill checks only
        </label>
        <AbilityTicks
          effect={p.effect}
          field="abilities"
          legend="Only checks of"
          title={p.title}
          onChange={p.onChange}
        />
      </>
    ),
    notInPlay: true,
  },
];
