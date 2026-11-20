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
import { Link, useLocation, useNavigate } from 'react-router';
import { plainEntryText } from '@/data5e/entries/plainText';
import { useTypePacks } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { EFFECT_EDITIONS, isRecord, own, type StoredEffect } from '@/engine/castGuidance';
import { SKILLS } from '@/engine/types';
import { Button } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { listClass } from '@/ui/surfaces';
import { fieldClass } from '@/ui/TextField';
import type { TableColumn } from '../ClassTable';
import {
  asByLevel,
  belowChanges,
  bookAt,
  byLevelValues,
  HeldCount,
  LEVELS,
  LevelSpells,
  OPENED,
  Spellcasting,
  setFrom,
  spellBase,
  spellColumns,
  spellGroupsFor,
  twenty,
  withOpened,
} from '../classFields';
import { basedOnKey, changeCount, copiedFrom, readStored, same, writeEntry } from '../copyWriter';
import {
  amendPatch,
  BY_LEVEL,
  EffectCards,
  editionBox,
  editionOf,
  firstWords,
  guidanceWith,
  isByLevel,
} from '../EffectCards';
import type { EditorProps, EditorSpec, Json, WriteContext, Written } from '../editorTypes';
import { FeatureRow, type FeatureStatus } from '../FeatureRow';
import { ABILITY_WORDS, ChipPicks, Field, Kept, Section, Select } from '../fields';
import { HeldNumber, NamesBox, OnSheet } from '../originFields';

export { asByLevel, bookAt, byLevelValues, LEVELS, setFrom };

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

const poolValues = (p: StoredEffect) => byLevelValues(own(p.max as Json, 'byLevel'));

/**
 * A pool's name as the table and its boxes show it: with the rules version it
 * counts under alone (`edition`), so a pool given once for each version shows
 * as two columns, "Channel Divinity (2014 rules)" and "(2024 rules)".
 */
function poolName(p: StoredEffect, label: unknown = p.label || 'Pool'): string {
  const name = firstWords(label);
  const edition = editionOf(p);
  return edition === undefined ? name : `${name} (${edition} rules)`;
}

/** The column Save adds to the class table for the pools. */
function poolGroup(pools: readonly StoredEffect[]): Json {
  const values = pools.map(poolValues);
  return {
    colLabels: pools.map((p) => poolName(p, p.label ?? 'Pool')),
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

/**
 * The class table Save writes: its spell columns and slots made to match the
 * spellcasting the class now has (where that changed, or for a new class),
 * and the pools' column added.
 */
export function tableGroupsFor(draft: Json, original: Json | undefined): unknown[] | undefined {
  const groups: Json[] = spellGroupsFor(draft, original);
  const pools = poolsOf(draft);
  if (pools.length > 0) groups.push(poolGroup(pools));
  return groups.length > 0 ? groups : undefined;
}

// ---------------------------------------------------------------------------
// Opening and saving
// ---------------------------------------------------------------------------

/**
 * The draft a class opens on: `_features` worked out by walking what the entry
 * lists against the original's features (as the subclass editor does), its
 * table without the pools' column, which Save writes again, and the spell
 * fields its table was made for (`OPENED`).
 */
export const openClass = (
  entry: Json,
  at: { original?: Json; registry: EntityRegistry; file?: Json },
): Json => withOpened(openFeatures(entry, at), entry);

function openFeatures(
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
    // Against the feature below the table's change, as it was written and as
    // the merge reads it: the table's change is in the copy's own changes.
    return target === undefined
      ? findFeature(registry, ref)
      : readStored(raw, belowChanges(registry, target)).entry;
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
    // Written against the feature below the table's change, which the merge
    // resolves a `_copy` against, so the copy keeps the table's version.
    const f = writeEntry({
      original: belowChanges(registry, e),
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

  const { [KEY]: _, [OPENED]: __, ...rest } = draft;
  const groups = tableGroupsFor(rest, spellBase(draft, at, 'class'));
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
  const { [KEY]: _, [OPENED]: __, ...rest } = draft;
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
  for (const o of optionalOf(draft)) {
    const name = String(o.name ?? '').trim();
    if (name === '') return 'Every optional feature list needs a name.';
    if (!Array.isArray(o.featureType) || o.featureType.length === 0)
      return `Pick the list ${name} picks from.`;
    // The sheet gives the most a level so far has given (`progressionCount`).
    const values = optionalValues(o);
    const fewer = values.findIndex((v, i) => i > 0 && v < Math.max(...values.slice(0, i)));
    if (fewer !== -1)
      return `${name} has fewer at level ${fewer + 1} than before. The sheet keeps the most so far, so set it no lower.`;
  }
  const pools = poolsOf(draft);
  const poolNames = pools.map((p) => lower(firstWords(p.label ?? '').trim()));
  if (poolNames.some((p) => p === '')) return 'Every pool needs a name.';
  // Two pools may share a name when they count under different rules versions
  // (`edition`): one pool given once for each.
  for (const version of EFFECT_EDITIONS) {
    const live = poolNames.filter((_, i) => {
      const edition = pools[i]?.edition;
      return edition === undefined || edition === version;
    });
    if (new Set(live).size !== live.length) return 'Two pools have the same name.';
  }
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
const ABILITY_KEYS = ABILITY_WORDS.map(([k]) => k);

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

const words = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map((x) => x.toLowerCase());

/** A record with `patch` applied, a key set to undefined taken out; undefined once it is empty. */
function patched(was: Json, patch: Json): Json | undefined {
  const next: Json = { ...was, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  return Object.keys(next).length > 0 ? next : undefined;
}

const PROF_LABELS = {
  first: {
    armor: 'Armor',
    weapons: 'Weapons',
    tools: 'Tools',
    count: 'Skills to choose',
    from: 'Chosen from',
    sheet: 'the Proficiencies list when it is the first class, the skills a pick on the Build tab.',
  },
  later: {
    armor: 'Armor gained',
    weapons: 'Weapons gained',
    tools: 'Tools gained',
    count: 'Skills gained',
    from: 'Skills gained from',
    sheet:
      'the Proficiencies list when a character takes it after their first class, the skills a pick on the Build tab.',
  },
} as const;

/**
 * The armor, weapons, tools and skills a class gives as a character's first
 * (`startingProficiencies`), or taken after it
 * (`multiclassing.proficienciesGained`), as class.ts reads them.
 */
function Proficiencies({
  start,
  onChange,
  readOnly,
  as,
  of,
}: {
  start: Json;
  onChange: (next: Json | undefined) => void;
  readOnly: boolean;
  as: keyof typeof PROF_LABELS;
  of: string;
}) {
  const label = PROF_LABELS[as];
  const setStart = (patch: Json) => onChange(patched(start, patch));
  const skills = skillChoice(start);
  const tools: unknown[] = Array.isArray(start.tools) ? start.tools : [];
  const toolWords = tools.filter((t): t is string => typeof t === 'string');
  return (
    <>
      <ChipPicks
        label={label.armor}
        options={ARMOR}
        value={words(start.armor)}
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
        label={label.weapons}
        options={WEAPONS}
        value={words(start.weapons)}
        disabled={readOnly}
        onChange={(v) => {
          const list = withPicks(start.weapons, ['simple', 'martial'], v);
          setStart({ weapons: list.length > 0 ? list : undefined });
        }}
      />
      <NamesBox
        label={label.tools}
        value={toolWords.map((t) => plainEntryText(t))}
        placeholder="Thieves' tools"
        disabled={readOnly}
        onChange={(names) => {
          // A tool the data tags ("{@item thieves' tools|phb}") keeps its tag
          // while its words are as they were.
          const next = [
            ...names.map((n) => toolWords.find((t) => plainEntryText(t) === n) ?? n),
            ...tools.filter((t) => typeof t !== 'string'),
          ];
          // `toolProficiencies` says the same as keys, and nothing reads a
          // class's: it goes rather than say something else.
          setStart({ tools: next.length > 0 ? next : undefined, toolProficiencies: undefined });
        }}
      />
      {skills === null ? (
        <Kept label="Skills">kept as {of} has them.</Kept>
      ) : (
        <>
          <HeldCount
            label={label.count}
            value={skills?.count}
            disabled={readOnly}
            onChange={(count) =>
              setStart({
                skills:
                  count === undefined
                    ? undefined
                    : [{ choose: { from: skills?.from ?? [], count } }],
              })
            }
          />
          {skills !== undefined && (
            <ChipPicks
              label={label.from}
              options={SKILL_WORDS}
              value={skills.from.map((s) => s.toLowerCase())}
              disabled={readOnly}
              onChange={(from) => setStart({ skills: [{ choose: { from, count: skills.count } }] })}
            />
          )}
        </>
      )}
      <OnSheet>{label.sheet}</OnSheet>
    </>
  );
}

/** The scores a class needs to be taken after the first: all of them, or one. */
export interface Needs {
  abilities: string[];
  score: number;
  any: boolean;
}

/**
 * `multiclassing.requirements` as one score for one or more abilities, all of
 * them or one (`or`); undefined for more than that (two scores).
 */
export function needsOf(req: unknown): Needs | undefined {
  if (req === undefined || req === null) return { abilities: [], score: 13, any: false };
  if (!isRecord(req)) return undefined;
  const { or, ...base } = req;
  if (or !== undefined && (!Array.isArray(or) || Object.keys(base).length > 0)) return undefined;
  const parts: unknown[] = or === undefined ? [base] : or;
  const abilities: string[] = [];
  const scores = new Set<number>();
  for (const part of parts) {
    if (!isRecord(part)) return undefined;
    for (const [k, v] of Object.entries(part)) {
      if (!ABILITY_KEYS.includes(k) || typeof v !== 'number') return undefined;
      if (!abilities.includes(k)) abilities.push(k);
      scores.add(v);
    }
  }
  if (scores.size > 1) return undefined;
  return { abilities, score: [...scores][0] ?? 13, any: or !== undefined };
}

/** The requirements for `n`: one of them is a list of one score each, as multiclass.ts reads `or`. */
export function needsWith(n: Needs): Json | undefined {
  if (n.abilities.length === 0) return undefined;
  if (n.any && n.abilities.length > 1) return { or: n.abilities.map((a) => ({ [a]: n.score })) };
  return Object.fromEntries(n.abilities.map((a) => [a, n.score]));
}

function Multiclassing({
  draft,
  change,
  readOnly,
}: Pick<EditorProps, 'draft' | 'change' | 'readOnly'>) {
  const mc = isRecord(draft.multiclassing) ? draft.multiclassing : {};
  const setMc = (patch: Json) => change({ multiclassing: patched(mc, patch) });
  const needs = needsOf(mc.requirements);
  const of = String(draft.name || 'the original');
  const setNeeds = (patch: Partial<Needs>) =>
    needs !== undefined && setMc({ requirements: needsWith({ ...needs, ...patch }) });
  return (
    <Section title="Multiclassing">
      {needs === undefined ? (
        <Kept label="Scores it needs">kept as {of} has them.</Kept>
      ) : (
        <>
          <ChipPicks
            label="Scores it needs"
            options={ABILITY_WORDS}
            value={needs.abilities}
            disabled={readOnly}
            onChange={(abilities) => setNeeds({ abilities })}
          />
          {needs.abilities.length > 0 && (
            <HeldNumber
              label="Score needed"
              value={needs.score}
              min={1}
              disabled={readOnly}
              onChange={(score) => setNeeds({ score })}
            />
          )}
          {needs.abilities.length > 1 &&
            (readOnly ? (
              <p className="text-body">{needs.any ? 'One of them' : 'All of them'}</p>
            ) : (
              <SegmentedControl
                label="Needs"
                block
                value={needs.any ? 'any' : 'all'}
                onChange={(v) => setNeeds({ any: v === 'any' })}
                options={[
                  { value: 'all', label: 'All of them' },
                  { value: 'any', label: 'One of them' },
                ]}
              />
            ))}
          <OnSheet>
            the Build tab, under each class of a character with more than one, met or not.
          </OnSheet>
        </>
      )}
      <Proficiencies
        as="later"
        of={of}
        start={isRecord(mc.proficienciesGained) ? mc.proficienciesGained : {}}
        readOnly={readOnly}
        onChange={(next) => setMc({ proficienciesGained: next })}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Starting equipment (`startingEquipment.defaultData`, read by the creator)

/** A slot of a kind, in the creator's words for it (startingEquipment.ts). */
const GEAR_KINDS: ReadonlyArray<readonly [string, string]> = [
  ['weaponSimple', 'any simple weapon'],
  ['weaponSimpleMelee', 'any simple melee weapon'],
  ['weaponMartial', 'any martial weapon'],
  ['weaponMartialMelee', 'any martial melee weapon'],
  ['instrumentMusical', 'a musical instrument'],
  ['armorLight', 'any light armor'],
  ['setGaming', 'a gaming set'],
  ['toolArtisan', "artisan's tools"],
  ['focusSpellcastingArcane', 'an arcane focus'],
  ['focusSpellcastingDruidic', 'a druidic focus'],
  ['focusSpellcastingHoly', 'a holy symbol'],
];
const COIN: Readonly<Record<string, number>> = { gp: 100, sp: 10, cp: 1 };

/** Copper as coins, as the creator says them (`coinLabel`, kept out of its chunk): 1550 is "15 gp 5 sp". */
function coins(cp: number): string {
  const shown = Object.entries(COIN)
    .map(
      ([coin, worth], i, all) =>
        [Math.floor((cp % (all[i - 1]?.[1] ?? Infinity)) / worth), coin] as const,
    )
    .filter(([n]) => n > 0)
    .map(([n, coin]) => `${n} ${coin}`);
  return shown.length > 0 ? shown.join(' ') : '0 gp';
}

/** One piece of gear in words: "chain mail", "javelin x8", "any martial weapon", "15 gp". */
export function gearText(e: unknown): string | undefined {
  if (typeof e === 'string') return e.split('|')[0];
  if (!isRecord(e)) return undefined;
  // A count as written, 1 too: "dart x1" is on its way to "dart x10".
  const times = typeof e.quantity === 'number' ? ` x${e.quantity}` : '';
  if (typeof e.item === 'string') return `${e.item.split('|')[0]}${times}`;
  if (typeof e.special === 'string') return `${e.special}${times}`;
  const kinds =
    typeof e.equipmentType === 'string'
      ? [e.equipmentType]
      : Array.isArray(e.equipmentTypes)
        ? e.equipmentTypes.map(String)
        : [];
  if (kinds.length > 0)
    return `${kinds.map((k) => GEAR_KINDS.find(([v]) => v === k)?.[1] ?? k).join(' or ')}${times}`;
  if (typeof e.value === 'number') return coins(e.value);
  return undefined;
}

/**
 * Gear typed in words, as the creator reads it: what the option had in the
 * same words stays as it was; coins, a slot of a kind, an item the data has
 * (named as typed), or else gear by its words.
 */
export function gearFrom(text: string, was: readonly unknown[], items: readonly Json[]): unknown {
  const kept = was.find((e) => gearText(e) === text);
  if (kept !== undefined) return kept;
  const coins = /^(\d+)\s*(gp|sp|cp)$/i.exec(text);
  if (coins !== null)
    return { value: Number(coins[1]) * (COIN[String(coins[2]).toLowerCase()] ?? 1) };
  const counted = /^(.*?)\s+x\s*(\d+)$/i.exec(text);
  const name = (counted?.[1] ?? text).trim();
  const many = counted === null ? {} : { quantity: Number(counted[2]) };
  const kind = GEAR_KINDS.find(([, w]) => w.toLowerCase() === name.toLowerCase());
  if (kind !== undefined) return { equipmentType: kind[0], ...many };
  const hit = items.find((i) => String(i.name).toLowerCase() === name.toLowerCase());
  if (hit !== undefined) {
    const ref = `${name}|${String(hit.source).toLowerCase()}`;
    return counted === null ? ref : { item: ref, ...many };
  }
  return { special: name, ...many };
}

type GearGroup = Record<string, unknown[]>;

/** `defaultData` as choices of options; undefined for a shape the editor cannot show. */
export function gearGroups(raw: unknown): GearGroup[] | undefined {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return undefined;
  const out: GearGroup[] = [];
  for (const g of raw) {
    if (!isRecord(g) || !Object.values(g).every(Array.isArray)) return undefined;
    out.push(g as GearGroup);
  }
  return out;
}

function GearBox({
  label,
  list,
  items,
  disabled,
  onChange,
}: {
  label: string;
  list: readonly unknown[];
  items: readonly Json[];
  disabled: boolean;
  onChange: (next: unknown[]) => void;
}) {
  const shown = list.flatMap((e) => gearText(e) ?? []);
  const kept = list.filter((e) => gearText(e) === undefined);
  return (
    <>
      <NamesBox
        label={label}
        value={shown}
        placeholder="Chain mail, any martial weapon, 10 gp"
        disabled={disabled}
        onChange={(names) => onChange([...names.map((n) => gearFrom(n, list, items)), ...kept])}
      />
      {kept.length > 0 && <Kept label={label}>and {kept.length} more, kept as written.</Kept>}
    </>
  );
}

function StartingGear({
  draft,
  change,
  readOnly,
  registry,
}: Pick<EditorProps, 'draft' | 'change' | 'readOnly' | 'registry'>) {
  useTypePacks('item');
  const se = isRecord(draft.startingEquipment) ? draft.startingEquipment : {};
  const groups = gearGroups(se.defaultData);
  if (groups === undefined) {
    return (
      <Section title="Starting equipment">
        <Kept label="Starting equipment">
          kept as {String(draft.name || 'the original')} has it.
        </Kept>
      </Section>
    );
  }
  const items = [...registry.byType('baseitem'), ...registry.byType('item')] as Json[];
  // The book's words for the kit (`default`, `entries`) describe the old one, so they go.
  const set = (next: GearGroup[]) =>
    change({
      startingEquipment: patched(se, {
        defaultData: next.length > 0 ? next : undefined,
        default: undefined,
        entries: undefined,
      }),
    });
  const setGroup = (i: number, g: GearGroup) => set(groups.map((x, j) => (j === i ? g : x)));
  const addOption = (i: number) => {
    const g = groups[i] ?? {};
    const keys = Object.keys(g).filter((k) => k !== '_');
    const upper = keys.length === 0 || keys.some((k) => k !== k.toLowerCase());
    const letters = 'abcdefghijklmnopqrstuvwxyz'
      .split('')
      .map((l) => (upper ? l.toUpperCase() : l));
    const named: GearGroup = '_' in g ? { [letters[0] ?? 'A']: g._ ?? [] } : { ...g };
    const free = letters.find((l) => !(l in named)) ?? `${Object.keys(named).length + 1}`;
    setGroup(i, { ...named, [free]: [] });
  };
  const removeOption = (i: number, key: string) => {
    const { [key]: _, ...rest } = groups[i] ?? {};
    setGroup(i, rest);
  };
  return (
    <Section title="Starting equipment">
      {groups.length > 0 && (
        <ul aria-label="Starting equipment" className={listClass}>
          {groups.map((g, i) => {
            const keys = Object.keys(g);
            const one = keys.length === 1;
            return (
              // A choice is its place in the list.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={i} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-body-strong">
                    {one ? `Gear ${i + 1}` : `Choice ${i + 1}: one of`}
                  </p>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Remove ${one ? 'gear' : 'choice'} ${i + 1}`}
                      onClick={() => set(groups.filter((_, j) => j !== i))}
                      className="tap rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  )}
                </div>
                {keys.map((k) => (
                  <div key={k} className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      <GearBox
                        label={one ? `Gear ${i + 1}` : `Choice ${i + 1}, option ${k.toUpperCase()}`}
                        list={g[k] ?? []}
                        items={items}
                        disabled={readOnly}
                        onChange={(list) => setGroup(i, { ...g, [k]: list })}
                      />
                    </div>
                    {!readOnly && !one && (
                      <button
                        type="button"
                        aria-label={`Remove choice ${i + 1}, option ${k.toUpperCase()}`}
                        onClick={() => removeOption(i, k)}
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
                    onClick={() => addOption(i)}
                  >
                    <Plus size={16} aria-hidden />
                    {one ? 'Make it a choice' : 'Add an option'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => set([...groups, { _: [] }])}
        >
          <Plus size={16} aria-hidden />
          Add gear
        </Button>
      )}
      <OnSheet>
        the character creator's Equipment step, which gives all of each gear and one option of each
        choice.
      </OnSheet>
    </Section>
  );
}

/** The class's own effects, for the whole class: its pools are set in the table. */
function ClassEffects({
  draft,
  change,
  original,
  readOnly,
}: Pick<EditorProps, 'draft' | 'change' | 'original' | 'readOnly'>) {
  const g = isRecord(draft.castGuidance) ? draft.castGuidance : {};
  const set = (patch: Json) => change({ castGuidance: guidanceWith(draft.castGuidance, patch) });
  return (
    <Section title="What it does on the sheet">
      <p className="text-caption text-ink-muted">
        For the whole class, at every level. A feature's own effects are set on the feature, in the
        table.
      </p>
      <EffectCards
        effects={g.effects}
        hide={isPool}
        resources={poolsOf(draft)}
        readOnly={readOnly}
        inherits={original !== undefined ? String(original.name) : undefined}
        replace={g.replace === true}
        onReplace={(replace) =>
          set(replace ? { replace: true, amend: undefined } : { replace: undefined })
        }
        onChange={(effects, amend) =>
          set({ effects: effects.length > 0 ? effects : undefined, ...amendPatch(amend) })
        }
        amend={g.amend}
        onAmend={(amend) => set(amendPatch(amend))}
        moments={g.moments}
        momentName={
          typeof draft.name === 'string' && draft.name.trim() !== '' ? draft.name : undefined
        }
        onMoments={(moments, effects) =>
          set({
            moments: moments.length > 0 ? moments : undefined,
            ...(effects === undefined ? {} : { effects: effects.length > 0 ? effects : undefined }),
          })
        }
      />
    </Section>
  );
}

function Basics(props: EditorProps) {
  const { draft, change, readOnly, registry } = props;
  const faces = isRecord(draft.hd) && typeof draft.hd.faces === 'number' ? draft.hd.faces : 0;
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
        <Proficiencies
          as="first"
          of={String(draft.name || 'the original')}
          start={startOf(draft)}
          readOnly={readOnly}
          onChange={(next) => change({ startingProficiencies: next })}
        />
      </Section>
      <Multiclassing draft={draft} change={change} readOnly={readOnly} />
      <StartingGear draft={draft} change={change} readOnly={readOnly} registry={registry} />
      <Section title="Spellcasting">
        <Spellcasting
          draft={draft}
          change={change}
          readOnly={readOnly}
          registry={registry}
          type="class"
          label="Spellcasting"
        />
      </Section>
      <Section title="Spells it gives">
        <LevelSpells
          raw={draft.additionalSpells}
          onChange={(next) => change({ additionalSpells: next })}
          registry={registry}
          readOnly={readOnly}
          first={1}
          of="the class"
        />
      </Section>
      <ClassEffects {...props} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Optional features by level (`optionalfeatureProgression`, read by optionalFeatures.ts)

/** The lists the books' optional features are on (as the optional feature editor names them). */
const OPTION_LISTS: ReadonlyArray<readonly [string, string]> = [
  ['EI', 'Eldritch invocation'],
  ['MV:B', 'Battle Master maneuver'],
  ['FS:F', 'Fighter fighting style'],
  ['FS:P', 'Paladin fighting style'],
  ['FS:R', 'Ranger fighting style'],
  ['FS:B', 'Bard fighting style'],
  ['MM', 'Metamagic'],
  ['PB', 'Pact boon'],
  ['AI', 'Artificer infusion'],
  ['AS', 'Arcane shot'],
  ['ED', 'Elemental discipline'],
  ['RN', 'Rune'],
  ['RP', 'Replicate magic item'],
];

const optionalOf = (draft: Json): Json[] =>
  Array.isArray(draft.optionalfeatureProgression)
    ? draft.optionalfeatureProgression.filter(isRecord)
    : [];

/**
 * How many at each level: a list of twenty, or a table by level, as the sheet
 * reads both; its `*` is every level, so level 1 on.
 */
export function optionalValues(o: Json): number[] {
  if (Array.isArray(o.progression)) return twenty(o.progression);
  if (!isRecord(o.progression)) return byLevelValues(undefined);
  const { '*': all, ...rest } = o.progression;
  if (typeof all !== 'number') return byLevelValues(rest);
  return byLevelValues(rest).map((v) => Math.max(v, all));
}

/** The table's columns for the optional features, set level by level. */
function optionalColumns(draft: Json, change: EditorProps['change']): TableColumn[] {
  const all = optionalOf(draft);
  return all.map((o, i) => {
    const values = optionalValues(o);
    return {
      key: `optional:${i}`,
      label: String(o.name || 'Optional features'),
      values: values.map(String),
      numbers: values,
      set: (level, v) => {
        const next = setFrom(values, level, v);
        // The shape it had stays: a list of twenty, or the levels where it changes.
        const progression = Array.isArray(o.progression) ? next : asByLevel(next);
        change({
          optionalfeatureProgression: all.map((x) => (x === o ? { ...o, progression } : x)),
        });
      },
    };
  });
}

/** The optional features' names and lists, under the table; their numbers are set in its rows. */
function OptionalFeatures({
  draft,
  change,
  readOnly,
  registry,
}: Pick<EditorProps, 'draft' | 'change' | 'readOnly' | 'registry'>) {
  const all = optionalOf(draft);
  const set = (next: Json[]) =>
    change({ optionalfeatureProgression: next.length > 0 ? next : undefined });
  const edit = (o: Json, patch: Json) => set(all.map((x) => (x === o ? { ...o, ...patch } : x)));
  // The books' lists, and any other a loaded optional feature or this class names.
  const named = new Set(OPTION_LISTS.map(([k]) => k));
  const others = new Set(
    [...registry.byType('optionalfeature'), ...all]
      .flatMap((f) => (Array.isArray(f.featureType) ? f.featureType.map(String) : []))
      .filter((k) => !named.has(k)),
  );
  const options = [...OPTION_LISTS, ...[...others].map((k) => [k, k] as const)];
  const add = () => {
    const taken = new Set(all.map((o) => String(o.name)));
    let k = 1;
    let name = 'Optional features';
    while (taken.has(name)) name = `Optional features ${++k}`;
    set([...all, { name, featureType: [], progression: { '1': 1 } }]);
  };
  return (
    <Section title="Optional features">
      <p className="text-caption text-ink-muted">
        Picks from a list, like Eldritch Invocations or Maneuvers, a column in the table. Open a
        level to set how many from that level on.
      </p>
      {all.length > 0 && (
        <ul aria-label="Optional features" className={listClass}>
          {all.map((o, i) => {
            const name = String(o.name || 'Optional features');
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: their names are typed.
              <li key={i} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label="Optional feature name">
                      <input
                        value={String(o.name ?? '')}
                        disabled={readOnly}
                        onChange={(e) => edit(o, { name: e.target.value })}
                        className={fieldClass}
                      />
                    </Field>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => set(all.filter((x) => x !== o))}
                      className="tap rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  )}
                </div>
                <ChipPicks
                  label={`${name}: picks from`}
                  options={options}
                  value={Array.isArray(o.featureType) ? o.featureType.map(String) : []}
                  disabled={readOnly}
                  onChange={(featureType) => edit(o, { featureType })}
                />
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <Button variant="outline" size="sm" className="self-start" onClick={add}>
          <Plus size={16} aria-hidden />
          Add optional features
        </Button>
      )}
      <OnSheet>
        a pick on the Build tab for each one it has at its level, from the optional features on
        those lists.
      </OnSheet>
    </Section>
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
  // A pool given once for each rules version is one pool: one name for both.
  const rename = (p: StoredEffect, label: string) =>
    set(all.map((e) => (e.kind === 'resource' && e.key === p.key ? { ...e, label } : e)));
  const setEdition = (p: StoredEffect, edition: string) => {
    const { edition: _, ...rest } = p;
    set(
      all.map((e) =>
        e === p ? ((edition === '' ? rest : { ...rest, edition }) as StoredEffect) : e,
      ),
    );
  };
  /**
   * The rules version a pool of one version alone has no half for yet, if any.
   * A pool of that version under its key or its name is its half.
   */
  const missingHalf = (p: StoredEffect) => {
    const edition = editionOf(p);
    const other = EFFECT_EDITIONS.find((v) => v !== edition);
    const name = lower(firstWords(p.label ?? '').trim());
    const half = (x: StoredEffect) =>
      x.edition === other && (x.key === p.key || lower(firstWords(x.label ?? '').trim()) === name);
    return edition === undefined || pools.some(half) ? undefined : other;
  };
  // The other version's half: the same pool, its numbers then set in the table.
  const addHalf = (p: StoredEffect, edition: string) => {
    const at = all.indexOf(p);
    set([...all.slice(0, at + 1), { ...p, edition } as StoredEffect, ...all.slice(at + 1)]);
  };
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
          {pools.map((p, i) => {
            const half = missingHalf(p);
            return (
              // A pool given once for each rules version shares its key with its other half.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <li key={i} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <Field label="Pool name">
                      <input
                        value={isByLevel(p.label) ? '' : String(p.label ?? '')}
                        placeholder={isByLevel(p.label) ? BY_LEVEL : undefined}
                        disabled={readOnly}
                        onChange={(e) => rename(p, e.target.value)}
                        className={fieldClass}
                      />
                    </Field>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Remove ${poolName(p, p.label || 'pool')}`}
                      onClick={() => set(all.filter((e) => e !== p))}
                      className="tap rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  <Field label={`${poolName(p)}: back on`}>
                    <Select
                      value={isByLevel(p.reset) ? '' : p.reset === 'short' ? 'short' : 'long'}
                      disabled={readOnly}
                      onChange={(e) => edit(p, { reset: e.target.value })}
                    >
                      {isByLevel(p.reset) && <option value="">{BY_LEVEL}</option>}
                      <option value="short">A short or long rest</option>
                      <option value="long">A long rest</option>
                    </Select>
                  </Field>
                  <Field label={`${poolName(p)}: rules`}>
                    <Select
                      value={editionBox(p).value}
                      disabled={readOnly}
                      onChange={(e) => setEdition(p, e.target.value)}
                    >
                      {editionBox(p).options.map(([v, text]) => (
                        <option key={v} value={v}>
                          {text}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {!readOnly && half !== undefined && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => addHalf(p, half)}
                  >
                    <Plus size={16} aria-hidden />
                    Add its {half} rules version
                  </Button>
                )}
              </li>
            );
          })}
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

/** The table's number columns: the pools, the optional features, the spell counts, the top slot. */
function columnsOf(draft: Json, change: EditorProps['change']): TableColumn[] {
  const cols: TableColumn[] = [];
  const all = effectsOf(draft);
  // Its place too: both halves of a pool can be set to one version.
  for (const [i, p] of all.filter(isPool).entries()) {
    const values = poolValues(p);
    cols.push({
      key: `pool:${i}:${String(p.key)}`,
      label: poolName(p),
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
  return [...cols, ...optionalColumns(draft, change), ...spellColumns(draft, change)];
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
  // A class begun in one of the player's files (`?file=`) is copied into it too.
  const file = new URLSearchParams(useLocation().search).get('file');
  const into = file === null ? '' : `?file=${encodeURIComponent(file)}`;
  const classes = [...registry.byType('class')].sort((a, b) =>
    String(a.name).localeCompare(String(b.name)),
  );
  return (
    <Field label="Start from">
      <Select
        value=""
        onChange={(e) => {
          if (e.target.value !== '')
            navigate(`/workshop/copy/class/${encodeURIComponent(e.target.value)}${into}`, {
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
          <OptionalFeatures draft={draft} change={change} readOnly={readOnly} registry={registry} />
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
