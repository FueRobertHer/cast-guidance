/** Board 4's spells: spell attacks, the spell save DC, and casting a spell. */
import { useId, useState } from 'react';
import { fieldClass } from '@/ui/TextField';
import { Field, Select } from '../fields';
import type { Eff, KindSpec, SpellOption } from './kit/types';
import { ABILITY, amount, amountField, firstWords, words } from './kit/words';

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

export const cards: readonly KindSpec[] = [
  {
    kinds: ['attackBonus'],
    is: (e) => e.attack === 'spell',
    add: 'Spell attacks',
    make: () => ({ kind: 'attackBonus', amount: 1, attack: 'spell' }),
    fields: [amountField],
    line: (e) => `${amount(e.amount)} to spell attack rolls`,
    stateful: true,
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
  },
];
