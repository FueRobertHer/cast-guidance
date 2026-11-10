/**
 * Classes (the Class board's A, with C's start from an existing class mixed
 * in; ADR-001 D1 and D3): the basics, a table with a row per level, and the
 * subclasses. A copy shows the original's features by level, each Kept,
 * Changed, Removed or New, as the subclass editor does.
 *
 * A class's features are entries of their own (`classFeature`), found through
 * the refs its `classFeatures` lists and the refs a feature's text holds to the
 * ones under it (a Monk's Focus holds Flurry of Blows). The draft keeps the
 * class and, under `_features`, only what the player did to them. Save writes
 * the class and each feature it touches:
 *
 * - a kept feature is not written: its ref stays, so the sheet finds the
 *   original, curated rows and spend links included (the class's
 *   `castGuidance.basedOn` names the class they are keyed under);
 * - a changed one is the player's own entry, `_copy` of the original with its
 *   changes and a `basedOn` of its own, or whole where the original's name and
 *   book do not find it alone (every class has an Ability Score Improvement),
 *   or where the original is the player's own (a class started from one of
 *   theirs): their books gain entries, so a name and book that find one
 *   feature today can find two later;
 * - a feature whose text holds one that was changed or removed is written too,
 *   its refs pointed at the feature now (or taken out), so what it holds stays
 *   in it: the sheet reads a held feature with the others it holds, an
 *   optional one among them a pick (Tasha's), and names its choices after it.
 *   Where the player rewrote the holder's text, the refs follow their text;
 *   where they took out the holder alone, what it held is listed on the class;
 * - a new one is a whole entry, listed after the last feature of its level.
 *
 * Pools are the class's own `resource` effects whose uses are a level table
 * (`{ "byLevel": ... }`, read by `formula.ts` at the class's level). Save also
 * writes them as a column of `classTableGroups`, so the class's table shows
 * them wherever it is read.
 */
import { Info, Plus, X } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { plainEntryText } from '@/data5e/entries/plainText';
import type { EntityRegistry } from '@/data5e/normalize';
import { ownCasterLevel, PACT_SLOTS, STANDARD_SLOTS } from '@/engine/calc/slots';
import { isRecord, own, type StoredEffect } from '@/engine/castGuidance';
import { SKILLS } from '@/engine/types';
import { Button } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { listClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import type { TableColumn } from '../ClassTable';
import { basedOnKey, changeCount, copiedFrom, readStored, same, writeEntry } from '../copyWriter';
import type { EditorProps, EditorSpec, Json, WriteContext, Written } from '../editorTypes';
import { FeatureRow, type FeatureStatus } from '../FeatureRow';
import { ABILITY_WORDS, ChipPicks, Field, Kept, NumberField, Section, Select } from '../fields';

const ClassTable = lazy(() => import('../ClassTable').then((m) => ({ default: m.ClassTable })));

const KEY = '_features';
/** A new feature that is a subclass level: its list item says `gainSubclassFeature`. */
const SUB = 'gainSubclassFeature';
const FEATURE = 'classFeature';
const REF = 'refClassFeature';
/**
 * A class opened without its original (a full copy, its book turned off) has
 * no features of the original's to keep its own in: each is a new one, and
 * one whose text holds others keeps, under `HOLDS`, its text as stored and the
 * refs to them; each it holds keeps, under `WAS`, the ref it was stored under.
 * Save puts them back where they were.
 */
const HOLDS = '_holds';
const WAS = '_heldAs';
export const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

/** What the player did to a class's features, kept in its draft. */
export interface FeatureEdits {
  /** Original features changed, by ref: each as it now stands, refs to those under it taken out. */
  changed: Record<string, Json>;
  /** Original features taken out, by ref. */
  removed: string[];
  /** Features the player added, each with its `level`, in order. */
  added: Json[];
}

/** One of the original's features, where it sits. */
export interface FeatureNode {
  ref: string;
  /** The ref of the feature whose text holds this one. */
  parent?: string;
  level: number;
  /** As the data holds it; undefined when the data does not have it. */
  entity?: Json;
  /** The entity with the refs to the features under it taken out. */
  base: Json;
  kids: string[];
  /** The class's list item for it (a ref, or `{ classFeature, gainSubclassFeature }`). */
  item?: unknown;
}

const lower = (v: unknown) => String(v ?? '').toLowerCase();
const eq = (a: unknown, b: unknown) => lower(a) === lower(b);

/** "Name|Class|ClassSource|Level|FeatureSource": an empty class book is PHB, as on the sheet. */
export function parseRef(raw: string) {
  const [name = '', className = '', classSource, level, featureSource] = raw.split('|');
  const n = Number.parseInt(level ?? '', 10);
  return {
    name,
    className,
    classSource: classSource || 'PHB',
    level: Number.isNaN(n) ? 1 : n,
    featureSource: featureSource || undefined,
  };
}

/** Whether a feature is the one a ref names, as the sheet tells. */
function isAt(f: Json, raw: string): boolean {
  const r = parseRef(raw);
  return (
    eq(f.name, r.name) &&
    eq(f.className, r.className) &&
    eq(f.classSource, r.classSource) &&
    f.level === r.level &&
    (r.featureSource === undefined || eq(f.source, r.featureSource))
  );
}

/** Whether a feature is the data's own, not a homebrew file's (homebrew merges after it). */
function isOfficialIn(registry: EntityRegistry, f: Json): boolean {
  const at = registry.byType(FEATURE).indexOf(f as never);
  return at !== -1 && at < registry.officialCount(FEATURE);
}

function findFeature(registry: EntityRegistry, raw: string): Json | undefined {
  return registry.byType(FEATURE).find((f) => isAt(f as Json, raw)) as Json | undefined;
}

/** The ref a list item names: a string, or `{ classFeature }` (a subclass level, a table name). */
export const refOf = (item: unknown): string | undefined =>
  typeof item === 'string'
    ? item
    : isRecord(item) && typeof item.classFeature === 'string'
      ? item.classFeature
      : undefined;

const listOf = (cls: Json | undefined): unknown[] =>
  Array.isArray(cls?.classFeatures) ? cls.classFeatures : [];

/** A counted `options` block: a pick (Divine Order), whose refs stay in their feature. */
const isPick = (o: Json) => o.type === 'options' && typeof o.count === 'number' && o.count >= 1;

/** The refs a feature's text holds to features under it, as the sheet follows them (not a pick's). */
function kidRefs(f: Json): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!isRecord(v) || isPick(v)) return;
    if (v.type === REF && typeof v.classFeature === 'string') {
      out.push(v.classFeature);
      return;
    }
    walk(v.entries);
    walk(v.items);
    walk(v.entry);
  };
  walk(f.entries);
  return out;
}

const GONE = Symbol('gone');

/** Text with the refs in `refs` taken out, and any block they alone filled. */
function withoutRefs(v: unknown, refs: ReadonlySet<string>): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const x of v) {
      if (isRecord(x) && x.type === REF && refs.has(String(x.classFeature))) continue;
      const y = withoutRefs(x, refs);
      if (y !== GONE) out.push(y);
    }
    return out;
  }
  if (!isRecord(v) || isPick(v)) return v;
  return inBlock(
    v,
    (x) => withoutRefs(x, refs),
    (x) => refs.has(String(x.classFeature)),
  );
}

/**
 * A block with `step` run over what it holds (`entries`, `items`, `entry`, as
 * the sheet reads them), or GONE where that took out all it held. `drops` says
 * whether a lone `entry` ref goes.
 */
function inBlock(
  v: Json,
  step: (x: unknown) => unknown,
  drops: (ref: Json) => boolean,
  swap?: (ref: Json) => Json,
): Json | typeof GONE {
  const o: Json = { ...v };
  let held = 0;
  let left = 0;
  for (const k of ['entries', 'items']) {
    if (!Array.isArray(v[k]) || (v[k] as unknown[]).length === 0) continue;
    o[k] = step(v[k]);
    held += 1;
    if ((o[k] as unknown[]).length > 0) left += 1;
  }
  if (isRecord(v.entry)) {
    held += 1;
    const x = v.entry;
    if (x.type === REF && typeof x.classFeature === 'string') {
      if (drops(x)) delete o.entry;
      else {
        o.entry = swap?.(x) ?? x;
        left += 1;
      }
    } else {
      const y = step([x]) as unknown[];
      if (y.length > 0) {
        o.entry = y[0];
        left += 1;
      } else delete o.entry;
    }
  }
  return held > 0 && left === 0 ? GONE : o;
}

/**
 * Text with each ref in `to` pointed where it now goes, or taken out (null),
 * with any block emptied by that: the place the sheet reads it from is kept.
 */
function rewriteRefs(v: unknown, to: ReadonlyMap<string, string | null>): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const x of v) {
      if (isRecord(x) && x.type === REF && to.has(String(x.classFeature))) {
        const next = to.get(String(x.classFeature));
        if (next !== null && next !== undefined) out.push({ ...x, classFeature: next });
        continue;
      }
      const y = rewriteRefs(x, to);
      if (y !== GONE) out.push(y);
    }
    return out;
  }
  if (!isRecord(v) || isPick(v)) return v;
  const next = (x: Json) => to.get(String(x.classFeature));
  return inBlock(
    v,
    (x) => rewriteRefs(x, to),
    (x) => to.has(String(x.classFeature)) && (next(x) ?? null) === null,
    (x) => {
      const r = next(x);
      return typeof r === 'string' ? { ...x, classFeature: r } : x;
    },
  );
}

/**
 * A class's features in the order the sheet collects them: each listed one,
 * then those its text holds. A ref the list itself names is the list's (as on
 * the sheet), so it is never also counted under another.
 */
export function featureTree(cls: Json, registry: EntityRegistry): FeatureNode[] {
  const nodes: FeatureNode[] = [];
  const listed = listOf(cls)
    .map(refOf)
    .filter((r) => r !== undefined);
  const seen = new Set(listed.map(lower));
  const done = new Set<string>();
  const visit = (ref: string, parent?: string, item?: unknown) => {
    if (done.has(lower(ref))) return;
    done.add(lower(ref));
    const entity = findFeature(registry, ref);
    const kids = entity === undefined ? [] : kidRefs(entity).filter((k) => !seen.has(lower(k)));
    for (const k of kids) seen.add(lower(k));
    const base =
      entity === undefined || kids.length === 0
        ? (entity ?? {})
        : { ...entity, entries: withoutRefs(entity.entries, new Set(kids)) };
    nodes.push({ ref, parent, level: parseRef(ref).level, entity, base, kids, item });
    for (const k of kids) visit(k, ref);
  };
  for (const item of listOf(cls)) {
    const ref = refOf(item);
    if (ref !== undefined) visit(ref, undefined, item);
  }
  return nodes;
}

export function editsOf(draft: Json): FeatureEdits {
  const e = isRecord(draft[KEY]) ? (draft[KEY] as Partial<FeatureEdits>) : {};
  return {
    changed: isRecord(e.changed) ? (e.changed as Record<string, Json>) : {},
    removed: Array.isArray(e.removed) ? e.removed : [],
    added: Array.isArray(e.added) ? e.added : [],
  };
}

function changedOf(edits: FeatureEdits, n: FeatureNode): Json | undefined {
  const now = edits.changed[n.ref];
  return now !== undefined && changeCount(n.base, now) > 0 ? now : undefined;
}

function statusOf(edits: FeatureEdits, n: FeatureNode): FeatureStatus {
  if (edits.removed.includes(n.ref)) return 'removed';
  return changedOf(edits, n) !== undefined ? 'changed' : 'kept';
}

/** The keys that place a feature in a class, which the writer sets. */
const PLACE = ['source', 'className', 'classSource'];

/** `castGuidance` without the pointer the writer works out again. */
function ownGuidance(f: Json): Json {
  const g = own(f, 'castGuidance');
  if (!isRecord(g)) return f;
  const { basedOn: _, basedOnFingerprint: __, ...rest } = g;
  const { castGuidance: ___, ...out } = f;
  return Object.keys(rest).some((k) => k !== 'v') ? { ...out, castGuidance: rest } : out;
}

// ---------------------------------------------------------------------------
// Pools and the class table
// ---------------------------------------------------------------------------

const effectsOf = (draft: Json): StoredEffect[] => {
  const g = own(draft, 'castGuidance');
  const list = isRecord(g) ? own(g, 'effects') : undefined;
  return Array.isArray(list) ? list.filter(isRecord).map((e) => e as StoredEffect) : [];
};

/** A pool: uses per rest whose number is a table by class level. */
export const isPool = (e: unknown): e is StoredEffect =>
  isRecord(e) && e.kind === 'resource' && isRecord(e.max) && isRecord(own(e.max, 'byLevel'));

export const poolsOf = (draft: Json): StoredEffect[] => effectsOf(draft).filter(isPool);

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

const poolValues = (p: StoredEffect) => byLevelValues(own(p.max as Json, 'byLevel'));

/** The column Save adds to the class table for the pools. */
function poolGroup(pools: readonly StoredEffect[]): Json {
  const values = pools.map(poolValues);
  return {
    colLabels: pools.map((p) => String(p.label ?? 'Pool')),
    rows: LEVELS.map((_, i) => values.map((v) => v[i] ?? 0)),
  };
}

/** The class table as the editor holds it: without the pools' column, which Save writes again. */
function withoutPoolGroup(groups: unknown, pools: readonly StoredEffect[]): unknown {
  if (!Array.isArray(groups) || pools.length === 0) return groups;
  const mine = poolGroup(pools);
  const at = groups.findLastIndex((g) => same(g, mine));
  return at === -1 ? groups : groups.filter((_, i) => i !== at);
}

type CountKind = 'cantrips' | 'prepared' | 'known' | 'pactSlots' | 'slotLevel';

/** What a table column counts, by its heading. */
function columnKind(label: unknown): CountKind | undefined {
  const t = plainEntryText(String(label ?? ''))
    .trim()
    .toLowerCase();
  if (t.startsWith('cantrips')) return 'cantrips';
  if (t.startsWith('prepared')) return 'prepared';
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

/** What the book's table says at each level, leaving out the spell columns the editor shows. */
export function bookAt(draft: Json): (level: number) => Array<[string, string]> {
  const groups = (Array.isArray(draft.classTableGroups) ? draft.classTableGroups : []).filter(
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
export function slotRows(draft: Json): number[][] | undefined {
  const p = draft.casterProgression;
  if (typeof p !== 'string' || p === 'pact') return undefined;
  for (const g of Array.isArray(draft.classTableGroups) ? draft.classTableGroups : []) {
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
export function topSlots(draft: Json): string[] | undefined {
  if (draft.casterProgression === 'pact') {
    return LEVELS.map((lv) => ORDINALS[(PACT_SLOTS[lv - 1]?.[1] ?? 1) - 1] ?? '');
  }
  return slotRows(draft)?.map((r) => {
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
 * The class table Save writes: its spell columns and slots made to match the
 * spellcasting the class now has (where that changed, or for a new class),
 * and the pools' column added.
 */
export function tableGroupsFor(draft: Json, original: Json | undefined): unknown[] | undefined {
  const start = Array.isArray(draft.classTableGroups) ? draft.classTableGroups : [];
  let groups: Json[] = structuredClone(start).filter(isRecord);
  const changed =
    original === undefined || SPELL_FIELDS.some((k) => !same(own(original, k), own(draft, k)));
  if (changed) {
    const p = draft.casterProgression;
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
      // A column the class no longer has goes.
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
    // The slot table the sheet reads, as the progression has it.
    groups = groups.filter((g) => !isSlotGroup(g));
    const slots = slotRows({ casterProgression: p });
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
  groups = groups.filter((g) => !Array.isArray(g.colLabels) || g.colLabels.length > 0);
  const pools = poolsOf(draft);
  if (pools.length > 0) groups.push(poolGroup(pools));
  return groups.length > 0 ? groups : undefined;
}

// ---------------------------------------------------------------------------
// Opening and saving
// ---------------------------------------------------------------------------

/**
 * The draft a class opens on: `_features` worked out by walking what the entry
 * lists against the original's features (as the subclass editor does), and
 * its table without the pools' column, which Save writes again.
 */
export function openClass(
  entry: Json,
  { original, registry, file }: { original?: Json; registry: EntityRegistry; file?: Json },
): Json {
  if (isRecord(entry[KEY])) return entry;
  // A copy whose original is not loaded is shown as it is stored.
  if (original === undefined && isRecord(own(entry, '_copy'))) return entry;
  const nodes = original === undefined ? [] : featureTree(original, registry);
  // The player's features, from the file the class is kept in: the registry
  // leaves out a file the player turned off.
  const stored = Array.isArray(file?.[FEATURE])
    ? (file[FEATURE] as unknown[]).filter(isRecord)
    : [];
  const featureOf = (ref: string): Json | undefined => {
    const raw = stored.find((f) => isAt(f, ref));
    const copy = raw === undefined ? undefined : own(raw, '_copy');
    if (raw === undefined || !isRecord(copy)) return raw ?? findFeature(registry, ref);
    const target = nodes.find(
      (n) =>
        eq(n.entity?.name, copy.name) &&
        eq(n.entity?.source, copy.source) &&
        n.level === Number(copy.level ?? raw.level),
    )?.entity;
    return target === undefined ? findFeature(registry, ref) : readStored(raw, target).entry;
  };
  const edits: FeatureEdits = { changed: {}, removed: [], added: [] };
  const present = new Set<string>();
  const keep = (n: FeatureNode) => {
    present.add(n.ref);
    for (const k of nodes) if (k.parent === n.ref) keep(k);
  };
  const seen = new Set<string>();
  /** `held`: the feature is in the text of one with nothing of the original's to pair with. */
  const visit = (ref: string, item?: unknown, held = false) => {
    if (seen.has(lower(ref))) return;
    seen.add(lower(ref));
    const node = nodes.find((n) => eq(n.ref, ref));
    if (node !== undefined) return keep(node);
    const f = featureOf(ref);
    if (f === undefined) return;
    const g = own(f, 'castGuidance');
    const based = isRecord(g) ? own(g, 'basedOn') : undefined;
    // Save keeps a changed feature at its original's level, and a name can
    // repeat at several (Ability Score Improvement). Its `basedOn` names the
    // official feature, as Save worked it out, also where the original is a
    // copy of the player's own (a class started from one of theirs).
    const from =
      typeof based !== 'string'
        ? undefined
        : nodes.find(
            (n) =>
              !present.has(n.ref) &&
              n.entity !== undefined &&
              eq(basedOnKey(n.entity), based) &&
              n.level === Number(f.level),
          );
    const now = from?.entity !== undefined ? ownGuidance(structuredClone(f)) : structuredClone(f);
    for (const k of PLACE) delete now[k];
    // What it holds is shown as features of their own, as the original's are.
    const kids = kidRefs(f);
    if (kids.length > 0) now.entries = withoutRefs(now.entries, new Set(kids));
    if (from?.entity !== undefined) {
      present.add(from.ref);
      for (const k of PLACE) if (from.entity[k] !== undefined) now[k] = from.entity[k];
      if (changeCount(from.base, now) > 0) edits.changed[from.ref] = now;
    } else {
      if (isRecord(item) && item[SUB] === true) now[SUB] = true;
      // The sheet shows a feature as its ref spells it ("Subclass Feature").
      const listedAs = parseRef(ref).name;
      if (eq(listedAs, now.name)) now.name = listedAs;
      if (held) now[WAS] = ref;
      if (kids.length > 0) now[HOLDS] = { entries: structuredClone(f.entries), kids };
      edits.added.push(now);
    }
    for (const k of kids) visit(k, undefined, from?.entity === undefined);
  };
  for (const item of listOf(entry)) {
    const ref = refOf(item);
    if (ref !== undefined) visit(ref, item);
  }
  edits.removed = nodes
    .filter((n) => n.entity !== undefined && !present.has(n.ref))
    .map((n) => n.ref);
  const out: Json = { ...entry, [KEY]: edits };
  const groups = withoutPoolGroup(entry.classTableGroups, poolsOf(entry));
  if (groups !== entry.classTableGroups) out.classTableGroups = groups;
  return out;
}

/** A list item for a ref: the original's shape kept (a subclass level stays one). */
function itemFor(item: unknown, ref: string, sub = false): unknown {
  if (isRecord(item)) return { ...item, classFeature: ref };
  return sub ? { classFeature: ref, [SUB]: true } : ref;
}

/** What Save stores: the class, and every feature of its own (see the top of this file). */
export function writeClass(at: WriteContext): Written {
  const { draft, source, mode, registry, copied } = at;
  const nodes = copied === undefined ? [] : featureTree(copied, registry);
  const edits = editsOf(draft);
  const className = String(draft.name ?? '').trim();
  const place = (level: number): Json => ({ className, classSource: source, level });
  const owned: Json[] = [];
  const items: Array<{ item: unknown; level: number }> = [];
  const ownRef = (f: Json) => {
    owned.push(f);
    return `${String(f.name)}|${className}|${source}|${String(f.level)}|${source}`;
  };

  const byRef = new Map(nodes.map((n) => [n.ref, n]));
  const removed = new Set(edits.removed);
  const touched = new Map<string, boolean>();
  const isTouched = (n: FeatureNode): boolean => {
    const known = touched.get(n.ref);
    if (known !== undefined) return known;
    const t =
      mode === 'full' ||
      statusOf(edits, n) !== 'kept' ||
      n.kids.some((k) => {
        const kid = byRef.get(k);
        return kid !== undefined && isTouched(kid);
      });
    touched.set(n.ref, t);
    return t;
  };
  const written = (n: FeatureNode) => n.entity !== undefined && !removed.has(n.ref) && isTouched(n);
  const isOfficial = (f: Json) => isOfficialIn(registry, f);

  // The ref each feature Save writes is found by, worked out first so the one
  // holding it can point there. A name kept as it was keeps the book's spelling.
  const refFor = new Map<string, string>();
  for (const n of nodes) {
    if (!written(n)) continue;
    const was = parseRef(n.ref).name;
    // Trimmed, as the entry stores its name.
    const name = String((changedOf(edits, n) ?? n.base).name ?? was).trim();
    refFor.set(n.ref, `${eq(name, was) ? was : name}|${className}|${source}|${n.level}|${source}`);
  }
  const target = (r: string): string | null => (removed.has(r) ? null : (refFor.get(r) ?? r));

  /**
   * A holder's text with what it holds where the sheet reads it: the book's
   * text with each ref pointed at the feature now, or, where the player
   * rewrote the text, their text with the refs after it.
   */
  const heldText = (n: FeatureNode, now: Json): unknown => {
    if (n.kids.length === 0 || n.entity === undefined) return now.entries;
    if (same(now.entries, n.base.entries)) {
      return rewriteRefs(n.entity.entries, new Map(n.kids.map((k) => [k, target(k)])));
    }
    const refs = n.kids.flatMap((k) => {
      const to = target(k);
      return to === null ? [] : [{ type: REF, classFeature: to }];
    });
    return [...(Array.isArray(now.entries) ? now.entries : []), ...refs];
  };

  for (const n of nodes) {
    if (removed.has(n.ref)) continue;
    const parent = n.parent === undefined ? undefined : byRef.get(n.parent);
    // Held in its parent's text, unless that was taken out without it.
    const held = parent !== undefined && !removed.has(parent.ref);
    if (!written(n)) {
      if (!held) items.push({ item: n.item ?? n.ref, level: n.level });
      continue;
    }
    const e = n.entity as Json;
    const now = changedOf(edits, n) ?? n.base;
    // A copy is found by name and book alone; where two features share them
    // (every class's Ability Score Improvement), it could find the other, so
    // this one is written out whole, as is one the data holds as a copy, and
    // one of the player's own, whose books can gain another of that name.
    const alone = registry.get(FEATURE, String(e.name), String(e.source)) === e && isOfficial(e);
    const f = writeEntry({
      original: e,
      draft: { ...now, entries: heldText(n, now), ...place(n.level) },
      source,
      mode: mode === 'full' || !alone || isRecord(e._copy) ? 'full' : 'changes',
    });
    Object.assign(f, place(n.level));
    if (isRecord(f._copy)) {
      // Where the original sits, as other tools find a feature to copy.
      const { _mod, ...copy } = f._copy;
      const where = { className: e.className, classSource: e.classSource, level: e.level };
      f._copy = { ...copy, ...where, ...(_mod !== undefined ? { _mod } : {}) };
    }
    owned.push(f);
    if (!held) items.push({ item: itemFor(n.item, refFor.get(n.ref) as string), level: n.level });
  }

  // Where each new feature another holds is now (see HOLDS).
  const levelOf = (a: Json) => Number(a.level) || 1;
  const newRef = (a: Json) =>
    `${String(a.name ?? '').trim()}|${className}|${source}|${levelOf(a)}|${source}`;
  const moved = new Map<string, string>();
  for (const a of edits.added) if (typeof a[WAS] === 'string') moved.set(a[WAS], newRef(a));
  const heldNow = new Set(
    edits.added.flatMap((a) => {
      const h = a[HOLDS];
      return isRecord(h) && Array.isArray(h.kids) ? h.kids : [];
    }),
  );

  // A new feature goes after the last of its level, unless another holds it.
  for (const a of edits.added) {
    const level = levelOf(a);
    const { [SUB]: sub, [WAS]: was, [HOLDS]: holds, ...rest } = a;
    const draftOf: Json = { ...rest, ...place(level) };
    if (isRecord(holds) && Array.isArray(holds.kids)) {
      const kids = holds.kids.filter((k): k is string => typeof k === 'string');
      const to = new Map(
        kids.map((k) => [k, moved.get(k) ?? (byRef.has(k) ? target(k) : null)] as const),
      );
      draftOf.entries = same(rest.entries, withoutRefs(holds.entries, new Set(kids)))
        ? rewriteRefs(holds.entries, to)
        : [
            ...(Array.isArray(rest.entries) ? rest.entries : []),
            ...kids.flatMap((k) => {
              const r = to.get(k);
              return typeof r === 'string' ? [{ type: REF, classFeature: r }] : [];
            }),
          ];
    }
    const f = writeEntry({ draft: draftOf, source, mode: 'changes' });
    Object.assign(f, place(level));
    const ref = ownRef(f);
    // Held, unless the player took out what held it.
    if (typeof was === 'string' && heldNow.has(was)) continue;
    const after = items.findLastIndex((i) => i.level <= level);
    items.splice(after + 1, 0, { item: itemFor(undefined, ref, sub === true), level });
  }

  const { [KEY]: _, ...rest } = draft;
  const groups = tableGroupsFor(rest, copied);
  const entry = writeEntry({
    original: at.original,
    draft: { ...rest, classFeatures: items.map((i) => i.item), classTableGroups: groups },
    source,
    mode,
  }) as Written['entry'];
  return { entry, owned };
}

/** The Save bar's line: what happened to the features, the way the board counts them. */
export function summarize(draft: Json, original: Json, registry: EntityRegistry): string {
  const edits = editsOf(draft);
  const count: Record<FeatureStatus, number> = {
    kept: 0,
    changed: 0,
    removed: 0,
    new: edits.added.length,
    waiting: 0,
  };
  for (const n of featureTree(original, registry)) {
    if (n.entity !== undefined) count[statusOf(edits, n)] += 1;
  }
  const { [KEY]: _, ...rest } = draft;
  // The list is the features' doing, counted above; the pools' column is theirs.
  const fields = changeCount(original, {
    ...rest,
    classFeatures: original.classFeatures,
    classTableGroups: tableGroupsFor(rest, original) ?? original.classTableGroups,
  });
  const of = String(original.name);
  if (count.changed + count.new + count.removed === 0 && fields === 0) {
    return `No changes from ${of} yet. You can save it as it is.`;
  }
  const parts = (['changed', 'new', 'removed', 'kept'] as const)
    .filter((k) => count[k] > 0 || k === 'kept')
    .map((k) => `${count[k]} ${k}`);
  const also =
    fields > 0 ? `, and ${fields} ${fields === 1 ? 'change' : 'changes'} to the class` : '';
  return `${parts.join(', ')} features${also}. Saved as changes from ${of}.`;
}

/** Why it cannot be saved: a feature without a name, two the sheet could not tell apart, a caster without an ability. */
function check(draft: Json, at?: Omit<WriteContext, 'draft'>): string | undefined {
  const edits = editsOf(draft);
  const mine: Json[] = [
    ...Object.entries(edits.changed)
      .filter(([ref]) => !edits.removed.includes(ref))
      .map(([ref, f]) => ({ ...f, level: f.level ?? parseRef(ref).level })),
    ...edits.added,
  ];
  const names = new Set<string>();
  for (const f of mine) {
    const name = String(f.name ?? '').trim();
    if (name === '') return 'Every feature needs a name.';
    if (name.includes('|')) return 'A feature name cannot have | in it.';
    const key = `${lower(name)}|${String(f.level)}`;
    if (names.has(key)) return `Two features at level ${String(f.level)} are called ${name}.`;
    names.add(key);
  }
  // Save also writes the book's features it has to (one holding a changed
  // feature, or every one in a full copy): two of those can share a name too.
  if (at !== undefined) {
    const written = new Set<string>();
    for (const f of writeClass({ ...at, draft }).owned) {
      const key = `${lower(String(f.name))}|${String(f.level)}`;
      if (written.has(key))
        return `Two features at level ${String(f.level)} are called ${String(f.name)}.`;
      written.add(key);
    }
  }
  if (typeof draft.casterProgression === 'string' && typeof draft.spellcastingAbility !== 'string')
    return 'Pick the ability it casts its spells with.';
  const pools = poolsOf(draft).map((p) => lower(String(p.label ?? '').trim()));
  if (pools.some((p) => p === '')) return 'Every pool needs a name.';
  if (new Set(pools).size !== pools.length) return 'Two pools have the same name.';
  return undefined;
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

const DICE = [6, 8, 10, 12] as const;
const ARMOR: ReadonlyArray<readonly [string, string]> = [
  ['light', 'Light'],
  ['medium', 'Medium'],
  ['heavy', 'Heavy'],
  ['shield', 'Shields'],
];
const WEAPONS: ReadonlyArray<readonly [string, string]> = [
  ['simple', 'Simple'],
  ['martial', 'Martial'],
];
const SKILL_WORDS = SKILLS.map((s) => [s.name.toLowerCase(), s.name] as const);
const CASTING: ReadonlyArray<readonly [string, string]> = [
  ['', 'No spells'],
  ['full', 'Full caster, slots up to 9th level'],
  ['1/2', 'Half caster, slots up to 5th level'],
  ['artificer', 'Half caster, slots from level 1'],
  ['1/3', 'Third caster, slots up to 4th level'],
  ['pact', 'Pact magic, slots back on a short rest'],
];

/** The draft's starting proficiencies, to read from and change. */
const startOf = (draft: Json): Json =>
  isRecord(draft.startingProficiencies) ? draft.startingProficiencies : {};

/** A list of words with the picked ones of `known` set, and the rest as the data had them. */
function withPicks(list: unknown, known: readonly string[], picked: readonly string[]): unknown[] {
  const rest = (Array.isArray(list) ? list : []).filter(
    (x) => typeof x !== 'string' || !known.includes(x.toLowerCase()),
  );
  return [...known.filter((k) => picked.includes(k)), ...rest];
}

/** The one shape of skill choice the editor can show: choose N from a list. */
function skillChoice(start: Json): { from: string[]; count: number } | undefined | null {
  const s = start.skills;
  if (s === undefined) return undefined;
  const c = Array.isArray(s) && s.length === 1 && isRecord(s[0]) ? s[0].choose : undefined;
  if (!isRecord(c) || !Array.isArray(c.from) || typeof c.count !== 'number') return null;
  return { from: c.from.map(String), count: c.count };
}

/** The first class in the data casting the same way, whose counts a new one starts from. */
function countsFrom(
  registry: EntityRegistry,
  progression: string,
  field: string,
): Json | undefined {
  return registry
    .byType('class')
    .find((c) => c.casterProgression === progression && Array.isArray(c[field])) as
    | Json
    | undefined;
}

function Basics({ draft, change, readOnly, registry }: EditorProps) {
  const start = startOf(draft);
  const setStart = (patch: Json) => {
    const next: Json = { ...start, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    change({ startingProficiencies: next });
  };
  const words = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map((x) => x.toLowerCase());
  const armor = words(start.armor);
  const weapons = words(start.weapons);
  const skills = skillChoice(start);
  const faces = isRecord(draft.hd) && typeof draft.hd.faces === 'number' ? draft.hd.faces : 0;
  const progression = typeof draft.casterProgression === 'string' ? draft.casterProgression : '';
  const prepares = !Array.isArray(draft.spellsKnownProgression);

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
    // A class new to spells starts from the counts of one in the data that
    // casts the same way, to change level by level in the table.
    const field = prepares ? 'preparedSpellsProgression' : 'spellsKnownProgression';
    const like = countsFrom(registry, p, field);
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

  return (
    <>
      <Section title="Hit points and proficiencies">
        {readOnly ? (
          <p className="text-body">d{faces || '?'} hit die</p>
        ) : (
          <SegmentedControl
            label="Hit die"
            block
            value={String(faces)}
            onChange={(v) => change({ hd: { number: 1, faces: Number(v) } })}
            options={DICE.map((d) => ({ value: String(d), label: `d${d}` }))}
          />
        )}
        <ChipPicks
          label="Saving throws, usually two"
          options={ABILITY_WORDS}
          value={words(draft.proficiency)}
          disabled={readOnly}
          onChange={(v) => change({ proficiency: v.length > 0 ? v : undefined })}
        />
        <ChipPicks
          label="Armor"
          options={ARMOR}
          value={armor}
          disabled={readOnly}
          onChange={(v) => {
            const list = withPicks(start.armor, ['light', 'medium', 'heavy', 'shield'], v);
            setStart({
              armor: list.length > 0 ? list : undefined,
              // The same list as the 2024 books also write it, kept in step.
              ...(start.armorProficiencies !== undefined
                ? {
                    armorProficiencies:
                      v.length > 0 ? [Object.fromEntries(v.map((a) => [a, true]))] : undefined,
                  }
                : {}),
            });
          }}
        />
        <ChipPicks
          label="Weapons"
          options={WEAPONS}
          value={weapons}
          disabled={readOnly}
          onChange={(v) => {
            const list = withPicks(start.weapons, ['simple', 'martial'], v);
            setStart({ weapons: list.length > 0 ? list : undefined });
          }}
        />
        {skills === null ? (
          <Kept label="Skills">kept as {String(draft.name || 'the original')} has them.</Kept>
        ) : (
          <>
            <NumberField
              label="Skills to choose"
              value={skills?.count}
              disabled={readOnly}
              onChange={(count) =>
                setStart({
                  skills:
                    count === undefined || count === 0
                      ? undefined
                      : [{ choose: { from: skills?.from ?? [], count } }],
                })
              }
            />
            {skills !== undefined && (
              <ChipPicks
                label="Chosen from"
                options={SKILL_WORDS}
                value={skills.from.map((s) => s.toLowerCase())}
                disabled={readOnly}
                onChange={(from) =>
                  setStart({ skills: [{ choose: { from, count: skills.count } }] })
                }
              />
            )}
          </>
        )}
      </Section>
      <Section title="Spellcasting">
        <Field label="Spellcasting">
          <Select
            value={progression}
            disabled={readOnly}
            onChange={(e) => setCasting(e.target.value)}
          >
            {CASTING.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {progression !== '' && (
          <>
            <Field label="Casts with">
              <Select
                value={
                  typeof draft.spellcastingAbility === 'string' ? draft.spellcastingAbility : ''
                }
                disabled={readOnly}
                onChange={(e) => change({ spellcastingAbility: e.target.value || undefined })}
              >
                <option value="">Pick an ability</option>
                {ABILITY_WORDS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
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
            <label className="flex min-h-tap items-center gap-2.5 text-body">
              <input
                type="checkbox"
                className="size-4.5 accent-ink"
                disabled={readOnly}
                checked={Array.isArray(draft.cantripProgression)}
                onChange={(e) =>
                  change({
                    cantripProgression: e.target.checked
                      ? (countsFrom(registry, progression, 'cantripProgression')
                          ?.cantripProgression ?? LEVELS.map(() => 2))
                      : undefined,
                  })
                }
              />
              Knows cantrips
            </label>
            {typeof draft.preparedSpells === 'string' && (
              <Kept label="Prepared spells">
                {plainEntryText(
                  draft.preparedSpells.replaceAll(/<\$(\w+)\$>/g, (_, w: string) =>
                    w === 'level' ? 'level' : `${w.replace('_mod', '').toUpperCase()} modifier`,
                  ),
                )}
                , as the original has it.
              </Kept>
            )}
            <p className="text-caption text-ink-muted">
              Set cantrips and spells for each level in the table.
            </p>
          </>
        )}
      </Section>
    </>
  );
}

/** The pools' names and rests, under the table; their numbers are set in its rows. */
function Pools({ draft, change, readOnly }: Pick<EditorProps, 'draft' | 'change' | 'readOnly'>) {
  const all = effectsOf(draft);
  const pools = all.filter(isPool);
  const set = (next: StoredEffect[]) => {
    const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
    const { effects: _, ...rest } = g;
    const out: Json = { v: 1, ...rest, ...(next.length > 0 ? { effects: next } : {}) };
    change({ castGuidance: Object.keys(out).some((k) => k !== 'v') ? out : undefined });
  };
  const edit = (p: StoredEffect, patch: Json) =>
    set(all.map((e) => (e === p ? ({ ...e, ...patch } as StoredEffect) : e)));
  const add = () => {
    const keys = new Set(all.map((e) => String(e.key)));
    let n = 1;
    while (keys.has(`pool-${n}`)) n++;
    set([
      ...all,
      {
        kind: 'resource',
        key: `pool-${n}`,
        label: `Pool ${n}`,
        max: { byLevel: { '1': 2 } },
        reset: 'long',
      },
    ]);
  };
  return (
    <Section title="Pools">
      <p className="text-caption text-ink-muted">
        Uses the sheet counts, like Rages or Focus Points, a column in the table. Open a level to
        set how many from that level on.
      </p>
      {pools.length > 0 && (
        <ul aria-label="Pools" className={listClass}>
          {pools.map((p) => (
            <li key={String(p.key)} className="flex flex-col gap-3 px-4 py-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="Pool name">
                    <input
                      value={String(p.label ?? '')}
                      disabled={readOnly}
                      onChange={(e) => edit(p, { label: e.target.value })}
                      className={fieldClass}
                    />
                  </Field>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove ${String(p.label || 'pool')}`}
                    onClick={() => set(all.filter((e) => e !== p))}
                    className="tap rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
                  >
                    <X size={18} aria-hidden />
                  </button>
                )}
              </div>
              <Field label={`${String(p.label || 'Pool')}: back on`}>
                <Select
                  value={p.reset === 'short' ? 'short' : 'long'}
                  disabled={readOnly}
                  onChange={(e) => edit(p, { reset: e.target.value })}
                >
                  <option value="short">A short or long rest</option>
                  <option value="long">A long rest</option>
                </Select>
              </Field>
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <Button variant="outline" size="sm" className="self-start" onClick={add}>
          <Plus size={16} aria-hidden />
          Add a pool
        </Button>
      )}
    </Section>
  );
}

/** The table's number columns: the pools, the spell counts, the top slot. */
function columnsOf(draft: Json, change: EditorProps['change']): TableColumn[] {
  const cols: TableColumn[] = [];
  const all = effectsOf(draft);
  for (const p of all.filter(isPool)) {
    const values = poolValues(p);
    cols.push({
      key: `pool:${String(p.key)}`,
      label: String(p.label || 'Pool'),
      values: values.map(String),
      set: (level, v) => {
        const max = { byLevel: asByLevel(setFrom(values, level, v)) };
        const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
        change({
          castGuidance: { ...g, effects: all.map((e) => (e === p ? { ...e, max } : e)) },
        });
      },
      numbers: values,
    });
  }
  if (typeof draft.casterProgression === 'string') {
    for (const [field, label] of [
      ['cantripProgression', 'Cantrips'],
      ['preparedSpellsProgression', 'Prepared'],
      ['spellsKnownProgression', 'Known'],
    ] as const) {
      const list = draft[field];
      if (!Array.isArray(list)) continue;
      const values = LEVELS.map((_, i) =>
        Array.isArray(list) && typeof list[i] === 'number' ? (list[i] as number) : 0,
      );
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
    const top = topSlots(draft);
    if (top !== undefined) cols.push({ key: 'slot', label: 'Top slot', values: top });
  }
  return cols;
}

/** A copy whose original is not loaded: what it lists, the original's waiting. */
function Waiting({ draft, registry }: Pick<EditorProps, 'draft' | 'registry'>) {
  const of = copiedFrom(draft)?.name ?? 'the original';
  const refs = listOf(draft)
    .map(refOf)
    .filter((r) => r !== undefined);
  if (refs.length === 0) {
    return <p className="text-body text-ink-muted">All of its features wait for {of}.</p>;
  }
  return (
    <ul aria-label="Features" className={listClass}>
      {refs.map((ref) => {
        const mine = eq(parseRef(ref).featureSource, draft.source)
          ? findFeature(registry, ref)
          : undefined;
        const g = mine !== undefined ? own(mine, 'castGuidance') : undefined;
        return (
          <FeatureRow
            key={ref}
            name={String(mine?.name ?? parseRef(ref).name)}
            noun="feature"
            meta={
              mine === undefined
                ? `Level ${parseRef(ref).level}. Shows when ${of} is loaded.`
                : `Level ${parseRef(ref).level}`
            }
            status={mine === undefined ? 'waiting' : isRecord(g) && g.basedOn ? 'changed' : 'new'}
            editing={false}
            readOnly
            onChange={() => undefined}
            onRename={() => undefined}
          />
        );
      })}
    </ul>
  );
}

/** Where a new class can start: blank, or a copy of one in the data (the board's C). */
function StartFrom({ registry }: { registry: EntityRegistry }) {
  const navigate = useNavigate();
  const classes = [...registry.byType('class')].sort((a, b) =>
    String(a.name).localeCompare(String(b.name)),
  );
  return (
    <Field label="Start from">
      <Select
        value=""
        onChange={(e) => {
          if (e.target.value !== '')
            navigate(`/workshop/copy/class/${encodeURIComponent(e.target.value)}`, {
              replace: true,
            });
        }}
      >
        <option value="">A blank class</option>
        {classes.map((c) => {
          const uid = `${String(c.name)}|${String(c.source)}`;
          return (
            <option key={uid} value={uid}>
              A copy of {String(c.name)}, {String(c.source)}
            </option>
          );
        })}
      </Select>
    </Field>
  );
}

type Tab = 'basics' | 'table' | 'subclasses';

function ClassBody(props: EditorProps) {
  const { draft, change, original, registry, readOnly } = props;
  const nodes = useMemo(
    () => (original === undefined ? [] : featureTree(original, registry)),
    [original, registry],
  );
  const isCopy = original !== undefined || isRecord(own(draft, '_copy'));
  // The class Save names as the one this copies, whose subclasses the sheet
  // offers: the official one a class of the player's own was made from.
  const ancestor = original === undefined ? undefined : basedOnKey(original).split('|')[0];
  const [tab, setTab] = useState<Tab>(isCopy ? 'table' : 'basics');
  const [changing, setChanging] = useState<ReadonlySet<string>>(() => new Set());
  if (original === undefined && isRecord(own(draft, '_copy'))) {
    return (
      <Section title="Features">
        <Waiting draft={draft} registry={registry} />
      </Section>
    );
  }
  const edits = editsOf(draft);
  const set = (patch: Partial<FeatureEdits>) => change({ [KEY]: { ...edits, ...patch } });
  const mark = (ref: string, on: boolean) =>
    setChanging((s) => {
      const next = new Set(s);
      if (on) next.add(ref);
      else next.delete(ref);
      return next;
    });
  const withoutChange = (ref: string) => {
    const { [ref]: _, ...changed } = edits.changed;
    return changed;
  };
  /** A feature and those its text holds, which go and come back with it. */
  const withHeld = (n: FeatureNode): string[] => [
    n.ref,
    ...nodes.filter((k) => k.parent === n.ref).flatMap(withHeld),
  ];
  const setMode = async (n: FeatureNode, mode: 'keep' | 'change' | 'remove') => {
    const name = String(n.entity?.name ?? '');
    const all = withHeld(n);
    if (mode === 'remove') {
      set({ removed: [...new Set([...edits.removed, ...all])], changed: withoutChange(n.ref) });
      return mark(n.ref, false);
    }
    const removed = edits.removed.includes(n.ref)
      ? edits.removed.filter((r) => !all.includes(r))
      : edits.removed;
    if (mode === 'keep' && changedOf(edits, n) !== undefined) {
      const ok = await askConfirm({
        title: `Go back to the original ${name}?`,
        detail: 'Your changes to it are lost.',
        confirmLabel: 'Go back',
      });
      if (!ok) return;
    }
    if (mode === 'keep') set({ removed, changed: withoutChange(n.ref) });
    else if (removed.length !== edits.removed.length) set({ removed });
    mark(n.ref, mode === 'change');
  };
  const add = (level: number, extra: Json = {}) => {
    const taken = new Set(edits.added.map((a) => String(a.name)));
    let k = 1;
    let name = 'New feature';
    while (taken.has(name)) name = `New feature ${++k}`;
    set({ added: [...edits.added, { name, level, entries: [], ...extra }] });
  };
  const setAdded = (i: number, next: Json) =>
    set({ added: edits.added.map((a, j) => (j === i ? next : a)) });
  const pools = poolsOf(draft);
  /** "Part of Monk's Focus": a feature the text of another holds. */
  const heldIn = (n: FeatureNode): string | undefined => {
    const p = n.parent === undefined ? undefined : nodes.find((k) => k.ref === n.parent);
    if (p === undefined) return undefined;
    return `Part of ${String((edits.changed[p.ref] ?? p.base).name ?? p.entity?.name)}`;
  };
  /** A new feature's line: one another holds says which (see HOLDS). */
  const addedMeta = (a: Json): string => {
    const was = a[WAS];
    const holder = edits.added.find((h) => {
      const holds = h[HOLDS];
      return isRecord(holds) && Array.isArray(holds.kids) && holds.kids.includes(was);
    });
    if (typeof was === 'string' && holder !== undefined)
      return `Your own feature, part of ${String(holder.name ?? '')}`;
    return a[SUB] === true ? 'Your own feature, a subclass level' : 'Your own feature';
  };

  /** The names at a level, as its row shows them. */
  const namesAt = (level: number) => [
    ...nodes
      .filter(
        (n) => n.level === level && n.entity !== undefined && statusOf(edits, n) !== 'removed',
      )
      .map((n) => String((edits.changed[n.ref] ?? n.base).name)),
    ...edits.added.filter((a) => Number(a.level) === level).map((a) => String(a.name ?? '')),
  ];
  const subAt = (level: number) =>
    nodes.some(
      (n) =>
        n.level === level &&
        isRecord(n.item) &&
        n.item[SUB] === true &&
        statusOf(edits, n) !== 'removed',
    ) || edits.added.some((a) => Number(a.level) === level && a[SUB] === true);

  const featuresAt = (level: number): ReactNode => (
    <>
      <ul aria-label={`Level ${level} features`} className={listClass}>
        {nodes
          .filter((n) => n.level === level && n.entity !== undefined)
          .map((n) => {
            const status = statusOf(edits, n);
            const value = edits.changed[n.ref] ?? n.base;
            return (
              <FeatureRow
                key={n.ref}
                name={String(status === 'removed' ? n.entity?.name : value.name)}
                noun="feature"
                meta={heldIn(n)}
                status={status}
                value={value}
                editing={status === 'changed' || (status === 'kept' && changing.has(n.ref))}
                readOnly={readOnly}
                foldable
                onMode={(m) => void setMode(n, m)}
                withEffects
                inherits={String(n.entity?.name)}
                resources={pools}
                onChange={(next) => set({ changed: { ...edits.changed, [n.ref]: next } })}
                onRename={(name) =>
                  set({ changed: { ...edits.changed, [n.ref]: { ...value, name } } })
                }
              />
            );
          })}
        {edits.added.map((a, i) =>
          Number(a.level) === level ? (
            <FeatureRow
              // biome-ignore lint/suspicious/noArrayIndexKey: added features have no other identity while their names are typed.
              key={`new:${i}`}
              name={String(a.name ?? '')}
              noun="feature"
              meta={addedMeta(a)}
              status="new"
              value={a}
              editing
              readOnly={readOnly}
              foldable
              withEffects
              resources={pools}
              onDelete={() => set({ added: edits.added.filter((_, j) => j !== i) })}
              onChange={(next) => setAdded(i, next)}
              onRename={(name) => setAdded(i, { ...a, name })}
            >
              <Field label="Level">
                <Select
                  value={String(a.level)}
                  disabled={readOnly}
                  onChange={(e) => setAdded(i, { ...a, level: Number(e.target.value) })}
                >
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            </FeatureRow>
          ) : null,
        )}
      </ul>
      {!readOnly && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => add(level)}>
          <Plus size={16} aria-hidden />
          Add a feature at level {level}
        </Button>
      )}
    </>
  );

  const title = String(draft.subclassTitle ?? '').trim();
  const toggleSub = (level: number) => {
    if (subAt(level)) {
      const mine = edits.added.findIndex((a) => Number(a.level) === level && a[SUB] === true);
      if (mine !== -1) return set({ added: edits.added.filter((_, j) => j !== mine) });
      const theirs = nodes.find(
        (n) => n.level === level && isRecord(n.item) && n.item[SUB] === true,
      );
      if (theirs !== undefined) void setMode(theirs, 'remove');
      return;
    }
    const first = !LEVELS.some((l) => l < level && subAt(l));
    add(level, {
      name: `${title || 'Subclass'}${first ? '' : ' feature'}`,
      [SUB]: true,
      entries: [
        first
          ? `You gain a ${title || 'subclass'} of your choice.`
          : `You gain a feature from your ${title || 'subclass'}.`,
      ],
    });
  };
  const subs = registry
    .byType('subclass')
    .filter((s) => eq(s.className, draft.name) && eq(s.classSource, draft.source) && draft.source);

  return (
    <>
      {!isCopy && !readOnly && <StartFrom registry={registry} />}
      <SegmentedControl<Tab>
        label="Part of the class"
        block
        value={tab}
        onChange={setTab}
        options={[
          { value: 'basics', label: 'Basics' },
          { value: 'table', label: 'Table' },
          { value: 'subclasses', label: 'Subclasses' },
        ]}
      />
      {tab === 'basics' && <Basics {...props} />}
      {tab === 'table' && (
        <>
          <Suspense fallback={<p className="text-body text-ink-muted">Loading the table…</p>}>
            <ClassTable
              name={String(draft.name || 'Your class')}
              columns={columnsOf(draft, change)}
              book={bookAt(draft)}
              namesAt={namesAt}
              subAt={subAt}
              readOnly={readOnly}
            >
              {featuresAt}
            </ClassTable>
          </Suspense>
          <Pools draft={draft} change={change} readOnly={readOnly} />
        </>
      )}
      {tab === 'subclasses' && (
        <>
          <Section title="Subclasses">
            <Field label="What it calls its subclass">
              <input
                value={String(draft.subclassTitle ?? '')}
                disabled={readOnly}
                placeholder="Warden Order"
                onChange={(e) => change({ subclassTitle: e.target.value || undefined })}
                className={fieldClass}
              />
            </Field>
            <ChipPicks
              label="Levels with a subclass feature"
              options={LEVELS.map((l) => [String(l), String(l)] as const)}
              value={LEVELS.filter(subAt).map(String)}
              disabled={readOnly}
              onChange={(v) => {
                const now = LEVELS.filter(subAt).map(String);
                const flip = [
                  ...v.filter((l) => !now.includes(l)),
                  ...now.filter((l) => !v.includes(l)),
                ];
                for (const l of flip) toggleSub(Number(l));
              }}
            />
          </Section>
          <Section title={`Your subclasses for ${String(draft.name || 'it')}`}>
            {subs.length === 0 ? (
              <p className="text-body text-ink-muted">
                None yet. Save the class, then make a subclass in the Workshop and pick this class
                for it.
              </p>
            ) : (
              <ul className={listClass}>
                {subs.map((s) => (
                  <li key={`${String(s.name)}|${String(s.source)}`}>
                    <Link
                      to={`/workshop/edit/subclass/${encodeURIComponent(`${String(s.name)}|${String(s.source)}`)}`}
                      className="flex min-h-14 items-center px-4 py-2 text-body-strong hover:bg-surface-hover"
                    >
                      {String(s.name)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {original !== undefined && (
              <p className="flex items-start gap-2 rounded-control bg-surface-raised px-3 py-2 text-caption">
                <Info size={16} aria-hidden className="mt-px shrink-0 text-ink-muted" />
                {ancestor === undefined || eq(ancestor, original.name)
                  ? `${String(original.name)}'s own subclasses stay with it, and a character of this class can take them too.`
                  : `${String(original.name)}'s own subclasses stay with it. A character of this class can take ${ancestor}'s, the class ${String(original.name)} was made from.`}
              </p>
            )}
          </Section>
        </>
      )}
    </>
  );
}

/** A new class's head start: ability score improvements where the books have them. */
function blank(): Json {
  const asi = [4, 8, 12, 16, 19].map((level) => ({
    name: 'Ability Score Improvement',
    level,
    entries: ['Increase one ability score by 2, or two by 1, or take a feat instead.'],
  }));
  return {
    [KEY]: { changed: {}, removed: [], added: asi },
    hd: { number: 1, faces: 8 },
    classFeatures: [],
  };
}

export const editor: EditorSpec = {
  noun: 'class',
  blank,
  Body: ClassBody,
  check,
  open: openClass,
  write: writeClass,
  summary: summarize,
};
