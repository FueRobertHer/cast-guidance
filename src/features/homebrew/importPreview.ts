/**
 * What importing a homebrew file would do, worked out before anything is
 * written (IMP-002). Pure: the caller gathers the prepared row, the files
 * already here, the official data and the roster, and this only reads them.
 *
 * It answers the questions the issue lists: is this file already here, what
 * does it depend on and is that available, what does it clash with and which
 * side wins, which `_copy` references will not resolve, how big is it, and
 * which characters use its sources. None of it blocks an import (guidance,
 * not gatekeeping); it is what the preview shows before the player decides.
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

/** The most entity clashes a preview lists; `collisionTotal` keeps the full count. */
export const MAX_LISTED_COLLISIONS = 50;

/**
 * The official entities and sources the registry holds, reduced to what a
 * preview needs. `complete` is false while game data is still downloading:
 * something not found yet may only be in a pack that has not arrived.
 */
export interface OfficialIndex {
  /** Lowercased `name|source` per type. */
  uids: Map<EntityType, Set<string>>;
  /** Lowercased source ids. */
  sources: Set<string>;
  complete: boolean;
}

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
  const uids = new Map<EntityType, Set<string>>();
  const sources = new Set<string>();
  for (const type of ENTITY_TYPES) {
    const official = reg.byType(type).slice(0, reg.officialCount(type));
    if (official.length === 0) continue;
    const set = new Set<string>();
    for (const e of official) {
      set.add(uidOf(e));
      if (typeof e.source === 'string' && e.source !== '') sources.add(e.source.toLowerCase());
    }
    uids.set(type, set);
  }
  return { uids, sources, complete };
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

export type DependencyStatus =
  /** Official data provides it. */
  | 'official'
  /** An enabled homebrew file here declares it. */
  | 'homebrew'
  /** Only a disabled homebrew file here declares it. */
  | 'disabled'
  /** Not found, but game data is not all here yet, so it may still arrive. */
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
  dependencies: Dependency[];
  copyIssues: CopyIssue[];
  affectedCharacters: { id: string; name: string }[];
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

/** An entity with a usable name and source, which is what makes it collide. */
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

export function previewHomebrewImport(input: HomebrewPreviewInput): HomebrewPreview {
  const { row, existing, official } = input;
  const ownSources = new Set(row.sourceIds.map(lower));
  const others = existing.filter((f) => f.id !== row.id);
  // Merge order, so the first file found for a uid is the one that wins it.
  const enabled = others.filter((f) => f.enabled).sort(compareMergeOrder);
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

  // First enabled file (in merge order) defining each uid, per type.
  const homebrewUids = new Map<string, FileRef>();
  for (const f of enabled) {
    for (const type of HOMEBREW_ENTITY_KEYS) {
      for (const e of entitiesOf(f.json, type)) {
        if (named(e) === undefined) continue;
        const key = `${type}:${uidOf(e)}`;
        if (!homebrewUids.has(key)) homebrewUids.set(key, { id: f.id, fileName: f.fileName });
      }
    }
  }

  const collisions: EntityCollision[] = [];
  const ownUids = new Set<string>();
  const copies: { type: EntityType; name: string; target: { name: string; source: string } }[] = [];
  for (const type of HOMEBREW_ENTITY_KEYS) {
    for (const e of entitiesOf(row.json, type)) {
      const target = copyTarget(e);
      const id = named(e);
      if (target !== undefined) copies.push({ type, name: id?.name ?? target.name, target });
      if (id === undefined) continue;
      const uid = uidOf(e);
      ownUids.add(`${type}:${uid}`);
      // An exact duplicate writes nothing, so it clashes with nothing.
      if (duplicateOf !== undefined) continue;
      if (official?.uids.get(type)?.has(uid) === true) {
        collisions.push({ type, ...id, against: 'official', winner: 'official' });
        continue;
      }
      const file = homebrewUids.get(`${type}:${uid}`);
      if (file !== undefined) collisions.push({ type, ...id, against: file, winner: 'existing' });
    }
  }

  const enabledSources = new Set(enabled.flatMap((f) => f.sourceIds.map(lower)));
  const disabledSources = new Set(
    others.filter((f) => !f.enabled).flatMap((f) => f.sourceIds.map(lower)),
  );
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
    const uid = `${target.name}|${target.source}`.toLowerCase();
    if (ownUids.has(`${type}:${uid}`)) continue;
    const resolves =
      homebrewUids.has(`${type}:${uid}`) || official?.uids.get(type)?.has(uid) === true;
    if (!ownSources.has(lower(target.source))) addDependency(target.source, 'copy');
    if (resolves) continue;
    // A target in a pack that has not downloaded yet may still resolve; one
    // the file names under its own source never will.
    if (officialKnown || ownSources.has(lower(target.source))) {
      copyIssues.push({ type, name, target: `${target.name}|${target.source}` });
    }
  }

  const affectedCharacters = input.characters
    .filter((doc) => {
      const used = collectCharacterSources(doc);
      return [...ownSources].some((s) => used.has(s));
    })
    .map((doc) => ({ id: doc.id, name: doc.name }));

  if (official === null) {
    notes.push(
      'Game data is not available yet, so clashes with official content were not checked.',
    );
  } else if (!official.complete) {
    notes.push(
      'Game data is still downloading, so clashes with official content may be incomplete.',
    );
  }
  const clashingFiles = new Map<string, string>();
  for (const c of collisions)
    if (c.against !== 'official') clashingFiles.set(c.against.id, c.against.fileName);
  for (const fileName of clashingFiles.values()) {
    notes.push(
      `Entries in this file that share a name and source with "${fileName}" are not used: ` +
        `"${fileName}" was imported first, so it wins until it is disabled or deleted.`,
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
    dependencies,
    copyIssues,
    affectedCharacters,
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
