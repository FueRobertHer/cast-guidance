/**
 * What an entry does on the sheet, built as cards (ADR-001, D2; the Spell
 * board's A). Each card is one effect kind the engine already counts, read
 * back as a sentence, with the few controls that kind takes. The list is
 * stored as `castGuidance.effects` (`StoredEffect`) and checked by the same
 * reader the sheet uses, so a card that would not count says why, here.
 */
import { CircleAlert, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import {
  EFFECT_EDITIONS,
  isRecord,
  type StoredEffect,
  type StoredState,
} from '@/engine/castGuidance';
import { readStoredEffects } from '@/engine/effects/mechanics';
import { HIT_DIE_COST, type RollFilter, SKILLS, SLOT_COST, type SlotPrice } from '@/engine/types';
import { rollsWords } from '@/features/sheet/effectsInPlay';
import { slotPriceWords } from '@/features/sheet/slotCost';
import { signed } from '@/lib/signed';
import { Chip } from '@/ui/Chip';
import { askChoice } from '@/ui/dialogs';
import { fieldClass } from '@/ui/TextField';
import type { EditorProps } from './editorTypes';
import { ABILITY_WORDS, Field, Section, Select } from './fields';

type Eff = StoredEffect;
type Options = ReadonlyArray<readonly [string, string]>;

const ABILITY: Options = ABILITY_WORDS;
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
/**
 * The rolls an Advantage or Added die card can name, each one stored filter,
 * worded as the sheet words it (`rollsWords`).
 */
const ROLL_KINDS: ReadonlyArray<readonly [string, RollFilter]> = [
  ['attack', { rolls: ['attack'] }],
  ['save', { rolls: ['save'] }],
  ['death', { rolls: ['save'], save: 'death' }],
  ['concentration', { rolls: ['save'], save: 'concentration' }],
  ['check', { rolls: ['check'] }],
  ['proficient', { rolls: ['check'], proficient: true }],
  ['initiative', { rolls: ['check'], initiative: true }],
];
/** The kinds an ability narrows: a death save has none, and the others name theirs. */
const TAKES_ABILITY = new Set(['attack', 'save', 'check', 'proficient']);
const SCOPE: Options = [
  ['all', 'All'],
  ['melee', 'Melee'],
  ['ranged', 'Ranged'],
];
const STATES: Options = [
  ['', 'Always'],
  ['bloodied', 'While bloodied'],
  ['concentrating', 'While concentrating'],
  ['noArmor', 'While wearing no armor'],
  ['shield', 'While holding a shield'],
];

/**
 * The rules version an effect counts under alone (`edition`), as a card's (and
 * a class's pool's) "Rules" box offers it. "Either rules" takes it away.
 */
const EDITIONS: Options = [
  ['', 'Either rules'],
  ['2014', '2014 rules only'],
  ['2024', '2024 rules only'],
];
export const editionOf = (e: Eff) =>
  EFFECT_EDITIONS.find((v) => v === e.edition) as (typeof EFFECT_EDITIONS)[number] | undefined;

/** The Rules box's choice for an `edition` a file gives that is not a rules version. */
const AS_WRITTEN = 'as written';

/**
 * A Rules box's value and choices. An `edition` a file gives that is not a
 * rules version shows as written, so "Either rules" is a change that takes it away.
 */
export function editionBox(e: Eff): { value: string; options: Options } {
  const edition = editionOf(e);
  if (edition !== undefined || e.edition === undefined)
    return { value: edition ?? '', options: EDITIONS };
  const raw = typeof e.edition === 'string' ? e.edition : JSON.stringify(e.edition);
  return {
    value: AS_WRITTEN,
    options: [...EDITIONS, [AS_WRITTEN, `${raw} (not a rules version)`]],
  };
}

/**
 * Whether a pool's or an action's name says the class that gives it: never,
 * always (`ownClass`), or only beside another class it lists (`ownClassBeside`).
 */
const NAMINGS: Options = [
  ['', 'Never'],
  ['own', 'Always'],
  ['beside', 'Beside a class'],
];

/** Class names as a box holds them, "Paladin, Cleric", as a list. */
const classList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

const word = (options: Options, v: unknown) => options.find(([k]) => k === v)?.[1] ?? String(v);

/** A stored number as a sentence reads it: `+2`, or the formula itself. */
function amount(v: unknown, sign = true): string {
  if (typeof v === 'number') return sign ? signed(v) : String(v);
  if (typeof v === 'object' && v !== null && 'f' in v) return `(${String(v.f)})`;
  return 'a number by level';
}

/** A stored level table (`{ "byLevel": ... }`), of numbers or of words. */
export const isByLevel = (v: unknown): v is { byLevel: Record<string, unknown> } =>
  isRecord(v) && isRecord(v.byLevel);

/** Stored words as one value: a level table's first level's, else as written. */
export function firstWords(v: unknown): string {
  if (!isByLevel(v)) return String(v);
  const [first] = Object.entries(v.byLevel).sort(([a], [b]) => Number(a) - Number(b));
  return first === undefined ? '' : String(first[1]);
}

/** Stored words as a sentence reads them: a level table's by its first level's. */
function words(v: unknown): string {
  if (!isByLevel(v)) return String(v);
  const first = firstWords(v);
  return first === '' ? 'words by level' : `${first}, by level`;
}

/**
 * What a box shows for a level table, which a file may hold and no box edits:
 * picking or typing a value puts that one value in its place.
 */
export const BY_LEVEL = 'By level, as written';

/**
 * What a file's `ownClass` or `ownClassBeside` adds to a pool's or an action's
 * name: the sheet names it for the class that gives it, "Channel Divinity
 * (Paladin)", always or only beside a class it lists.
 */
function classWords(e: Eff): string {
  if (e.ownClass === true) return ' (name of the class that gives it)';
  const beside = Array.isArray(e.ownClassBeside) ? e.ownClassBeside.map(String) : [];
  return beside.length === 0
    ? ''
    : ` (name of the class that gives it, beside a level in ${beside.join(' or ')})`;
}

/** When a pool comes back, as a sentence reads it. */
const restWords = (v: unknown) =>
  isByLevel(v)
    ? 'a rest that changes by level'
    : v === 'short'
      ? 'a short or long rest'
      : 'a long rest';

type FieldSpec =
  | { key: string; label: string; type: 'pick'; options: Options }
  | { key: string; label: string; type: 'amount' | 'text' | 'dice' };

interface KindSpec {
  kinds: readonly string[];
  /** For a kind two cards share: whether this card is the one for `e`. */
  is?: (e: Eff) => boolean;
  /** What the add list calls it. */
  add: string;
  make: () => Eff;
  fields: readonly FieldSpec[];
  line: (e: Eff) => string;
}

const amountField: FieldSpec = { key: 'amount', label: 'Amount', type: 'amount' };

/**
 * An effect's roll filter as the reader reads it, so a stored one it refuses
 * (abilities as a word, a roll it does not know) is worded as no filter, not
 * thrown or misread; the card's problem line says what is wrong.
 */
function filterOf(e: Eff): RollFilter | undefined {
  const read = readStoredEffects([{ kind: 'rollAdvantage', mode: 'adv', on: e.on }]).effects[0];
  return read?.effect.on as RollFilter | undefined;
}

const rollWords = (e: Eff) => {
  const on = filterOf(e);
  return on !== undefined ? rollsWords(on) : 'rolls';
};

/**
 * Which of `ROLL_KINDS` a filter is, with any abilities beside it where the
 * kind takes one; undefined for one the card cannot show (skills, a range, two
 * kinds of roll), which it keeps as written until the player picks a kind.
 */
export function rollKindOf(on: unknown): string | undefined {
  if (!isRecord(on)) return undefined;
  const { abilities, ...rest } = on;
  const same = (f: RollFilter) => {
    const keys = Object.keys(rest);
    return (
      keys.length === Object.keys(f).length &&
      keys.every((k) => JSON.stringify(rest[k]) === JSON.stringify(f[k as keyof RollFilter]))
    );
  };
  const kind = ROLL_KINDS.find(([, f]) => same(f))?.[0];
  if (kind === undefined) return undefined;
  if (abilities === undefined) return kind;
  const known = (a: unknown) => ABILITY.some(([v]) => v === a);
  return TAKES_ABILITY.has(kind) &&
    Array.isArray(abilities) &&
    abilities.length > 0 &&
    abilities.every(known)
    ? kind
    : undefined;
}

const KINDS: readonly KindSpec[] = [
  {
    kinds: ['abilityBonus'],
    add: 'Ability score',
    make: () => ({ kind: 'abilityBonus', ability: 'str', amount: 1 }),
    fields: [{ key: 'ability', label: 'Ability', type: 'pick', options: ABILITY }, amountField],
    line: (e) => `${amount(e.amount)} ${word(ABILITY, e.ability)}`,
  },
  {
    kinds: ['acBonus'],
    add: 'Armor Class',
    make: () => ({ kind: 'acBonus', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to Armor Class`,
  },
  {
    kinds: ['initiativeBonus'],
    add: 'Initiative',
    make: () => ({ kind: 'initiativeBonus', amount: 1 }),
    fields: [amountField],
    line: (e) =>
      e.profBonus === true
        ? 'Your proficiency bonus to Initiative, once however many add it'
        : `${amount(e.amount)} to Initiative`,
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
      {
        key: 'sense',
        label: 'Sense',
        type: 'pick',
        options: [
          ['darkvision', 'Darkvision'],
          ['blindsight', 'Blindsight'],
          ['tremorsense', 'Tremorsense'],
          ['truesight', 'Truesight'],
        ],
      },
      { key: 'range', label: 'Range in feet', type: 'amount' },
    ],
    line: (e) => `${word(KINDS_SENSE, e.sense)} ${amount(e.range, false)} ft`,
  },
  {
    kinds: ['maxHpBonus'],
    add: 'Hit points',
    make: () => ({ kind: 'maxHpBonus', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to your hit point maximum`,
  },
  {
    kinds: ['hpPerLevel'],
    add: 'Hit points per level',
    make: () => ({ kind: 'hpPerLevel', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} hit point maximum for each level`,
  },
  {
    kinds: ['saveBonus'],
    add: 'Saving throws',
    make: () => ({ kind: 'saveBonus', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to every saving throw`,
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
  },
  {
    kinds: ['saveProf'],
    add: 'Save proficiency',
    make: () => ({ kind: 'saveProf', ability: 'wis' }),
    fields: [{ key: 'ability', label: 'Ability', type: 'pick', options: ABILITY }],
    line: (e) => `Proficiency in ${word(ABILITY, e.ability)} saving throws`,
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
    kinds: ['resist', 'immune', 'vulnerable'],
    add: 'Resistance',
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
      `${e.kind === 'immune' ? 'Immunity' : e.kind === 'vulnerable' ? 'Vulnerability' : 'Resistance'} to ${String(e.damageType)} damage`,
  },
  {
    kinds: ['conditionImmune'],
    add: 'Condition immunity',
    make: () => ({ kind: 'conditionImmune', condition: 'Frightened' }),
    fields: [{ key: 'condition', label: 'Condition', type: 'pick', options: CONDITION }],
    line: (e) => `Immune to the ${String(e.condition)} condition`,
  },
  {
    kinds: ['rollAdvantage'],
    add: 'Advantage',
    make: () => ({ kind: 'rollAdvantage', mode: 'adv', on: { rolls: ['save'] } }),
    fields: [
      {
        key: 'mode',
        label: 'Kind',
        type: 'pick',
        options: [
          ['adv', 'Advantage'],
          ['dis', 'Disadvantage'],
        ],
      },
    ],
    line: (e) =>
      `${e.mode === 'dis' ? 'Disadvantage' : 'Advantage'} on ${rollWords(e)}${
        typeof e.when === 'string' && e.when.trim() !== '' ? `. ${e.when.trim()}` : ''
      }`,
  },
  {
    kinds: ['rollDie'],
    add: 'Added die',
    make: () => ({ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } }),
    fields: [{ key: 'dice', label: 'Dice', type: 'dice' }],
    line: (e) => `+${String(e.dice)} to ${rollWords(e)}`,
  },
  {
    kinds: ['attackBonus'],
    is: (e) => e.attack === 'spell',
    add: 'Spell attacks',
    make: () => ({ kind: 'attackBonus', amount: 1, attack: 'spell' }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to spell attack rolls`,
  },
  {
    kinds: ['spellDcBonus'],
    add: 'Spell save DC',
    make: () => ({ kind: 'spellDcBonus', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to your spell save DC`,
  },
  {
    kinds: ['grantSpell'],
    add: 'Cast a spell',
    make: () => ({ kind: 'grantSpell', spell: '' }),
    fields: [],
    line: (e) => {
      const name = String(e.spell ?? '').split('|')[0] || 'a spell';
      const how =
        e.usage === 'prepared'
          ? ', always prepared'
          : typeof e.resourceKey === 'string'
            ? `, spending 1 use of ${e.resourceKey}`
            : ' at will';
      return `Cast ${name}${how}`;
    },
  },
  {
    kinds: ['attackBonus'],
    add: 'Attack rolls',
    make: () => ({ kind: 'attackBonus', amount: 1, scope: 'all' }),
    fields: [amountField, { key: 'scope', label: 'Which', type: 'pick', options: SCOPE }],
    line: (e) =>
      `${amount(e.amount)} to ${e.scope === 'all' || e.scope === undefined ? '' : `${String(e.scope)} `}attack rolls`,
  },
  {
    kinds: ['damageBonus'],
    add: 'Damage',
    make: () => ({ kind: 'damageBonus', amount: 1, scope: 'all' }),
    fields: [amountField, { key: 'scope', label: 'Which', type: 'pick', options: SCOPE }],
    line: (e) =>
      `${amount(e.amount)} to ${e.scope === 'all' || e.scope === undefined ? '' : `${String(e.scope)} `}damage rolls`,
  },
  {
    kinds: ['resource'],
    add: 'Uses per rest',
    make: () => ({ kind: 'resource', key: 'uses', label: 'Uses', max: 1, reset: 'long' }),
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'max', label: 'Uses', type: 'amount' },
      {
        key: 'reset',
        label: 'Back on',
        type: 'pick',
        options: [
          ['short', 'A short or long rest'],
          ['long', 'A long rest'],
        ],
      },
    ],
    line: (e) =>
      `${words(e.label)}${classWords(e)}: ${amount(e.max, false)} ${e.max === 1 ? 'use' : 'uses'}, back on ${restWords(e.reset)}`,
  },
  {
    kinds: ['action'],
    add: 'Action',
    make: () => ({ kind: 'action', economy: 'action', label: 'New action' }),
    fields: [
      {
        key: 'economy',
        label: 'Takes',
        type: 'pick',
        options: [
          ['action', 'An action'],
          ['bonus', 'A bonus action'],
          ['reaction', 'A reaction'],
          // A rider on a hit, a spell or a roll: tapping it spends and takes nothing from the turn.
          ['none', 'No action'],
        ],
      },
      { key: 'label', label: 'Name', type: 'text' },
    ],
    line: (e) =>
      `${ECONOMY_WORDS[String(e.economy)] ?? 'Action'}: ${words(e.label)}${classWords(e)}${priceWords(e)}`,
  },
  {
    kinds: ['cue'],
    add: 'Reminder',
    make: () => ({ kind: 'cue', tone: 'info', text: 'Remember to' }),
    fields: [{ key: 'text', label: 'What to remember', type: 'text' }],
    line: (e) => String(e.text),
  },
];

const KINDS_SENSE: Options = [
  ['darkvision', 'Darkvision'],
  ['blindsight', 'Blindsight'],
  ['tremorsense', 'Tremorsense'],
  ['truesight', 'Truesight'],
];

/** The kinds offered first, as chips; the rest are one tap further, under More. */
const FIRST = ['Ability score', 'Armor Class', 'Speed', 'Skill', 'Resistance', 'Uses per rest'];

/** Kinds that may hold only while a state lasts (H10), and those that cannot wait for bloodied. */
const STATEFUL = new Set([
  'acBonus',
  'initiativeBonus',
  'speedBonus',
  'moveSpeed',
  'sense',
  'maxHpBonus',
  'saveBonus',
  'resist',
  'immune',
  'vulnerable',
  'conditionImmune',
  'rollAdvantage',
  'rollDie',
  'attackBonus',
  'damageBonus',
]);
const EARLY = new Set(['maxHpBonus']);

const ECONOMY_WORDS: Readonly<Record<string, string>> = {
  action: 'Action',
  bonus: 'Bonus action',
  reaction: 'Reaction',
  none: 'No action',
};

/** An action's price (`cost` or `buyBack`), when the file gives one. */
type Price = Record<string, unknown>;
const priceOf = (v: unknown): Price | undefined =>
  isRecord(v) && typeof v.resource === 'string' ? v : undefined;

/** What a price takes: "2 uses of focus", "a level 3+ spell slot", "a Hit Point Die". */
function paidWords(p: Price): string {
  if (p.resource === SLOT_COST) return slotPriceWords(p as SlotPrice);
  if (p.resource === HIT_DIE_COST) return 'a Hit Point Die';
  const n = p.amount;
  if (n === 'varies') return `uses of ${String(p.resource)}, as many as you choose`;
  return `${String(n)} ${n === 1 ? 'use' : 'uses'} of ${String(p.resource)}`;
}

/** An action card's line after its name: what it spends, and what buys a use back. */
function priceWords(e: Eff): string {
  const cost = priceOf(e.cost);
  const back = priceOf(e.buyBack);
  return [
    cost === undefined
      ? ''
      : cost.optional === true
        ? `, free, or ${paidWords(cost)} for more`
        : `, spends ${paidWords(cost)}`,
    back === undefined ? '' : `, buys a use back with ${paidWords(back)}`,
  ].join('');
}

/** The fields that belong to one way of paying: a spell slot's, or a Hit Point Die's. */
const PAID_WITH_ONLY = [
  'minLevel',
  'pactOnly',
  'slotDice',
  'slotRefills',
  'hitDieHeals',
  'hitDieAtLeast',
];

/**
 * A price paid another way: what belonged to the old way goes, the rest stays
 * (how many, a use of its own too, the use it gives back). A spell slot or a
 * Hit Point Die is one, and pays for every use, so it drops a free base use.
 */
function repaid(price: Price | undefined, resource: string): Price {
  const one = resource === SLOT_COST || resource === HIT_DIE_COST;
  const rest = Object.fromEntries(
    Object.entries(price ?? {}).filter(
      ([k]) => !PAID_WITH_ONLY.includes(k) && !(one && k === 'optional'),
    ),
  );
  return { ...rest, resource, amount: one || rest.amount === undefined ? 1 : rest.amount };
}

/** A price's fields that name the renamed pool, named for its new key. */
function renamedIn(
  key: 'cost' | 'buyBack',
  v: unknown,
  fields: readonly string[],
  [from, to]: readonly [string, string],
): Record<string, Price> {
  if (!isRecord(v)) return {};
  return {
    [key]: Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, fields.includes(k) && x === from ? to : x]),
    ),
  };
}

/** A box's choices, with a value a file gives that none of them is shown as written. */
function offering(options: Options, value: string, written: string): Options {
  return options.some(([v]) => v === value) ? options : [...options, [value, written]];
}

const COUNTS: Options = Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]);
const AMOUNTS: Options = [...COUNTS, ['varies', 'Any number']];
const PAID_FOR: Options = [
  ['', 'Every use'],
  ['optional', 'Extra uses'],
];
const SLOT_PRICES: Options = [
  ['', 'Any spell slot'],
  ...Array.from({ length: 8 }, (_, i) => [String(i + 2), `Level ${i + 2}+`] as const),
  ['pact', 'Pact Magic'],
];
const HEALS: Options = [
  ['roll', 'Roll'],
  ['rollPlusCon', 'Roll plus Con'],
];

/** Which slots pay a slot price, as its box holds it: any, a level or higher, Pact Magic. */
function slotPriceBox(p: Price): { value: string; options: Options } {
  const level = typeof p.minLevel === 'number' ? String(p.minLevel) : '';
  const value = p.pactOnly === true ? (level === '' ? 'pact' : `pact:${level}`) : level;
  return { value, options: offering(SLOT_PRICES, value, slotPriceWords(p as SlotPrice)) };
}

function withSlotPrice(p: Price, value: string): Price {
  const { minLevel: _, pactOnly: _pact, ...rest } = p;
  if (value === 'pact') return { ...rest, pactOnly: true };
  return value === '' ? rest : { ...rest, minLevel: Number(value) };
}

/**
 * An action card's price: what using it spends (`cost`: a pool's uses, a spell
 * slot or a Hit Point Die) and what buys a use back once none are left
 * (`buyBack`). What no box here shows (a slot's dice, the points it gives back,
 * a use of its own too, the use a buy-back gives back) is kept as written.
 */
function PriceFields({
  effect,
  title,
  resources,
  onChange,
}: {
  effect: Eff;
  title: string;
  resources: readonly Eff[];
  onChange: (next: Eff) => void;
}) {
  const cost = priceOf(effect.cost);
  const back = priceOf(effect.buyBack);
  const pools: Options = resources.map((r) => [String(r.key), `Uses of ${words(r.label)}`]);
  const payWith = (p: Price | undefined, hitDie: boolean): { value: string; options: Options } => {
    const value = p === undefined ? '' : String(p.resource);
    const options: Options = [
      ['', 'Nothing'],
      ...pools,
      [SLOT_COST, 'A spell slot'],
      ...(hitDie ? ([[HIT_DIE_COST, 'A Hit Point Die']] as const) : []),
    ];
    return { value, options: offering(options, value, value) };
  };
  const set = (key: 'cost' | 'buyBack', next: Price | undefined) => {
    const { [key]: _, ...rest } = effect;
    onChange(next === undefined ? (rest as Eff) : ({ ...rest, [key]: next } as Eff));
  };
  const pick = (
    label: string,
    box: { value: string; options: Options },
    to: (v: string) => void,
  ) => (
    <Field label={label}>
      <Select
        aria-label={`${title}: ${label}`}
        value={box.value}
        onChange={(e) => to(e.target.value)}
      >
        {box.options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
  const isPool = (p: Price) => p.resource !== SLOT_COST && p.resource !== HIT_DIE_COST;
  const count = (p: Price, options: Options) => ({
    value: String(p.amount),
    options: offering(options, String(p.amount), String(p.amount)),
  });
  return (
    <>
      {pick('Spends', payWith(cost, true), (v) =>
        set('cost', v === '' ? undefined : repaid(cost, v)),
      )}
      {cost !== undefined &&
        isPool(cost) &&
        pick('How many', count(cost, AMOUNTS), (v) =>
          set('cost', { ...cost, amount: v === 'varies' ? v : Number(v) }),
        )}
      {/* A slot or a die pays for every use: the box shows there only to take a file's away. */}
      {cost !== undefined &&
        (isPool(cost) || cost.optional === true) &&
        pick(
          'Paid for',
          { value: cost.optional === true ? 'optional' : '', options: PAID_FOR },
          (v) => {
            const { optional: _, ...rest } = cost;
            set('cost', v === 'optional' ? { ...rest, optional: true } : rest);
          },
        )}
      {cost?.resource === SLOT_COST &&
        pick('Which slots', slotPriceBox(cost), (v) => set('cost', withSlotPrice(cost, v)))}
      {cost?.resource === HIT_DIE_COST &&
        pick(
          'It heals',
          { value: cost.hitDieHeals === 'rollPlusCon' ? 'rollPlusCon' : 'roll', options: HEALS },
          (v) => {
            const { hitDieHeals: _, ...rest } = cost;
            set('cost', v === 'rollPlusCon' ? { ...rest, hitDieHeals: v } : rest);
          },
        )}
      {pick('Buys back a use with', payWith(back, false), (v) =>
        set('buyBack', v === '' ? undefined : repaid(back, v)),
      )}
      {back !== undefined &&
        isPool(back) &&
        pick('Buy-back uses', count(back, COUNTS), (v) =>
          set('buyBack', { ...back, amount: Number(v) }),
        )}
      {back?.resource === SLOT_COST &&
        pick('Buy-back slots', slotPriceBox(back), (v) => set('buyBack', withSlotPrice(back, v)))}
    </>
  );
}

const specOf = (e: Eff) => KINDS.find((k) => k.kinds.includes(e.kind) && (k.is?.(e) ?? true));

/** A spell a card can name: the player's data, as `name|source`. */
export interface SpellOption {
  name: string;
  source: string;
}

/**
 * The resource a grant spends, as the Spells tab counts it: per day back on a
 * long rest. A rest by level is one value here, its first level's.
 */
function usageFor(resource: Eff | undefined): string {
  return `1/${firstWords(resource?.reset) === 'short' ? 'rest' : 'day'}`;
}

/** The "Attack and DC from" value for a grant cast with the class that gives it. */
const OWN_CLASS = 'ownClass';

/** A spell grant's own controls: which spell, how it is cast, whose ability sets its numbers. */
function GrantFields({
  effect,
  resources,
  spells,
  onChange,
}: {
  effect: Eff;
  resources: readonly Eff[];
  spells: readonly SpellOption[];
  onChange: (next: Eff) => void;
}) {
  const id = useId();
  const ref = String(effect.spell ?? '');
  const [held, setTyped] = useState(ref.split('|')[0] ?? '');
  const resolve = (name: string) => {
    const hit = spells.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    return hit !== undefined ? `${hit.name}|${hit.source}` : name;
  };
  // Cards are their place in the list, so this one can be handed another
  // grant (the one above it removed): then its spell is shown, not what was typed.
  const typed = resolve(held) === ref ? held : (ref.split('|')[0] ?? '');
  const how =
    effect.usage === 'prepared'
      ? 'prepared'
      : typeof effect.resourceKey === 'string'
        ? `use:${effect.resourceKey}`
        : '';
  const setHow = (v: string) => {
    const { usage: _u, resourceKey: _r, ...rest } = effect;
    if (v === 'prepared') onChange({ ...rest, usage: 'prepared' } as Eff);
    else if (v.startsWith('use:')) {
      const key = v.slice(4);
      onChange({
        ...rest,
        resourceKey: key,
        usage: usageFor(resources.find((r) => r.key === key)),
      } as Eff);
    } else onChange(rest as Eff);
  };
  return (
    <>
      <Field label="Spell">
        <input
          aria-label="Cast a spell: Spell"
          list={id}
          value={typed}
          placeholder="Misty Step"
          onChange={(e) => {
            const name = e.target.value;
            setTyped(name);
            onChange({ ...effect, spell: resolve(name) });
          }}
          className={fieldClass}
        />
        <datalist id={id}>
          {spells.map((s) => (
            <option key={`${s.name}|${s.source}`} value={s.name} />
          ))}
        </datalist>
      </Field>
      <Field label="Cast">
        <Select
          aria-label="Cast a spell: Cast"
          value={how}
          onChange={(e) => setHow(e.target.value)}
        >
          <option value="">At will</option>
          <option value="prepared">Always prepared</option>
          {resources.map((r) => (
            <option key={String(r.key)} value={`use:${String(r.key)}`}>
              Spending 1 use of {words(r.label)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Attack and DC from">
        <Select
          aria-label="Cast a spell: Attack and DC from"
          value={
            effect.ownClass === true
              ? OWN_CLASS
              : typeof effect.ability === 'string'
                ? effect.ability
                : ''
          }
          onChange={(e) => {
            // A file's grant may name the class that gives it ("ownClass") in
            // place of an ability. Its option shows only while it is chosen, so a
            // change always leaves it: naming both would not read.
            const { ability: _, ownClass: _own, ...rest } = effect;
            onChange(e.target.value === '' ? (rest as Eff) : { ...rest, ability: e.target.value });
          }}
        >
          <option value="">No ability</option>
          {effect.ownClass === true && <option value={OWN_CLASS}>The class that gives it</option>}
          {ABILITY.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/**
 * A roll card's own controls: which rolls, narrowed to an ability where that
 * kind takes one, and for an advantage, when it holds if the app cannot see it
 * (the roll prompt then offers it to claim).
 */
function RollFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const on = isRecord(effect.on) ? effect.on : {};
  const kind = rollKindOf(on);
  const abilities = Array.isArray(on.abilities) ? on.abilities.map(String) : [];
  const several = abilities.map((a) => word(ABILITY, a)).join(' or ');
  const setKind = (k: string) => {
    const base = ROLL_KINDS.find(([v]) => v === k)?.[1];
    if (base === undefined) return;
    const kept = TAKES_ABILITY.has(k) && abilities.length > 0 ? { abilities } : {};
    const { when: _, ...rest } = effect;
    onChange({ ...(claims(base) ? effect : rest), on: { ...base, ...kept } });
  };
  const setAbility = (a: string) => {
    const { abilities: _, ...rest } = on;
    onChange({ ...effect, on: a === '' ? rest : { ...rest, abilities: [a] } });
  };
  return (
    <>
      <Field label="On">
        <Select
          aria-label={`${title}: On`}
          value={kind ?? ''}
          onChange={(e) => setKind(e.target.value)}
        >
          {kind === undefined && <option value="">{rollWords(effect)}, as written</option>}
          {ROLL_KINDS.map(([v, f]) => (
            <option key={v} value={v}>
              {rollsWords(f)}
            </option>
          ))}
        </Select>
      </Field>
      {kind !== undefined && TAKES_ABILITY.has(kind) && (
        <Field label="Ability">
          <Select
            aria-label={`${title}: Ability`}
            value={abilities.length > 1 ? 'several' : (abilities[0] ?? '')}
            onChange={(e) => {
              if (e.target.value !== 'several') setAbility(e.target.value);
            }}
          >
            <option value="">Any ability</option>
            {abilities.length > 1 && <option value="several">{several}</option>}
            {ABILITY.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}

/**
 * Whether an advantage on this kind of roll can wait for the player to claim
 * it: the roll prompt offers it, but a concentration save rolls at once, with
 * no prompt to offer it in.
 */
const claims = (on: unknown) => !(isRecord(on) && on.save === 'concentration');

/** An advantage's `when`: it holds only then, and the roll prompt offers it to claim. */
function ClaimField({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  if (effect.mode === 'dis' || !claims(effect.on)) return null;
  return (
    <div className="col-span-2">
      <Field label="Only when">
        <input
          aria-label={`${title}: Only when`}
          value={typeof effect.when === 'string' ? effect.when : ''}
          placeholder="Only against being Frightened"
          onChange={(e) => {
            const { when: _, ...rest } = effect;
            onChange(e.target.value.trim() === '' ? rest : { ...rest, when: e.target.value });
          }}
          className={fieldClass}
        />
      </Field>
    </div>
  );
}

/** A resource's key, from the name a player gives it. */
const keyOf = (label: string) =>
  label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '') || 'uses';

/** A field's value as its box shows it. */
function shown(e: Eff, f: FieldSpec): string {
  const v = e[f.key];
  // A level table has no box of its own: the box offers to replace it (`BY_LEVEL`).
  if (v === undefined || isByLevel(v)) return '';
  if (typeof v === 'object' && v !== null && 'f' in v) return String(v.f);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** A box's text as the field stores it: a whole number stays a number, anything else is a formula. */
function stored(f: FieldSpec, text: string): unknown {
  if (f.type === 'pick') return f.key === 'level' ? Number(text) : text;
  if (f.type !== 'amount') return text;
  const t = text.trim();
  if (f.key === 'speed' && t === 'walk') return t;
  return /^-?\d+$/.test(t) ? Number(t) : { f: t };
}

/**
 * A pool's or an action's "Class in the name" box, and the classes it names
 * when the name says the class only beside another (`ownClassBeside`).
 */
function NamingFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const beside = Array.isArray(effect.ownClassBeside) ? effect.ownClassBeside.map(String) : [];
  const naming =
    effect.ownClass === true ? 'own' : Array.isArray(effect.ownClassBeside) ? 'beside' : '';
  // The words as typed, so a comma can start the next name. Cards are their
  // place in the list, so this one can be handed another card's classes (the
  // one above it removed): then those are shown, not what was typed.
  const [held, setTyped] = useState(beside.join(', '));
  const typed = classList(held).join('\n') === beside.join('\n') ? held : beside.join(', ');
  const without = (): Eff => {
    const { ownClass: _, ownClassBeside: _beside, ...rest } = effect;
    return rest as Eff;
  };
  return (
    <>
      <Field label="Class in the name">
        <Select
          aria-label={`${title}: Class in the name`}
          value={naming}
          onChange={(e) => {
            const v = e.target.value;
            onChange(
              v === 'own'
                ? { ...without(), ownClass: true }
                : v === 'beside'
                  ? { ...without(), ownClassBeside: classList(typed) }
                  : without(),
            );
          }}
        >
          {NAMINGS.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
      {naming === 'beside' && (
        <Field label="Beside which classes">
          <input
            aria-label={`${title}: Beside which classes`}
            value={typed}
            placeholder="Paladin, Cleric"
            onChange={(e) => {
              setTyped(e.target.value);
              onChange({ ...without(), ownClassBeside: classList(e.target.value) });
            }}
            className={fieldClass}
          />
        </Field>
      )}
    </>
  );
}

function Card({
  effect,
  problems,
  list,
  pools,
  spells,
  inPlay,
  readOnly,
  onChange,
  onRemove,
}: {
  effect: Eff;
  problems: string[];
  list: readonly Eff[];
  pools: readonly Eff[];
  spells: readonly SpellOption[];
  inPlay: boolean;
  readOnly: boolean;
  onChange: (next: Eff, renamedKey?: [string, string]) => void;
  onRemove: () => void;
}) {
  const spec = specOf(effect);
  const title = spec?.add ?? effect.kind;
  // One of each key: a pool given once for each rules version (`edition`) is one
  // pool, the card's own or one kept elsewhere (a class's).
  const resources = [...list.filter((x) => x.kind === 'resource'), ...pools].filter(
    (x, i, all) => typeof x.key === 'string' && all.findIndex((y) => y.key === x.key) === i,
  );
  const state = typeof effect.while === 'string' ? effect.while : '';
  const edition = editionOf(effect);
  const set = (f: FieldSpec, text: string) => {
    const v = stored(f, text);
    if (f.key === 'kind') onChange({ ...effect, kind: String(v) });
    else if (effect.kind === 'rollAdvantage' && f.key === 'mode' && v === 'dis') {
      // The roll prompt offers only advantage to claim, so a disadvantage holds always.
      const { when: _, ...rest } = effect;
      onChange({ ...rest, mode: v });
    } else if (effect.kind === 'initiativeBonus' && f.key === 'amount') {
      // An amount typed in takes the place of the proficiency bonus.
      const { profBonus: _, ...rest } = effect;
      onChange({ ...rest, amount: v });
    } else if (effect.kind === 'resource' && f.key === 'label') {
      // The key follows the name, and an action spending it follows the key.
      const key = keyOf(text);
      onChange({ ...effect, label: v, key }, [String(effect.key), key]);
    } else onChange({ ...effect, [f.key]: v });
  };
  return (
    <div className="flex flex-col gap-2 rounded-control bg-surface py-2.5 pr-1 pl-3 ring-1 ring-line ring-inset">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-caption text-ink-muted">{title}</b>
        {!readOnly && (
          <button
            type="button"
            aria-label={`Remove ${spec?.line(effect) ?? title}`}
            onClick={onRemove}
            className="tap -my-2 rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      <span className="pr-2 text-body-strong">{spec?.line(effect) ?? effect.kind}</span>
      {spec !== undefined && !readOnly && (
        <div className="grid grid-cols-2 items-end gap-2 pr-2">
          {spec.fields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.type === 'pick' ? (
                <Select
                  aria-label={`${title}: ${f.label}`}
                  value={f.key === 'kind' ? effect.kind : shown(effect, f)}
                  onChange={(e) => set(f, e.target.value)}
                >
                  {isByLevel(effect[f.key]) && <option value="">{BY_LEVEL}</option>}
                  {f.options.map(([v, text]) => (
                    <option key={v} value={v}>
                      {text}
                    </option>
                  ))}
                </Select>
              ) : (
                <input
                  aria-label={`${title}: ${f.label}`}
                  value={shown(effect, f)}
                  placeholder={isByLevel(effect[f.key]) ? BY_LEVEL : undefined}
                  onChange={(e) => set(f, e.target.value)}
                  className={fieldClass}
                />
              )}
            </Field>
          ))}
          {(effect.kind === 'rollAdvantage' || effect.kind === 'rollDie') && (
            <RollFields effect={effect} title={title} onChange={onChange} />
          )}
          {effect.kind === 'grantSpell' && (
            <GrantFields
              effect={effect}
              resources={resources}
              spells={spells}
              onChange={onChange}
            />
          )}
          {effect.kind === 'action' && (
            <PriceFields effect={effect} title={title} resources={resources} onChange={onChange} />
          )}
          {STATEFUL.has(effect.kind) && (
            <Field label="When">
              <Select
                aria-label={`${title}: When`}
                value={state}
                onChange={(e) => {
                  const { while: _, ...rest } = effect;
                  onChange(
                    e.target.value === ''
                      ? (rest as Eff)
                      : { ...rest, while: e.target.value as StoredState },
                  );
                }}
              >
                {STATES.filter(([v]) => !(v === 'bloodied' && EARLY.has(effect.kind))).map(
                  ([v, text]) => (
                    <option key={v} value={v}>
                      {text}
                    </option>
                  ),
                )}
              </Select>
            </Field>
          )}
          {(effect.kind === 'resource' || effect.kind === 'action') && (
            <NamingFields effect={effect} title={title} onChange={onChange} />
          )}
          {/* An effect in play holds under the sheet's rules: its box shows only
              while a file sets one, to take it away. */}
          {(!inPlay || effect.edition !== undefined) && (
            <Field label="Rules">
              <Select
                aria-label={`${title}: Rules`}
                value={editionBox(effect).value}
                onChange={(e) => {
                  const { edition: _, ...rest } = effect;
                  const v = e.target.value;
                  onChange(v === '' ? (rest as Eff) : { ...rest, edition: v as typeof edition });
                }}
              >
                {editionBox(effect).options.map(([v, text]) => (
                  <option key={v} value={v}>
                    {text}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {effect.kind === 'rollAdvantage' && (
            <ClaimField effect={effect} title={title} onChange={onChange} />
          )}
        </div>
      )}
      {state !== '' && readOnly && (
        <span className="text-caption text-ink-muted">{word(STATES, state)}</span>
      )}
      {edition !== undefined && readOnly && (
        <span className="text-caption text-ink-muted">{word(EDITIONS, edition)}</span>
      )}
      {problems.map((p) => (
        <p key={p} className="flex items-start gap-1.5 pr-2 text-caption text-danger">
          <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
          This does not count yet:{' '}
          {effect.kind === 'grantSpell' && p.startsWith('"spell"')
            ? 'pick a spell from the list'
            : p === '"ownClassBeside" is a list'
              ? 'name a class it stands beside'
              : p}
        </p>
      ))}
    </div>
  );
}

/**
 * The effects list: a card per effect, then the kinds to add. `inherits` names
 * the entry a copy is made from, whose own mechanics it keeps unless the
 * player starts from nothing (`replace`).
 */
export function EffectCards({
  effects,
  onChange,
  readOnly,
  inherits,
  replace,
  onReplace,
  spells,
  hide,
  resources,
  inPlay = false,
}: {
  effects: unknown;
  onChange: (next: Eff[]) => void;
  readOnly: boolean;
  /**
   * The effects are in play (a condition's, a spell's on its target): they hold
   * under the sheet's rules, so no card offers a rules version.
   */
  inPlay?: boolean;
  inherits?: string;
  replace?: boolean;
  onReplace?: (replace: boolean) => void;
  /** The spells a "Cast a spell" card can name; without them it is not offered. */
  spells?: readonly SpellOption[];
  /** Effects another control of the editor shows, left out of the cards (an item's charges). */
  hide?: (e: Eff) => boolean;
  /** Uses kept elsewhere that an action or a spell here can spend too (a class's pools). */
  resources?: readonly Eff[];
}) {
  const list: Eff[] = Array.isArray(effects) ? (effects as Eff[]) : [];
  const { problems } = readStoredEffects(list);
  const problemsOf = (i: number) =>
    problems
      .filter((p) => p.startsWith(`effect ${i + 1}:`) || p.startsWith(`effect ${i + 1} (`))
      .map((p) => p.replace(/^effect \d+( \([^)]*\))?: /, ''));
  const add = (spec: KindSpec) => onChange([...list, spec.make()]);
  const more = async () => {
    const id = await askChoice({
      title: 'What does it do?',
      options: KINDS.filter(
        (k) => !FIRST.includes(k.add) && (spells !== undefined || k.add !== 'Cast a spell'),
      ).map((k) => ({
        id: k.add,
        label: k.add,
      })),
    });
    const spec = KINDS.find((k) => k.add === id);
    if (spec !== undefined) add(spec);
  };
  return (
    <div className="flex flex-col gap-2">
      {inherits !== undefined && (
        <label className="flex min-h-tap items-center gap-2.5 text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-ink"
            disabled={readOnly}
            checked={replace !== true}
            onChange={(e) => onReplace?.(!e.target.checked)}
          />
          Also does what {inherits} does on the sheet
        </label>
      )}
      {list.map((effect, i) =>
        hide?.(effect) === true ? null : (
          <Card
            // Effects have no id of their own; a card is its place in the list.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            effect={effect}
            list={list}
            pools={resources ?? []}
            spells={spells ?? []}
            problems={problemsOf(i)}
            inPlay={inPlay}
            readOnly={readOnly}
            onRemove={() => onChange(list.filter((_, j) => j !== i))}
            onChange={(next, renamed) =>
              onChange(
                list.map((x, j) => {
                  if (j === i) return next;
                  if (renamed === undefined) return x;
                  // What spends the renamed uses follows it: an action's cost
                  // (and the points a slot gives back), what buys a use back and
                  // the use it gives back, a spell cast with them, and the same
                  // pool given for the other rules version (`edition`), which
                  // stays one pool.
                  if (x.kind === 'resource' && x.key === renamed[0])
                    return { ...x, key: renamed[1], label: next.label };
                  if (x.kind === 'action' && (x.cost !== undefined || x.buyBack !== undefined))
                    return {
                      ...x,
                      ...renamedIn('cost', x.cost, ['resource', 'slotRefills'], renamed),
                      ...renamedIn('buyBack', x.buyBack, ['resource', 'own'], renamed),
                    };
                  if (x.kind === 'grantSpell' && x.resourceKey === renamed[0])
                    return { ...x, resourceKey: renamed[1] };
                  return x;
                }),
              )
            }
          />
        ),
      )}
      {list.filter((e) => hide?.(e) !== true).length === 0 && (
        <p className="text-caption text-ink-muted">
          Nothing for the sheet to count yet. Add what it does, and the sheet adds it up.
        </p>
      )}
      {!readOnly && (
        <div className="-mx-1.5 flex flex-wrap">
          {KINDS.filter((k) => FIRST.includes(k.add)).map((k) => (
            <Chip key={k.add} tone="outline" className="px-2.5" onClick={() => add(k)}>
              <Plus size={14} aria-hidden />
              {k.add}
            </Chip>
          ))}
          <Chip tone="outline" className="px-2.5" onClick={() => void more()}>
            More
          </Chip>
        </div>
      )}
    </div>
  );
}

/** `castGuidance` with `patch` applied, or undefined once it says nothing. */
export function guidanceWith(
  g: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { v: 1, ...(isRecord(g) ? g : {}), ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  return Object.keys(next).some((k) => k !== 'v') ? next : undefined;
}

/** An entry's own effects, as a section of its editor. */
export function EntryEffects({
  draft,
  change,
  original,
  readOnly,
}: Pick<EditorProps, 'draft' | 'change' | 'original' | 'readOnly'>) {
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  const set = (patch: Record<string, unknown>) =>
    change({ castGuidance: guidanceWith(draft.castGuidance, patch) });
  return (
    <Section title="What it does on the sheet">
      <EffectCards
        effects={g.effects}
        readOnly={readOnly}
        inherits={original !== undefined ? String(original.name) : undefined}
        replace={g.replace === true}
        onReplace={(replace) => set({ replace: replace ? true : undefined })}
        onChange={(effects) => set({ effects: effects.length > 0 ? effects : undefined })}
      />
    </Section>
  );
}
