/**
 * What an entry does on the sheet, built as cards (ADR-001, D2; the Spell
 * board's A). Each card is one effect kind the engine already counts, read
 * back as a sentence, with the few controls that kind takes. The list is
 * stored as `castGuidance.effects` (`StoredEffect`) and checked by the same
 * reader the sheet uses, so a card that would not count says why, here.
 */
import { CircleAlert, Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { isRecord, type StoredEffect, type StoredState } from '@/engine/castGuidance';
import { readStoredEffects } from '@/engine/effects/mechanics';
import { SKILLS } from '@/engine/types';
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
const ROLLS: Options = [
  ['attack', 'attack rolls'],
  ['save', 'saving throws'],
  ['check', 'ability checks'],
];
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

const word = (options: Options, v: unknown) => options.find(([k]) => k === v)?.[1] ?? String(v);

/** A stored number as a sentence reads it: `+2`, or the formula itself. */
function amount(v: unknown, sign = true): string {
  if (typeof v === 'number') return sign ? signed(v) : String(v);
  if (typeof v === 'object' && v !== null && 'f' in v) return `(${String(v.f)})`;
  return 'a number by level';
}

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
const on = (e: Eff) => (e.on as { rolls?: string[] } | undefined)?.rolls?.[0];

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
    line: (e) => `${amount(e.amount)} to Initiative`,
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
      { key: 'on', label: 'On', type: 'pick', options: ROLLS },
    ],
    line: (e) => `${e.mode === 'dis' ? 'Disadvantage' : 'Advantage'} on ${word(ROLLS, on(e))}`,
  },
  {
    kinds: ['rollDie'],
    add: 'Added die',
    make: () => ({ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } }),
    fields: [
      { key: 'dice', label: 'Dice', type: 'dice' },
      { key: 'on', label: 'On', type: 'pick', options: ROLLS },
    ],
    line: (e) => `+${String(e.dice)} to ${word(ROLLS, on(e))}`,
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
      `${String(e.label)}: ${amount(e.max, false)} ${e.max === 1 ? 'use' : 'uses'}, back on a ${e.reset === 'short' ? 'short or long' : 'long'} rest`,
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
        ],
      },
      { key: 'label', label: 'Name', type: 'text' },
    ],
    line: (e) =>
      `${e.economy === 'bonus' ? 'Bonus action' : e.economy === 'reaction' ? 'Reaction' : 'Action'}: ${String(e.label)}${costOf(e) ? `, spends 1 use of ${costOf(e)}` : ''}`,
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

function costOf(e: Eff): string | undefined {
  const cost = e.cost as { resource?: unknown } | undefined;
  return typeof cost?.resource === 'string' ? cost.resource : undefined;
}

const specOf = (e: Eff) => KINDS.find((k) => k.kinds.includes(e.kind) && (k.is?.(e) ?? true));

/** A spell a card can name: the player's data, as `name|source`. */
export interface SpellOption {
  name: string;
  source: string;
}

/** The resource a grant spends, as the Spells tab counts it: per day back on a long rest. */
function usageFor(resource: Eff | undefined): string {
  return `1/${resource?.reset === 'short' ? 'rest' : 'day'}`;
}

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
              Spending 1 use of {String(r.label)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Attack and DC from">
        <Select
          aria-label="Cast a spell: Attack and DC from"
          value={typeof effect.ability === 'string' ? effect.ability : ''}
          onChange={(e) => {
            const { ability: _, ...rest } = effect;
            onChange(e.target.value === '' ? (rest as Eff) : { ...rest, ability: e.target.value });
          }}
        >
          <option value="">No ability</option>
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

/** A resource's key, from the name a player gives it. */
const keyOf = (label: string) =>
  label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '') || 'uses';

/** A field's value as its box shows it. */
function shown(e: Eff, f: FieldSpec): string {
  const v = f.key === 'on' ? on(e) : e[f.key];
  if (v === undefined) return '';
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

function Card({
  effect,
  problems,
  list,
  spells,
  readOnly,
  onChange,
  onRemove,
}: {
  effect: Eff;
  problems: string[];
  list: readonly Eff[];
  spells: readonly SpellOption[];
  readOnly: boolean;
  onChange: (next: Eff, renamedKey?: [string, string]) => void;
  onRemove: () => void;
}) {
  const spec = specOf(effect);
  const title = spec?.add ?? effect.kind;
  const resources = list.filter((x) => x.kind === 'resource' && typeof x.key === 'string');
  const state = typeof effect.while === 'string' ? effect.while : '';
  const set = (f: FieldSpec, text: string) => {
    const v = stored(f, text);
    if (f.key === 'on') onChange({ ...effect, on: { rolls: [v] } });
    else if (f.key === 'kind') onChange({ ...effect, kind: String(v) });
    else if (effect.kind === 'resource' && f.key === 'label') {
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
                  onChange={(e) => set(f, e.target.value)}
                  className={fieldClass}
                />
              )}
            </Field>
          ))}
          {effect.kind === 'grantSpell' && (
            <GrantFields
              effect={effect}
              resources={resources}
              spells={spells}
              onChange={onChange}
            />
          )}
          {effect.kind === 'action' && resources.length > 0 && (
            <Field label="Spends">
              <Select
                aria-label={`${title}: Spends`}
                value={costOf(effect) ?? ''}
                onChange={(e) => {
                  const { cost: _, ...rest } = effect;
                  onChange(
                    e.target.value === ''
                      ? (rest as Eff)
                      : { ...rest, cost: { resource: e.target.value, amount: 1 } },
                  );
                }}
              >
                <option value="">Nothing</option>
                {resources.map((r) => (
                  <option key={String(r.key)} value={String(r.key)}>
                    1 use of {String(r.label)}
                  </option>
                ))}
              </Select>
            </Field>
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
        </div>
      )}
      {state !== '' && readOnly && (
        <span className="text-caption text-ink-muted">{word(STATES, state)}</span>
      )}
      {problems.map((p) => (
        <p key={p} className="flex items-start gap-1.5 pr-2 text-caption text-danger">
          <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
          This does not count yet:{' '}
          {effect.kind === 'grantSpell' && p.startsWith('"spell"')
            ? 'pick a spell from the list'
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
}: {
  effects: unknown;
  onChange: (next: Eff[]) => void;
  readOnly: boolean;
  inherits?: string;
  replace?: boolean;
  onReplace?: (replace: boolean) => void;
  /** The spells a "Cast a spell" card can name; without them it is not offered. */
  spells?: readonly SpellOption[];
  /** Effects another control of the editor shows, left out of the cards (an item's charges). */
  hide?: (e: Eff) => boolean;
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
            spells={spells ?? []}
            problems={problemsOf(i)}
            readOnly={readOnly}
            onRemove={() => onChange(list.filter((_, j) => j !== i))}
            onChange={(next, renamed) =>
              onChange(
                list.map((x, j) => {
                  if (j === i) return next;
                  if (renamed === undefined) return x;
                  // What spends the renamed uses follows it: an action's cost,
                  // a spell cast with them.
                  const cost = x.cost as { resource?: unknown } | undefined;
                  if (x.kind === 'action' && cost?.resource === renamed[0])
                    return { ...x, cost: { ...cost, resource: renamed[1] } };
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
