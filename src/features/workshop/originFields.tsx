/**
 * What board 5 adds to the species, feat, optional feature and item editors
 * (ADR-002, U5b), shared by them: proficiencies given, spells given, and what
 * a prerequisite asks besides a level. Each edits the simple shape the data
 * writes. A field holding more than that is shown as kept and never rewritten,
 * and an edit changes only the keys it is about, each left where it was.
 */
import { useId, useState } from 'react';
import { useTypePacks } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { isRecord } from '@/engine/castGuidance';
import { LANGUAGE_OPTIONS } from '@/engine/effects/readers';
import { ABILITIES, SKILLS } from '@/engine/types';
import { Button } from '@/ui/Button';
import { fieldClass } from '@/ui/TextField';
import { same } from './copyWriter';
import type { Json } from './editorTypes';
import {
  ABILITY_WORDS,
  ChipPicks,
  Field,
  Kept,
  NumberField,
  onePerName,
  PrerequisiteField,
  prerequisiteLevel,
  Select,
  withPrerequisiteLevel,
} from './fields';

type Options = ReadonlyArray<readonly [string, string]>;

/** The data's own words for skills, languages and armor, as it keys them. */
export const SKILL_WORDS: Options = SKILLS.map((s) => [s.name.toLowerCase(), s.name]);
export const LANGUAGE_WORDS: Options = LANGUAGE_OPTIONS.map((o) => [o.id.toLowerCase(), o.label]);
export const ARMOR_WORDS: Options = [
  ['light', 'Light'],
  ['medium', 'Medium'],
  ['heavy', 'Heavy'],
  ['shield', 'Shields'],
];

/** Where the sheet shows a field, under it. */
export function OnSheet({ children }: { children: string }) {
  return <p className="text-caption text-ink-muted">On the sheet: {children}</p>;
}

const split = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/** Names in one box, a comma between each, held as typed so a comma can be typed. */
export function NamesBox({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: readonly string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState(value.join(', '));
  const shown = split(typed).join('\n') === value.join('\n') ? typed : value.join(', ');
  return (
    <Field label={label}>
      <input
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          setTyped(e.target.value);
          onChange(split(e.target.value));
        }}
        className={fieldClass}
      />
    </Field>
  );
}

/**
 * A `*Proficiencies` list (`[{ stealth: true, any: 1 }]`) as the names it
 * gives and a count of the player's choice under `anyKey`, when it is that
 * simple: one block of names. Undefined for anything more (a `choose`).
 */
export function grantShape(
  raw: unknown,
  anyKey?: string,
): { names: string[]; any?: number } | undefined {
  if (raw === undefined) return { names: [] };
  if (!Array.isArray(raw) || raw.length !== 1 || !isRecord(raw[0])) return undefined;
  const names: string[] = [];
  let any: number | undefined;
  for (const [k, v] of Object.entries(raw[0])) {
    if (v === true) names.push(k);
    else if (k === anyKey && typeof v === 'number' && v > 0) any = v;
    else return undefined;
  }
  return { names, any };
}

/** `raw` giving `names` and `any`: the keys it had stay where they were. */
export function grantWith(
  raw: unknown,
  names: readonly string[],
  any: number | undefined,
  anyKey?: string,
): unknown {
  const was = Array.isArray(raw) && isRecord(raw[0]) ? raw[0] : {};
  const out: Json = {};
  for (const k of Object.keys(was)) {
    if (k === anyKey ? any !== undefined : names.includes(k)) out[k] = k === anyKey ? any : true;
  }
  for (const n of names) out[n] = true;
  if (anyKey !== undefined && any !== undefined) out[anyKey] = any;
  return Object.keys(out).length > 0 ? [out] : undefined;
}

/**
 * A proficiency list: chips for the data's words (a name the file writes
 * otherwise is kept), or a box of names; and a count of the player's choice.
 */
export function GrantField({
  label,
  raw,
  onChange,
  readOnly,
  options,
  anyKey,
  anyLabel = '',
  placeholder,
}: {
  label: string;
  raw: unknown;
  onChange: (next: unknown) => void;
  readOnly: boolean;
  options?: Options;
  anyKey?: string;
  anyLabel?: string;
  placeholder?: string;
}) {
  const shape = grantShape(raw, anyKey);
  if (shape === undefined) return <Kept label={label}>a choice, kept as it is.</Kept>;
  const set = (names: readonly string[], any = shape.any) =>
    onChange(grantWith(raw, names, any, anyKey));
  // The chips are keyed in lower case; a name the file capitalised is written back as it was.
  const asWritten = new Map(shape.names.map((n) => [n.toLowerCase(), n]));
  const offered = new Set(options?.map(([k]) => k));
  const others = shape.names.filter((n) => !offered.has(n.toLowerCase()));
  return (
    <div className="flex flex-col gap-2">
      {options !== undefined ? (
        <ChipPicks
          label={label}
          options={options}
          value={shape.names.map((n) => n.toLowerCase())}
          disabled={readOnly}
          onChange={(v) => set(v.map((k) => asWritten.get(k) ?? k))}
        />
      ) : (
        <NamesBox
          label={label}
          value={shape.names}
          placeholder={placeholder}
          disabled={readOnly}
          onChange={(v) => set(v)}
        />
      )}
      {options !== undefined && others.length > 0 && (
        <Kept label={label}>also {others.join(', ')}, kept as written.</Kept>
      )}
      {anyKey !== undefined && (
        <NumberField
          label={anyLabel}
          value={shape.any}
          placeholder="None"
          disabled={readOnly}
          onChange={(n) => set(shape.names, n === 0 ? undefined : n)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spells given

type How = 'known' | 'will' | 'daily' | 'rest';

/** One spell given: how often, from what level, and the count key it was read from. */
export interface SpellRow {
  spell: string;
  how: How;
  uses?: number;
  /** The `daily` or `rest` key it was read from ("1e", or "1" for one spell alone). */
  key?: string;
  /** The character level it comes at, as the data keys it ("3", or "_" for any). */
  level?: string;
}

const HOWS: Options = [
  ['known', 'Known'],
  ['will', 'At will'],
  ['daily', 'Per long rest'],
  ['rest', 'Per short rest'],
];

const names = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((s) => typeof s === 'string') ? v : undefined;

/**
 * The rows of one `{ will, daily, rest }` list, or undefined for one the rows
 * cannot hold: several spells sharing one count, a `ritual` or `resource` list.
 * `keepOthers` lets other keys be (an item's `charges`, kept by its own section).
 */
function bucketRows(b: unknown, level: string | undefined, keepOthers: boolean) {
  const flat = names(b);
  if (flat !== undefined) return flat.map((spell): SpellRow => ({ spell, how: 'will', level }));
  if (!isRecord(b)) return undefined;
  const rows: SpellRow[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (k === 'will') {
      const n = names(v);
      if (n === undefined) return undefined;
      rows.push(...n.map((spell): SpellRow => ({ spell, how: 'will', level })));
    } else if (k === 'daily' || k === 'rest') {
      if (!isRecord(v)) return undefined;
      for (const [key, list] of Object.entries(v)) {
        const n = names(list);
        if (n === undefined || !/^[1-9]\d*e?$/.test(key) || (!key.endsWith('e') && n.length > 1))
          return undefined;
        const uses = Number.parseInt(key, 10);
        rows.push(...n.map((spell): SpellRow => ({ spell, how: k, uses, key, level })));
      }
    } else if (!keepOthers) return undefined;
  }
  return rows;
}

/** The `{ will, daily, rest }` list for `rows`: a count keeps the key it was read from. */
function bucketOf(rows: readonly SpellRow[]): Json {
  const out: Json = {};
  for (const r of rows) {
    if (r.how !== 'daily' && r.how !== 'rest') {
      out.will = [...((out.will as string[] | undefined) ?? []), r.spell];
      continue;
    }
    const uses = r.uses ?? 1;
    const key = r.key !== undefined && Number.parseInt(r.key, 10) === uses ? r.key : `${uses}e`;
    const counts = (out[r.how] ?? {}) as Record<string, string[]>;
    out[r.how] = { ...counts, [key]: [...(counts[key] ?? []), r.spell] };
  }
  return out;
}

const LEVEL_KEY = /^(_|[1-9]\d*)$/;

/**
 * `additionalSpells` as rows, when it is one list of spells given by name:
 * known, at will, or a number of times a rest, each from a level. Undefined
 * for more (alternatives, a choice of spell, an expanded list).
 */
export function grantRows(raw: unknown): { rows: SpellRow[]; ability: unknown } | undefined {
  if (raw === undefined) return { rows: [], ability: undefined };
  if (!Array.isArray(raw) || raw.length !== 1 || !isRecord(raw[0])) return undefined;
  const { ability, known, innate, ...rest } = raw[0];
  if (Object.keys(rest).length > 0) return undefined;
  if (ability !== undefined && typeof ability !== 'string' && !isRecord(ability)) return undefined;
  const rows: SpellRow[] = [];
  // In the entry's own order, which is the order they are written back in.
  const lists = Object.keys(raw[0]).flatMap(
    (k): Array<[unknown, 'known' | 'innate']> =>
      k === 'known' ? [[known, 'known']] : k === 'innate' ? [[innate, 'innate']] : [],
  );
  for (const [list, how] of lists) {
    if (!isRecord(list)) return undefined;
    for (const [level, v] of Object.entries(list)) {
      if (!LEVEL_KEY.test(level)) return undefined;
      const read =
        how === 'known'
          ? names(v)?.map((spell): SpellRow => ({ spell, how, level }))
          : bucketRows(v, level, false);
      if (read === undefined) return undefined;
      rows.push(...read);
    }
  }
  return { rows, ability };
}

/** The `additionalSpells` for `rows`, or undefined when they give none. */
export function grantsOf(rows: readonly SpellRow[], ability: unknown): unknown {
  const given = rows.filter((r) => r.spell.trim() !== '');
  if (given.length === 0) return undefined;
  const byLevel = (rs: readonly SpellRow[], each: (at: SpellRow[]) => unknown) => {
    const out: Json = {};
    for (const level of new Set(rs.map((r) => r.level ?? '_')))
      out[level] = each(rs.filter((r) => (r.level ?? '_') === level));
    return out;
  };
  const innate = given.filter((r) => r.how !== 'known');
  const known = given.filter((r) => r.how === 'known');
  const lists: Json = {
    ...(innate.length > 0 ? { innate: byLevel(innate, bucketOf) } : {}),
    ...(known.length > 0 ? { known: byLevel(known, (at) => at.map((r) => r.spell)) } : {}),
  };
  // The list of the first row first, so the rows open again in the order they were made.
  const first = given[0]?.how === 'known' ? 'known' : 'innate';
  return [
    {
      ...(ability !== undefined ? { ability } : {}),
      ...(lists[first] !== undefined ? { [first]: lists[first] } : {}),
      ...lists,
    },
  ];
}

/** An item's `attachedSpells` lists the sheet grants (`will`, `daily`, `rest`) as rows. */
export function attachedRows(raw: unknown): SpellRow[] | undefined {
  if (raw === undefined) return [];
  return isRecord(raw) ? bucketRows(raw, undefined, true) : undefined;
}

/** `raw` with those lists for `rows`; its other keys (`charges`, `ability`) as they were. */
export function attachedWith(raw: unknown, rows: readonly SpellRow[], ability: unknown): unknown {
  const { will: _, daily: __, rest: ___, ability: ____, ...kept } = isRecord(raw) ? raw : {};
  const next: Json = {
    ...kept,
    ...bucketOf(rows.filter((r) => r.spell.trim() !== '')),
    ...(ability !== undefined ? { ability } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

/** A spell typed, as the data's `name|source` when the data has one of that name. */
function spellRef(typed: string, spells: ReadonlyArray<{ name: string; source: string }>) {
  const hit = spells.find((s) => s.name.toLowerCase() === typed.trim().toLowerCase());
  return hit === undefined ? typed.trim() : `${hit.name}|${hit.source}`;
}

const refName = (ref: string) => ref.split('|')[0]?.split('#')[0] ?? '';

function SpellLine({
  n,
  row,
  spells,
  listId,
  levels,
  hows,
  disabled,
  onChange,
  onRemove,
}: {
  n: number;
  row: SpellRow;
  spells: ReadonlyArray<{ name: string; source: string }>;
  listId: string;
  levels: boolean;
  hows: Options;
  disabled: boolean;
  onChange: (next: SpellRow) => void;
  onRemove: () => void;
}) {
  const [held, setHeld] = useState(refName(row.spell));
  const typed = spellRef(held, spells) === row.spell ? held : refName(row.spell);
  const counted = row.how === 'daily' || row.how === 'rest';
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-32 flex-1">
        <Field label={`Spell ${n}`}>
          <input
            list={listId}
            value={typed}
            placeholder="Light"
            disabled={disabled}
            onChange={(e) => {
              setHeld(e.target.value);
              onChange({ ...row, spell: spellRef(e.target.value, spells) });
            }}
            className={fieldClass}
          />
        </Field>
      </div>
      <div className="w-36">
        <Field label={`Spell ${n}: how`}>
          <Select
            value={row.how}
            disabled={disabled}
            onChange={(e) => onChange({ ...row, how: e.target.value as How })}
          >
            {hows.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {counted && (
        <div className="w-18">
          <NumberField
            label={`Spell ${n}: times`}
            value={row.uses ?? 1}
            disabled={disabled}
            onChange={(u) => onChange({ ...row, uses: u === undefined || u < 1 ? 1 : u })}
          />
        </div>
      )}
      {levels && (
        <div className="w-24">
          <NumberField
            label={`Spell ${n}: from level`}
            value={row.level === undefined || row.level === '_' ? undefined : Number(row.level)}
            placeholder="Any"
            disabled={disabled}
            onChange={(l) =>
              onChange({ ...row, level: l === undefined || l < 1 ? '_' : String(Math.min(l, 20)) })
            }
          />
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        aria-label={`Remove spell ${n}`}
        disabled={disabled}
        onClick={onRemove}
      >
        Remove
      </Button>
    </div>
  );
}

/**
 * Spells an entry gives, as rows, held as typed so a row can be added before
 * its spell is named; a row with no spell is not written. `write` turns the
 * rows and the ability into the field.
 */
function SpellRows({
  rows,
  ability,
  write,
  raw,
  registry,
  draft,
  levels,
  readOnly,
  onChange,
}: {
  rows: SpellRow[];
  ability: unknown;
  write: (rows: readonly SpellRow[], ability: unknown) => unknown;
  raw: unknown;
  registry: EntityRegistry;
  draft: Json;
  levels: boolean;
  readOnly: boolean;
  onChange: (next: unknown) => void;
}) {
  useTypePacks('spell');
  const listId = useId();
  const [held, setHeld] = useState(rows);
  // Written from elsewhere (the file view, Undo): what the field holds is shown.
  const shown = same(write(held, ability), raw) ? held : rows;
  const spells = onePerName(registry.byType('spell'), draft);
  const set = (next: SpellRow[], ab = ability) => {
    setHeld(next);
    onChange(write(next, ab));
  };
  const hows = levels ? HOWS : HOWS.slice(1);
  return (
    <div className="flex flex-col gap-2">
      {shown.map((row, i) => (
        <SpellLine
          // A row is its place in the list, as a charge spell's is.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={i}
          n={i + 1}
          row={row}
          spells={spells}
          listId={listId}
          levels={levels}
          hows={hows}
          disabled={readOnly}
          onChange={(r) => set(shown.map((x, j) => (j === i ? r : x)))}
          onRemove={() => set(shown.filter((_, j) => j !== i))}
        />
      ))}
      <datalist id={listId}>
        {spells.map((s) => (
          <option key={`${s.name}|${s.source}`} value={s.name} />
        ))}
      </datalist>
      {shown.length > 0 &&
        (ability === undefined || typeof ability === 'string' ? (
          <Field label="Their attack and DC from">
            <Select
              value={typeof ability === 'string' ? ability : ''}
              disabled={readOnly}
              onChange={(e) => set(shown, e.target.value === '' ? undefined : e.target.value)}
            >
              <option value="">No ability</option>
              {ABILITIES.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Kept label="Their attack and DC from">a choice of ability, kept as it is.</Kept>
        ))}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => set([...shown, { spell: '', how: levels ? 'known' : 'will' }])}
        >
          Add a spell
        </Button>
      )}
    </div>
  );
}

/** The spells a species or feat gives (`additionalSpells`). */
export function SpellsGiven({
  raw,
  onChange,
  registry,
  draft,
  readOnly,
}: {
  raw: unknown;
  onChange: (next: unknown) => void;
  registry: EntityRegistry;
  draft: Json;
  readOnly: boolean;
}) {
  const read = grantRows(raw);
  if (read === undefined)
    return <Kept label="Spells">alternatives or a choice of spell, kept as they are.</Kept>;
  return (
    <SpellRows
      rows={read.rows}
      ability={read.ability}
      write={grantsOf}
      raw={raw}
      registry={registry}
      draft={draft}
      levels
      readOnly={readOnly}
      onChange={onChange}
    />
  );
}

/** The spells an item casts without its charges (`attachedSpells`). */
export function SpellsAttached({
  raw,
  onChange,
  registry,
  draft,
  readOnly,
}: {
  raw: unknown;
  onChange: (next: unknown) => void;
  registry: EntityRegistry;
  draft: Json;
  readOnly: boolean;
}) {
  const rows = attachedRows(raw);
  if (rows === undefined)
    return <Kept label="Spells it casts">a list with no limits, kept as it is.</Kept>;
  const ability = isRecord(raw) ? raw.ability : undefined;
  return (
    <SpellRows
      rows={rows}
      ability={ability}
      write={(r, ab) => attachedWith(raw, r, ab)}
      raw={raw}
      registry={registry}
      draft={draft}
      levels={false}
      readOnly={readOnly}
      onChange={onChange}
    />
  );
}

// ---------------------------------------------------------------------------
// Prerequisites

const PACTS: Options = [
  ['', 'None'],
  ['Blade', 'Pact of the Blade'],
  ['Chain', 'Pact of the Chain'],
  ['Tome', 'Pact of the Tome'],
  ['Talisman', 'Pact of the Talisman'],
];

/** The keys the parts below edit (a `note` goes unsaid); any other is kept, and named. */
const PARTS = new Set(['level', 'spellcasting', 'note']);
const NEEDS: Readonly<Record<string, string>> = {
  ability: 'an ability score',
  race: 'a species',
  feat: 'a feat',
  background: 'a background',
  proficiency: 'a proficiency',
  pact: 'a pact',
  spell: 'a spell',
  other: 'something else',
  patron: 'a patron',
  campaign: 'a campaign',
};

/** A list of names, as strings or as `{ name }`, when every one is that plain. */
function nameList(v: unknown, asObjects: boolean): string[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) =>
    asObjects
      ? isRecord(x) && Object.keys(x).join() === 'name' && typeof x.name === 'string'
        ? x.name
        : undefined
      : typeof x === 'string'
        ? x
        : undefined,
  );
  return out.every((x) => x !== undefined) ? (out as string[]) : undefined;
}

/** One ability score asked for (`[{ str: 13 }]`), when it is one. */
function abilityNeed(v: unknown): { ability?: string; score?: number } | undefined {
  if (v === undefined) return {};
  if (!Array.isArray(v) || v.length !== 1 || !isRecord(v[0])) return undefined;
  const entries = Object.entries(v[0]);
  const [k, n] = entries[0] ?? [];
  return entries.length === 1 && ABILITY_WORDS.some(([a]) => a === k) && typeof n === 'number'
    ? { ability: k, score: n }
    : undefined;
}

/** The armor training asked for (`[{ armor: "medium" }]`), when that is all it asks. */
function armorNeed(v: unknown): string | undefined | null {
  if (v === undefined) return undefined;
  return Array.isArray(v) &&
    v.length === 1 &&
    isRecord(v[0]) &&
    Object.keys(v[0]).join() === 'armor' &&
    typeof v[0].armor === 'string'
    ? v[0].armor
    : null;
}

/**
 * What a feat or optional feature needs: the character level, and the rest
 * of one set of needs (an ability score, spellcasting, a species, a feat, a
 * background, armor training, a pact, a spell, something else). Alternatives
 * ("this or that") are kept as they are, with the level box as before.
 */
export function Prerequisites({
  value,
  onChange,
  readOnly,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  readOnly: boolean;
}) {
  const one = value === undefined || (Array.isArray(value) && value.length === 1);
  const alt = Array.isArray(value) ? value[0] : {};
  if (!one || !isRecord(alt) || !prerequisiteLevel(value).editable)
    return <PrerequisiteField value={value} readOnly={readOnly} onChange={onChange} />;
  const put = (key: string, v: unknown) => {
    const next: Json = { ...alt, [key]: v };
    if (v === undefined) delete next[key];
    onChange(Object.keys(next).length > 0 ? [next] : undefined);
  };
  const putNames = (key: string, list: string[], asObjects: boolean) =>
    put(key, list.length === 0 ? undefined : asObjects ? list.map((name) => ({ name })) : list);
  const ability = abilityNeed(alt.ability);
  const armor = armorNeed(alt.proficiency);
  const lists = [
    ['race', 'Species', 'Elf, Dwarf', true],
    ['feat', 'Feat', 'Tough|XPHB', false],
    ['background', 'Background', 'Sage', true],
    ['spell', 'Spell known', 'Eldritch Blast#c', false],
  ] as const;
  // What a box below edits, as long as the file writes it plainly.
  const edits: Readonly<Record<string, boolean>> = {
    ability: ability !== undefined,
    proficiency: armor !== null,
    pact: alt.pact === undefined || PACTS.some(([p]) => p === alt.pact),
    other: alt.other === undefined || typeof alt.other === 'string',
    ...Object.fromEntries(lists.map(([k, , , o]) => [k, nameList(alt[k], o) !== undefined])),
  };
  const kept = [
    ...new Set(
      Object.keys(alt)
        .filter((k) => !PARTS.has(k) && edits[k] !== true)
        .map((k) => NEEDS[k] ?? (k.startsWith('spellcasting') ? 'spellcasting' : k)),
    ),
  ];
  return (
    <div className="flex flex-col gap-2">
      <NumberField
        label="Character level needed"
        value={prerequisiteLevel(value).level}
        placeholder="Any"
        disabled={readOnly}
        onChange={(l) => onChange(withPrerequisiteLevel(value, l === 0 ? undefined : l))}
      />
      {ability !== undefined && (
        <div className="grid grid-cols-2 items-end gap-2">
          <Field label="Ability score needed">
            <Select
              value={ability.ability ?? ''}
              disabled={readOnly}
              onChange={(e) =>
                put(
                  'ability',
                  e.target.value === '' ? undefined : [{ [e.target.value]: ability.score ?? 13 }],
                )
              }
            >
              <option value="">None</option>
              {ABILITY_WORDS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {ability.ability !== undefined && (
            <NumberField
              label="At least"
              value={ability.score}
              disabled={readOnly}
              onChange={(n) => put('ability', [{ [ability.ability as string]: n ?? 13 }])}
            />
          )}
        </div>
      )}
      <label className="flex min-h-tap items-center gap-2.5 text-body">
        <input
          type="checkbox"
          className="size-4.5 accent-ink"
          disabled={readOnly}
          checked={alt.spellcasting === true}
          onChange={(e) => put('spellcasting', e.target.checked ? true : undefined)}
        />
        Can cast at least one spell
      </label>
      {lists.map(([key, label, placeholder, asObjects]) => {
        const list = nameList(alt[key], asObjects);
        return list === undefined ? null : (
          <NamesBox
            key={key}
            label={label}
            value={list}
            placeholder={placeholder}
            disabled={readOnly}
            onChange={(v) => putNames(key, v, asObjects)}
          />
        );
      })}
      <div className="grid grid-cols-2 items-end gap-2">
        {armor !== null && (
          <Field label="Armor training">
            <Select
              value={armor ?? ''}
              disabled={readOnly}
              onChange={(e) =>
                put('proficiency', e.target.value === '' ? undefined : [{ armor: e.target.value }])
              }
            >
              <option value="">None</option>
              {ARMOR_WORDS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {edits.pact && (
          <Field label="Pact boon">
            <Select
              value={typeof alt.pact === 'string' ? alt.pact : ''}
              disabled={readOnly}
              onChange={(e) => put('pact', e.target.value === '' ? undefined : e.target.value)}
            >
              {PACTS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {edits.other && (
        <Field label="Something else, in words">
          <input
            value={typeof alt.other === 'string' ? alt.other : ''}
            disabled={readOnly}
            onChange={(e) => put('other', e.target.value === '' ? undefined : e.target.value)}
            className={fieldClass}
          />
        </Field>
      )}
      {kept.length > 0 && <Kept label="Also needs">{kept.join(', ')}, kept as it is.</Kept>}
    </div>
  );
}
