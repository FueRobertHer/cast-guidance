/**
 * What an entry does on the sheet, built as cards (ADR-001, D2; the Spell
 * board's A). Each card is one effect kind the engine already counts, read
 * back as a sentence, with the few controls that kind takes. The list is
 * stored as `castGuidance.effects` (`StoredEffect`) and checked by the same
 * reader the sheet uses, so a card that would not count says why, here.
 */
import { CircleAlert, Plus, X } from 'lucide-react';
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

const specOf = (kind: string) => KINDS.find((k) => k.kinds.includes(kind));

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
  readOnly,
  onChange,
  onRemove,
}: {
  effect: Eff;
  problems: string[];
  list: readonly Eff[];
  readOnly: boolean;
  onChange: (next: Eff, renamedKey?: [string, string]) => void;
  onRemove: () => void;
}) {
  const spec = specOf(effect.kind);
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
          This does not count yet: {p}
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
}: {
  effects: unknown;
  onChange: (next: Eff[]) => void;
  readOnly: boolean;
  inherits?: string;
  replace?: boolean;
  onReplace?: (replace: boolean) => void;
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
      options: KINDS.filter((k) => !FIRST.includes(k.add)).map((k) => ({
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
      {list.map((effect, i) => (
        <Card
          // Effects have no id of their own; a card is its place in the list.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={i}
          effect={effect}
          list={list}
          problems={problemsOf(i)}
          readOnly={readOnly}
          onRemove={() => onChange(list.filter((_, j) => j !== i))}
          onChange={(next, renamed) =>
            onChange(
              list.map((x, j) => {
                if (j === i) return next;
                const cost = x.cost as { resource?: unknown } | undefined;
                return renamed !== undefined && x.kind === 'action' && cost?.resource === renamed[0]
                  ? { ...x, cost: { ...cost, resource: renamed[1] } }
                  : x;
              }),
            )
          }
        />
      ))}
      {list.length === 0 && (
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
