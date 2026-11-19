/**
 * The five modifiers under every card (ADR-002, D6; board 4's phone 2): Only
 * while, Grows with level, Rules version, Counts when and Lasts. Each is
 * offered only where the engine reads it, asked of the reader itself, and says
 * why where it is not. A modifier a file sets shows whatever it is, so it can
 * be taken away.
 */
import { Plus, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  FORMULA_FIELDS,
  isRecord,
  MOMENTS,
  type MomentId,
  type StoredState,
} from '@/engine/castGuidance';
import { readStoredEffects } from '@/engine/effects/mechanics';
import { readMoments } from '@/engine/moments';
import { Chip } from '@/ui/Chip';
import { fieldClass } from '@/ui/TextField';
import { Field, Select } from '../../fields';
import type { Eff, KindSpec, Options } from './types';
import { editionBox, isByLevel, offering, omit, STATES, stateBox } from './words';

type Json = Record<string, unknown>;

export type ModifierId = 'while' | 'level' | 'edition' | 'when' | 'lasts';

const LABELS: ReadonlyArray<readonly [ModifierId, string]> = [
  ['while', 'Only while'],
  ['level', 'Grows with level'],
  ['edition', 'Rules version'],
  ['when', 'Counts when'],
  ['lasts', 'Lasts'],
];

// What the reader makes of one effect, kept: every card asks of each render.
const READ = new Map<string, readonly string[]>();
function remembered(key: string, read: () => readonly string[]): readonly string[] {
  const known = READ.get(key);
  if (known !== undefined) return known;
  if (READ.size > 4000) READ.clear();
  const now = read();
  READ.set(key, now);
  return now;
}
const asEntry = (e: Eff) =>
  remembered(`e${JSON.stringify(e)}`, () => readStoredEffects([e]).problems);
/** The name a moment's effect goes on the sheet under, when the entry has none. */
const ON_SHEET = 'Effect';
const atMoment = (e: Eff) =>
  remembered(`m${JSON.stringify(e)}`, () => {
    const moment = { at: 'zeroHp', do: [{ kind: 'addEffect', name: ON_SHEET, effects: [e] }] };
    return readMoments([moment], ON_SHEET).problems;
  });

/**
 * Whether the reader takes a whole one of a kind (`base`, one it takes as it
 * is) with `patch`. The reader says only the first field it refuses, so what
 * a kind may take is asked of a whole one, never of a card still being filled in.
 */
const takes = (base: Eff, patch: Json) =>
  asEntry({ ...base, ...patch } as Eff).length === 0 && asEntry(base).length === 0;

/** A whole one of the card's kind, as the reader takes it. */
export const sampleOf = (spec: KindSpec | undefined, e: Eff): Eff =>
  spec?.sample?.() ?? spec?.make() ?? e;

/** Always, and the states a kind may hold only while (`while`), as the reader takes them. */
const statesFor = (base: Eff) => STATES.filter(([s]) => s === '' || takes(base, { while: s }));

/** The box a level table goes in: the first amount box of a field that may be one. */
export function levelKey(spec: KindSpec | undefined, e: Eff): string | undefined {
  const formulas = FORMULA_FIELDS[e.kind as keyof typeof FORMULA_FIELDS] ?? [];
  return spec?.fields.find((f) => f.type === 'amount' && formulas.includes(f.key))?.key;
}

/**
 * Why a moment cannot put `e` on, in a player's words; undefined when it can.
 * A kind a moment never puts on says so first (asked of a whole one, `base`),
 * then what this card holds that a moment's effect may not.
 */
function momentRefusal(base: Eff, e: Eff): string | undefined {
  const kind = asEntry(base).length === 0 ? refusal(base) : undefined;
  if (kind !== undefined) return kind;
  if (asEntry(e).length > 0) return 'it does not count yet as it is';
  return refusal(e);
}

function refusal(e: Eff): string | undefined {
  const all = atMoment(e);
  if (all.length === 0) return undefined;
  const why = all.map((p) => /: (an effect in play .*)$/.exec(p)?.[1]).find((w) => w !== undefined);
  if (why === undefined) return 'a moment cannot put this on as it is';
  if (why.includes('"while"')) {
    return 'take Only while away first: what a moment puts on holds for as long as it lasts';
  }
  if (why.includes('"edition"')) {
    return 'take Rules version away first: what a moment puts on holds under the rules it is put on under';
  }
  if (why.includes('only numbers and rolls')) return 'a moment can put on numbers and rolls only';
  return why.replace(/^an effect in play/, 'what a moment puts on');
}

/** The moments, in a player's words. */
export const MOMENT_WORDS: Readonly<Record<MomentId, string>> = {
  zeroHp: 'You drop to 0 hit points',
  natural20: 'You roll a natural 20',
  natural1: 'You roll a natural 1',
  castAtLevel: 'You cast a spell with a slot',
  shortRest: 'You finish a short rest',
  longRest: 'You finish a long rest',
  turnStart: 'Your turn starts',
  conditionAdded: 'A condition starts on you',
  conditionEnded: 'A condition ends on you',
};
const MOMENT_OPTIONS: Options = MOMENTS.map((m) => [m, MOMENT_WORDS[m]]);

/** A moment's fields that belong to one moment alone (`readMoment`). */
const FILTERS: Readonly<Record<string, readonly MomentId[]>> = {
  rolls: ['natural20', 'natural1'],
  level: ['castAtLevel'],
  condition: ['conditionAdded', 'conditionEnded'],
};

/** A moment put on at another: what belonged to the old one alone goes. */
export function movedTo(moment: Json, at: MomentId): Json {
  return {
    ...Object.fromEntries(
      Object.entries(moment).filter(([k]) => !(k in FILTERS) || FILTERS[k]?.includes(at)),
    ),
    at,
  };
}

const ROLLS: Options = [
  ['', 'Any d20 roll'],
  ['attack', 'An attack roll'],
  ['save', 'A saving throw'],
  ['check', 'An ability check'],
];
const SLOT_LEVELS: Options = [
  ['', 'Any slot'],
  ...Array.from({ length: 9 }, (_, i) => [String(i + 1), `Level ${i + 1} or higher`] as const),
];
const LASTS: Options = [
  ['', 'No set time'],
  ['m1', '1 minute'],
  ['m10', '10 minutes'],
  ['m60', '1 hour'],
  ['m480', '8 hours'],
  ['short', 'Until you finish a short rest'],
  ['long', 'Until you finish a long rest'],
];
const ENDS: Options = [
  ['', 'Never'],
  ['unconscious', 'When knocked unconscious'],
  ['incapacitated', 'When Incapacitated'],
];

/** A duration's Lasts box: its time or its rest. Both, or another time, show as written. */
function lastsBox(lasts: Json): { value: string; options: Options } {
  const { minutes, rest } = lasts;
  const value =
    minutes === undefined && rest === undefined
      ? ''
      : minutes === undefined && typeof rest === 'string'
        ? rest
        : rest === undefined && typeof minutes === 'number'
          ? `m${minutes}`
          : 'written';
  const written = [
    typeof minutes === 'number' ? `${minutes} minutes` : '',
    typeof rest === 'string' ? `until a ${rest} rest` : '',
  ]
    .filter((s) => s !== '')
    .join(' or ');
  return { value, options: offering(LASTS, value, `${written}, as written`) };
}

function withLasts(lasts: Json, v: string): Json {
  const rest = omit(lasts as Eff, ['minutes', 'rest']) as Json;
  if (v === 'short' || v === 'long') return { ...rest, rest: v };
  if (v.startsWith('m')) return { ...rest, minutes: Number(v.slice(1)) };
  return rest;
}

/** How long what a moment puts on lasts, in words: "for 1 minute", "until a long rest". */
export function lastsWords(lasts: unknown): string {
  if (!isRecord(lasts)) return '';
  const box = lastsBox(lasts);
  const time = box.options.find(([v]) => v === box.value)?.[1] ?? '';
  return [
    box.value === '' ? '' : `, ${time.replace(/, as written$/, '').toLowerCase()}`,
    lasts.concentration === true ? ', while you concentrate' : '',
    typeof lasts.endsWhen === 'string' ? `, ending if you are ${lasts.endsWhen}` : '',
  ].join('');
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** When a moment puts its effect on, and for how long, as a read-only card says it. */
export function momentWords(place: MomentPlace): string {
  const { at, rolls, level, condition } = place.moment;
  const said =
    typeof condition === 'string' && (at === 'conditionAdded' || at === 'conditionEnded')
      ? `${condition} ${at === 'conditionAdded' ? 'starts' : 'ends'} on you`
      : lower(MOMENT_WORDS[at as MomentId] ?? String(at));
  const more =
    typeof level === 'number'
      ? ` of level ${level} or higher`
      : Array.isArray(rolls)
        ? ` on ${rolls.map((r) => lower(ROLLS.find(([v]) => v === r)?.[1] ?? String(r))).join(' or ')}`
        : '';
  return `Put on when ${said}${more}${lastsWords(place.outcome.lasts)}`;
}

/** Where a card a moment puts on sits: its moment, and how to change or leave it. */
export interface MomentPlace {
  moment: Json;
  /** The moment's one outcome, the effect it puts on (`addEffect`). */
  outcome: Json;
  set: (moment: Json) => void;
  /** Back to the entry's own list: it counts all the time. */
  out: () => void;
}

export interface ModifierProps {
  spec: KindSpec | undefined;
  effect: Eff;
  title: string;
  inPlay: boolean;
  inPick: boolean;
  onChange: (next: Eff) => void;
  place?: MomentPlace;
  /** Puts the card on at a moment; absent where the list keeps no moments. */
  toMoment?: (at: MomentId) => void;
}

/** The modifiers row and, under it, each one that is on. */
export function Modifiers({
  spec,
  effect: e,
  title,
  inPlay,
  inPick,
  onChange,
  place,
  toMoment,
}: ModifierProps) {
  const [open, setOpen] = useState<Partial<Record<ModifierId, boolean>>>({});
  const [note, setNote] = useState('');
  // An effect a moment puts on is in play: it holds for as long as it lasts,
  // under the rules it is put on under.
  const played = inPlay || place !== undefined;
  const key = levelKey(spec, e);
  const base = sampleOf(spec, e);
  // In play a state shows only as a file sets it, to be taken away.
  const states = statesFor(base);
  const why: Record<ModifierId, string | undefined> = {
    while: played
      ? 'an effect in play holds for as long as it lasts'
      : states.length === 1
        ? 'it holds all the time: only numbers and rolls can wait on a state'
        : undefined,
    level: played
      ? 'an effect in play takes the numbers it is given'
      : key === undefined || !takes(base, { [key]: { byLevel: { 1: 1, 5: 2 } } })
        ? 'it has no number to grow'
        : undefined,
    edition: played
      ? 'an effect in play holds under the rules it is put in play under'
      : takes(base, { edition: '2024' })
        ? undefined
        : 'it holds under every rules version',
    when:
      place !== undefined
        ? undefined
        : inPlay
          ? 'an effect in play is put on by what holds it'
          : inPick
            ? 'what a pick gives counts from when it is picked'
            : toMoment === undefined
              ? 'this list cannot put an effect on at a moment yet'
              : momentRefusal(base, e),
    lasts:
      place === undefined
        ? 'only what a moment puts on has a duration: set Counts when first'
        : undefined,
  };
  const set: Record<ModifierId, boolean> = {
    while: e.while !== undefined,
    level: key !== undefined && isByLevel(e[key]),
    edition: e.edition !== undefined,
    when: place !== undefined,
    lasts: isRecord(place?.outcome.lasts),
  };
  // Only while and Rules version show from the start, as they always have.
  const shows = (id: ModifierId) =>
    set[id] ||
    (why[id] === undefined && (open[id] ?? ((id === 'while' || id === 'edition') && !played)));
  const tap = (id: ModifierId, label: string) => {
    setNote('');
    if (!shows(id) && why[id] !== undefined) {
      return setNote(`${label} is not offered here: ${why[id]}.`);
    }
    if (!shows(id)) {
      if (id === 'level' && key !== undefined) {
        const now = e[key];
        return onChange({ ...e, [key]: { byLevel: { 1: typeof now === 'number' ? now : 0 } } });
      }
      return setOpen({ ...open, [id]: true });
    }
    setOpen({ ...open, [id]: false });
    if (!set[id]) return;
    if (id === 'while' || id === 'edition') onChange(omit(e, [id]));
    else if (id === 'level' && key !== undefined) onChange({ ...e, [key]: firstRow(e[key]) });
    else if (id === 'when') place?.out();
    else if (id === 'lasts' && place !== undefined) {
      place.set({ ...place.moment, do: [omit(place.outcome as Eff, ['lasts'])] });
    }
  };
  const when = stateBox(e, (s) => states.some(([v]) => v === s));
  const editions = editionBox(e);
  const subs: Record<ModifierId, () => ReactNode> = {
    while: () => (
      <Field label="When">
        <Select
          aria-label={`${title}: When`}
          value={when.value}
          onChange={(x) => {
            const { while: _, ...rest } = e;
            onChange(
              x.target.value === ''
                ? (rest as Eff)
                : { ...rest, while: x.target.value as StoredState },
            );
          }}
        >
          {when.options
            .filter(([v]) => !played || v === '' || v === when.value)
            .map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
        </Select>
      </Field>
    ),
    level: () =>
      key === undefined ? null : (
        <LevelRows effect={e} field={key} title={title} onChange={onChange} />
      ),
    edition: () => (
      <Field label="Rules">
        <Select
          aria-label={`${title}: Rules`}
          value={editions.value}
          onChange={(x) => {
            const { edition: _, ...rest } = e;
            const v = x.target.value;
            onChange(v === '' ? (rest as Eff) : ({ ...rest, edition: v } as Eff));
          }}
        >
          {editions.options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
    ),
    when: () => <MomentFields title={title} place={place} toMoment={toMoment} />,
    lasts: () => (place === undefined ? null : <LastsFields title={title} place={place} />),
  };
  return (
    <>
      <fieldset className="-mx-1.5 flex flex-wrap pr-2">
        <legend className="sr-only">{title}: modifiers</legend>
        {LABELS.map(([id, label]) => (
          <Chip
            key={id}
            tone="outline"
            className="px-2.5 aria-disabled:opacity-60"
            pressed={shows(id)}
            aria-disabled={!shows(id) && why[id] !== undefined}
            onClick={() => tap(id, label)}
          >
            {label}
          </Chip>
        ))}
      </fieldset>
      {note !== '' && (
        <p role="status" className="pr-2 text-caption text-ink-muted">
          {note}
        </p>
      )}
      {LABELS.filter(([id]) => shows(id)).map(([id]) => (
        <div key={id} className="mr-2 flex flex-col gap-2 rounded-control bg-surface-raised p-2">
          {subs[id]()}
        </div>
      ))}
    </>
  );
}

/** A level table's rows, lowest level first. */
function rowsOf(v: unknown): Array<[number, number]> {
  const table = isByLevel(v) ? v.byLevel : {};
  return Object.entries(table)
    .map(([l, n]): [number, number] => [Number(l), typeof n === 'number' ? n : 0])
    .sort((a, b) => a[0] - b[0]);
}

/** A level table taken away: the number it starts at. */
const firstRow = (v: unknown) => rowsOf(v)[0]?.[1] ?? 0;

const LEVELS = Array.from({ length: 19 }, (_, i) => i + 2);

/** Grows with level: the number from each level on, level 1 first, as the reader needs. */
function LevelRows({
  effect,
  field,
  title,
  onChange,
}: {
  effect: Eff;
  field: string;
  title: string;
  onChange: (next: Eff) => void;
}) {
  const rows = rowsOf(effect[field]);
  const write = (next: Array<[number, number]>) =>
    onChange({
      ...effect,
      [field]: { byLevel: Object.fromEntries(next.map(([l, n]) => [String(l), n])) },
    });
  const free = LEVELS.filter((l) => !rows.some(([r]) => r === l));
  return (
    <>
      <p className="text-caption text-ink-muted">
        By your level in the class that gives it, or your character level
      </p>
      {rows.map(([level, n], i) => (
        <div key={level} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          {i === 0 ? (
            // A table starts at level 1, since the effect needs it from the start.
            <div className="flex flex-col gap-1.5">
              <span className="text-label text-ink-muted">From level</span>
              <span className={`${fieldClass} flex items-center`}>1</span>
            </div>
          ) : (
            <Field label="From level">
              <Select
                aria-label={`${title}: From level, row ${i + 1}`}
                value={String(level)}
                onChange={(x) =>
                  write(
                    rows.map((r, j): [number, number] =>
                      j === i ? [Number(x.target.value), r[1]] : r,
                    ),
                  )
                }
              >
                {[level, ...free]
                  .sort((a, b) => a - b)
                  .map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
          <Field label="Amount">
            <WholeNumber
              label={`${title}: Amount, row ${i + 1}`}
              value={n}
              onChange={(v) =>
                write(rows.map((r, j): [number, number] => (j === i ? [r[0], v] : r)))
              }
            />
          </Field>
          {i === 0 ? (
            <span className="size-tap" aria-hidden />
          ) : (
            <button
              type="button"
              aria-label={`Remove level ${level}`}
              onClick={() => write(rows.filter((_, j) => j !== i))}
              className="tap rounded-full text-ink-muted hover:bg-surface hover:text-ink"
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </div>
      ))}
      {free.length > 0 && rows.length < 20 && (
        <div className="-mx-1.5 flex flex-wrap">
          <Chip
            tone="outline"
            className="px-2.5"
            onClick={() => {
              const [lastLevel, lastAmount] = rows[rows.length - 1] ?? [1, 0];
              const next = free.find((l) => l > lastLevel) ?? free[0] ?? 2;
              const added: [number, number] = [next, lastAmount];
              write([...rows, added].sort((x, y) => x[0] - y[0]));
            }}
          >
            <Plus size={14} aria-hidden />
            Add a level
          </Chip>
        </div>
      )}
    </>
  );
}

/** A whole number box that writes only whole numbers, and keeps what is typed meanwhile. */
function WholeNumber({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [typed, setTyped] = useState(String(value));
  // A number on its way ("", "-") shows as typed. Rows are their place in the
  // table, so this one can be handed another row's number: then that is shown.
  const t = typed.trim();
  const shown = t === '' || t === '-' || Number(t) === value ? typed : String(value);
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={shown}
      onChange={(x) => {
        setTyped(x.target.value);
        const t = x.target.value.trim();
        if (/^-?\d+$/.test(t)) onChange(Number(t));
      }}
      className={fieldClass}
    />
  );
}

/** Counts when: the moment it is put on at, and what that moment holds for. */
function MomentFields({
  title,
  place,
  toMoment,
}: {
  title: string;
  place?: MomentPlace;
  toMoment?: (at: MomentId) => void;
}) {
  const m = place?.moment;
  const at = typeof m?.at === 'string' ? m.at : '';
  const options =
    m === undefined ? [['', 'Choose a moment'] as const, ...MOMENT_OPTIONS] : MOMENT_OPTIONS;
  // A filter set empty holds for every one: it is taken away.
  const set = (patch: Json) => {
    if (place === undefined || m === undefined) return;
    const next: Json = { ...m };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    place.set(next);
  };
  const rolls = Array.isArray(m?.rolls) ? m.rolls.map(String) : [];
  const rollsValue = rolls.length === 0 ? '' : rolls.length === 1 ? (rolls[0] ?? '') : 'written';
  const level = typeof m?.level === 'number' ? String(m.level) : '';
  return (
    <>
      <Field label="Put on when">
        <Select
          aria-label={`${title}: Put on when`}
          value={at}
          onChange={(x) => {
            const v = x.target.value as MomentId;
            if (v === ('' as MomentId)) return;
            if (place === undefined || m === undefined) toMoment?.(v);
            else place.set(movedTo(m, v));
          }}
        >
          {offering(options, at, `${at}, as written`).map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
      {(at === 'natural20' || at === 'natural1') && (
        <Field label="Which rolls">
          <Select
            aria-label={`${title}: Which rolls`}
            value={rollsValue}
            onChange={(x) => set({ rolls: x.target.value === '' ? undefined : [x.target.value] })}
          >
            {offering(ROLLS, rollsValue, `${rolls.join(' or ')}, as written`).map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {at === 'castAtLevel' && (
        <Field label="Slot">
          <Select
            aria-label={`${title}: Slot`}
            value={level}
            onChange={(x) =>
              set({ level: x.target.value === '' ? undefined : Number(x.target.value) })
            }
          >
            {offering(SLOT_LEVELS, level, `${level}, as written`).map(([v, text]) => (
              <option key={v} value={v}>
                {text}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {(at === 'conditionAdded' || at === 'conditionEnded') && (
        <Field label="Condition">
          <input
            aria-label={`${title}: Condition`}
            value={typeof m?.condition === 'string' ? m.condition : ''}
            placeholder="Any condition"
            onChange={(x) =>
              set({ condition: x.target.value.trim() === '' ? undefined : x.target.value })
            }
            className={fieldClass}
          />
        </Field>
      )}
    </>
  );
}

/** Lasts: how long what the moment puts on lasts, and what ends it early. */
function LastsFields({ title, place }: { title: string; place: MomentPlace }) {
  const lasts = isRecord(place.outcome.lasts) ? place.outcome.lasts : {};
  const setLasts = (next: Json) => {
    const outcome = omit(place.outcome as Eff, ['lasts']) as Json;
    place.set({
      ...place.moment,
      do: [Object.keys(next).length === 0 ? outcome : { ...outcome, lasts: next }],
    });
  };
  const box = lastsBox(lasts);
  const ends = typeof lasts.endsWhen === 'string' ? lasts.endsWhen : '';
  return (
    <>
      <Field label="Lasts">
        <Select
          aria-label={`${title}: Lasts`}
          value={box.value}
          onChange={(x) => setLasts(withLasts(lasts, x.target.value))}
        >
          {box.options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Ends early">
        <Select
          aria-label={`${title}: Ends early`}
          value={ends}
          onChange={(x) => {
            const rest = omit(lasts as Eff, ['endsWhen']) as Json;
            setLasts(x.target.value === '' ? rest : { ...rest, endsWhen: x.target.value });
          }}
        >
          {offering(ENDS, ends, `${ends}, as written`).map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex min-h-tap items-center gap-2.5 text-body">
        <input
          type="checkbox"
          className="size-4.5 accent-ink"
          checked={lasts.concentration === true}
          onChange={(x) => {
            const rest = omit(lasts as Eff, ['concentration']) as Json;
            setLasts(x.target.checked ? { ...rest, concentration: true } : rest);
          }}
        />
        While you concentrate
      </label>
    </>
  );
}
