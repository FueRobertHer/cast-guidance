/**
 * What board 5 adds to the class and subclass editors (ADR-002, U5c), shared
 * by them: spellcasting, its numbers by level and the table Save writes for
 * them, the spells either gives by class level, and the entry a copied
 * feature is read and written against.
 *
 * A subclass casts on its own (an Eldritch Knight) only for a class with no
 * spellcasting of its own, as the sheet reads it (`casterOf` in slots.ts); its
 * table is `subclassTableGroups`, a class's `classTableGroups`.
 */
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { plainEntryText } from '@/data5e/entries/plainText';
import { useTypePacks } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { ownCasterLevel, PACT_SLOTS, STANDARD_SLOTS } from '@/engine/calc/slots';
import { isRecord, own } from '@/engine/castGuidance';
import { Button } from '@/ui/Button';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { fieldClass } from '@/ui/TextField';
import type { TableColumn } from './ClassTable';
import { same } from './copyWriter';
import type { EditorProps, Json, WriteContext } from './editorTypes';
import { ABILITY_WORDS, Field, Kept, Select } from './fields';
import { HeldNumber, NamesBox, OnSheet } from './originFields';

export const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * The entry a copy of `e` is written and read against: the one below the
 * table's change, as the merge resolves a `_copy` (WorkshopPage's
 * `copiedBase`). `e` must be the registry's own object, which it keys by.
 */
export const belowChanges = (registry: EntityRegistry, e: Json): Json =>
  (registry.changeOf(e as never)?.base as Json | undefined) ?? e;

/**
 * The entry Save compares the spell fields with when the draft holds none of
 * its own, one that never went through `open`: the one copied, or the one as
 * stored. The Workshop opens every draft, and a class's or subclass's file
 * view cannot be edited, so there this is never reached.
 */
export function savedBefore(at: WriteContext, type: 'class' | 'subclass'): Json | undefined {
  if (at.copied !== undefined) return at.copied;
  if (at.stored === undefined) return undefined;
  return at.registry.get(type, at.stored.name, at.stored.source) as Json | undefined;
}

/**
 * Where a draft keeps the spell fields it opened with: the ones its table was
 * made for. A save leaves the draft's table as it opened, and the registry
 * is read again after it, so this, not the entry stored, tells Save whether
 * the table is to be made again.
 */
export const OPENED = '_spellsOpened';

/** The draft with the spell fields `entry` has, unless it holds them already. */
export function withOpened(draft: Json, entry: Json): Json {
  if (isRecord(draft[OPENED])) return draft;
  const was: Json = {};
  for (const k of SPELL_FIELDS) {
    const v = own(entry, k);
    if (v !== undefined) was[k] = v;
  }
  return { ...draft, [OPENED]: was };
}

/** The spell fields Save compares the draft's with: as it opened, else as saved before. */
export function spellBase(
  draft: Json,
  at: WriteContext,
  type: 'class' | 'subclass',
): Json | undefined {
  const opened = draft[OPENED];
  return isRecord(opened) ? opened : savedBefore(at, type);
}

// ---------------------------------------------------------------------------
// Numbers by level

/** A level table's value at each level 1 to 20 (0 below its first level). */
export function byLevelValues(table: unknown): number[] {
  const rows = isRecord(table) ? Object.entries(table) : [];
  return LEVELS.map((lv) => {
    let v = 0;
    let at = 0;
    for (const [k, n] of rows) {
      const l = Number(k);
      if (typeof n === 'number' && l <= lv && l >= at) {
        v = n;
        at = l;
      }
    }
    return v;
  });
}

/** Twenty values as a level table: the levels where the number changes. */
export function asByLevel(values: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  values.forEach((v, i) => {
    if (i === 0 ? v !== 0 : v !== values[i - 1]) out[String(i + 1)] = v;
  });
  return Object.keys(out).length > 0 ? out : { '1': 0 };
}

/**
 * Twenty values with the one at `level` set, and the levels after it that had
 * the same number following it, as a class table reads ("2 until level 5").
 */
export function setFrom(values: readonly number[], level: number, v: number): number[] {
  const out = [...values];
  const was = values[level - 1];
  for (let i = level - 1; i < out.length && (i === level - 1 || values[i] === was); i++) out[i] = v;
  return out;
}

/** Twenty numbers from a list, 0 where it has none. */
export const twenty = (list: unknown): number[] =>
  LEVELS.map((_, i) => (Array.isArray(list) && typeof list[i] === 'number' ? list[i] : 0));

// ---------------------------------------------------------------------------
// The table's spell columns

type CountKind = 'cantrips' | 'prepared' | 'known' | 'pactSlots' | 'slotLevel';
export type TableKey = 'classTableGroups' | 'subclassTableGroups';

/** What a table column counts, by its heading. */
function columnKind(label: unknown): CountKind | undefined {
  const t = plainEntryText(String(label ?? ''))
    .trim()
    .toLowerCase();
  if (t.startsWith('cantrips')) return 'cantrips';
  if (t.startsWith('prepared') || t === 'spells prepared') return 'prepared';
  if (t === 'spells known') return 'known';
  if (t === 'spell slots') return 'pactSlots';
  if (t === 'slot level') return 'slotLevel';
  return undefined;
}

/** A cell of a book's class table as text: `2`, `+2`, `1d6`, `+10 ft.`. */
function cellText(cell: unknown): string {
  if (typeof cell === 'number') return String(cell);
  if (typeof cell === 'string') return plainEntryText(cell);
  if (!isRecord(cell)) return '';
  if (cell.type === 'bonus') return `+${String(cell.value)}`;
  if (cell.type === 'bonusSpeed') return `+${String(cell.value)} ft.`;
  if (cell.type === 'dice' && Array.isArray(cell.toRoll)) {
    return cell.toRoll
      .filter(isRecord)
      .map((d) => `${String(d.number)}d${String(d.faces)}`)
      .join(' + ');
  }
  return '';
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

/**
 * A table of slots per spell level: the one the sheet reads
 * (`rowsSpellProgression`), or one only shown, with a column per spell level
 * (the Spellcaster Sidekick's).
 */
function isSlotGroup(g: Json): boolean {
  if (Array.isArray(g.rowsSpellProgression)) return true;
  const labels = Array.isArray(g.colLabels) ? g.colLabels : [];
  return (
    labels.length > 0 &&
    labels.every((l) => ORDINALS.includes(plainEntryText(String(l ?? '')).trim()))
  );
}

const groupsOf = (draft: Json, key: TableKey): unknown[] =>
  Array.isArray(draft[key]) ? (draft[key] as unknown[]) : [];

/** What the book's table says at each level, leaving out the spell columns the editor shows. */
export function bookAt(
  draft: Json,
  key: TableKey = 'classTableGroups',
): (level: number) => Array<[string, string]> {
  const groups = groupsOf(draft, key).filter(
    (g): g is Json =>
      isRecord(g) && Array.isArray(g.colLabels) && Array.isArray(g.rows) && !isSlotGroup(g),
  );
  return (level) =>
    groups.flatMap((g) => {
      const row = (g.rows as unknown[])[level - 1];
      if (!Array.isArray(row)) return [];
      return (g.colLabels as unknown[]).flatMap((label, c): Array<[string, string]> => {
        if (columnKind(label) !== undefined) return [];
        const text = cellText(row[c]);
        return text === '' ? [] : [[plainEntryText(String(label)), text]];
      });
    });
}

/** Slots per spell level at each class level, as the sheet works them out. */
export function slotRows(draft: Json, key: TableKey = 'classTableGroups'): number[][] | undefined {
  const p = draft.casterProgression;
  if (typeof p !== 'string' || p === 'pact') return undefined;
  for (const g of groupsOf(draft, key)) {
    const rows = isRecord(g) ? g.rowsSpellProgression : undefined;
    if (Array.isArray(rows) && rows.length > 0) {
      return LEVELS.map((_, i) => {
        const r = rows[Math.min(i, rows.length - 1)];
        return Array.isArray(r) ? r.map((n) => (typeof n === 'number' ? n : 0)) : [];
      });
    }
  }
  return LEVELS.map((lv) => {
    const at = ownCasterLevel(p, lv);
    return at > 0 ? [...(STANDARD_SLOTS[at - 1] ?? [])] : [];
  });
}

/** The highest slot at each level, as the table's last column shows it. */
export function topSlots(draft: Json, key: TableKey = 'classTableGroups'): string[] | undefined {
  if (draft.casterProgression === 'pact') {
    return LEVELS.map((lv) => ORDINALS[(PACT_SLOTS[lv - 1]?.[1] ?? 1) - 1] ?? '');
  }
  return slotRows(draft, key)?.map((r) => {
    const top = r.findLastIndex((n) => n > 0);
    return top === -1 ? '-' : (ORDINALS[top] ?? '');
  });
}

const SPELL_FIELDS = [
  'casterProgression',
  'cantripProgression',
  'preparedSpellsProgression',
  'spellsKnownProgression',
] as const;

const COUNT_FIELD: Readonly<Partial<Record<CountKind, string>>> = {
  cantrips: 'cantripProgression',
  prepared: 'preparedSpellsProgression',
  known: 'spellsKnownProgression',
};
const COUNT_LABEL: Readonly<Record<CountKind, string>> = {
  cantrips: 'Cantrips',
  prepared: 'Prepared Spells',
  known: 'Spells Known',
  pactSlots: 'Spell Slots',
  slotLevel: 'Slot Level',
};

/**
 * The table's groups with its spell columns and slots made to match the
 * spellcasting the entry now has (where that changed from `original`, or with
 * nothing to compare with). The book's other columns stay as they are, and so
 * do its slots while its slots' progression does: a converted table the
 * progression does not explain is what the sheet reads (`ownSlotTable`).
 */
export function spellGroupsFor(
  draft: Json,
  original: Json | undefined,
  key: TableKey = 'classTableGroups',
): Json[] {
  let groups: Json[] = structuredClone(groupsOf(draft, key)).filter(isRecord);
  const p = draft.casterProgression;
  const castChanged =
    original === undefined ||
    !same(own(original, 'casterProgression'), own(draft, 'casterProgression'));
  const changed =
    castChanged || SPELL_FIELDS.some((k) => !same(own(original as Json, k), own(draft, k)));
  if (changed) {
    const caster = typeof p === 'string';
    const want: Partial<Record<CountKind, unknown[]>> = {};
    for (const [kind, field] of Object.entries(COUNT_FIELD) as [CountKind, string][]) {
      const v = own(draft, field);
      if (caster && Array.isArray(v)) want[kind] = v;
    }
    if (p === 'pact') {
      want.pactSlots = LEVELS.map((lv) => PACT_SLOTS[lv - 1]?.[0] ?? 0);
      want.slotLevel = LEVELS.map((lv) => ORDINALS[(PACT_SLOTS[lv - 1]?.[1] ?? 1) - 1]);
    }
    const found = new Set<CountKind>();
    groups = groups.map((g) => {
      if (!Array.isArray(g.colLabels) || !Array.isArray(g.rows)) return g;
      const kinds = g.colLabels.map(columnKind);
      // A column the entry no longer has goes.
      const drop = kinds.map((k) =>
        k === undefined
          ? false
          : k === 'pactSlots' || k === 'slotLevel'
            ? p !== 'pact'
            : !caster || want[k] === undefined,
      );
      const rows = (g.rows as unknown[]).map((row, i) =>
        Array.isArray(row)
          ? row.flatMap((cell, c) => {
              const k = kinds[c];
              if (drop[c]) return [];
              const list = k === undefined ? undefined : want[k];
              return [list !== undefined && i < list.length ? list[i] : cell];
            })
          : row,
      );
      for (const k of kinds) if (k !== undefined && want[k] !== undefined) found.add(k);
      return {
        ...g,
        colLabels: g.colLabels.filter((_, c) => !drop[c]),
        rows,
      };
    });
    const missing = (Object.keys(want) as CountKind[]).filter((k) => !found.has(k));
    if (missing.length > 0) {
      groups.unshift({
        colLabels: missing.map((k) => COUNT_LABEL[k]),
        rows: LEVELS.map((_, i) => missing.map((k) => want[k]?.[i] ?? 0)),
      });
    }
  }
  // The slot table the sheet reads, as the progression has it, made again only
  // when the progression changed. With nothing to compare with, a slot table
  // there stays for a progression with one.
  const slots = slotRows({ casterProgression: p });
  const keep = original === undefined && slots !== undefined && groups.some(isSlotGroup);
  if (castChanged && !keep) {
    groups = groups.filter((g) => !isSlotGroup(g));
    if (slots !== undefined) {
      const top = Math.max(0, ...slots.map((r) => r.findLastIndex((n) => n > 0) + 1));
      if (top > 0) {
        groups.push({
          title: 'Spell Slots per Spell Level',
          colLabels: ORDINALS.slice(0, top),
          rowsSpellProgression: slots.map((r) => Array.from({ length: top }, (_, j) => r[j] ?? 0)),
        });
      }
    }
  }
  return groups.filter((g) => !Array.isArray(g.colLabels) || g.colLabels.length > 0);
}

/** The table's spell columns: cantrips, prepared or known spells, and the top slot. */
export function spellColumns(
  draft: Json,
  change: EditorProps['change'],
  key: TableKey = 'classTableGroups',
): TableColumn[] {
  if (typeof draft.casterProgression !== 'string') return [];
  const cols: TableColumn[] = [];
  for (const [field, label] of [
    ['cantripProgression', 'Cantrips'],
    ['preparedSpellsProgression', 'Prepared'],
    ['spellsKnownProgression', 'Known'],
  ] as const) {
    const list = draft[field];
    if (!Array.isArray(list)) continue;
    const values = twenty(list);
    cols.push({
      key: field,
      label,
      values: values.map(String),
      numbers: values,
      set: (level, v) => {
        const next = setFrom(values, level, v);
        change({ [field]: next.some((n) => n > 0) ? next : undefined });
      },
    });
  }
  const top = topSlots(draft, key);
  if (top !== undefined) cols.push({ key: 'slot', label: 'Top slot', values: top });
  return cols;
}

/**
 * How many of a choice: emptied, the box waits for the next number, so the
 * list the choice is from stays; left empty, or 0, it is none.
 */
export function HeldCount({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState<string | undefined>(undefined);
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        value={typed ?? (value === undefined ? '' : String(value))}
        placeholder="None"
        disabled={disabled}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          const n = Number.parseInt(digits, 10);
          if (Number.isNaN(n)) {
            setTyped(digits);
            return;
          }
          setTyped(undefined);
          onChange(n === 0 ? undefined : Math.min(999, n));
        }}
        onBlur={() => {
          if (typed === '') onChange(undefined);
          setTyped(undefined);
        }}
        className={fieldClass}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Spellcasting

export const CASTING: ReadonlyArray<readonly [string, string]> = [
  ['', 'No spells'],
  ['full', 'Full caster, slots up to 9th level'],
  ['1/2', 'Half caster, slots up to 5th level'],
  ['artificer', 'Half caster, slots from level 1'],
  ['1/3', 'Third caster, slots up to 4th level'],
  ['pact', 'Pact magic, slots back on a short rest'],
];

/** The first entry of `type` in the data casting the same way, whose counts a new one starts from. */
function countsFrom(
  registry: EntityRegistry,
  type: 'class' | 'subclass',
  progression: string,
  field: string,
): Json | undefined {
  return registry
    .byType(type)
    .find((c) => c.casterProgression === progression && Array.isArray(c[field])) as
    | Json
    | undefined;
}

/** "<$level$> + <$wis_mod$>", and "<$level$> / 2 + <$cha_mod$>": the formulas the sheet reads. */
const FORMULA = /^<\$level\$>(\s*\/\s*2)?\s*\+\s*<\$(\w+)_mod\$>$/;
type PreparedHow = 'table' | 'level' | 'half';
const PREPARED: ReadonlyArray<readonly [PreparedHow, string]> = [
  ['table', 'A number for each level, in the table'],
  ['level', 'Its level + its casting modifier'],
  ['half', 'Half its level + its casting modifier'],
];

/** How the number of spells it prepares is given; undefined for a formula the box cannot show. */
function preparedHow(draft: Json): PreparedHow | undefined {
  const f = draft.preparedSpells;
  if (typeof f !== 'string') return 'table';
  const m = FORMULA.exec(f.trim());
  return m === null ? undefined : m[1] !== undefined ? 'half' : 'level';
}

const formula = (how: PreparedHow, ability: string) =>
  `<$level$>${how === 'half' ? ' / 2' : ''} + <$${ability}_mod$>`;

const abilityWord = (key: unknown) =>
  ABILITY_WORDS.find(([k]) => k === key)?.[1] ?? 'casting ability';

/**
 * How a class or subclass casts: its slots, the ability, whether it prepares
 * or knows its spells (and how many it prepares), and cantrips. The numbers
 * at each level are set in its table.
 */
export function Spellcasting({
  draft,
  change,
  readOnly,
  registry,
  type,
  label,
}: Pick<EditorProps, 'draft' | 'change' | 'readOnly' | 'registry'> & {
  type: 'class' | 'subclass';
  label: string;
}) {
  const progression = typeof draft.casterProgression === 'string' ? draft.casterProgression : '';
  const prepares = !Array.isArray(draft.spellsKnownProgression);
  const how = preparedHow(draft);
  const ability = typeof draft.spellcastingAbility === 'string' ? draft.spellcastingAbility : '';

  const setCasting = (p: string) => {
    if (p === '') {
      change({
        casterProgression: undefined,
        spellcastingAbility: undefined,
        cantripProgression: undefined,
        preparedSpellsProgression: undefined,
        spellsKnownProgression: undefined,
        preparedSpells: undefined,
      });
      return;
    }
    // New to spells, it starts from the counts of one in the data that casts
    // the same way, to change level by level in the table.
    const field = prepares ? 'preparedSpellsProgression' : 'spellsKnownProgression';
    const like = countsFrom(registry, type, p, field);
    const patch: Json = { casterProgression: p };
    if (!Array.isArray(draft[field]) && draft.preparedSpells === undefined)
      patch[field] = like?.[field] ?? LEVELS.map(() => 0);
    if (!Array.isArray(draft.cantripProgression) && Array.isArray(like?.cantripProgression))
      patch.cantripProgression = like.cantripProgression;
    change(patch);
  };
  const setPrepares = (yes: boolean) => {
    const counts =
      (yes ? draft.spellsKnownProgression : draft.preparedSpellsProgression) ?? LEVELS.map(() => 0);
    change(
      yes
        ? { spellsKnownProgression: undefined, preparedSpellsProgression: counts }
        : {
            preparedSpellsProgression: undefined,
            preparedSpells: undefined,
            spellsKnownProgression: counts,
          },
    );
  };
  // The sheet takes a table over a formula, so a formula clears the table.
  const setHow = (next: PreparedHow) =>
    change(
      next === 'table'
        ? {
            preparedSpells: undefined,
            preparedSpellsProgression: Array.isArray(draft.preparedSpellsProgression)
              ? draft.preparedSpellsProgression
              : (countsFrom(registry, type, progression, 'preparedSpellsProgression')
                  ?.preparedSpellsProgression ?? LEVELS.map(() => 0)),
          }
        : { preparedSpellsProgression: undefined, preparedSpells: formula(next, ability || 'int') },
    );
  // The formula names the ability too; the sheet takes the modifier from "Casts with".
  const setAbility = (a: string) =>
    change({
      spellcastingAbility: a || undefined,
      ...(a !== '' && (how === 'level' || how === 'half')
        ? { preparedSpells: formula(how, a) }
        : {}),
    });

  return (
    <>
      <Field label={label}>
        <Select
          value={progression}
          disabled={readOnly}
          onChange={(e) => setCasting(e.target.value)}
        >
          {CASTING.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
      {progression !== '' && (
        <>
          <Field label="Casts with">
            <Select
              value={ability}
              disabled={readOnly}
              onChange={(e) => setAbility(e.target.value)}
            >
              <option value="">Pick an ability</option>
              {ABILITY_WORDS.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Its spells">
            <Select
              value={prepares ? 'prepared' : 'known'}
              disabled={readOnly}
              onChange={(e) => setPrepares(e.target.value === 'prepared')}
            >
              <option value="prepared">Prepares some each day</option>
              <option value="known">Knows a set number</option>
            </Select>
          </Field>
          {prepares &&
            (how === undefined ? (
              <Kept label="Prepared spells">
                {plainEntryText(
                  String(draft.preparedSpells).replaceAll(/<\$(\w+)\$>/g, (_, w: string) =>
                    w === 'level' ? 'level' : `${w.replace('_mod', '').toUpperCase()} modifier`,
                  ),
                )}
                , as the original has it.
              </Kept>
            ) : (
              <>
                <Field label="How many it prepares">
                  <Select
                    value={how}
                    disabled={readOnly}
                    onChange={(e) => setHow(e.target.value as PreparedHow)}
                  >
                    {PREPARED.map(([v, text]) => (
                      <option key={v} value={v}>
                        {text}
                      </option>
                    ))}
                  </Select>
                </Field>
                {how !== 'table' && (
                  <OnSheet>
                    {`the Spells tab's prepared limit, ${how === 'half' ? 'half its level' : 'its level'} plus its ${abilityWord(draft.spellcastingAbility)} modifier, at least 1.`}
                  </OnSheet>
                )}
              </>
            ))}
          <label className="flex min-h-tap items-center gap-2.5 text-body">
            <input
              type="checkbox"
              className="size-4.5 accent-ink"
              disabled={readOnly}
              checked={Array.isArray(draft.cantripProgression)}
              onChange={(e) =>
                change({
                  cantripProgression: e.target.checked
                    ? (countsFrom(registry, type, progression, 'cantripProgression')
                        ?.cantripProgression ?? LEVELS.map(() => 2))
                    : undefined,
                })
              }
            />
            Knows cantrips
          </label>
          <p className="text-caption text-ink-muted">
            Set cantrips and spells for each level in the table.
          </p>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Spells given by class level

type GivenHow = 'prepared' | 'expanded';
interface LevelRow {
  level: number;
  spells: string[];
}
/** Spells by class level as the field holds them, and the entry's other keys, kept. */
interface Given {
  how: GivenHow;
  rows: LevelRow[];
  /** The block as it was (`known` cantrips, `innate` spells, `ability`), written back around the list. */
  block?: Json;
}

/**
 * `additionalSpells` as spells by class level, always prepared (an oath's) or
 * added to the list it chooses from (a patron's), when it is one block with
 * one such list of names; its other keys (cantrips it knows) are kept.
 * Undefined for more: alternatives, a choice, a filter, spells by spell level.
 */
export function levelSpells(raw: unknown): Given | undefined {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0))
    return { how: 'prepared', rows: [] };
  if (!Array.isArray(raw) || raw.length !== 1 || !isRecord(raw[0])) return undefined;
  const block = raw[0];
  if (block.prepared !== undefined && block.expanded !== undefined) return undefined;
  const how: GivenHow = block.expanded !== undefined ? 'expanded' : 'prepared';
  const list = block[how];
  const rows: LevelRow[] = [];
  if (list !== undefined) {
    if (!isRecord(list)) return undefined;
    for (const [k, v] of Object.entries(list)) {
      if (!/^[1-9]\d*$/.test(k) || !Array.isArray(v) || !v.every((s) => typeof s === 'string'))
        return undefined;
      rows.push({ level: Number(k), spells: v });
    }
  }
  return { how, rows: rows.sort((a, b) => a.level - b.level), block };
}

/** The `additionalSpells` for `rows` in `block`'s other keys, or undefined when they give none. */
export function levelSpellsOf(how: GivenHow, rows: readonly LevelRow[], block: Json = {}): unknown {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    const given = r.spells.filter((s) => s.trim() !== '');
    if (given.length > 0) out[String(r.level)] = [...(out[String(r.level)] ?? []), ...given];
  }
  const list = Object.keys(out).length > 0 ? out : undefined;
  // The list where the block had one, the keys around it as they were.
  const next: Json = {};
  for (const [k, v] of Object.entries(block)) {
    if (k === 'prepared' || k === 'expanded') {
      if (list !== undefined) next[how] = list;
    } else next[k] = v;
  }
  if (list !== undefined) next[how] = list;
  return Object.keys(next).length > 0 ? [next] : undefined;
}

/** What a block gives besides its list, in words, for the line saying it is kept. */
function besides(block: Json | undefined): string | undefined {
  const words = [
    block?.known !== undefined ? 'spells it knows' : undefined,
    block?.innate !== undefined ? 'spells it casts on its own' : undefined,
  ].filter((w) => w !== undefined);
  return words.length > 0 ? words.join(' and ') : undefined;
}

const refName = (ref: string) => ref.split('|')[0]?.split('#')[0] ?? '';

/**
 * Spells typed by name: one the row had keeps its reference; a new one names
 * the data's book for it, in the case it was typed (the box compares as typed).
 */
function SpellNames({
  label,
  refs,
  registry,
  disabled,
  onChange,
}: {
  label: string;
  refs: readonly string[];
  registry: EntityRegistry;
  disabled: boolean;
  onChange: (refs: string[]) => void;
}) {
  return (
    <NamesBox
      label={label}
      value={refs.map(refName)}
      placeholder="Bless, Shield"
      disabled={disabled}
      onChange={(names) =>
        onChange(
          names.map((n) => {
            const was = refs.find((r) => refName(r).toLowerCase() === n.toLowerCase());
            if (was !== undefined) return was;
            const hit = registry
              .byType('spell')
              .find((s) => String(s.name).toLowerCase() === n.toLowerCase());
            return hit === undefined ? n : `${n}|${String(hit.source)}`;
          }),
        )
      }
    />
  );
}

/**
 * The spells a class or subclass gives as its levels come: always prepared,
 * or added to the list it chooses from. Rows are held as typed, so a level can
 * be added before its spells are named.
 */
export function LevelSpells({
  raw,
  onChange,
  registry,
  readOnly,
  first,
  of,
}: {
  raw: unknown;
  onChange: (next: unknown) => void;
  registry: EntityRegistry;
  readOnly: boolean;
  /** The level a new row starts at. */
  first: number;
  /** "the class", "the subclass": whose level the rows are. */
  of: string;
}) {
  useTypePacks('spell');
  const read = levelSpells(raw);
  const [held, setHeld] = useState<Given>(() => read ?? { how: 'prepared', rows: [] });
  if (read === undefined)
    return <Kept label="Spells">a choice or a filter of spells, kept as it is.</Kept>;
  // Written from elsewhere (the file view, Undo): what the field holds is shown.
  const shown: Given = same(levelSpellsOf(held.how, held.rows, read.block), raw ?? undefined)
    ? { ...held, block: read.block }
    : read.rows.length > 0
      ? read
      : { ...read, how: held.how };
  const set = (next: Given) => {
    setHeld(next);
    onChange(levelSpellsOf(next.how, next.rows, next.block));
  };
  const also = besides(read.block);
  const setRow = (i: number, row: LevelRow) =>
    set({ ...shown, rows: shown.rows.map((r, j) => (j === i ? row : r)) });
  return (
    <div className="flex flex-col gap-3">
      {readOnly ? (
        <p className="text-body">
          {shown.how === 'prepared' ? 'Always prepared' : 'Added to its list'}
        </p>
      ) : (
        <SegmentedControl<GivenHow>
          label="How it gives its spells"
          block
          value={shown.how}
          onChange={(how) => set({ ...shown, how })}
          options={[
            { value: 'prepared', label: 'Always prepared' },
            { value: 'expanded', label: 'Added to its list' },
          ]}
        />
      )}
      {shown.rows.map((row, i) => (
        // A row is its place in the list: its level can be retyped.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="w-24">
            <HeldNumber
              label={`Spell row ${i + 1}: from level`}
              value={row.level}
              min={1}
              disabled={readOnly}
              onChange={(l) => setRow(i, { ...row, level: Math.min(20, l) })}
            />
          </div>
          <div className="min-w-40 flex-1">
            <SpellNames
              label={`Spell row ${i + 1}: spells`}
              refs={row.spells}
              registry={registry}
              disabled={readOnly}
              onChange={(spells) => setRow(i, { ...row, spells })}
            />
          </div>
          {!readOnly && (
            <button
              type="button"
              aria-label={`Remove spell row ${i + 1}`}
              onClick={() => set({ ...shown, rows: shown.rows.filter((_, j) => j !== i) })}
              className="tap rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
            >
              <X size={18} aria-hidden />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            const last = shown.rows.at(-1)?.level;
            const level = last === undefined ? first : Math.min(20, last + 2);
            set({ ...shown, rows: [...shown.rows, { level, spells: [] }] });
          }}
        >
          <Plus size={16} aria-hidden />
          Add spells at a level
        </Button>
      )}
      {also !== undefined && <Kept label="Also">the {also}, kept as written.</Kept>}
      <OnSheet>
        {shown.how === 'prepared'
          ? `the Spells tab has them prepared from that level of ${of}, not counted against the spells it prepares.`
          : `the Spells tab adds them to the spells ${of} can choose from, from that level.`}
      </OnSheet>
    </div>
  );
}
