/**
 * Board 4's spells: spell attacks and the spell save DC (each narrowed to one
 * class's spells or those cast with one ability), spell damage, spells added
 * to a class's list, and casting a spell.
 */
import { useId, useState } from 'react';
import { isRecord } from '@/engine/castGuidance';
import { SPELL_SCHOOLS } from '@/engine/spellQuery';
import { fieldClass } from '@/ui/TextField';
import { Field, Select } from '../fields';
import { ListBox } from './attacks';
import type { Eff, KindSpec, Options, SpellOption } from './kit/types';
import {
  ABILITY,
  amount,
  amountField,
  asWritten,
  firstWords,
  listed,
  omit,
  shown,
  stored,
  word,
  words,
} from './kit/words';

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
  title,
  resources,
  spells,
  onChange,
}: {
  effect: Eff;
  title: string;
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
          aria-label={`${title}: Spell`}
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
        <Select aria-label={`${title}: Cast`} value={how} onChange={(e) => setHow(e.target.value)}>
          <option value="">At will</option>
          <option value="prepared">Always prepared</option>
          {resources.map((r) => (
            <option key={String(r.key)} value={`use:${String(r.key)}`}>
              Spending 1 use of {words(r.label)}
            </option>
          ))}
          {/* A pool kept where this list cannot see it (a class's, here a feat). */}
          {how.startsWith('use:') && !resources.some((r) => `use:${String(r.key)}` === how) && (
            <option value={how}>Spending 1 use of {how.slice(4)}, as written</option>
          )}
        </Select>
      </Field>
      <Field label="Attack and DC from">
        <Select
          aria-label={`${title}: Attack and DC from`}
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
          {effect.ownClass !== true &&
            typeof effect.ability === 'string' &&
            !ABILITY.some(([v]) => v === effect.ability) && (
              <option value={effect.ability}>{effect.ability}, as written</option>
            )}
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

const SCHOOLS: Options = Object.entries(SPELL_SCHOOLS);

/** A class's name as a box holds it: emptied, the field goes. */
function ClassBox({
  effect,
  title,
  label,
  onChange,
}: {
  effect: Eff;
  title: string;
  label: string;
  onChange: (next: Eff) => void;
}) {
  return (
    <Field label={label}>
      <input
        aria-label={`${title}: ${label}`}
        value={typeof effect.className === 'string' ? effect.className : ''}
        placeholder="Any class"
        onChange={(e) =>
          onChange(
            e.target.value.trim() === ''
              ? omit(effect, ['className'])
              : { ...effect, className: e.target.value },
          )
        }
        className={fieldClass}
      />
    </Field>
  );
}

/** A box of choices that leaves its field out for the first, and shows a file's other value as written. */
function OptionalBox({
  effect,
  field,
  title,
  label,
  any,
  options,
  onChange,
}: {
  effect: Eff;
  field: string;
  title: string;
  label: string;
  any: string;
  options: Options;
  onChange: (next: Eff) => void;
}) {
  const held = typeof effect[field] === 'string' ? (effect[field] as string) : '';
  return (
    <Field label={label}>
      <Select
        aria-label={`${title}: ${label}`}
        value={held}
        onChange={(e) =>
          onChange(
            e.target.value === '' ? omit(effect, [field]) : { ...effect, [field]: e.target.value },
          )
        }
      >
        <option value="">{any}</option>
        {held !== '' && !options.some(([v]) => v === held) && (
          <option value={held}>{held}, as written</option>
        )}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/**
 * What narrows a spell attack or DC bonus: one class's spells (Rod of the Pact
 * Keeper's Warlock spells), or the spells cast with one ability (Jester's Mask).
 */
function SpellReach({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  return (
    <>
      <ClassBox effect={effect} title={title} label="Only spells of" onChange={onChange} />
      <OptionalBox
        effect={effect}
        field="ability"
        title={title}
        label="Cast with"
        any="Any ability"
        options={ABILITY}
        onChange={onChange}
      />
    </>
  );
}

/** A bonus's class, as a line says it before "spell": "Warlock ". */
const classWord = (e: Eff) =>
  typeof e.className === 'string' && e.className.trim() !== '' ? `${e.className.trim()} ` : '';
/** A bonus's casting ability, as a line says it after the rest. */
const castWith = (e: Eff) =>
  typeof e.ability === 'string' ? `, for spells cast with ${word(ABILITY, e.ability)}` : '';

/** An ability modifier as a spell damage bonus stores it (`{ "f": "mod.cha" }`). */
const MOD = /^mod\.(str|dex|con|int|wis|cha)$/;
const modOf = (v: unknown): string | undefined => {
  const f = isRecord(v) && typeof v.f === 'string' ? v.f.trim() : '';
  return MOD.test(f) ? f.slice(4) : undefined;
};
const NUMBER = ':number';

/** What a spell damage bonus adds, as a line says it. */
function addsWords(v: unknown): string {
  const mod = modOf(v);
  return mod !== undefined ? `Your ${word(ABILITY, mod)} modifier` : amount(v);
}

/** The spells a spell damage bonus reaches, as a line says them. */
function damagedWords(e: Eff): string {
  const named = Array.isArray(e.spells) ? e.spells.map(String) : [];
  const school = typeof e.school === 'string' ? `${word(SCHOOLS, e.school)} ` : '';
  const what = `${school}${e.cantrips === true ? 'cantrips' : 'spells'}`;
  const of = e.ownClass === true ? `${what} of the class that gives it` : `${classWord(e)}${what}`;
  return named.length > 0 ? `${listed(named)}${of === 'spells' ? '' : `, if ${of}`}` : of;
}

/** A tick for a flag a card stores as `true`, or leaves out. */
function Tick({
  effect,
  field,
  title,
  label,
  onChange,
}: {
  effect: Eff;
  field: string;
  title: string;
  label: string;
  onChange: (next: Eff) => void;
}) {
  return (
    <label className="col-span-2 flex min-h-tap items-center gap-2.5 text-body">
      <input
        type="checkbox"
        className="size-4.5 accent-ink"
        aria-label={`${title}: ${label}`}
        checked={effect[field] === true}
        onChange={(x) =>
          onChange(x.target.checked ? { ...effect, [field]: true } : omit(effect, [field]))
        }
      />
      {label}
    </label>
  );
}

/**
 * A spell damage bonus's own boxes: what it adds (a number, a formula, or an
 * ability modifier, as Agonizing Blast adds Charisma), and the spells it
 * reaches. Every limit given must hold.
 */
function SpellDamageFields({
  effect,
  title,
  onChange,
}: {
  effect: Eff;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const mod = modOf(effect.amount);
  return (
    <>
      <Field label="Adds">
        <Select
          aria-label={`${title}: Adds`}
          value={mod ?? NUMBER}
          onChange={(e) =>
            onChange({
              ...effect,
              amount: e.target.value === NUMBER ? 1 : { f: `mod.${e.target.value}` },
            })
          }
        >
          <option value={NUMBER}>A number</option>
          {ABILITY.map(([v, text]) => (
            <option key={v} value={v}>
              {text} modifier
            </option>
          ))}
        </Select>
      </Field>
      {mod === undefined && (
        <Field label="Amount">
          <input
            aria-label={`${title}: Amount`}
            value={shown(effect, amountField)}
            placeholder={asWritten(effect.amount)}
            onChange={(e) => onChange({ ...effect, amount: stored(amountField, e.target.value) })}
            className={fieldClass}
          />
        </Field>
      )}
      <Tick
        effect={effect}
        field="cantrips"
        title={title}
        label="Cantrips only"
        onChange={onChange}
      />
      <OptionalBox
        effect={effect}
        field="school"
        title={title}
        label="School"
        any="Any school"
        options={SCHOOLS}
        onChange={onChange}
      />
      {/* A file's "the class that gives it" is said in the line and kept. */}
      {effect.ownClass !== true && (
        <ClassBox effect={effect} title={title} label="Only spells of" onChange={onChange} />
      )}
      <ListBox
        effect={effect}
        field="spells"
        title={title}
        label="Only these spells"
        placeholder="Eldritch Blast"
        onChange={onChange}
      />
      <Tick
        effect={effect}
        field="oneRoll"
        title={title}
        label="On one damage roll a cast, not each"
        onChange={onChange}
      />
    </>
  );
}

/** The spells a list addition names, as a line says them. */
function addedWords(e: Eff): string {
  const named = Array.isArray(e.spells) ? e.spells.map(String) : [];
  const which = named.length === 0 ? 'No spell yet' : listed(named);
  const cls = classWord(e);
  const joins = named.length > 1 ? 'join' : 'joins';
  return cls === ''
    ? `${which} ${joins} each of your spell lists`
    : `${which} ${joins} your ${cls}spell list`;
}

/** The heading its cards are listed under on the add sheet. */
export const group = 'Spells';

export const cards: readonly KindSpec[] = [
  {
    kinds: ['attackBonus'],
    is: (e) => e.attack === 'spell',
    add: 'Spell attacks',
    does: "Raises or lowers spell attack rolls, every class's or one class's",
    make: () => ({ kind: 'attackBonus', amount: 1, attack: 'spell' }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to ${classWord(e)}spell attack rolls${castWith(e)}`,
    boxes: (p) => <SpellReach effect={p.effect} title={p.title} onChange={p.onChange} />,
  },
  {
    kinds: ['spellDcBonus'],
    add: 'Spell save DC',
    does: "Raises or lowers your spell save DC, every class's or one class's",
    make: () => ({ kind: 'spellDcBonus', amount: 1 }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to your ${classWord(e)}spell save DC${castWith(e)}`,
    boxes: (p) => <SpellReach effect={p.effect} title={p.title} onChange={p.onChange} />,
  },
  {
    kinds: ['spellDamageBonus'],
    add: 'Spell damage',
    does: 'Adds to the damage of some spells, as Agonizing Blast adds Charisma to Eldritch Blast',
    make: () => ({ kind: 'spellDamageBonus', amount: { f: 'mod.cha' }, cantrips: true }),
    fields: [],
    line: (e) =>
      `${addsWords(e.amount)} to the damage of ${damagedWords(e)}${
        e.oneRoll === true ? ', on one damage roll a cast' : ''
      }`,
    boxes: (p) => <SpellDamageFields effect={p.effect} title={p.title} onChange={p.onChange} />,
    notInPlay: true,
  },
  {
    kinds: ['spellListAdd'],
    add: 'Spells added to a class list',
    does: "Spells that join a class's spell list, as an expanded spell list does",
    make: () => ({ kind: 'spellListAdd', spells: ['Fireball'] }),
    fields: [],
    line: addedWords,
    boxes: (p) => (
      <>
        <ListBox
          effect={p.effect}
          field="spells"
          title={p.title}
          label="Spells"
          placeholder="Fireball, Haste"
          onChange={p.onChange}
        />
        <ClassBox effect={p.effect} title={p.title} label="Class list" onChange={p.onChange} />
      </>
    ),
    problemWords: (p) => (p.startsWith('"spells"') ? 'name a spell' : undefined),
    notInPlay: true,
  },
  {
    kinds: ['grantSpell'],
    add: 'Cast a spell',
    does: 'A spell you can cast at will, with uses, or always prepared',
    make: () => ({ kind: 'grantSpell', spell: '' }),
    sample: () => ({ kind: 'grantSpell', spell: 'Misty Step|XPHB' }),
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
    boxes: (p) => (
      <GrantFields
        effect={p.effect}
        title={p.title}
        resources={p.resources}
        spells={p.spells ?? []}
        onChange={p.onChange}
      />
    ),
    problemWords: (p) => (p.startsWith('"spell"') ? 'pick a spell from the list' : undefined),
    // Spells come from the build: one given in play is not cast from the sheet.
    notInPlay: true,
  },
];
