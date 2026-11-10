/**
 * Spells (the Spell board's A, with B's text reader as a head start): what the
 * spell is, its text and what the reader found in it, what it does as cards
 * the sheet can roll and count, and the spell as the Spells tab shows it.
 *
 * Every card writes the standard field the sheet reads (`spellAttack`,
 * `savingThrow`, `conditionInflict`, `damageInflict`, `duration`, the dice
 * tags in the text, `entriesHigherLevel`, `scalingLevelDice`). Only what a
 * spell puts on its target while it lasts has no such field: that is the
 * spell's own `castGuidance.effects`.
 */
import { CircleAlert, Plus, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { DAMAGE_TYPES } from '@/convert/fc5/text';
import { useTypePacks } from '@/data5e/hooks';
import { isRecord } from '@/engine/castGuidance';
import { SPELL_SCHOOLS } from '@/engine/spellQuery';
import { castingTime, spellDuration, spellRange } from '@/features/library/fmt';
import { spellMeta, spellSaves } from '@/features/sheet/spellMeta';
import { spellRollActions } from '@/features/sheet/spellRolls';
import { entriesToText, textToEntries } from '@/lib/entriesText';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { fieldClass } from '@/ui/TextField';
import { EffectCards, guidanceWith } from '../EffectCards';
import type { EditorProps, EditorSpec, Json } from '../editorTypes';
import {
  ABILITY_WORDS,
  ChipPicks,
  Field,
  NumberField,
  onePerName,
  Section,
  Select,
  TextBlocks,
} from '../fields';
import {
  escapeRe,
  type Finding,
  mapStrings,
  ordinal,
  readSpellText,
  retag,
  stringsOf,
  swapTag,
  tagsIn,
  untag,
  withSentence,
  wordsOf,
} from '../textReader';

type Options = ReadonlyArray<readonly [string, string]>;

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => list(v).filter((s): s is string => typeof s === 'string');
const cap = (s: string) => `${s[0]?.toUpperCase() ?? ''}${s.slice(1)}`;
const DICE = /^\d{1,2}d\d{1,3}(?:[+-]\d{1,3})?$/;
const TYPES = DAMAGE_TYPES.join('|');
const CONDITIONS = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
];

// ---------------------------------------------------------------------------
// The cards, read from the spell and written back to it
// ---------------------------------------------------------------------------

/** A damage roll as a card shows it: its dice, and the type its words name. */
export interface Roll {
  dice: string;
  type?: string;
}

/**
 * Each damage roll the text tags, once per dice and type: Flame Strike's 4d6
 * fire and 4d6 radiant are two rolls, a roll the text names twice is one.
 */
export function damageRolls(spell: Json): Roll[] {
  const out: Roll[] = [];
  const re = new RegExp(`\\{@damage ([^{}|]+)[^{}]*\\}(?:\\s+(${TYPES})\\b)?`, 'gi');
  for (const s of stringsOf(spell.entries)) {
    for (const m of s.matchAll(re)) {
      const dice = (m[1] ?? '').trim();
      const type = m[2]?.toLowerCase();
      if (out.some((r) => r.dice === dice && r.type === type)) continue;
      out.push(type === undefined ? { dice } : { dice, type });
    }
  }
  return out;
}

/**
 * `entries` with each tag of `roll` (its dice, followed by its type or by no
 * type) changed by `fn`, which gets the tag and the words after it. A roll of
 * the same dice in another type is left alone.
 */
export function mapRoll(
  entries: unknown,
  roll: Roll,
  fn: (tag: string, after: string) => string,
): unknown {
  const re = new RegExp(
    `\\{@damage ${escapeRe(roll.dice)}(?:\\|[^{}]*)?\\}((?:\\s+(?:${TYPES})\\b)?)`,
    'gi',
  );
  return mapStrings(entries, (s) =>
    s.replace(re, (whole: string, after: string) => {
      const type = /\S+/.exec(after)?.[0]?.toLowerCase();
      if (type !== roll.type) return whole;
      return fn(whole.slice(0, whole.length - after.length), after);
    }),
  );
}

const MOD = /^\s*(?:\+|plus)\s+your spellcasting ability modifier/i;

/** Each healing roll: a dice tag in words that regain hit points, and whether the caster's modifier adds. */
export function healRolls(spell: Json): Array<{ dice: string; mod: boolean }> {
  const out: Array<{ dice: string; mod: boolean }> = [];
  for (const s of stringsOf(spell.entries)) {
    if (!/\bregains?\b|\bhealing\b/i.test(s)) continue;
    for (const m of s.matchAll(/\{@dice ([^{}|]+)[^{}]*\}/g)) {
      const dice = (m[1] ?? '').trim();
      if (out.some((r) => r.dice === dice)) continue;
      out.push({ dice, mod: MOD.test(s.slice((m.index ?? 0) + m[0].length)) });
    }
  }
  return out;
}

/** The slot scaling the higher-level text tags: which roll, from which level, by what. */
export function upcastOf(spell: Json): { base: string; step: string; heal: boolean } | undefined {
  for (const s of stringsOf(spell.entriesHigherLevel)) {
    const m = /\{@scale(damage|dice) ([^{}|]+)\|[^{}|]+\|([^{}|]+)/.exec(s);
    if (m !== null) return { base: m[2] ?? '', step: m[3] ?? '', heal: m[1] === 'dice' };
  }
  return undefined;
}

/**
 * `damageInflict` once a roll's type is `to` instead of `from`, or gone when
 * `to` is undefined. A type stays while another roll still names it, and so do
 * the ones the rolls never named (a book's spell lists every type it can deal).
 */
export function inflictSwap(spell: Json, entries: unknown, from?: string, to?: string): Json {
  const named = new Set(
    damageRolls({ ...spell, entries }).flatMap((r) => (r.type ? [r.type] : [])),
  );
  const had = strings(spell.damageInflict);
  const kept = had.filter((t) => t !== from || named.has(t));
  const next = [...new Set([...kept, ...(to !== undefined ? [to] : []), ...named])];
  return { damageInflict: next.length > 0 ? next : undefined };
}

/** A tag's last part changed: a slot's step, `{@scaledamage 4d6|1-9|1d6}`. */
export function withStep(spell: Json, to: string): Json {
  return {
    entriesHigherLevel: mapStrings(spell.entriesHigherLevel, (s) =>
      s.replace(/(\{@scale(?:damage|dice) [^{}|]+\|[^{}|]+\|)[^{}|]+/, `$1${to}`),
    ),
  };
}

/** A cantrip's dice by character level, from its 1st-level dice. */
export function cantripLadder(dice: string, type?: string): Json {
  const m = /^(\d+)d(\d+)$/.exec(dice);
  const n = Number(m?.[1] ?? 1);
  const d = m?.[2] ?? '6';
  return {
    label: type ? `${type} damage` : 'damage',
    scaling: { 1: `${n}d${d}`, 5: `${2 * n}d${d}`, 11: `${3 * n}d${d}`, 17: `${4 * n}d${d}` },
  };
}

/** The higher-level field for a slot step, or a cantrip's upgrade sentence. */
export function higherBlock(spell: Json, base: string, step: string, heal: boolean): unknown[] {
  const level = typeof spell.level === 'number' ? spell.level : 0;
  if (level === 0) {
    const s = cantripLadder(base).scaling as Record<string, string>;
    return [
      {
        type: 'entries',
        name: 'Cantrip Upgrade',
        entries: [
          `The damage increases by ${base} when you reach levels 5 (${s[5]}), 11 (${s[11]}), and 17 (${s[17]}).`,
        ],
      },
    ];
  }
  const tag = `{@scale${heal ? 'dice' : 'damage'} ${base}|${level}-9|${step}}`;
  return [
    {
      type: 'entries',
      name: spell.edition === 'one' ? 'Using a Higher-Level Spell Slot' : 'At Higher Levels',
      entries: [
        `The ${heal ? 'healing' : 'damage'} increases by ${tag} for each spell slot level above ${ordinal(level)}.`,
      ],
    },
  ];
}

/**
 * `block` added to what the spell already says of higher levels: its sentence
 * at the end of the first named part (Scorching Ray's "one additional ray"
 * stays), else the block after the rest.
 */
export function withHigher(existing: unknown, block: unknown[]): unknown[] {
  const had = list(existing);
  const first = had[0];
  const add = block.flatMap((b) => (isRecord(b) ? list(b.entries) : [b]));
  if (isRecord(first) && Array.isArray(first.entries)) {
    return [{ ...first, entries: [...first.entries, ...add] }, ...had.slice(1)];
  }
  return [...had, ...block];
}

/** The sentence a cantrip's damage grows by, as `higherBlock` and the books write it. */
const LADDER = /\bincreases? by \S+ when you reach (?:5th level|levels? 5)\b/i;

/** What the spell says of higher levels without the scaling sentence a card stands for. */
export function withoutScaling(existing: unknown): unknown[] | undefined {
  const keep = (e: unknown): unknown => {
    if (typeof e === 'string') return e.includes('{@scale') || LADDER.test(e) ? undefined : e;
    if (!isRecord(e) || !Array.isArray(e.entries)) return e;
    const entries = e.entries.map(keep).filter((x) => x !== undefined);
    return entries.length > 0 ? { ...e, entries } : undefined;
  };
  const left = list(existing)
    .map(keep)
    .filter((x) => x !== undefined);
  return left.length > 0 ? left : undefined;
}

/**
 * A damage roll's dice changed: in the text, and in the slot scaling and a
 * cantrip's ladder unless another roll still has the old dice.
 */
export function withDamageDice(spell: Json, roll: Roll, to: string): Json {
  const from = roll.dice;
  const entries = mapRoll(
    spell.entries,
    roll,
    (tag, after) => `${tag.replace(/^(\{@damage )[^{}|]+/i, `$1${to}`)}${after}`,
  );
  const shared = damageRolls({ ...spell, entries }).some((r) => r.dice === from);
  const patch: Json = {
    entries,
    ...(spell.entriesHigherLevel !== undefined && !shared
      ? { entriesHigherLevel: swapTag(spell.entriesHigherLevel, 'scaledamage', from, to) }
      : {}),
  };
  const ladder = spell.scalingLevelDice;
  if (
    !shared &&
    spell.level === 0 &&
    isRecord(ladder) &&
    isRecord(ladder.scaling) &&
    ladder.scaling[1] === from
  ) {
    patch.scalingLevelDice = { ...cantripLadder(to, roll.type), label: ladder.label };
    // The upgrade sentence the card wrote follows the dice; one the author wrote is theirs.
    if (
      JSON.stringify(spell.entriesHigherLevel) ===
      JSON.stringify(higherBlock(spell, from, from, false))
    )
      patch.entriesHigherLevel = higherBlock(spell, to, to, false);
  }
  return patch;
}

/** A damage roll's type changed: the word after its dice, and `damageInflict`. */
export function withDamageType(spell: Json, roll: Roll, to: string): Json {
  const next = mapRoll(spell.entries, roll, (tag, after) => {
    const m = /^(\s+)(\S+)$/.exec(after);
    if (m === null) return `${tag} ${to}`;
    const was = m[2] ?? '';
    return `${tag}${m[1]}${was[0] === was[0]?.toUpperCase() ? cap(to) : to}`;
  });
  const patch: Json = { entries: next, ...inflictSwap(spell, next, roll.type, to) };
  const ladder = spell.scalingLevelDice;
  if (isRecord(ladder) && isRecord(ladder.scaling) && ladder.scaling[1] === roll.dice) {
    patch.scalingLevelDice = { ...ladder, label: `${to} damage` };
  }
  return patch;
}

/** A healing roll's dice, or whether the caster's modifier adds to it, changed. */
export function withHeal(spell: Json, from: string, to: string, mod: boolean): Json {
  const re = new RegExp(
    `\\{@dice ${from.replace(/[+]/g, '\\+')}\\}(\\s*(?:\\+|plus)\\s+your spellcasting ability modifier)?`,
    'g',
  );
  const entries = mapStrings(spell.entries, (s) =>
    s.replace(re, `{@dice ${to}}${mod ? ' + your spellcasting ability modifier' : ''}`),
  );
  return {
    entries,
    ...(spell.entriesHigherLevel !== undefined
      ? { entriesHigherLevel: swapTag(spell.entriesHigherLevel, 'scaledice', from, to) }
      : {}),
  };
}

/** The slot level changed: a cantrip's scaling and a slot's scaling are not the same field. */
export function withLevel(spell: Json, level: number): Json {
  const was = typeof spell.level === 'number' ? spell.level : 0;
  const up = upcastOf(spell);
  if ((was === 0) !== (level === 0) && (up !== undefined || spell.scalingLevelDice !== undefined)) {
    return { level, entriesHigherLevel: undefined, scalingLevelDice: undefined };
  }
  if (up === undefined || level === 0) return { level };
  return {
    level,
    entriesHigherLevel: mapStrings(spell.entriesHigherLevel, (s) =>
      s
        .replace(/(\{@scale(?:damage|dice) [^{}|]+\|)\d+(-\d+)/, `$1${level}$2`)
        .replace(/above (\d)(?:st|nd|rd|th)\b/, `above ${ordinal(level)}`),
    ),
  };
}

// ---------------------------------------------------------------------------
// What it is
// ---------------------------------------------------------------------------

const LEVELS: Options = Array.from({ length: 10 }, (_, i) => [
  String(i),
  i === 0 ? 'Cantrip' : ordinal(i),
]);
const SCHOOL_OPTIONS: Options = Object.entries(SPELL_SCHOOLS);
const TIMES: ReadonlyArray<readonly [string, string, Json]> = [
  ['1 action', 'An action', { number: 1, unit: 'action' }],
  ['1 bonus', 'A bonus action', { number: 1, unit: 'bonus' }],
  ['1 reaction', 'A reaction', { number: 1, unit: 'reaction' }],
  ['1 minute', '1 minute', { number: 1, unit: 'minute' }],
  ['10 minute', '10 minutes', { number: 10, unit: 'minute' }],
  ['1 hour', '1 hour', { number: 1, unit: 'hour' }],
];
const RANGES: Options = [
  ['self', 'Self'],
  ['touch', 'Touch'],
  ['feet', 'Feet'],
  ['sight', 'Sight'],
  ['unlimited', 'Unlimited'],
];
const timed = (type: string, amount: number) => ({ type: 'timed', duration: { type, amount } });
const DURATIONS: ReadonlyArray<readonly [string, string, Json]> = [
  ['round', '1 round', timed('round', 1)],
  ['minute', '1 minute', timed('minute', 1)],
  ['10 minute', '10 minutes', timed('minute', 10)],
  ['hour', '1 hour', timed('hour', 1)],
  ['8 hour', '8 hours', timed('hour', 8)],
  ['24 hour', '24 hours', timed('hour', 24)],
  ['dispel', 'Until dispelled', { type: 'permanent', ends: ['dispel'] }],
];

const timeKey = (time: unknown) => {
  const t = list(time);
  const first = t[0];
  return t.length === 1 && isRecord(first) ? `${String(first.number)} ${String(first.unit)}` : '';
};
const durationKey = (d: Json | undefined) => {
  if (d === undefined) return '';
  if (d.type === 'permanent') return 'dispel';
  const inner = isRecord(d.duration) ? d.duration : undefined;
  return d.type === 'timed' && inner !== undefined
    ? `${inner.amount === 1 ? '' : `${String(inner.amount)} `}${String(inner.type)}`
    : '';
};

/** The spell's one duration entry, when it has one and only one. */
const durationOf = (spell: Json): Json | undefined => {
  const d = list(spell.duration);
  return d.length === 1 && isRecord(d[0]) ? d[0] : undefined;
};
const lasts = (spell: Json) => {
  const d = durationOf(spell);
  return d !== undefined ? d.type !== 'instant' : list(spell.duration).length > 0;
};

/** A dropdown that keeps a value it has no option for, shown as the book reads it. */
function KeptSelect({
  label,
  value,
  shown,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  shown: string;
  options: Options;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const known = options.some(([v]) => v === value);
  return (
    <Field label={label}>
      <Select
        value={known ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {!known && <option value="">{shown === '?' ? 'Not given' : `${shown}, as written`}</option>}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The casters in the player's data, one chip a name, each with its own book. */
function classOptions(props: EditorProps): Array<{ name: string; source: string }> {
  const casters = props.registry
    .byType('class')
    .filter((c) => c.spellcastingAbility !== undefined || c.casterProgression !== undefined);
  return onePerName(casters, props.draft);
}

function About(props: EditorProps) {
  const { draft, change, readOnly } = props;
  useTypePacks('class');
  const level = typeof draft.level === 'number' ? draft.level : 0;
  const range = isRecord(draft.range) ? draft.range : undefined;
  const distance = isRecord(range?.distance) ? range.distance : undefined;
  const rangeKey =
    range?.type === 'point' && typeof distance?.type === 'string' ? distance.type : '';
  const comp = isRecord(draft.components) ? draft.components : {};
  const material = typeof comp.m === 'string' ? comp.m : isRecord(comp.m) ? comp.m.text : undefined;
  const classes = isRecord(draft.classes) ? draft.classes : {};
  const picked = list(classes.fromClassList).filter(isRecord);
  const casters = classOptions(props);
  const pickedNames = picked.map((c) => String(c.name).toLowerCase());
  const meta = isRecord(draft.meta) ? draft.meta : {};
  return (
    <Section title="About it">
      <div className="grid grid-cols-2 items-end gap-2">
        <Field label="Level">
          <Select
            value={String(level)}
            disabled={readOnly}
            onChange={(e) => change(withLevel(draft, Number(e.target.value)))}
          >
            {LEVELS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <KeptSelect
          label="School"
          value={String(draft.school ?? '')}
          shown="?"
          options={SCHOOL_OPTIONS}
          disabled={readOnly}
          onChange={(school) => change({ school })}
        />
        <KeptSelect
          label="Casting time"
          value={timeKey(draft.time)}
          shown={castingTime(draft.time)}
          options={TIMES.map(([v, t]) => [v, t] as const)}
          disabled={readOnly}
          onChange={(v) => {
            const t = TIMES.find(([k]) => k === v)?.[2];
            const was = list(draft.time)[0];
            // A reaction's trigger stays while it is still a reaction.
            const keep = isRecord(was) && was.unit === t?.unit && was.condition !== undefined;
            if (t !== undefined) change({ time: [keep ? { ...t, condition: was.condition } : t] });
          }}
        />
        <KeptSelect
          label="Range"
          value={rangeKey}
          shown={spellRange(draft.range)}
          options={RANGES}
          disabled={readOnly}
          onChange={(type) =>
            change({
              range: {
                type: 'point',
                distance:
                  type === 'feet' ? { type, amount: Number(distance?.amount ?? 60) } : { type },
              },
            })
          }
        />
        {rangeKey === 'feet' && (
          <NumberField
            label="Feet"
            value={typeof distance?.amount === 'number' ? distance.amount : undefined}
            disabled={readOnly}
            onChange={(amount) =>
              change({ range: { type: 'point', distance: { type: 'feet', amount: amount ?? 0 } } })
            }
          />
        )}
      </div>
      <ChipPicks
        label="Components"
        options={[
          ['v', 'Verbal'],
          ['s', 'Somatic'],
          ['m', 'Material'],
        ]}
        value={['v', 's', 'm'].filter((k) => comp[k] !== undefined && comp[k] !== false)}
        disabled={readOnly}
        onChange={(on) => {
          const next: Json = {};
          if (on.includes('v')) next.v = true;
          if (on.includes('s')) next.s = true;
          if (on.includes('m')) next.m = comp.m !== undefined && comp.m !== false ? comp.m : '';
          change({ components: Object.keys(next).length > 0 ? next : undefined });
        }}
      />
      {material !== undefined && (
        <Field label="Material">
          <input
            value={String(material)}
            disabled={readOnly}
            placeholder="a pinch of soot"
            onChange={(e) =>
              change({
                components: {
                  ...comp,
                  m: isRecord(comp.m) ? { ...comp.m, text: e.target.value } : e.target.value,
                },
              })
            }
            className={fieldClass}
          />
        </Field>
      )}
      <label className="flex min-h-tap items-center gap-2.5 text-body">
        <input
          type="checkbox"
          className="size-4.5 accent-ink"
          disabled={readOnly}
          checked={meta.ritual === true}
          onChange={(e) => {
            const { ritual: _, ...rest } = meta;
            const next = e.target.checked ? { ...rest, ritual: true } : rest;
            change({ meta: Object.keys(next).length > 0 ? next : undefined });
          }}
        />
        Can be cast as a ritual
      </label>
      <ChipPicks
        label="On the spell lists of"
        options={casters.map((c) => [c.name.toLowerCase(), c.name] as const)}
        value={pickedNames}
        disabled={readOnly}
        onChange={(names) => {
          const kept = picked.filter((c) => names.includes(String(c.name).toLowerCase()));
          const added = casters.filter(
            (c) =>
              names.includes(c.name.toLowerCase()) && !pickedNames.includes(c.name.toLowerCase()),
          );
          const fromClassList = [...kept, ...added];
          const { fromClassList: _, ...rest } = classes;
          const next = fromClassList.length > 0 ? { ...rest, fromClassList } : rest;
          change({ classes: Object.keys(next).length > 0 ? next : undefined });
        }}
      />
      {casters.length === 0 && (
        <p className="text-caption text-ink-muted">
          No classes in your game data cast spells yet, so there is no list to put it on. A
          character can still add it on their Spells tab.
        </p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Its text, and what the reader finds in it
// ---------------------------------------------------------------------------

/** Text the author can type as plain words: paragraphs and simple lists, with no tags but rolls and conditions. */
function typable(entries: unknown): boolean {
  const text = entriesToText(entries);
  return (
    JSON.stringify(textToEntries(text)) === JSON.stringify(list(entries)) &&
    !wordsOf(text).includes('{@')
  );
}

function SpellText({ draft, change, readOnly }: EditorProps) {
  const stored = entriesToText(draft.entries);
  const [typed, setTyped] = useState(() => wordsOf(stored));
  const own = typable(draft.entries);
  if (!own) {
    return (
      <TextBlocks
        entries={draft.entries}
        readOnly={readOnly}
        onChange={(entries) => change({ entries })}
      />
    );
  }
  const tags = tagsIn(stored);
  // Text set from outside (a card, a finding) replaces what was typed. Compared
  // as blocks, as `TextBlocks` does: turning text into blocks trims each one,
  // so a space or blank line just typed would not match the stored text.
  const shown =
    JSON.stringify(textToEntries(retag(typed, tags))) === JSON.stringify(list(draft.entries))
      ? typed
      : wordsOf(stored);
  return (
    <Field label="Text">
      <textarea
        value={shown}
        disabled={readOnly}
        rows={6}
        placeholder={
          'Write it as the books do: "Each creature in a 10-foot sphere must make a Dexterity saving throw, taking 3d8 radiant damage on a failed save."'
        }
        onChange={(e) => {
          setTyped(e.target.value);
          change({ entries: textToEntries(retag(e.target.value, tags)) });
        }}
        className={`${fieldClass} min-h-39 py-3`}
      />
    </Field>
  );
}

const FOUND_LABEL: Readonly<Record<Finding['kind'], string>> = {
  damage: 'Damage',
  heal: 'Healing',
  roll: 'Roll',
  save: 'Save',
  attack: 'Attack roll',
  condition: 'Condition',
  higher: 'More at higher levels',
  cantrip: 'More at higher levels',
};

function Findings({ draft, change, readOnly }: EditorProps) {
  const found = readSpellText(draft);
  if (found.length === 0 || readOnly) return null;
  return (
    <div className="flex flex-col gap-2 rounded-control bg-surface-raised p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-label text-ink-muted">Found in the text</span>
        {found.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // One at a time, each read again over the last one's result.
              let next = draft;
              for (let i = 0; i < 40; i++) {
                const f = readSpellText(next)[0];
                if (f === undefined) break;
                next = { ...next, ...f.patch };
              }
              const patch: Json = {};
              for (const k of new Set([...Object.keys(next), ...Object.keys(draft)])) {
                if (next[k] !== draft[k]) patch[k] = next[k];
              }
              change(patch);
            }}
          >
            Add all
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {found.map((f) => (
          <li key={`${f.kind}|${f.what}`} className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-body-strong">
                {FOUND_LABEL[f.kind]}: {f.what}
              </span>
              <span className="block text-caption text-ink-muted">“{f.quote}”</span>
            </span>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Add ${f.what}`}
              onClick={() => change(f.patch)}
            >
              <Plus size={16} aria-hidden /> Add
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What it does
// ---------------------------------------------------------------------------

function Card({
  title,
  line,
  sub,
  readOnly,
  onRemove,
  children,
}: {
  title: string;
  line: string;
  sub?: string;
  readOnly: boolean;
  onRemove: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-control bg-surface py-2.5 pr-1 pl-3 ring-1 ring-line ring-inset">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-caption text-ink-muted">{title}</b>
        {!readOnly && (
          <button
            type="button"
            aria-label={`Remove ${line}`}
            onClick={onRemove}
            className="tap -my-2 rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>
      <span className="pr-2 text-body-strong">{line}</span>
      {sub !== undefined && <span className="pr-2 text-caption text-ink-muted">{sub}</span>}
      {!readOnly && children !== undefined && (
        <div className="grid grid-cols-2 items-end gap-2 pr-2">{children}</div>
      )}
    </div>
  );
}

/** A dice box that writes only a roll the sheet can read, and says so otherwise. */
function DiceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [typed, setTyped] = useState(value);
  const shown = DICE.test(typed.replaceAll(' ', '')) || typed === value ? typed : value;
  const bad = !DICE.test(typed.replaceAll(' ', ''));
  return (
    <Field label={label}>
      <input
        value={bad ? typed : shown}
        inputMode="text"
        aria-invalid={bad}
        onChange={(e) => {
          setTyped(e.target.value);
          const v = e.target.value.replaceAll(' ', '');
          if (DICE.test(v) && v !== value) onChange(v);
        }}
        className={fieldClass}
      />
    </Field>
  );
}

const ABILITY_NAME: Options = ABILITY_WORDS.map(
  ([k, v]) => [k === 'str' ? 'strength' : v.toLowerCase(), v] as const,
);
const CONDITION_OPTIONS: Options = CONDITIONS.map((c) => [c, cap(c)] as const);
const DAMAGE_OPTIONS: Options = DAMAGE_TYPES.map((t) => [t, cap(t)] as const);

function Cards({ draft, change, readOnly }: EditorProps) {
  const level = typeof draft.level === 'number' ? draft.level : 0;
  const attack = strings(draft.spellAttack)[0];
  const save = strings(draft.savingThrow)[0];
  const damage = damageRolls(draft);
  const heals = healRolls(draft);
  const conditions = strings(draft.conditionInflict);
  const up = upcastOf(draft);
  const ladder = isRecord(draft.scalingLevelDice) ? draft.scalingLevelDice : undefined;
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  const d = durationOf(draft);
  const how =
    save !== undefined
      ? 'on a failed save'
      : attack !== undefined
        ? 'on a hit'
        : 'with no roll to avoid it';
  const set = (patch: Json) => change(patch);
  const roll = damage[0] ?? (heals[0] !== undefined ? { dice: heals[0].dice } : undefined);
  const cards: ReactNode[] = [];

  if (attack !== undefined) {
    cards.push(
      <Card
        key="attack"
        title="Attack roll"
        line={`${attack === 'M' ? 'Melee' : 'Ranged'} spell attack`}
        sub="Uses your spell attack bonus"
        readOnly={readOnly}
        onRemove={() => set({ spellAttack: undefined })}
      >
        <Field label="Reach">
          <Select value={attack} onChange={(e) => set({ spellAttack: [e.target.value] })}>
            <option value="R">Ranged</option>
            <option value="M">Melee</option>
          </Select>
        </Field>
      </Card>,
    );
  }
  if (save !== undefined) {
    cards.push(
      <Card
        key="save"
        title="Saving throw"
        line={`${cap(save)} save against your spell save DC`}
        readOnly={readOnly}
        onRemove={() => set({ savingThrow: undefined })}
      >
        <Field label="Ability">
          <Select value={save} onChange={(e) => set({ savingThrow: [e.target.value] })}>
            {ABILITY_NAME.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </Card>,
    );
  }
  // Cards are keyed by place: a key that held the dice would remount the card,
  // and lose the box being typed in, each time the dice change.
  damage.forEach((r, i) => {
    cards.push(
      <Card
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        key={`damage:${i}`}
        title="Damage"
        line={`${r.dice}${r.type ? ` ${r.type}` : ''} damage`}
        sub={
          up?.base === r.dice && !up.heal
            ? `${up.step} more for each slot level above ${ordinal(level)}`
            : undefined
        }
        readOnly={readOnly}
        onRemove={() => {
          const entries = mapRoll(draft.entries, r, (_, after) => `${r.dice}${after}`);
          set({ entries, ...inflictSwap(draft, entries, r.type) });
        }}
      >
        <DiceField
          label="Dice"
          value={r.dice}
          onChange={(to) => set(withDamageDice(draft, r, to))}
        />
        <Field label="Type">
          <Select
            value={r.type ?? ''}
            onChange={(e) => set(withDamageType(draft, r, e.target.value))}
          >
            {r.type === undefined && <option value="">Not said</option>}
            {DAMAGE_OPTIONS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </Card>,
    );
  });
  heals.forEach((h, i) => {
    cards.push(
      <Card
        // biome-ignore lint/suspicious/noArrayIndexKey: as the damage cards
        key={`heal:${i}`}
        title="Healing"
        line={`${h.dice}${h.mod ? ' + your spellcasting modifier' : ''} hit points`}
        readOnly={readOnly}
        onRemove={() => {
          const tags = strings(draft.miscTags).filter((t) => t !== 'HL');
          const entries = untag(draft.entries, 'dice', h.dice);
          set({
            entries,
            ...(heals.length === 1 ? { miscTags: tags.length > 0 ? tags : undefined } : {}),
          });
        }}
      >
        <DiceField
          label="Dice"
          value={h.dice}
          onChange={(to) => set(withHeal(draft, h.dice, to, h.mod))}
        />
        <label className="flex min-h-12 items-center gap-2.5 text-body">
          <input
            type="checkbox"
            className="size-4.5 accent-ink"
            checked={h.mod}
            onChange={(e) => set(withHeal(draft, h.dice, h.dice, e.target.checked))}
          />
          Add your modifier
        </label>
      </Card>,
    );
  });
  conditions.forEach((c, i) => {
    cards.push(
      <Card
        key={`condition:${c}`}
        title="Condition"
        line={`${cap(c)} ${how}`}
        readOnly={readOnly}
        onRemove={() => {
          const rest = conditions.filter((x) => x !== c);
          set({
            conditionInflict: rest.length > 0 ? rest : undefined,
            entries: untag(draft.entries, 'condition', c),
          });
        }}
      >
        <Field label="Condition">
          <Select
            value={c}
            onChange={(e) => {
              const to = e.target.value;
              set({
                conditionInflict: conditions.map((x, j) => (j === i ? to : x)),
                // The tag keeps its book (`|XPHB`) and the case it was written in.
                entries: mapStrings(draft.entries, (s) =>
                  s.replace(
                    new RegExp(`\\{@condition (${c})((?:\\|[^{}]*)?)\\}`, 'gi'),
                    (_, was: string, rest: string) =>
                      `{@condition ${was[0] === was[0]?.toUpperCase() ? cap(to) : to}${rest}}`,
                  ),
                ),
              });
            }}
          >
            {CONDITION_OPTIONS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
      </Card>,
    );
  });
  if (lasts(draft)) {
    const effects = list(g.effects);
    cards.push(
      <Card
        key="lasting"
        title="Lasting effect"
        line={spellDuration(draft.duration)}
        sub={
          d?.concentration === true
            ? 'The sheet tracks it while you concentrate'
            : 'What it does to the target while it lasts, below'
        }
        readOnly={readOnly}
        onRemove={() =>
          set({
            duration: [{ type: 'instant' }],
            castGuidance: guidanceWith(draft.castGuidance, { effects: undefined }),
          })
        }
      >
        <KeptSelect
          label="Lasts"
          value={durationKey(d)}
          shown={spellDuration(draft.duration)}
          options={DURATIONS.map(([v, t]) => [v, t] as const)}
          disabled={readOnly}
          onChange={(v) => {
            const next = DURATIONS.find(([k]) => k === v)?.[2];
            if (next === undefined) return;
            const conc = d?.concentration === true && next.type === 'timed';
            set({ duration: [conc ? { ...next, concentration: true } : next] });
          }}
        />
        {d?.type === 'timed' && (
          <label className="flex min-h-12 items-center gap-2.5 text-body">
            <input
              type="checkbox"
              className="size-4.5 accent-ink"
              checked={d.concentration === true}
              onChange={(e) => {
                const { concentration: _, ...rest } = d;
                set({ duration: [e.target.checked ? { ...rest, concentration: true } : rest] });
              }}
            />
            Concentration
          </label>
        )}
        <div className="col-span-2 flex flex-col gap-2">
          <span className="text-label text-ink-muted">On the target while it lasts</span>
          <EffectCards
            effects={effects}
            readOnly={readOnly}
            onChange={(next) =>
              set({
                castGuidance: guidanceWith(draft.castGuidance, {
                  effects: next.length > 0 ? next : undefined,
                }),
              })
            }
          />
        </div>
      </Card>,
    );
  }
  const scales = up !== undefined || (level === 0 && ladder !== undefined);
  if (scales) {
    const base = up?.base ?? (isRecord(ladder?.scaling) ? String(ladder.scaling[1]) : '');
    cards.push(
      <Card
        key="higher"
        title="More at higher levels"
        line={
          level === 0
            ? `${base} more at levels 5, 11 and 17`
            : `${up?.step ?? ''} more for each slot level above ${ordinal(level)}`
        }
        readOnly={readOnly}
        onRemove={() =>
          set({
            entriesHigherLevel: withoutScaling(draft.entriesHigherLevel),
            scalingLevelDice: undefined,
          })
        }
      >
        {level > 0 && up !== undefined && (
          <DiceField
            label="Each slot level adds"
            value={up.step}
            onChange={(to) => set(withStep(draft, to))}
          />
        )}
      </Card>,
    );
  }

  const adds: Array<[string, () => void]> = [];
  if (attack === undefined) adds.push(['Attack roll', () => set({ spellAttack: ['R'] })]);
  if (save === undefined) adds.push(['Saving throw', () => set({ savingThrow: ['dexterity'] })]);
  adds.push([
    'Damage',
    () => {
      const dice =
        ['1d8', '2d8', '3d8', '4d8', '1d10', '2d10'].find(
          (x) => !damage.some((r) => r.dice === x),
        ) ?? '1d6';
      const entries = withSentence(
        draft.entries,
        `The target takes {@damage ${dice}} fire damage.`,
      );
      set({ entries, ...inflictSwap(draft, entries, undefined, 'fire') });
    },
  ]);
  if (heals.length === 0)
    adds.push([
      'Healing',
      () =>
        set({
          entries: withSentence(
            draft.entries,
            'The target regains a number of hit points equal to {@dice 2d8} + your spellcasting ability modifier.',
          ),
          miscTags: [...new Set([...strings(draft.miscTags), 'HL'])],
        }),
    ]);
  adds.push([
    'Condition',
    () => {
      const c = CONDITIONS.find((x) => !conditions.includes(x)) ?? 'blinded';
      set({
        conditionInflict: [...conditions, c],
        entries: withSentence(draft.entries, `The target has the {@condition ${c}} condition.`),
      });
    },
  ]);
  if (!lasts(draft))
    adds.push([
      'Lasting effect',
      () => set({ duration: [{ ...timed('minute', 1), concentration: true }] }),
    ]);
  if (!scales && roll !== undefined)
    adds.push([
      'More at higher levels',
      () => {
        const heal = damage.length === 0;
        const step = /^\d+(d\d+)/.exec(roll.dice)?.[1] ?? 'd6';
        // Added to what the spell already says of higher levels, never in its place.
        set(
          level === 0
            ? {
                scalingLevelDice: cantripLadder(roll.dice, damage[0]?.type),
                entriesHigherLevel: withHigher(
                  draft.entriesHigherLevel,
                  higherBlock(draft, roll.dice, roll.dice, false),
                ),
              }
            : {
                entriesHigherLevel: withHigher(
                  draft.entriesHigherLevel,
                  higherBlock(draft, roll.dice, `1${step}`, heal),
                ),
              },
        );
      },
    ]);

  return (
    <Section title="What it does">
      {cards}
      {cards.length === 0 && (
        <p className="text-caption text-ink-muted">
          Nothing for the sheet to roll yet, and you can save it anyway. Add what it does, or what
          the text says, and the Spells tab rolls it.
        </p>
      )}
      {!readOnly && (
        <div className="-mx-1.5 flex flex-wrap">
          {adds.map(([label, add]) => (
            <Chip key={label} tone="outline" className="px-2.5" onClick={add}>
              <Plus size={14} aria-hidden />
              {label}
            </Chip>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// On the Spells tab
// ---------------------------------------------------------------------------

/** The caster the preview shows numbers for: 5th level, +4 in the spellcasting ability. */
const SAMPLE = { level: 5, mod: 4, prof: 3 };
const CHIP =
  'inline-flex h-8.5 min-w-13 items-center justify-center rounded-chip px-2 font-semibold text-dice tabular-nums';
const TONE = {
  dice: 'bg-roll-soft text-roll',
  damage: 'bg-danger-soft text-danger',
  heal: 'bg-heal-soft text-heal',
};

function Preview({ draft }: EditorProps) {
  const name = String(draft.name ?? '').trim() || 'Your spell';
  const level = typeof draft.level === 'number' ? draft.level : 0;
  const rolls = spellRollActions(draft, {
    characterLevel: SAMPLE.level,
    abilityModifier: SAMPLE.mod,
  });
  const up = upcastOf(draft);
  const higher =
    level > 0 && level < 9 && up !== undefined
      ? spellRollActions(draft, {
          characterLevel: SAMPLE.level,
          abilityModifier: SAMPLE.mod,
          slotLevel: level + 1,
        })
      : [];
  const concentrates = durationOf(draft)?.concentration === true;
  const hasAttack = strings(draft.spellAttack).length > 0;
  const hasSave = spellSaves(draft).length > 0;
  return (
    <Section title="On the Spells tab">
      <div className="rounded-card bg-surface ring-1 ring-line ring-inset">
        <div className="flex min-h-15 flex-wrap items-center gap-x-2 gap-y-1 py-2 pr-3 pl-4">
          <div className="min-w-0 flex-1 basis-26">
            <div className="flex flex-wrap items-center gap-x-1.5">
              <span className="wrap-anywhere text-body-strong">{name}</span>
              {concentrates && (
                <span
                  title="Concentration"
                  className="inline-flex size-4.5 items-center justify-center rounded-[0.25rem] bg-arcane-soft font-bold text-[0.6875rem] text-arcane"
                >
                  <span aria-hidden="true">C</span>
                  <span className="sr-only">Concentration</span>
                </span>
              )}
            </div>
            <div className="text-caption text-ink-muted">
              {spellMeta(draft, { withLevel: true })}
            </div>
          </div>
          <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
            {hasSave && (
              <span className="inline-flex h-6 items-center rounded-chip bg-arcane-soft px-2 font-semibold text-arcane text-label">
                DC {8 + SAMPLE.prof + SAMPLE.mod}
              </span>
            )}
            {hasAttack && (
              <span className={`${CHIP} ${TONE.dice}`}>+{SAMPLE.prof + SAMPLE.mod}</span>
            )}
            {rolls.map((r) => (
              <span key={r.label} title={r.label} className={`${CHIP} ${TONE[r.variant]}`}>
                {r.expr}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="text-caption text-ink-muted">
        As a 5th-level caster with +4 in their spellcasting ability would see it.
        {higher.length > 0 &&
          ` With a ${ordinal(level + 1)}-level slot: ${higher.map((r) => r.expr).join(', ')}.`}
      </p>
      {rolls.length === 0 && !hasAttack && !hasSave && (
        <p className="flex items-start gap-1.5 text-caption text-ink-muted">
          <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
          Nothing to roll yet: the Spells tab shows Cast alone.
        </p>
      )}
    </Section>
  );
}

function SpellBody(props: EditorProps) {
  return (
    <>
      <About {...props} />
      <Section title="Text">
        <SpellText {...props} />
        <Findings {...props} />
      </Section>
      <Cards {...props} />
      <Preview {...props} />
    </>
  );
}

export const editor: EditorSpec = {
  noun: 'spell',
  blank: () => ({
    level: 1,
    school: 'V',
    time: [{ number: 1, unit: 'action' }],
    range: { type: 'point', distance: { type: 'feet', amount: 60 } },
    components: { v: true, s: true },
    duration: [{ type: 'instant' }],
    entries: [],
  }),
  Body: SpellBody,
};
