/**
 * What importing a homebrew file would do, worked out before anything is
 * written (IMP-002). Pure: the caller gathers the prepared row, the files
 * already here, the official data and the roster, and this only reads them.
 *
 * It answers the questions the issue lists: is this file already here, what
 * does it depend on and is that available, what does it clash with and which
 * side wins, which `_copy` references will not resolve (and which broken ones
 * elsewhere it fixes), how big is it, and which characters use its sources.
 * None of it blocks an import (guidance, not gatekeeping); it is what the
 * preview shows before the player decides.
 *
 * The rules mirror the registry (`mergeHomebrew`): homebrew merges oldest
 * import first and the first entity per identity wins, while a `_copy` looks
 * in its own file, then official data, then every other enabled file, so
 * whether a copy resolves does not depend on import order.
 */
import { type Entity, uidOf } from '@/data5e/copyMod';
import { ENTITY_TYPES, type EntityRegistry, type EntityType } from '@/data5e/normalize';
import { packGuidance, packName, packReach, packRefusals, packsInOrder } from '@/data5e/rulePack';
import type { HomebrewFileRow } from '@/db/db';
import { bookKey, oldWholeImports, sameBookCopy } from '@/db/homebrewBooks';
import { compareMergeOrder, type MergeOrderKey } from '@/db/homebrewOrder';
import type { HomebrewFile } from '@/db/homebrewRepo';
import {
  CAST_GUIDANCE_LIMITS,
  clip,
  guidanceVersion,
  own,
  PACK_PARTS,
  type PackAppliesTo,
  RULE_PACK_TYPE,
  readTableRules,
  TABLE_RULES,
  type TableRuleChoices,
  type TableRuleId,
} from '@/engine/castGuidance';
import { readPack } from '@/engine/effects/mechanics';
import { readPackMoments } from '@/engine/moments';
import { appRulesFor, ruleSources } from '@/engine/rules';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import {
  collectCharacterRefs,
  collectCharacterSources,
} from '@/features/characters/homebrewExport';
import { HOMEBREW_ENTITY_KEYS, IMPORT_LIMITS } from '@/lib/guards';

/**
 * How a `name|source` tie is settled, worded for the player. It has to match
 * what the registry does: entries with the same name and source share one
 * identity, so whichever wins is the one every character gets.
 */
export const WINNER_POLICY =
  'Official content wins over homebrew with the same name and source. Between homebrew files, ' +
  'the one imported first wins, and only its version is listed. Entries with the same name and ' +
  'source count as one, so a character that picks either gets the winning version.';

/** The most clashes a preview lists per kind; the totals keep the full counts. */
export const MAX_LISTED_COLLISIONS = 50;

/**
 * The official entities and sources the registry holds, reduced to what a
 * preview needs. `complete` is false until every pack has landed (the
 * download may be running, stopped or not begun): something not found yet
 * may only be in a pack that has not arrived.
 */
export interface OfficialIndex {
  /** Lowercased `name|source` per type: what a `_copy` resolves against. */
  uids: Map<EntityType, Set<string>>;
  /** {@link clashKey} per type: what decides which entry a character gets. */
  clashKeys: Map<EntityType, Set<string>>;
  /** Lowercased source ids. */
  sources: Set<string>;
  complete: boolean;
}

/**
 * The identity the engine looks an entry up by, lowercased, or undefined for
 * an entry that cannot be looked up that way (so it cannot clash).
 *
 * Most types resolve by `name|source`. Class and subclass features do not:
 * the class builder finds them by the fields their references carry
 * (`findClassFeature` and `findSubclassFeature` in
 * `src/engine/effects/class.ts`), taking the first match in list order. Two
 * features that share a name and source but belong to different classes or
 * levels never shadow each other, so they are keyed the same way here. A
 * class feature reference may leave its source out and then matches any
 * source; keying on the source anyway means every clash reported is one every
 * reference sees, at the cost of not flagging the looser case.
 */
export function clashKey(type: EntityType, e: Entity): string | undefined {
  const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const name = text(e.name);
  if (name === undefined) return undefined;
  if (type === 'classFeature') {
    const parts = [name, text(e.className), text(e.classSource), e.level, text(e.source)];
    return typeof e.level === 'number' && parts.every((p) => p !== undefined)
      ? parts.join('|').toLowerCase()
      : undefined;
  }
  if (type === 'subclassFeature') {
    const parts = [
      name,
      text(e.className),
      text(e.subclassShortName),
      text(e.subclassSource),
      e.level,
    ];
    return typeof e.level === 'number' && parts.every((p) => p !== undefined)
      ? parts.join('|').toLowerCase()
      : undefined;
  }
  return text(e.source) === undefined ? undefined : uidOf(e);
}

/**
 * One index per registry instance. A registry is only handed out once its
 * homebrew is merged (`getRegistry` merges before it publishes), so its
 * official part never changes afterwards and the index can be reused by every
 * preview that registry serves.
 */
const indexCache = new WeakMap<EntityRegistry, Omit<OfficialIndex, 'complete'>>();

/**
 * Build the official index from a registry. Only the front of each type's
 * list is official (`officialCount`); the rest is homebrew merged after it,
 * which must not count as official here. Sources are read from those same
 * entities across every type rather than from `sourceCounts()`, which skips
 * types a player does not browse and includes homebrew.
 */
export function officialIndexFrom(
  reg: EntityRegistry,
  { complete = true }: { complete?: boolean } = {},
): OfficialIndex {
  let index = indexCache.get(reg);
  if (index === undefined) {
    const uids = new Map<EntityType, Set<string>>();
    const clashKeys = new Map<EntityType, Set<string>>();
    const sources = new Set<string>();
    for (const type of ENTITY_TYPES) {
      const official = reg.byType(type).slice(0, reg.officialCount(type));
      if (official.length === 0) continue;
      const ids = new Set<string>();
      const keys = new Set<string>();
      for (const e of official) {
        ids.add(uidOf(e));
        const key = clashKey(type, e);
        if (key !== undefined) keys.add(key);
        if (typeof e.source === 'string' && e.source !== '') sources.add(e.source.toLowerCase());
      }
      uids.set(type, ids);
      clashKeys.set(type, keys);
    }
    index = { uids, clashKeys, sources };
    indexCache.set(reg, index);
  }
  return { ...index, complete };
}

export interface FileRef {
  id: string;
  fileName: string;
}

export interface EntityCollision {
  type: EntityType;
  name: string;
  source: string;
  against: 'official' | FileRef;
  /** Which side a character picking this entry gets. The new file never wins. */
  winner: 'official' | 'existing';
}

/**
 * A clash with a file that is turned off. This file's entry is used for now,
 * but the older file wins again if it is turned back on.
 */
export interface DisabledClash {
  type: EntityType;
  name: string;
  source: string;
  against: FileRef;
}

export type DependencyStatus =
  /** Official data provides it. */
  | 'official'
  /** An enabled homebrew file here declares it. */
  | 'homebrew'
  /** Only a disabled homebrew file here declares it. */
  | 'disabled'
  /**
   * Not found, but not all game data is here (still downloading, stopped, or
   * not read at all), so it may still be official.
   */
  | 'not-downloaded'
  /** Not found anywhere, and all game data is here. */
  | 'missing';

export interface Dependency {
  sourceId: string;
  status: DependencyStatus;
  /** Declared in `_meta`, or only implied by a `_copy` of another source. */
  via: 'meta' | 'copy';
}

export interface CopyIssue {
  type: EntityType;
  /** The entry doing the copying. */
  name: string;
  /** `name|source` of the target that will not resolve. */
  target: string;
  /** A turned-off file here that has the target: turning it on fixes the copy. */
  disabledIn?: FileRef;
}

/**
 * How much official data the preview could check against: all of it, only
 * what is on this device so far, or none (the registry could not be read).
 */
export type OfficialCoverage = 'complete' | 'partial' | 'unavailable';

export function officialCoverage(official: OfficialIndex | null): OfficialCoverage {
  if (official === null) return 'unavailable';
  return official.complete ? 'complete' : 'partial';
}

/** An enabled file here whose broken `_copy` entries this file would fix. */
export interface SatisfiedCopies {
  file: FileRef;
  entries: CopyIssue[];
}

export interface HomebrewPreview {
  fileName: string;
  counts: Record<string, number>;
  bytes: number;
  limitBytes: number;
  sources: { id: string; full: string }[];
  /** The same content is already here, so importing writes nothing. */
  duplicateOf?: FileRef & {
    addedAt: number;
    enabled: boolean;
    /** For a file of books: how many of its books here are turned off. */
    booksOff?: number;
  };
  /** Files here that declare a source id this file also declares. */
  sourceCollisions: { sourceId: string; files: (FileRef & { enabled: boolean })[] }[];
  /** At most {@link MAX_LISTED_COLLISIONS}; `collisionTotal` is the real count. */
  entityCollisions: EntityCollision[];
  collisionTotal: number;
  /** At most {@link MAX_LISTED_COLLISIONS}; `disabledClashTotal` is the real count. */
  disabledClashes: DisabledClash[];
  disabledClashTotal: number;
  dependencies: Dependency[];
  copyIssues: CopyIssue[];
  satisfiesCopies: SatisfiedCopies[];
  affectedCharacters: { id: string; name: string }[];
  officialCoverage: OfficialCoverage;
  notes: string[];
  /**
   * For a rule pack: what it holds, and the packs here that are on, in the
   * player's order, for the review to say what it would clash with.
   */
  pack?: PackReview;
  packsOn?: PackInPlay[];
  /** The pack coming in, as the clash check reads it once Apply to is chosen. */
  packIn?: PackInPlay;
  /** For a file stored a book at a time: each book, in the file's order. */
  books?: BookChoice[];
  /**
   * This file imported whole before it was stored a book at a time, with the
   * sources it declared. Importing replaces it, so no entry shows twice.
   */
  replacesOldImport?: (FileRef & { sourceIds: string[] })[];
  /**
   * Characters that use an entry of {@link replacesOldImport} this file does
   * not bring under the same name and source, so it goes missing.
   */
  oldImportCharacters?: { id: string; name: string }[];
}

/** One book of a file stored a book at a time, and what importing it would do. */
export interface BookChoice {
  /** The prepared row's id. */
  id: string;
  full: string;
  counts: Record<string, number>;
  /**
   * `new`: not here yet. `same`: here exactly as it is, so nothing is stored.
   * `replaces`: a copy stored before, which this one replaces.
   */
  status: 'new' | 'same' | 'replaces';
  /** For `replaces`: the file the stored copy came from. */
  replacesFrom?: string;
  /**
   * Other files here with a copy of this book. Each file keeps its own, and
   * an entry two copies both have is used once, from the one imported first.
   */
  alsoIn?: string[];
}

export interface HomebrewPreviewInput {
  /** The file, or for one stored a book at a time, the whole of it. */
  row: HomebrewFileRow;
  /** For a file stored a book at a time: one row per book. */
  books?: readonly HomebrewFileRow[];
  bytes: number;
  /** The largest file of its kind the import takes. Defaults to the JSON limit. */
  limitBytes?: number;
  /** Every homebrew file here, enabled or not (`homebrewRepo.listSafe().files`). */
  existing: readonly HomebrewFile[];
  /** Null when the registry could not be read (no game data yet). */
  official: OfficialIndex | null;
  characters: readonly CharacterDoc[];
}

/** How a file here is named to the player: one book of a file goes by the book. */
function fileLabel(f: { fileName: string; book?: string }): string {
  return f.book ?? f.fileName;
}

/**
 * What each book would do; the files here that are this file's own copies
 * of its books (stored before, or the same), which are not other files to
 * clash with, since importing replaces them or they are this file already;
 * and the copies of its books from other files, which stay.
 */
function bookChoices(
  books: readonly HomebrewFileRow[],
  existing: readonly HomebrewFile[],
): {
  choices: BookChoice[];
  ownCopies: Set<string>;
  sharedCopies: Set<string>;
  /**
   * Where each book coming in lands in merge order, by its source: a copy
   * that replaces this file's own keeps the earliest place of those copies
   * (`homebrewRepo.commitBooks`). A book new here comes after every file.
   */
  places: Map<string, MergeOrderKey>;
} {
  const byBook = new Map<string, HomebrewFile[]>();
  for (const f of existing) {
    const key = f.book === undefined ? undefined : bookKey(f);
    if (key === undefined) continue;
    const copies = byBook.get(key);
    if (copies === undefined) byBook.set(key, [f]);
    else copies.push(f);
  }
  const ownCopies = new Set<string>();
  const sharedCopies = new Set<string>();
  const places = new Map<string, MergeOrderKey>();
  const existingIds = new Set(existing.map((f) => f.id));
  const choices = books.map((b): BookChoice => {
    const copies = byBook.get(bookKey(b) ?? '') ?? [];
    const alsoIn = new Set<string>();
    let addedAt = Number.POSITIVE_INFINITY;
    for (const c of copies) {
      if (c.id === b.id || sameBookCopy(c, b)) {
        ownCopies.add(c.id);
        addedAt = Math.min(addedAt, c.addedAt);
      } else {
        sharedCopies.add(c.id);
        alsoIn.add(c.fileName);
      }
    }
    const key = bookKey(b);
    if (key !== undefined && addedAt !== Number.POSITIVE_INFINITY) {
      places.set(key, { addedAt, id: b.id });
    }
    const same = existingIds.has(b.id);
    if (same) ownCopies.add(b.id);
    const replaced = copies.find((c) => c.id !== b.id && sameBookCopy(c, b));
    const base = {
      id: b.id,
      full: b.book ?? fileLabel(b),
      counts: b.counts,
      ...(alsoIn.size === 0 ? {} : { alsoIn: [...alsoIn] }),
    };
    if (same) return { ...base, status: 'same' };
    if (replaced !== undefined)
      return { ...base, status: 'replaces', replacesFrom: replaced.fileName };
    return { ...base, status: 'new' };
  });
  return { choices, ownCopies, sharedCopies, places };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Base entities only: `_versions` expansions are left out on purpose. */
function entitiesOf(json: unknown, type: string): Entity[] {
  if (!isRecord(json)) return [];
  const arr = json[type];
  return Array.isArray(arr) ? arr.filter(isRecord) : [];
}

/** An entity with a usable name and source: a `_copy` can reach it. */
function named(e: Entity): { name: string; source: string } | undefined {
  return typeof e.name === 'string' && e.name !== '' && typeof e.source === 'string'
    ? { name: e.name, source: e.source }
    : undefined;
}

function metaSources(json: unknown): { id: string; full: string }[] {
  const meta = isRecord(json) ? json._meta : undefined;
  const sources = isRecord(meta) && Array.isArray(meta.sources) ? meta.sources : [];
  const out: { id: string; full: string }[] = [];
  for (const s of sources) {
    if (!isRecord(s) || typeof s.json !== 'string') continue;
    out.push({ id: s.json, full: typeof s.full === 'string' && s.full !== '' ? s.full : s.json });
  }
  return out;
}

/**
 * Source ids from `_meta.dependencies` and `_meta.includes`. 5etools writes
 * these as `{ [type]: sourceId[] }`; a bare array is accepted too, and
 * anything else is ignored rather than trusted.
 */
function declaredDependencies(json: unknown): string[] {
  const meta = isRecord(json) ? json._meta : undefined;
  if (!isRecord(meta)) return [];
  const out: string[] = [];
  const take = (v: unknown) => {
    if (Array.isArray(v)) for (const s of v) if (typeof s === 'string' && s !== '') out.push(s);
  };
  for (const key of ['dependencies', 'includes']) {
    const v = meta[key];
    if (Array.isArray(v)) take(v);
    else if (isRecord(v)) for (const list of Object.values(v)) take(list);
  }
  return out;
}

function copyTarget(e: Entity): { name: string; source: string } | undefined {
  const c = e._copy;
  if (!isRecord(c) || typeof c.name !== 'string' || typeof c.source !== 'string') return undefined;
  return { name: c.name, source: c.source };
}

const lower = (s: string) => s.toLowerCase();
const targetUid = (t: { name: string; source: string }) => `${t.name}|${t.source}`.toLowerCase();

/** Where each identity first appears across `files`, taken in the order given. */
function firstFileBy(
  files: readonly HomebrewFile[],
  keyOf: (type: EntityType, e: Entity) => string | undefined,
): Map<string, FileRef> {
  const out = new Map<string, FileRef>();
  for (const f of files) {
    for (const type of HOMEBREW_ENTITY_KEYS) {
      for (const e of entitiesOf(f.json, type)) {
        const key = keyOf(type, e);
        if (key === undefined) continue;
        const k = `${type}:${key}`;
        if (!out.has(k)) out.set(k, { id: f.id, fileName: fileLabel(f) });
      }
    }
  }
  return out;
}

const uidKey = (_: EntityType, e: Entity) => (named(e) === undefined ? undefined : uidOf(e));

export function previewHomebrewImport(input: HomebrewPreviewInput): HomebrewPreview {
  const { row, existing, official } = input;
  const pack = packReview(row.json);
  const ownSources = new Set(row.sourceIds.map(lower));
  const books = input.books === undefined ? undefined : bookChoices(input.books, existing);
  const oldImports = books === undefined ? [] : oldWholeImports(row.fileName, existing);
  const replaced = new Set(oldImports.map((f) => f.id));
  const others = existing.filter(
    (f) => f.id !== row.id && books?.ownCopies.has(f.id) !== true && !replaced.has(f.id),
  );
  // Merge order, so the first file found for an identity is the one that wins it.
  const enabled = others.filter((f) => f.enabled).sort(compareMergeOrder);
  const disabled = others.filter((f) => !f.enabled).sort(compareMergeOrder);
  const notes: string[] = [];
  const byId = new Map(existing.map((f) => [f.id, f]));
  // Whether `ref`, the first file here with an entry, comes ahead of where
  // `e` lands: always for a file coming in, which is the newest; for a book
  // taking its own copy's place, only a file imported before that copy.
  const ahead = (ref: FileRef, e: Entity) => {
    const place = typeof e.source === 'string' ? books?.places.get(lower(e.source)) : undefined;
    const f = byId.get(ref.id);
    return place === undefined || f === undefined || compareMergeOrder(f, place) < 0;
  };

  let duplicateOf: HomebrewPreview['duplicateOf'];
  if (books === undefined) {
    const dup = existing.find((f) => f.id === row.id);
    if (dup !== undefined) {
      duplicateOf = {
        id: dup.id,
        fileName: fileLabel(dup),
        addedAt: dup.addedAt,
        enabled: dup.enabled,
      };
    }
  } else if (books.choices.length > 0 && books.choices.every((b) => b.status === 'same')) {
    // Every book is here as it is: the file is, a book at a time.
    const chosenIds = new Set(books.choices.map((b) => b.id));
    const stored = existing.filter((f) => chosenIds.has(f.id));
    duplicateOf = {
      id: stored[0]?.id ?? '',
      fileName: row.fileName,
      // A fold, not a spread: one argument per book.
      addedAt: stored.reduce((min, f) => Math.min(min, f.addedAt), Number.POSITIVE_INFINITY),
      enabled: stored.every((f) => f.enabled),
      booksOff: stored.filter((f) => !f.enabled).length,
    };
  }

  // Another file's copy of a book is named under that book in the picker.
  const sourceCollisions = row.sourceIds
    .map((sourceId) => ({
      sourceId,
      files: others
        .filter((f) => books?.sharedCopies.has(f.id) !== true)
        .filter((f) => f.sourceIds.some((s) => lower(s) === lower(sourceId)))
        .map((f) => ({ id: f.id, fileName: fileLabel(f), enabled: f.enabled })),
    }))
    .filter((c) => c.files.length > 0);

  // Copy targets reachable in enabled files, and who wins each clash key.
  const homebrewUids = firstFileBy(enabled, uidKey);
  const enabledClashes = firstFileBy(enabled, clashKey);
  const disabledClashMap = firstFileBy(disabled, clashKey);
  const disabledUids = firstFileBy(disabled, uidKey);
  const officialHas = (type: EntityType, key: string) =>
    official?.clashKeys.get(type)?.has(key) === true;

  const collisions: EntityCollision[] = [];
  const disabledClashes: DisabledClash[] = [];
  const ownUids = new Set<string>();
  const copies: { type: EntityType; name: string; target: { name: string; source: string } }[] = [];
  for (const type of HOMEBREW_ENTITY_KEYS) {
    for (const e of entitiesOf(row.json, type)) {
      const target = copyTarget(e);
      const id = named(e);
      if (target !== undefined) copies.push({ type, name: id?.name ?? target.name, target });
      if (id !== undefined) ownUids.add(`${type}:${uidOf(e)}`);
      const key = clashKey(type, e);
      // An exact duplicate writes nothing, so it clashes with nothing.
      if (key === undefined || duplicateOf !== undefined) continue;
      const what = {
        type,
        name: String(e.name),
        source: typeof e.source === 'string' ? e.source : '',
      };
      if (officialHas(type, key)) {
        collisions.push({ ...what, against: 'official', winner: 'official' });
        continue;
      }
      const file = enabledClashes.get(`${type}:${key}`);
      if (file !== undefined && ahead(file, e)) {
        collisions.push({ ...what, against: file, winner: 'existing' });
        continue;
      }
      const off = disabledClashMap.get(`${type}:${key}`);
      if (off !== undefined && ahead(off, e)) disabledClashes.push({ ...what, against: off });
    }
  }

  const enabledSources = new Set(enabled.flatMap((f) => f.sourceIds.map(lower)));
  const disabledSources = new Set(disabled.flatMap((f) => f.sourceIds.map(lower)));
  const officialKnown = official?.complete === true;
  const statusOf = (sourceId: string): DependencyStatus => {
    const s = lower(sourceId);
    if (official?.sources.has(s) === true) return 'official';
    if (enabledSources.has(s)) return 'homebrew';
    if (disabledSources.has(s)) return 'disabled';
    return officialKnown ? 'missing' : 'not-downloaded';
  };

  const dependencies: Dependency[] = [];
  const seenDeps = new Set<string>();
  const addDependency = (sourceId: string, via: Dependency['via']) => {
    const s = lower(sourceId);
    if (ownSources.has(s) || seenDeps.has(s)) return;
    seenDeps.add(s);
    dependencies.push({ sourceId, status: statusOf(sourceId), via });
  };
  for (const sourceId of declaredDependencies(row.json)) addDependency(sourceId, 'meta');

  const copyIssues: CopyIssue[] = [];
  for (const { type, name, target } of copies) {
    const uid = targetUid(target);
    if (ownUids.has(`${type}:${uid}`)) continue;
    const resolves =
      homebrewUids.has(`${type}:${uid}`) || official?.uids.get(type)?.has(uid) === true;
    if (!ownSources.has(lower(target.source))) addDependency(target.source, 'copy');
    if (resolves) continue;
    // A target in a pack that has not downloaded yet may still resolve; one
    // the file names under its own source never will.
    if (officialKnown || ownSources.has(lower(target.source))) {
      const off = disabledUids.get(`${type}:${uid}`);
      copyIssues.push({
        type,
        name,
        target: `${target.name}|${target.source}`,
        ...(off === undefined ? {} : { disabledIn: off }),
      });
    }
  }

  // Broken copies in enabled files that this file's entries would resolve:
  // not found in their own file, official data, or any other enabled file.
  // `homebrewUids` covers every enabled file, the copying one included, so a
  // single shared lookup answers both "own file" and "elsewhere" (one pass,
  // not a fresh index of the other files for each file).
  const satisfiesCopies: SatisfiedCopies[] = [];
  if (duplicateOf === undefined) {
    for (const f of enabled) {
      const entries: CopyIssue[] = [];
      for (const type of HOMEBREW_ENTITY_KEYS) {
        for (const e of entitiesOf(f.json, type)) {
          const target = copyTarget(e);
          if (target === undefined) continue;
          const key = `${type}:${targetUid(target)}`;
          if (!ownUids.has(key) || homebrewUids.has(key)) continue;
          if (official?.uids.get(type)?.has(targetUid(target)) === true) continue;
          entries.push({
            type,
            name: named(e)?.name ?? target.name,
            target: `${target.name}|${target.source}`,
          });
        }
      }
      if (entries.length > 0)
        satisfiesCopies.push({ file: { id: f.id, fileName: fileLabel(f) }, entries });
    }
  }

  // One character the roster cannot read must not stop every import, so each
  // is read on its own and a bad one is left out of the list.
  const affectedCharacters: { id: string; name: string }[] = [];
  const oldImportCharacters: { id: string; name: string }[] = [];
  const oldSources = new Set(oldImports.flatMap((f) => f.sourceIds.map(lower)));
  // What this file brings, by name and source: an entry of the old import it
  // brings again under the same identity is not lost.
  const brought = new Set<string>();
  if (oldSources.size > 0) {
    for (const type of HOMEBREW_ENTITY_KEYS) {
      for (const e of entitiesOf(row.json, type)) if (named(e) !== undefined) brought.add(uidOf(e));
    }
  }
  const loses = (doc: CharacterDoc) =>
    oldSources.size > 0 &&
    collectCharacterRefs(doc).some(
      (r) => oldSources.has(lower(r.source)) && !brought.has(targetUid(r)),
    );
  for (const doc of input.characters) {
    try {
      const used = collectCharacterSources(doc);
      const who = { id: String(doc.id), name: String(doc.name) };
      if ([...ownSources].some((s) => used.has(s))) affectedCharacters.push(who);
      if (loses(doc)) oldImportCharacters.push(who);
    } catch {
      // Unreadable: the roster reports it; the preview just cannot list it.
    }
  }

  const coverage = officialCoverage(official);
  if (coverage === 'unavailable') {
    notes.push('Game data could not be read, so clashes with official content were not checked.');
  } else if (coverage === 'partial') {
    notes.push(
      'Not all game data is on this device yet, so clashes with official content may be incomplete.',
    );
  }
  // A book here is named by the file it came from, so a compendium that
  // shares many books with this one makes one note, not one per book.
  const noteLabel = (ref: FileRef) => {
    const f = byId.get(ref.id);
    return f?.book === undefined ? ref.fileName : f.fileName;
  };
  const clashingFiles = new Set<string>();
  for (const c of collisions) {
    if (c.against !== 'official') clashingFiles.add(noteLabel(c.against));
  }
  for (const fileName of clashingFiles) {
    notes.push(
      `Entries in this file that match entries in "${fileName}" are not used: ` +
        `"${fileName}" was imported first, so it wins until it is disabled or deleted.`,
    );
  }
  const dormantFiles = new Set(disabledClashes.map((c) => noteLabel(c.against)));
  for (const fileName of dormantFiles) {
    notes.push(
      `Some entries in this file match entries in "${fileName}", which is turned off. ` +
        `This file's entries are used for now; "${fileName}" wins again if it is turned back on.`,
    );
  }

  return {
    fileName: row.fileName,
    counts: row.counts,
    bytes: input.bytes,
    limitBytes: input.limitBytes ?? IMPORT_LIMITS.maxImportBytes,
    sources: metaSources(row.json),
    duplicateOf,
    sourceCollisions,
    entityCollisions: collisions.slice(0, MAX_LISTED_COLLISIONS),
    collisionTotal: collisions.length,
    disabledClashes: disabledClashes.slice(0, MAX_LISTED_COLLISIONS),
    disabledClashTotal: disabledClashes.length,
    dependencies,
    copyIssues,
    satisfiesCopies,
    affectedCharacters,
    officialCoverage: coverage,
    notes,
    ...(pack === undefined
      ? {}
      : {
          pack,
          packsOn: packsInPlay(existing.filter((f) => f.enabled && f.id !== row.id)),
          packIn: { id: row.id, name: pack.name, guidance: packGuidance(row.json) ?? {} },
        }),
    ...(books === undefined ? {} : { books: books.choices }),
    ...(oldImports.length === 0
      ? {}
      : {
          replacesOldImport: oldImports.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            sourceIds: f.sourceIds,
          })),
          oldImportCharacters,
        }),
  };
}

/** One clash in a sentence, naming the side a character gets. */
export function describeCollision(c: EntityCollision): string {
  const what = `${c.name} (${c.source})`;
  return c.against === 'official'
    ? `${what} is also official content. Official wins, so a character that picks it gets the official version.`
    : `${what} is also in "${c.against.fileName}", which was imported first, so a character that picks it gets that version.`;
}

// ---------------------------------------------------------------------------
// Rule packs (H8): what a pack holds, before it goes on and from the Homebrew page
// ---------------------------------------------------------------------------

/** Each table rule and its values, worded as the Rules board words them. */
export const RULE_WORDS: {
  readonly [K in TableRuleId]: {
    name: string;
    values: Readonly<Record<(typeof TABLE_RULES)[K][number], string>>;
  };
} = {
  critDamage: {
    name: 'Critical hits',
    values: {
      doubleDice: 'Double the dice',
      maxPlusRoll: 'Max the dice, then roll them',
      doubleTotal: 'Double the total',
    },
  },
  restLength: {
    name: 'Rest length',
    values: {
      standard: 'Short 1 hour, long 8 hours',
      gritty: 'Short 8 hours, long 7 days',
      heroic: 'Short 5 minutes, long 1 hour',
    },
  },
  hpEachLevel: {
    name: 'HP each level',
    values: {
      average: 'Always the fixed amount',
      rolled: 'Always roll',
      max: 'Always the maximum',
      rolledAtLeastAverage: 'Roll, never under the fixed amount',
    },
  },
  hpOnLongRest: {
    name: 'HP on a long rest',
    values: {
      all: 'All of it',
      half: 'Half your maximum',
      hitDice: 'None, spend hit dice to heal',
    },
  },
  flanking: {
    name: 'Flanking',
    values: { off: 'Off', advantage: 'Advantage', plusTwo: '+2 to hit' },
  },
  oneUseDice: {
    name: 'Guidance and Bardic Inspiration',
    values: { after: 'Offered after the roll', before: 'Named before the roll' },
  },
};

const ruleName = (id: TableRuleId) => RULE_WORDS[id].name;
const ruleValue = (id: TableRuleId, value: string) =>
  (RULE_WORDS[id].values as Record<string, string>)[value] ?? value;

/** One line of a review section: what it is about, then what it does. */
export interface PackReviewRow {
  key: string;
  value: string;
}

/** What a pack holds, worded for the review sheet. */
export interface PackReview {
  name: string;
  /** The limits it breaks. While any, it cannot be added and reaches nobody. */
  refusals: string[];
  rules: PackReviewRow[];
  changes: PackReviewRow[];
  moments: PackReviewRow[];
  /** What the app cannot read in it. It still goes on; these parts do nothing. */
  problems: string[];
  /** "3 rules, 2 changed entries, 1 moment": the Homebrew page's line for it. */
  holds: string;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
const text = (v: unknown) =>
  typeof v === 'string' ? v.trim().slice(0, CAST_GUIDANCE_LIMITS.textLength) : '';
const listOf = (raw: Record<string, unknown>, key: string) => {
  const v = own(raw, key);
  return Array.isArray(v) ? v : [];
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A patch's target as the player reads it: `Rage|Barbarian` is "Rage (Barbarian)". */
export function targetWords(target: string): string {
  const [name = '', ...rest] = target.split('|').map((part) => part.trim());
  const more = rest.filter((r) => r !== '');
  return more.length === 0 ? name : `${name} (${more.join(', ')})`;
}

const MOMENT_AT: Readonly<Record<string, (m: Record<string, unknown>) => string>> = {
  zeroHp: () => 'At 0 HP',
  natural20: () => 'On a natural 20',
  natural1: () => 'On a natural 1',
  castAtLevel: (m) => {
    const level = own(m, 'level');
    return typeof level === 'number' ? `Casting at level ${level} or higher` : 'Casting a spell';
  },
  shortRest: () => 'After a short rest',
  longRest: () => 'After a long rest',
  turnStart: () => 'At the start of your turn',
  conditionAdded: (m) => {
    const c = text(own(m, 'condition'));
    return c === '' ? 'On gaining a condition' : `On gaining ${capital(c)}`;
  },
  conditionEnded: (m) => {
    const c = text(own(m, 'condition'));
    return c === '' ? 'When a condition ends' : `When ${capital(c)} ends`;
  },
  levelUp: () => 'At a level up',
  attack: () => 'On attacks',
  save: () => 'On saving throws',
  check: () => 'On ability checks',
};

function amountWords(a: unknown): string {
  if (typeof a === 'number') return String(a);
  if (isRecord(a) && typeof own(a, 'f') === 'string') return text(own(a, 'f'));
  if (isRecord(a) && isRecord(own(a, 'byLevel'))) return 'an amount by level';
  return 'an amount';
}

function outcomeWords(o: unknown): string | undefined {
  if (!isRecord(o)) return undefined;
  switch (own(o, 'kind')) {
    case 'addCondition': {
      const condition = capital(text(own(o, 'condition')));
      if (condition.toLowerCase() !== 'exhaustion') return `Gain ${condition}`;
      const level = own(o, 'level');
      const levels = typeof level === 'number' && level > 1 ? level : 1;
      return levels === 1 ? 'Gain a level of Exhaustion' : `Gain ${levels} levels of Exhaustion`;
    }
    case 'addEffect':
      return `${text(own(o, 'name')) || 'An effect'} takes effect`;
    case 'regain':
      return `Regain ${amountWords(own(o, 'amount'))} ${text(own(o, 'resource'))}`.trim();
    case 'spend':
      return `Spend ${amountWords(own(o, 'amount'))} ${text(own(o, 'resource'))}`.trim();
    case 'tempHp':
      return `Gain ${amountWords(own(o, 'amount'))} temporary HP`;
    case 'cue':
      return `Says "${text(own(o, 'text'))}"`;
    case 'offer': {
      const dice = text(own(o, 'dice'));
      return `Offers ${text(own(o, 'label'))}${dice === '' ? '' : ` (${dice})`}`;
    }
    default:
      return undefined;
  }
}

function changeWords(p: Record<string, unknown>): string {
  const replace = own(p, 'effects');
  const add = own(p, 'add');
  const parts: string[] = [];
  if (Array.isArray(replace)) {
    parts.push(
      replace.length === 0
        ? 'Does nothing now'
        : `Works by ${plural(replace.length, 'effect')} in place of its own`,
    );
  }
  if (Array.isArray(add) && add.length > 0) {
    parts.push(
      parts.length === 0 ? `Gains ${plural(add.length, 'effect')}` : `gains ${add.length} more`,
    );
  }
  return parts.length === 0 ? 'Changes nothing' : parts.join(', and ');
}

/** What the pack in `json` holds, or undefined when the file is not a rule pack. */
export function packReview(json: unknown): PackReview | undefined {
  const guidance = packGuidance(json);
  if (guidance === undefined) return undefined;
  const name = packName(json);
  const problems = new Set<string>();
  const version = guidanceVersion(guidance);
  if ('problem' in version) problems.add(version.problem);
  for (const key of Object.keys(guidance)) {
    if (!(PACK_PARTS as readonly string[]).includes(key)) {
      problems.add(`"${clip(key)}" is not part of a rule pack, so it is not read`);
    }
  }
  const table = readTableRules(own(guidance, 'tableRules'));
  for (const p of table.problems) problems.add(p);
  for (const p of readPack({ name, castGuidance: guidance }).problems) problems.add(p);
  for (const p of readPackMoments(guidance, name).problems) problems.add(p);

  const rules = (Object.keys(table.rules) as TableRuleId[]).map((id) => ({
    key: ruleName(id),
    value: ruleValue(id, table.rules[id] as string),
  }));
  const changes = listOf(guidance, 'patches')
    .filter(isRecord)
    .filter((p) => text(own(p, 'target')) !== '')
    .map((p) => ({ key: targetWords(text(own(p, 'target'))), value: changeWords(p) }));
  const moments: PackReviewRow[] = [];
  for (const m of listOf(guidance, 'moments')) {
    if (!isRecord(m)) continue;
    const at = Object.hasOwn(MOMENT_AT, text(own(m, 'at')))
      ? MOMENT_AT[text(own(m, 'at'))]
      : undefined;
    const does = listOf(m, 'do')
      .map(outcomeWords)
      .filter((w): w is string => w !== undefined);
    if (at !== undefined && does.length > 0) {
      moments.push({ key: at(m), value: does.join(', then ') });
    }
  }
  let cues = 0;
  for (const c of listOf(guidance, 'cues')) {
    if (!isRecord(c)) continue;
    const at = Object.hasOwn(MOMENT_AT, text(own(c, 'at')))
      ? MOMENT_AT[text(own(c, 'at'))]
      : undefined;
    const said = text(own(c, 'text'));
    if (at === undefined || said === '') continue;
    cues += 1;
    moments.push({ key: at(c), value: `Says "${said}"` });
  }
  const holds = [
    rules.length > 0 ? plural(rules.length, 'rule') : '',
    changes.length > 0 ? plural(changes.length, 'changed entry', 'changed entries') : '',
    moments.length - cues > 0 ? plural(moments.length - cues, 'moment') : '',
    cues > 0 ? plural(cues, 'cue') : '',
  ].filter((s) => s !== '');
  return {
    name,
    refusals: packRefusals(guidance),
    rules,
    changes,
    moments,
    problems: [...problems],
    holds: holds.length === 0 ? 'Nothing the app reads yet' : holds.join(', '),
  };
}

/** A pack as the clash check sees it: in the player's order, with who it reaches. */
export interface PackInPlay {
  id: string;
  name: string;
  guidance: Record<string, unknown>;
  appliesTo?: PackAppliesTo;
}

/** Two or more packs setting the same thing for the same characters. */
export interface PackConflict {
  /** "rest length", or the entry two packs replace. */
  what: string;
  /** The packs that set it, in the player's order, by name and by id. */
  packs: string[];
  ids: string[];
  winner: string;
  winnerId: string;
  /** `order`: later in the player's order; `chosen`: applied to the characters, over every character. */
  why: 'order' | 'chosen';
}

const reaches = (to: PackAppliesTo | undefined): to is PackAppliesTo =>
  to !== undefined && (to.appDefault === true || to.characters.length > 0);

/** Every character who is not one a pack is applied to by name. */
const OTHERS = Symbol('others');
type Who = string | typeof OTHERS;

/** What a pack sets, read once per guidance object. */
interface PackSets {
  rules: Partial<TableRuleChoices>;
  /** The targets it replaces, lowercased, as the engine keys them. */
  replaces: Set<string>;
  /** How each target is written, for the sentence. */
  written: Map<string, string>;
}
const SETS = new WeakMap<Record<string, unknown>, PackSets>();

function packSets(p: PackInPlay): PackSets {
  const known = SETS.get(p.guidance);
  if (known !== undefined) return known;
  const replaces = new Set<string>();
  // The engine's own reader: a list none of whose effects can be read replaces nothing.
  for (const patch of readPack({ name: p.name, castGuidance: p.guidance }).patches) {
    if (patch.replace !== undefined) replaces.add(patch.target);
  }
  const written = new Map<string, string>();
  for (const patch of listOf(p.guidance, 'patches')) {
    const target = isRecord(patch) ? own(patch, 'target') : undefined;
    if (typeof target !== 'string') continue;
    const key = target.trim().toLowerCase();
    if (replaces.has(key) && !written.has(key)) written.set(key, target.trim());
  }
  const sets = { rules: readTableRules(own(p.guidance, 'tableRules')).rules, replaces, written };
  SETS.set(p.guidance, sets);
  return sets;
}

/** A character no pack names: who the packs applied to every character alone reach. */
const NAMED_BY_NONE = '\u0000anyone else';

/** Which pack a character plays a rule by, by its place among the packs, and whether it names them. */
type PlayedBy = Partial<Record<TableRuleId, { place: number; named: boolean }>>;

/**
 * The pack each rule comes from for the character `who`, as the engine
 * decides it (`ruleSources`, then `appRulesFor` where the rule is the app's):
 * none where a choice in Settings or the book sets it. Each pack goes in
 * named by its place, so two packs sharing a name are never confused.
 */
function playedBy(
  packs: readonly DataEntity[],
  who: string,
  settings: Readonly<Partial<TableRuleChoices>>,
): PlayedBy {
  const ctx = {
    byType: (type: string) => (type === RULE_PACK_TYPE ? packs : []),
    rules: settings,
  };
  const doc = { id: who, rulesVersion: '2024' as const };
  const from = ruleSources(doc, ctx);
  const app = appRulesFor(ctx, doc.rulesVersion);
  // `appRulesFor` names the pack behind a rule, which decides only where Settings has none.
  const chosen = readTableRules(settings).rules;
  const out: PlayedBy = {};
  for (const id of Object.keys(TABLE_RULES) as TableRuleId[]) {
    const source = from[id];
    const appPack = app.packs[id];
    if (source.from === 'pack') out[id] = { place: Number(source.pack), named: true };
    else if (source.from === 'app' && chosen[id] === undefined && appPack !== undefined)
      out[id] = { place: Number(appPack), named: false };
  }
  return out;
}

/**
 * Where packs that are on disagree, and which wins, worked out character by
 * character. For a table rule the engine decides (`ruleSources` and
 * `appRulesFor` in `engine/rules.ts`): a pack counts for a character where,
 * on its own, they would play the rule by it, and the winner is the pack
 * they play it by with every pack on. For a change to an entry, the later of
 * two replacing it wins, as `effects/mechanics.ts` applies them, read by its
 * `readPack`. Packs that agree, or reach no character in common, are no
 * clash. A character's own choice of a rule, which is over every pack, is
 * not seen.
 */
export function packConflicts(
  packs: readonly PackInPlay[],
  app: Readonly<Partial<TableRuleChoices>> = {},
): PackConflict[] {
  const live = packs
    .filter((p) => reaches(p.appliesTo))
    .map((pack) => ({ pack, sets: packSets(pack), to: pack.appliesTo as PackAppliesTo }));
  // Each character a pack names, then everyone else: who an every-character pack alone reaches.
  const people: Who[] = [...new Set(live.flatMap((l) => l.to.characters)), OTHERS];
  const named = (to: PackAppliesTo, who: Who) => who !== OTHERS && to.characters.includes(who);
  const found = new Map<string, PackConflict>();
  const say = (
    what: string,
    set: readonly PackInPlay[],
    winner: PackInPlay,
    why: PackConflict['why'],
  ) => {
    const key = JSON.stringify([what, set.map((p) => p.id), winner.id, why]);
    if (found.has(key)) return;
    found.set(key, {
      what,
      packs: set.map((p) => p.name),
      ids: set.map((p) => p.id),
      winner: winner.name,
      winnerId: winner.id,
      why,
    });
  };
  const entries: DataEntity[] = live.map((l, place) => ({
    name: String(place),
    castGuidance: l.pack.guidance,
    appliesTo: l.to,
  }));
  // For each character: the pack behind each rule with every pack on, and with each alone.
  const played = new Map(
    people.map((who) => {
      const id = who === OTHERS ? NAMED_BY_NONE : who;
      return [
        who,
        {
          all: playedBy(entries, id, app),
          alone: entries.map((e) => playedBy([e], id, app)),
        },
      ] as const;
    }),
  );
  for (const id of Object.keys(TABLE_RULES) as TableRuleId[]) {
    for (const who of people) {
      const by = played.get(who);
      const won = by?.all[id];
      if (by === undefined || won === undefined) continue;
      const counted = live.flatMap((l, place) => {
        const alone = by.alone[place]?.[id];
        return alone === undefined ? [] : [{ ...l, named: alone.named }];
      });
      if (counted.length < 2 || new Set(counted.map((c) => c.sets.rules[id])).size === 1) continue;
      const winner = live[won.place];
      if (winner === undefined) continue;
      // Chosen only when every pack it overrules is applied to every character;
      // one that also names the character it beats by order alone.
      const value = winner.sets.rules[id];
      const overruled = counted.filter((c) => c.sets.rules[id] !== value);
      const why = won.named && overruled.every((c) => !c.named) ? 'chosen' : 'order';
      say(
        ruleName(id).toLowerCase(),
        counted.map((c) => c.pack),
        winner.pack,
        why,
      );
    }
  }
  const targets = new Map<string, string>();
  for (const l of live) {
    for (const [key, target] of l.sets.written) if (!targets.has(key)) targets.set(key, target);
  }
  for (const [key, target] of targets) {
    for (const who of people) {
      const setters = live.filter(
        (l) => l.sets.replaces.has(key) && (l.to.appDefault === true || named(l.to, who)),
      );
      const winner = setters[setters.length - 1];
      if (setters.length >= 2 && winner !== undefined) {
        say(
          targetWords(target),
          setters.map((l) => l.pack),
          winner.pack,
          'order',
        );
      }
    }
  }
  return [...found.values()];
}

const names = (all: readonly string[]) =>
  all.length <= 2 ? all.join(' and ') : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;

/** A clash in a sentence, for the Homebrew page's banner. */
export function describeConflict(c: PackConflict): string {
  const why =
    c.why === 'chosen'
      ? 'it is applied to those characters, over every character'
      : 'it comes later in your pack order';
  const all = c.packs.length === 2 ? 'both' : 'all';
  return `${names(c.packs)} ${all} set ${c.what}. ${c.winner} wins: ${why}.`;
}

/** A clash a pack being added would join, worded from its side. */
export function describeIncomingConflict(c: PackConflict, incomingId: string): string {
  const others = c.packs.filter((_, i) => c.ids[i] !== incomingId);
  const incoming = c.packs[c.ids.indexOf(incomingId)] ?? 'This pack';
  const win =
    c.winnerId === incomingId
      ? `${incoming} would win, as ${c.why === 'chosen' ? 'it is applied to those characters' : 'it goes last in your pack order'}.`
      : `${c.winner} would still win, as ${c.why === 'chosen' ? 'it is applied to those characters' : 'it comes later in your pack order'}.`;
  return `Sets ${c.what}, which ${names(others)} also ${others.length === 1 ? 'sets' : 'set'}. ${win}`;
}

/** The packs among stored files, in the player's order, with who each reaches now. */
export function packsInPlay(files: readonly HomebrewFile[]): PackInPlay[] {
  return packsInOrder([...files].sort(compareMergeOrder).map((f) => [f.id, f.json] as const)).map(
    (p) => {
      const to = packReach(p);
      return {
        id: p.id,
        name: p.name,
        guidance: p.guidance,
        ...(to === undefined ? {} : { appliesTo: to }),
      };
    },
  );
}
