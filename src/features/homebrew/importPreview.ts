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
import type { HomebrewFileRow } from '@/db/db';
import { compareMergeOrder } from '@/db/homebrewOrder';
import type { HomebrewFile } from '@/db/homebrewRepo';
import type { CharacterDoc } from '@/engine/types';
import { collectCharacterSources } from '@/features/characters/homebrewExport';
import { HOMEBREW_ENTITY_KEYS, IMPORT_LIMITS } from '@/lib/guards';

/**
 * How a `name|source` tie is settled, worded for the player. It has to match
 * what the registry does: entries with the same name and source share one
 * identity, so whichever wins is the one every character gets.
 */
export const WINNER_POLICY =
  'Official content wins over homebrew with the same name and source. Between homebrew files, ' +
  'the one imported first wins. Entries with the same name and source count as one, so a ' +
  'character that picks either gets the winning version.';

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
  duplicateOf?: FileRef & { addedAt: number; enabled: boolean };
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
}

export interface HomebrewPreviewInput {
  row: HomebrewFileRow;
  bytes: number;
  /** Every homebrew file here, enabled or not (`homebrewRepo.listSafe().files`). */
  existing: readonly HomebrewFile[];
  /** Null when the registry could not be read (no game data yet). */
  official: OfficialIndex | null;
  characters: readonly CharacterDoc[];
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
        if (!out.has(k)) out.set(k, { id: f.id, fileName: f.fileName });
      }
    }
  }
  return out;
}

const uidKey = (_: EntityType, e: Entity) => (named(e) === undefined ? undefined : uidOf(e));

export function previewHomebrewImport(input: HomebrewPreviewInput): HomebrewPreview {
  const { row, existing, official } = input;
  const ownSources = new Set(row.sourceIds.map(lower));
  const others = existing.filter((f) => f.id !== row.id);
  // Merge order, so the first file found for an identity is the one that wins it.
  const enabled = others.filter((f) => f.enabled).sort(compareMergeOrder);
  const disabled = others.filter((f) => !f.enabled).sort(compareMergeOrder);
  const notes: string[] = [];

  const dup = existing.find((f) => f.id === row.id);
  const duplicateOf =
    dup === undefined
      ? undefined
      : { id: dup.id, fileName: dup.fileName, addedAt: dup.addedAt, enabled: dup.enabled };

  const sourceCollisions = row.sourceIds
    .map((sourceId) => ({
      sourceId,
      files: others
        .filter((f) => f.sourceIds.some((s) => lower(s) === lower(sourceId)))
        .map((f) => ({ id: f.id, fileName: f.fileName, enabled: f.enabled })),
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
      if (file !== undefined) {
        collisions.push({ ...what, against: file, winner: 'existing' });
        continue;
      }
      const off = disabledClashMap.get(`${type}:${key}`);
      if (off !== undefined) disabledClashes.push({ ...what, against: off });
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
        satisfiesCopies.push({ file: { id: f.id, fileName: f.fileName }, entries });
    }
  }

  // One character the roster cannot read must not stop every import, so each
  // is read on its own and a bad one is left out of the list.
  const affectedCharacters: { id: string; name: string }[] = [];
  for (const doc of input.characters) {
    try {
      const used = collectCharacterSources(doc);
      if ([...ownSources].some((s) => used.has(s))) {
        affectedCharacters.push({ id: String(doc.id), name: String(doc.name) });
      }
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
  const clashingFiles = new Map<string, string>();
  for (const c of collisions) {
    if (c.against !== 'official') clashingFiles.set(c.against.id, c.against.fileName);
  }
  for (const fileName of clashingFiles.values()) {
    notes.push(
      `Entries in this file that match entries in "${fileName}" are not used: ` +
        `"${fileName}" was imported first, so it wins until it is disabled or deleted.`,
    );
  }
  const dormantFiles = new Map(disabledClashes.map((c) => [c.against.id, c.against.fileName]));
  for (const fileName of dormantFiles.values()) {
    notes.push(
      `Some entries in this file match entries in "${fileName}", which is turned off. ` +
        `This file's entries are used for now; "${fileName}" wins again if it is turned back on.`,
    );
  }

  return {
    fileName: row.fileName,
    counts: row.counts,
    bytes: input.bytes,
    limitBytes: IMPORT_LIMITS.maxImportBytes,
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
  };
}

/** One clash in a sentence, naming the side a character gets. */
export function describeCollision(c: EntityCollision): string {
  const what = `${c.name} (${c.source})`;
  return c.against === 'official'
    ? `${what} is also official content. Official wins, so a character that picks it gets the official version.`
    : `${what} is also in "${c.against.fileName}", which was imported first, so a character that picks it gets that version.`;
}
