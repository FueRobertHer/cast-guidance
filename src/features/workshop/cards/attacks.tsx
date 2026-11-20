/**
 * Board 4's attacks and damage: to hit and weapon damage (each narrowed to one
 * ability or to weapons), an extra die on a hit, the critical hit range, a
 * natural weapon and a bigger unarmed strike.
 */
import { useState } from 'react';
import { fieldClass } from '@/ui/TextField';
import { Field, Select } from '../fields';
import type { Eff, KindSpec, Options } from './kit/types';
import { ABILITY, amount, amountField, asWritten, omit, word } from './kit/words';

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

/** The damage types a die on a hit or a natural weapon may deal. */
export const DAMAGE: Options = [
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

/**
 * What a box with a choice for none ("Any ability", "As the weapon") holds: ''
 * for none, else the value, with a file's empty or non-word value said as
 * written (`""`, `3`), so the none choice is a change and takes it away.
 */
export const optionalHeld = (v: unknown): string =>
  v === undefined ? '' : typeof v === 'string' && v.trim() !== '' ? v : String(JSON.stringify(v));

/**
 * Words a box holds as a list, "longbow, shortbow", read back as one. A name
 * with a comma in it is typed in quotes, "Crossbow, hand", and kept whole; a
 * quote opens only at a name's start (12" blade is a name), and two quotes in
 * a quoted name are one quote mark.
 */
export function listOf(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i <= text.length) {
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    let name = '';
    if (text.charAt(i) === '"') {
      i++;
      while (i < text.length) {
        const c = text.charAt(i);
        if (c === '"' && text.charAt(i + 1) === '"') {
          name += '"';
          i += 2;
        } else if (c === '"') {
          i++;
          break;
        } else {
          name += c;
          i++;
        }
      }
    }
    // Up to the next comma: a name's words, or what follows its closing quote.
    while (i < text.length && text.charAt(i) !== ',') name += text.charAt(i++);
    out.push(name.trim());
    i++;
  }
  return out.filter((s) => s !== '');
}

/** A list as its box shows it, quoted where a name would not read back whole. */
const listText = (xs: readonly string[]) =>
  xs
    .map((x) => (x.includes(',') || x.startsWith('"') ? `"${x.replaceAll('"', '""')}"` : x))
    .join(', ');

/** A stored list of words, or none. */
const wordsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Words as a sentence offers them: "a longbow", "a longbow or a shortbow". */
const either = (xs: readonly string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`;

/**
 * A box for a list of names, stored as a list: a weapon's kinds, spells, a
 * class's name. What is typed stays as typed while it means the list stored
 * (a comma just typed, a space after it); emptied, the field goes.
 */
export function ListBox({
  effect,
  field,
  title,
  label,
  placeholder,
  onChange,
}: {
  effect: Eff;
  field: string;
  title: string;
  label: string;
  placeholder?: string;
  onChange: (next: Eff) => void;
}) {
  const held = wordsOf(effect[field]);
  const key = JSON.stringify(held);
  const [typed, setTyped] = useState({ text: listText(held), key });
  // Written from elsewhere (the file view, Undo): the box starts again from what
  // the field holds, so text typed for an earlier list never comes back with it.
  if (typed.key !== key) setTyped({ text: listText(held), key });
  const shown = typed.key === key ? typed.text : listText(held);
  return (
    <div className="col-span-2">
      <Field label={label}>
        <input
          aria-label={`${title}: ${label}`}
          value={shown}
          placeholder={placeholder}
          onChange={(e) => {
            const text = e.target.value;
            const next = listOf(text);
            setTyped({ text, key: JSON.stringify(next) });
            onChange(next.length === 0 ? omit(effect, [field]) : { ...effect, [field]: next });
          }}
          className={fieldClass}
        />
      </Field>
    </div>
  );
}

/**
 * What else narrows a bonus, as its line says it: the ability the attack is
 * made with, the kinds of weapon, or weapons alone (no unarmed strike or
 * natural weapon). A file's field with no box is said too.
 */
function reachWords(e: Eff): string {
  const parts: string[] = [];
  if (typeof e.ability === 'string') parts.push(`using ${word(ABILITY, e.ability)}`);
  const kinds = wordsOf(e.weapons);
  if (kinds.length > 0) parts.push(`with ${either(kinds)}`);
  else if (e.weaponsOnly === true) parts.push('with a weapon');
  return parts.length === 0 ? '' : `, ${parts.join(', ')}`;
}

/**
 * The boxes that narrow a weapon bonus: the ability its attack uses, and the
 * weapons it reaches. Each is offered only where the kind takes it (a die on a
 * hit takes no ability or kinds of weapon, and a bonus to every attack reaches
 * spells, which know no weapon).
 */
function ReachFields({
  effect,
  title,
  ability = true,
  weaponsOnly = true,
  weapons = true,
  onChange,
}: {
  effect: Eff;
  title: string;
  ability?: boolean;
  weaponsOnly?: boolean;
  weapons?: boolean;
  onChange: (next: Eff) => void;
}) {
  const held = optionalHeld(effect.ability);
  return (
    <>
      {ability && (
        <Field label="With">
          <Select
            aria-label={`${title}: With`}
            value={held}
            onChange={(x) =>
              onChange(
                x.target.value === ''
                  ? omit(effect, ['ability'])
                  : { ...effect, ability: x.target.value },
              )
            }
          >
            <option value="">Any ability</option>
            {held !== '' && !ABILITY.some(([v]) => v === held) && (
              <option value={held}>{held}, as written</option>
            )}
            {ABILITY.map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {weaponsOnly && (
        <label className="col-span-2 flex min-h-tap items-center gap-2.5 text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-ink"
            aria-label={`${title}: Weapons only`}
            checked={effect.weaponsOnly === true}
            onChange={(x) =>
              onChange(
                x.target.checked ? { ...effect, weaponsOnly: true } : omit(effect, ['weaponsOnly']),
              )
            }
          />
          Weapons only, not an unarmed strike or natural weapon
        </label>
      )}
      {weapons && (
        <ListBox
          effect={effect}
          field="weapons"
          title={title}
          label="Only these weapons"
          placeholder="longbow, shortbow"
          onChange={onChange}
        />
      )}
    </>
  );
}

/** The heading its cards are listed under on the add sheet. */
export const group = 'Attacks';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['attackBonus'],
    add: 'Attack rolls',
    does: 'Raises or lowers attack rolls, with every weapon, one ability or some weapons',
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
        // Spell attacks know no weapon, so a bonus to every attack names none;
        // a class names whose spells, so a weapon bonus keeps none.
        apply: (e, v) =>
          v === EVERY_ATTACK
            ? { ...omit(e, ['weaponsOnly', 'weapons']), scope: 'all', attack: 'any' }
            : { ...omit(e, ['attack', 'className']), scope: v },
      },
    ],
    line: (e) =>
      everyAttack(e)
        ? `${amount(e.amount)} to every attack roll, weapon and ${
            typeof e.className === 'string' ? `${e.className} ` : ''
          }spell${reachWords(e)}`
        : `${amount(e.amount)} to ${e.scope === 'all' || e.scope === undefined ? '' : `${String(e.scope)} `}attack rolls${reachWords(e)}`,
    boxes: (p) =>
      everyAttack(p.effect) ? (
        // Spell attacks know no weapon: every attack is narrowed by its ability alone.
        <ReachFields
          effect={p.effect}
          title={p.title}
          weaponsOnly={false}
          weapons={false}
          onChange={p.onChange}
        />
      ) : (
        <ReachFields effect={p.effect} title={p.title} onChange={p.onChange} />
      ),
  },
  {
    kinds: ['damageBonus'],
    add: 'Damage',
    does: 'Raises or lowers weapon damage, as Rage does with Strength',
    make: () => ({ kind: 'damageBonus', amount: 1, scope: 'all' }),
    fields: [amountField, { key: 'scope', label: 'Which', type: 'pick', options: SCOPE }],
    line: (e) =>
      `${amount(e.amount)} to ${e.scope === 'all' || e.scope === undefined ? '' : `${String(e.scope)} `}damage rolls${reachWords(e)}`,
    boxes: (p) => <ReachFields effect={p.effect} title={p.title} onChange={p.onChange} />,
  },
  {
    kinds: ['damageDie'],
    add: 'Extra die on a hit',
    does: 'Extra damage dice on every hit, as Elemental Weapon or a flame tongue adds',
    make: () => ({ kind: 'damageDie', scope: 'all', dice: '1d4', damageType: 'fire' }),
    fields: [
      { key: 'dice', label: 'Dice', type: 'dice' },
      {
        key: 'damageType',
        label: 'Damage',
        type: 'pick',
        options: [['', 'As the weapon'], ...DAMAGE],
        // A level table has a choice of its own (`asWritten`).
        value: (e) => (asWritten(e.damageType) !== undefined ? '' : optionalHeld(e.damageType)),
        apply: (e, v) => (v === '' ? omit(e, ['damageType']) : { ...e, damageType: v }),
      },
      { key: 'scope', label: 'Which', type: 'pick', options: SCOPE },
    ],
    line: (e) => {
      const type = typeof e.damageType === 'string' ? ` ${e.damageType}` : '';
      const which = e.scope === 'melee' || e.scope === 'ranged' ? `${e.scope} ` : '';
      const weapon = e.weaponsOnly === true ? 'weapon ' : '';
      return `+${String(e.dice)}${type} damage on ${which}${weapon}hits`;
    },
    boxes: (p) => (
      <ReachFields
        effect={p.effect}
        title={p.title}
        ability={false}
        weapons={false}
        onChange={p.onChange}
      />
    ),
  },
  {
    kinds: ['critRange'],
    add: 'Critical hit range',
    does: 'Attacks score a critical hit on a lower roll, as Improved Critical does',
    make: () => ({ kind: 'critRange', min: 19 }),
    fields: [{ key: 'min', label: 'On a roll of at least', type: 'amount' }],
    line: (e) =>
      typeof e.min === 'number' && e.min >= 20
        ? 'A critical hit on a 20'
        : `A critical hit on a ${amount(e.min, false)} or higher`,
  },
  {
    kinds: ['naturalWeapon'],
    add: 'Natural weapon',
    does: 'An attack with claws, a bite, horns or a tail, as a species has',
    make: () => ({
      kind: 'naturalWeapon',
      label: 'Claws',
      dice: '1d6',
      damageType: 'slashing',
      ability: 'str',
    }),
    fields: [
      { key: 'label', label: 'Name', type: 'text' },
      { key: 'dice', label: 'Dice', type: 'dice' },
      { key: 'damageType', label: 'Damage', type: 'pick', options: DAMAGE },
      {
        key: 'ability',
        label: 'With',
        type: 'pick',
        options: ABILITY,
        // A file that leaves it out attacks with Strength.
        value: (e) => (e.ability === undefined ? 'str' : String(e.ability)),
      },
    ],
    line: (e) =>
      `${String(e.label)} deal ${String(e.dice)} ${String(e.damageType)} damage, using ${word(ABILITY, e.ability ?? 'str')}`,
    notInPlay: true,
  },
  {
    kinds: ['unarmedDamage'],
    add: 'Bigger unarmed strike',
    does: 'Your unarmed strike deals a bigger die, as Tavern Brawler or Martial Arts gives',
    make: () => ({ kind: 'unarmedDamage', label: 'Bigger unarmed strike', dice: '1d6' }),
    fields: [
      { key: 'dice', label: 'Dice', type: 'dice' },
      // Shown beside the Unarmed Strike's damage, so the number says where it is from.
      { key: 'label', label: 'Shown as', type: 'text' },
    ],
    line: (e) => `Your unarmed strike deals ${String(e.dice)}`,
    // The sheet keeps the biggest die by its average, which it works out for
    // dice like 1d8 alone (`averageDice`): "d8" or "1d8+1" never wins. Dice the
    // reader refuses already say so.
    ownProblems: (problems, e) =>
      typeof e.dice === 'string' &&
      e.dice.trim() !== '' &&
      !/^\d+d\d+$/.test(e.dice.trim()) &&
      !problems.some((p) => p.includes('"dice"'))
        ? [
            ...problems,
            'dice written as 1d8, a number of dice and their size alone, so the sheet can weigh them',
          ]
        : problems,
    notInPlay: true,
  },
];
