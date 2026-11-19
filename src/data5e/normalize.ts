/**
 * Pure dataset normalization: raw 5etools JSON files -> typed entity lists
 * with `_copy` resolved and `_versions` expanded. No browser/DB imports, so
 * the data-audit script exercises exactly the code the app runs.
 */

// Relative, not `@/`: the data-audit script runs this file under plain Bun.
import {
  ENTRY_PARENT_KEYS,
  isRecord,
  CAST_GUIDANCE_LIMITS as L,
  own,
  type PackAppliesTo,
  RULE_PACK_TYPE,
  RULE_SET_TYPE,
} from '../engine/castGuidance';
import {
  applyCopy,
  type CopyModWarning,
  type CopyRef,
  DELETE_ON_COPY,
  type Entity,
  expandVersions,
  resolveCopies,
  textOf,
  uidOf,
  withReplaceBudget,
} from './copyMod';
import { fieldPrint, OWN_GUIDANCE } from './fingerprint';
import {
  type PackFile,
  type PackLocal,
  packReach,
  packsInOrder,
  rulePackEntries,
} from './rulePack';

/**
 * The list and the union are one declaration, so a type added to one cannot go
 * missing from the other. The runtime list is what lets a `:type` out of the
 * URL be checked before it is treated as one.
 */
export const ENTITY_TYPES = [
  'race',
  'subrace',
  'background',
  'feat',
  'optionalfeature',
  'item',
  'itemGroup',
  'baseitem',
  'itemProperty',
  'itemType',
  'magicvariant',
  'skill',
  'language',
  'sense',
  'action',
  'condition',
  'disease',
  'status',
  'variantrule',
  'book',
  'class',
  'subclass',
  'classFeature',
  'subclassFeature',
  'spell',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export function isEntityType(value: string): value is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Types a player actually browses or picks; see {@link EntityRegistry.sourceCounts}.
 *
 * Must stay a superset of what the UI source-filters, or a book can be hidden
 * without ever appearing in settings as something to un-hide. The 2024 Monster
 * Manual is the live example: the app loads no bestiary, so XMM's only entries
 * are languages, and leaving `language` out here made XMM unlistable even
 * though a preset names it.
 */
const COUNTED_TYPES = new Set<EntityType>([
  'race',
  'subrace',
  'background',
  'feat',
  'optionalfeature',
  'item',
  'baseitem',
  'magicvariant',
  'spell',
  'class',
  'subclass',
  'condition',
  'disease',
  'action',
  'variantrule',
  'skill',
  'language',
  'sense',
  // A book's own entry, which the library browses and therefore source-filters
  // too. Several books reach this app as nothing but their own row (no bestiary
  // is loaded, so the 2014 Monster Manual has no other entries at all), and
  // leaving the type out here would hide those from settings entirely.
  'book',
]);

export class EntityRegistry {
  private readonly types = new Map<EntityType, Entity[]>();
  private readonly index = new Map<EntityType, Map<string, Entity>>();
  /**
   * The rule packs among the merged homebrew, in the player's order. A list of
   * their own rather than an `ENTITY_TYPES` entry, so the Library, search and
   * the audits never list a pack as content.
   */
  private packs: readonly Entity[] = [];
  /**
   * The app's built-in rule sets (`setRuleSets`). Not content either: no list
   * shows them, and they reach the engine only through `byType(RULE_SET_TYPE)`.
   */
  private ruleSets: readonly Entity[] = [];
  /** The built-in rule sets could not be loaded (`setRuleSets`). */
  ruleSetsFailed = false;
  readonly warnings: CopyModWarning[] = [];
  /**
   * The official books a row marks as 2024 rules (see `booksMarkedOne`). Merging
   * homebrew never adds to it, so a brew's own marks label no book.
   */
  rulesBooks: ReadonlySet<string> = new Set();
  /** Per-type list lengths when homebrew started arriving; see `officialCount`. */
  private officialCounts: Map<EntityType, number> | undefined;
  /** The changes to the books the merge found, in the order it placed them. */
  private readonly changed: ChangedEntry[] = [];
  /** Each changed entry's record, under its placed version and the entry below it. */
  private readonly changeIndex = new Map<Entity, ChangedEntry>();

  /**
   * Every entry a change to the books stands over (ADR-002, D2), with both
   * versions: the one below every change and the one in its place here, so a
   * per-character view (E4) can give a character either, and Needs a look can
   * show them side by side.
   */
  changedEntries(): readonly ChangedEntry[] {
    return this.changed;
  }

  /** The change record of `e`, when it is a changed entry or the entry below one. */
  changeOf(e: Entity): ChangedEntry | undefined {
    return this.changeIndex.get(e);
  }

  /**
   * What the player's own change to `e` is read against: the entry below it,
   * with the shared packs' changes, or `e` itself before the first change.
   * A change is written against this (`writeChange`), never against the
   * entry below every change, or a pack's text would be baked into it.
   */
  belowOwnChange(e: Entity): Entity {
    const record = this.changeIndex.get(e);
    if (record === undefined) return e;
    return record.layers.find((l) => l.from.kind === 'changes')?.below ?? record.placed;
  }

  /**
   * Record a change to the books and put its placed version where the entry
   * below it is: at its place in its type's list, so pickers list it once, in
   * the book's order, and `officialCount` still counts the same rows; and in
   * the index when the index finds that entry, never when it finds another of
   * the same `name|source` (each class's Ability Score Improvement).
   */
  placeChange(record: ChangedEntry): void {
    this.changed.push(record);
    this.changeIndex.set(record.base, record);
    if (record.placed === record.base) return;
    this.changeIndex.set(record.placed, record);
    const list = this.types.get(record.type);
    const at = list?.indexOf(record.base) ?? -1;
    if (list === undefined || at === -1) return;
    list[at] = record.placed;
    const idx = this.index.get(record.type);
    const uid = uidOf(record.base);
    if (idx?.get(uid) === record.base) idx.set(uid, record.placed);
  }

  /**
   * Record where official data ends. Homebrew is only ever appended after it
   * (`mergeHomebrew` calls this first), so each type's list is official up to
   * the recorded length and homebrew past it.
   */
  sealOfficial(): void {
    if (this.officialCounts !== undefined) return;
    this.officialCounts = new Map([...this.types].map(([type, list]) => [type, list.length]));
  }

  /** How many of `byType(type)`, from the front, are official data. */
  officialCount(type: EntityType): number {
    const all = this.byType(type).length;
    if (this.officialCounts === undefined) return all;
    return this.officialCounts.get(type) ?? 0;
  }

  addAll(type: EntityType, entities: Entity[]): void {
    const list = this.types.get(type) ?? [];
    const idx = this.index.get(type) ?? new Map<string, Entity>();
    for (const e of entities) {
      list.push(e);
      const uid = uidOf(e);
      if (!idx.has(uid)) idx.set(uid, e);
    }
    this.types.set(type, list);
    this.index.set(type, idx);
  }

  byType(type: EntityType | typeof RULE_PACK_TYPE | typeof RULE_SET_TYPE): readonly Entity[] {
    if (type === RULE_PACK_TYPE) return this.packs;
    if (type === RULE_SET_TYPE) return this.ruleSets;
    return this.types.get(type) ?? [];
  }

  /** Replaces the rule packs `byType(RULE_PACK_TYPE)` lists; see `rulePackEntries`. */
  setRulePacks(packs: readonly Entity[]): void {
    this.packs = packs;
  }

  /**
   * The app's built-in rule sets `byType(RULE_SET_TYPE)` lists, as
   * `data5e/builtInRules.ts` loaded them. `failed`: they could not be loaded,
   * which every sheet then says (`EngineContext.ruleSetsFailed`).
   */
  setRuleSets(sets: readonly Entity[], failed = false): void {
    this.ruleSets = sets;
    this.ruleSetsFailed = failed;
  }

  get(type: EntityType, name: string, source?: string): Entity | undefined {
    const idx = this.index.get(type);
    if (!idx) return undefined;
    if (source !== undefined) return idx.get(`${name}|${source}`.toLowerCase());
    const lower = `${name}|`.toLowerCase();
    for (const [uid, e] of idx) {
      if (uid.startsWith(lower)) return e;
    }
    return undefined;
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [type, list] of this.types) out[type] = list.length;
    return out;
  }

  /**
   * Every source code present, with how many entries carry it. Drives the
   * source list in settings, which shows only books the player can actually
   * run into: the registry holds what has downloaded, not the whole catalog.
   *
   * Counts only things a player browses or picks. Class and subclass features
   * come with their class rather than being chosen, and they outnumber
   * everything else several times over, so counting them would turn the number
   * into noise.
   */
  sourceCounts(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [type, list] of this.types) {
      if (!COUNTED_TYPES.has(type)) continue;
      for (const e of list) {
        if (typeof e.source !== 'string') continue;
        out.set(e.source, (out.get(e.source) ?? 0) + 1);
      }
    }
    return out;
  }
}

function entityArray(files: ReadonlyMap<string, unknown>, path: string, key: string): Entity[] {
  const json = files.get(path);
  if (json === null || typeof json !== 'object') return [];
  const arr = (json as Record<string, unknown>)[key];
  if (!Array.isArray(arr)) return [];
  return arr.filter((e): e is Entity => typeof e === 'object' && e !== null);
}

const byNameSource =
  (...lists: Entity[][]) =>
  (copy: CopyRef): Entity | undefined => {
    const uid = `${String(copy.name)}|${String(copy.source)}`.toLowerCase();
    for (const list of lists) {
      const hit = list.find((e) => uidOf(e) === uid);
      if (hit) return hit;
    }
    return undefined;
  };

/** Subraces are keyed by (name, source) plus the race they attach to. */
const subraceLookup =
  (subraces: Entity[]) =>
  (copy: CopyRef): Entity | undefined => {
    const matches = subraces.filter(
      (e) =>
        String(e.name).toLowerCase() === String(copy.name).toLowerCase() &&
        String(e.source).toLowerCase() === String(copy.source).toLowerCase(),
    );
    if (matches.length <= 1) return matches[0];
    const withRace = matches.find(
      (e) =>
        copy.raceName === undefined ||
        (String(e.raceName).toLowerCase() === String(copy.raceName).toLowerCase() &&
          (copy.raceSource === undefined ||
            String(e.raceSource).toLowerCase() === String(copy.raceSource).toLowerCase())),
    );
    return withRace ?? matches[0];
  };

/**
 * Subclasses are keyed by (name, source) plus the class they belong to, as
 * 5etools' own subclass hash is. A copy never finds itself: World of
 * Warcraft's Swashbuckler|WoW for Rogue|WoW copies Swashbuckler|WoW for
 * Rogue|XPHB and comes first in the file.
 */
const subclassLookup =
  (subclasses: Entity[]) =>
  (copy: CopyRef, self: Entity): Entity | undefined => {
    const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
    const matches = subclasses.filter(
      (e) => e !== self && same(e.name, copy.name) && same(e.source, copy.source),
    );
    if (matches.length <= 1) return matches[0];
    const withClass = matches.find(
      (e) =>
        (copy.className === undefined || same(e.className, copy.className)) &&
        (copy.classSource === undefined || same(e.classSource, copy.classSource)),
    );
    return withClass ?? matches[0];
  };

/**
 * The traits of the race a subrace with versions belongs to: a version's `_mod`
 * is written against the race and subrace merged. Undefined when its race is
 * not found, so its versions' mods read the subrace alone.
 */
function raceTraitsOf(reg: EntityRegistry, subrace: Entity): unknown[] | undefined {
  const { raceName, raceSource } = subrace;
  if (typeof raceName !== 'string' || typeof raceSource !== 'string') return undefined;
  const entries = reg.get('race', raceName, raceSource)?.entries;
  return Array.isArray(entries) ? entries : undefined;
}

export function normalizeDataset(files: ReadonlyMap<string, unknown>): EntityRegistry {
  const reg = new EntityRegistry();
  const warn = (w: CopyModWarning[]) => reg.warnings.push(...w);

  const rulesBooks = booksMarkedOne(files);
  reg.rulesBooks = rulesBooks;

  // Races + subraces (copies, then version expansion on both)
  const races = entityArray(files, 'races.json', 'race');
  const subraces = entityArray(files, 'races.json', 'subrace');
  warn(resolveCopies(races, byNameSource(races), 'race'));
  warn(resolveCopies(subraces, subraceLookup(subraces), 'subrace'));
  const raceVersions = races.flatMap((r) => expandVersions(r, reg.warnings));
  reg.addAll('race', [...races, ...raceVersions]);
  const subraceVersions = subraces.flatMap((r) =>
    expandVersions(r, reg.warnings, raceTraitsOf(reg, r)),
  );
  reg.addAll('subrace', [...subraces, ...subraceVersions]);

  // Flat copy-within-type entity files
  const simple: Array<[EntityType, string, string]> = [
    ['background', 'backgrounds.json', 'background'],
    ['feat', 'feats.json', 'feat'],
    ['optionalfeature', 'optionalfeatures.json', 'optionalfeature'],
    ['skill', 'skills.json', 'skill'],
    ['language', 'languages.json', 'language'],
    ['sense', 'senses.json', 'sense'],
    ['action', 'actions.json', 'action'],
    ['condition', 'conditionsdiseases.json', 'condition'],
    ['disease', 'conditionsdiseases.json', 'disease'],
    ['status', 'conditionsdiseases.json', 'status'],
    ['variantrule', 'variantrules.json', 'variantrule'],
    ['book', 'books.json', 'book'],
  ];
  for (const [type, path, key] of simple) {
    const list = entityArray(files, path, key);
    warn(resolveCopies(list, byNameSource(list), type));
    reg.addAll(type, list);
  }

  // Items: base tables + items (item copies may point at baseitems/groups)
  const baseitems = entityArray(files, 'items-base.json', 'baseitem');
  const itemProperties = entityArray(files, 'items-base.json', 'itemProperty');
  const itemTypes = entityArray(files, 'items-base.json', 'itemType');
  const items = entityArray(files, 'items.json', 'item');
  const itemGroups = entityArray(files, 'items.json', 'itemGroup');
  const magicvariants = entityArray(files, 'magicvariants.json', 'magicvariant');
  warn(resolveCopies(baseitems, byNameSource(baseitems), 'baseitem'));
  warn(resolveCopies(items, byNameSource(items, baseitems, itemGroups), 'item'));
  reg.addAll('baseitem', baseitems);
  reg.addAll('itemProperty', itemProperties);
  reg.addAll('itemType', itemTypes);
  reg.addAll('item', items);
  reg.addAll('itemGroup', itemGroups);
  reg.addAll('magicvariant', magicvariants);

  // Classes (one file per class)
  const classes: Entity[] = [];
  const subclasses: Entity[] = [];
  const classFeatures: Entity[] = [];
  const subclassFeatures: Entity[] = [];
  for (const [path] of files) {
    if (!path.startsWith('class/class-')) continue;
    classes.push(...entityArray(files, path, 'class'));
    subclasses.push(...entityArray(files, path, 'subclass'));
    classFeatures.push(...entityArray(files, path, 'classFeature'));
    subclassFeatures.push(...entityArray(files, path, 'subclassFeature'));
  }
  warn(resolveCopies(classes, byNameSource(classes), 'class'));
  warn(resolveCopies(subclasses, subclassLookup(subclasses), 'subclass'));
  reg.addAll('class', classes);
  reg.addAll('subclass', subclasses);
  reg.addAll('classFeature', classFeatures);
  reg.addAll('subclassFeature', subclassFeatures);

  // Spells (one file per source)
  const spells: Entity[] = [];
  for (const [path] of files) {
    if (!path.startsWith('spells/spells-')) continue;
    spells.push(...entityArray(files, path, 'spell'));
  }
  reg.addAll('spell', spells);

  // Beside `edition` rather than in it, and only now that copies have resolved,
  // so this reaches no row through a copy. Some older adventures copy bare XDMG
  // items and are still 2014 books, and homebrew, merged later, reads as it did
  // (`copyMod` drops the field on copy).
  for (const type of ENTITY_TYPES) {
    for (const e of reg.byType(type)) {
      if (e.edition === undefined && typeof e.source === 'string' && rulesBooks.has(e.source)) {
        e.bookEdition = 'one';
      }
    }
  }
  return reg;
}

/**
 * The books that count as 2024 rules, because a row in them says so.
 *
 * 5etools marks entities, but the rules edition belongs to the book: a later
 * book marks its backgrounds and subclasses `one` and leaves its feats, spells
 * and items bare, which read as 2014 one entity at a time. `normalizeDataset`
 * gives those bare rows a `bookEdition`, so `editionOf` stays a question about
 * one entity for all of its callers, and keeps the set on the registry for a
 * label that holds only a source code (`isBook2024`).
 *
 * Read from the raw files, because `edition` carries through a `_copy`: read
 * afterwards, one older row copying a marked XPHB race would hide its whole book
 * from a 2014 character. Official files only, so a homebrew row claiming
 * `source: 'PHB'` with a `one` cannot flip the real PHB. A book is only as known
 * as the files that have landed, and each landing rebuilds this.
 */
function booksMarkedOne(files: ReadonlyMap<string, unknown>): Set<string> {
  const books = new Set<string>();
  for (const json of files.values()) {
    if (json === null || typeof json !== 'object') continue;
    for (const list of Object.values(json)) {
      if (!Array.isArray(list)) continue;
      for (const row of list as Array<Entity | null>) {
        if (row?.edition === 'one' && typeof row.source === 'string') books.add(row.source);
      }
    }
  }
  return books;
}

/** Homebrew JSON keys are the same as official entity-array keys. */
const HOMEBREW_TYPES: EntityType[] = [
  'race',
  'subrace',
  'background',
  'feat',
  'optionalfeature',
  'item',
  'baseitem',
  'itemGroup',
  'magicvariant',
  'spell',
  'class',
  'subclass',
  'classFeature',
  'subclassFeature',
  'language',
  'condition',
  'disease',
  'status',
  'action',
  'skill',
  'sense',
  'variantrule',
];

/**
 * Merge homebrew files into a built registry. Homebrew flows through the SAME
 * copy/mod machinery: `_copy` targets may be official entities. `packs` is
 * each rule pack's Apply to and order by file id, from the stored rows: a
 * pack with none reaches nobody. `changeFiles` is the ids of the stored rows
 * with the changes role (ADR-002, D2), which only the app sets on a file the
 * player owns: their entries take the place of the entries they change.
 */
export function mergeHomebrew(
  reg: EntityRegistry,
  homebrew: ReadonlyMap<string, Record<string, unknown>>,
  packs: ReadonlyMap<string, PackLocal> = new Map(),
  changeFiles: ReadonlySet<string> = new Set(),
): void {
  const files: PackFile[] = [...homebrew].map(([id, json]) => {
    const pack = packs.get(id);
    return pack === undefined ? { id, json } : { id, json, pack };
  });
  const ordered = packsInOrder(files);
  // Every replaceTxt in every file draws on one budget, so the merge as a
  // whole is bounded rather than each operation on its own.
  withReplaceBudget(() =>
    mergeHomebrewFiles(reg, homebrew, replacersOf(reg, homebrew, ordered, changeFiles)),
  );
  reg.setRulePacks(rulePackEntries(files) as unknown as Entity[]);
}

// ---------------------------------------------------------------------------
// Changes to the books (ADR-002, D2)
// ---------------------------------------------------------------------------

/**
 * An entry's identity, lowercased: `name|source`, then for the types in
 * `ENTRY_PARENT_KEYS` those fields, so a change to Rage is the Barbarian's
 * Rage at level 1 and no other class's feature of that name. One function for
 * both sides of the match, the change and the entry below it.
 */
export function identityKey(type: string, e: Entity): string {
  const parents = Object.hasOwn(ENTRY_PARENT_KEYS, type) ? ENTRY_PARENT_KEYS[type] : undefined;
  return [own(e, 'name'), own(e, 'source'), ...(parents ?? []).map((k) => own(e, k))]
    .map((v) => (v === undefined || v === null ? '' : textOf(v)))
    .join('|')
    .toLowerCase();
}

/** What gives a change to the books: the player's Changes to the books, or a rule pack. */
export interface ChangeFrom {
  kind: 'changes' | 'pack';
  /** The stored file's id. An imported file's changes on every update: never keep it across one. */
  fileId: string;
  /** The source its file declares first, which a character's collection switch names (E2). */
  source: string;
  /** A pack's: who it reaches, as its row says; absent, nobody. */
  reach?: PackAppliesTo;
}

/** One change over an entry, as stored. */
export interface ChangeLayer {
  from: ChangeFrom;
  /** The change as its file holds it, its `_copy` unresolved: `stackChanges` reads it. */
  entry: Entity;
  /** The entry it is read against: the base with the shared layers under it. */
  below: Entity;
  /**
   * Whether the shared registry's version holds it: the player's changes do,
   * and a pack's when it applies to every character. A pack applied to some
   * characters reaches them through their own view (E4), never everyone's.
   */
  shared: boolean;
  /**
   * The fields the entry below it changed since the change was made, which the
   * change also changes (Needs a look); empty when none. Read over the base and
   * the shared layers below it.
   */
  needsLook: readonly string[];
}

/** An entry changes to the books stand over, with both versions. */
export interface ChangedEntry {
  type: EntityType;
  /** The entry below every change: the book's, or an imported collection's. */
  base: Entity;
  /** Every change over it, lowest first: packs in the player's order, then the player's own. */
  layers: readonly ChangeLayer[];
  /** What the registry holds in the base's place: `base` with the shared layers over it. */
  placed: Entity;
}

/** The entries of one file that are changes, by type, and what gives them. */
interface Replacer {
  from: ChangeFrom;
  /** Every entry of its content (the changes file), or those of these identities (a pack). */
  identities: ReadonlyMap<string, ReadonlySet<string>> | 'all';
  /** Where it stacks: packs in the player's order, then the player's changes. */
  rank: number;
  shared: boolean;
}

/** The id of the book a homebrew file declares first, or '' when it declares none. */
function firstSourceId(json: Record<string, unknown>): string {
  const meta = own(json, '_meta');
  const sources = isRecord(meta) ? own(meta, 'sources') : undefined;
  const first = Array.isArray(sources) && isRecord(sources[0]) ? own(sources[0], 'json') : '';
  return typeof first === 'string' ? first : '';
}

/**
 * The files whose entries may take a book entry's place, and which of their
 * entries do. Only two may (D2): a stored row with the changes role, and a rule
 * pack for the entries its own `replaces` names. Every other file's entries
 * keep today's rule, so a file declaring PHB never rewrites Fireball.
 */
function replacersOf(
  reg: EntityRegistry,
  homebrew: ReadonlyMap<string, Record<string, unknown>>,
  packs: ReturnType<typeof packsInOrder>,
  changeFiles: ReadonlySet<string>,
): Map<string, Replacer> {
  const out = new Map<string, Replacer>();
  packs.forEach((pack, rank) => {
    const listed = own(pack.guidance, 'replaces');
    if (listed === undefined) return;
    const warn = (message: string) =>
      reg.warnings.push({ entity: pack.name, message: `rule pack replaces: ${message}` });
    if (!Array.isArray(listed)) {
      warn('"replaces" is a list of entries');
      return;
    }
    if (listed.length > L.replacesPerPack) {
      warn(`it names ${listed.length} entries; a pack replaces at most ${L.replacesPerPack}`);
    }
    const identities = new Map<string, Set<string>>();
    for (const ref of listed.slice(0, L.replacesPerPack)) {
      const type = isRecord(ref) ? own(ref, 'type') : undefined;
      if (
        !isRecord(ref) ||
        typeof type !== 'string' ||
        !(HOMEBREW_TYPES as readonly string[]).includes(type) ||
        typeof own(ref, 'name') !== 'string' ||
        typeof own(ref, 'source') !== 'string'
      ) {
        warn('each entry it names has a type, a name and a source');
        continue;
      }
      const set = identities.get(type) ?? new Set<string>();
      set.add(identityKey(type, ref));
      identities.set(type, set);
    }
    if (identities.size === 0) return;
    const reach = packReach(pack);
    out.set(pack.id, {
      from: { kind: 'pack', fileId: pack.id, source: pack.source, ...(reach ? { reach } : {}) },
      identities,
      rank,
      shared: reach?.appDefault === true,
    });
  });
  for (const id of changeFiles) {
    const json = homebrew.get(id);
    if (json === undefined) continue;
    out.set(id, {
      from: { kind: 'changes', fileId: id, source: firstSourceId(json) },
      identities: 'all',
      rank: packs.length,
      shared: true,
    });
  }
  return out;
}

/** True when an entry of `type` in this file is a change rather than content. */
function isChange(replacer: Replacer | undefined, type: string, e: Entity): boolean {
  if (replacer === undefined) return false;
  if (replacer.identities === 'all') return true;
  return replacer.identities.get(type)?.has(changeIdentity(type, e) ?? '') === true;
}

/**
 * The identity a change stands for: its own, with what it leaves to its
 * `_copy` (a change saved as changes need not repeat its class or level).
 * Undefined when its own and its copy's disagree: a change keeps the identity
 * of the entry it changes, or the sheets holding that entry would find one of
 * another name.
 */
function changeIdentity(type: string, change: Entity): string | undefined {
  const copy = isRecord(change._copy) ? change._copy : undefined;
  const probe: Entity = {};
  const parents = Object.hasOwn(ENTRY_PARENT_KEYS, type) ? ENTRY_PARENT_KEYS[type] : undefined;
  for (const key of ['name', 'source', ...(parents ?? [])]) {
    const mine = own(change, key);
    const its = copy === undefined ? undefined : own(copy, key);
    if (
      mine !== undefined &&
      its !== undefined &&
      textOf(mine).toLowerCase() !== textOf(its).toLowerCase()
    ) {
      return undefined;
    }
    const v = mine ?? its;
    if (v !== undefined) probe[key] = v;
  }
  return identityKey(type, probe);
}

/** The fields a change marks that the entry below it now holds otherwise (Needs a look). */
function needsLookOf(change: Entity, below: Entity): string[] {
  const g = own(change, 'castGuidance');
  const marks = isRecord(g) ? own(g, 'basedOnFields') : undefined;
  if (!isRecord(marks)) return [];
  return Object.entries(marks)
    .slice(0, L.fieldsPerChange)
    .filter(([field, mark]) => typeof mark === 'string' && fieldPrint(below, field) !== mark)
    .map(([field]) => field);
}

/** Keys a change takes back from the entry it changes when it has none of its own. */
const RESTORED = [...DELETE_ON_COPY, 'bookEdition'] as const;

/**
 * A change's guidance over the guidance of the entry below it: the parts the
 * change holds take those parts' place, an empty one clears its part, and
 * every other part is the entry's. So a change to an imported entry's text
 * leaves its effects to the collection, and an update to them comes through.
 */
function guidanceOver(below: unknown, change: unknown): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = isRecord(below) ? { ...below } : {};
  if (isRecord(change) && OWN_GUIDANCE.some((part) => Object.hasOwn(change, part))) {
    for (const part of OWN_GUIDANCE) {
      if (!Object.hasOwn(change, part)) continue;
      const v = change[part];
      if (v === false || v === null || (Array.isArray(v) && v.length === 0)) delete out[part];
      else out[part] = v;
    }
    // Its parts are written in its own version, which the engine reads them by.
    if (change.v !== undefined) out.v = change.v;
  }
  return isRecord(below) || Object.keys(out).length > 0 ? out : undefined;
}

/**
 * One change over the entry below it: its `_copy`, of itself, read against that
 * entry (never against itself, which it would wait on forever), or the change
 * as it is when written whole. A change is the entry it changes, so what a
 * copy leaves behind comes back from below: its book's edition, its reprints,
 * its versions, its page; and so does its identity, exactly as below has it.
 *
 * Undefined, with a warning, when it cannot stand for that entry: its `_copy`
 * is no reference or cannot be read (never a stub of the entry), or its `_mod`
 * gives it another name, source, class or level. A `_mod` step that no longer
 * finds its text is only a warning: the rest of the change still holds.
 */
function applyChange(
  type: string,
  below: Entity,
  change: Entity,
  warnings: CopyModWarning[],
): Entity | undefined {
  const label = `change to ${type}`;
  const leftOut = (why: string) => {
    warnings.push({ entity: uidOf(change), message: `${label}: ${why}, so it is left out` });
    return undefined;
  };
  const working = structuredClone(change);
  const copy = own(working, '_copy');
  if (copy !== undefined) {
    if (!isRecord(copy)) return leftOut('its _copy is not a reference');
    try {
      applyCopy(working, below, warnings, label);
    } catch (err) {
      return leftOut(`its _copy could not be read (${err instanceof Error ? err.message : err})`);
    }
    delete working._copy;
    const guidance = guidanceOver(own(below, 'castGuidance'), own(change, 'castGuidance'));
    if (guidance === undefined) delete working.castGuidance;
    else working.castGuidance = guidance;
  }
  if (identityKey(type, working) !== identityKey(type, below)) {
    return leftOut('it no longer stands for the entry it changes');
  }
  const parents = Object.hasOwn(ENTRY_PARENT_KEYS, type) ? ENTRY_PARENT_KEYS[type] : undefined;
  for (const key of ['name', 'source', ...(parents ?? [])]) {
    if (Object.hasOwn(below, key)) working[key] = below[key];
  }
  for (const key of RESTORED) {
    if (Object.hasOwn(working, key) || !Object.hasOwn(below, key)) continue;
    // A change that says its own edition is printed under it, not its book's.
    if (key === 'bookEdition' && working.edition !== undefined) continue;
    working[key] = below[key];
  }
  return working;
}

/**
 * `base` with `layers` over it, lowest first: what a view holding those changes
 * gives in the base's place. A layer that cannot stand for the entry is left
 * out, as the shared registry leaves it out. Pure; the shared registry stacks
 * its shared layers the same way, and a per-character view (E4) may stack
 * another set. Outside a merge, wrap the calls in `withReplaceBudget`, or each
 * text replacement gets a budget of its own.
 */
export function stackChanges(
  type: string,
  base: Entity,
  layers: readonly Entity[],
  warnings: CopyModWarning[] = [],
): Entity {
  let entry = base;
  for (const change of layers) entry = applyChange(type, entry, change, warnings) ?? entry;
  return entry;
}

/** A change found in a file's content, before it is stacked. */
interface FoundChange {
  identity: string;
  replacer: Replacer;
  entry: Entity;
}

/**
 * Stack each identity's changes on the entry below them and put the result in
 * that entry's place. The entry below is the first of that identity in the
 * type's list, as every lookup finds it: the book's when the book has it, else
 * an imported collection's. A change with nothing below it is held out, since
 * it would be a stub of what it changes: when its book or collection comes
 * back, so does the change.
 */
function placeChanges(reg: EntityRegistry, type: EntityType, found: FoundChange[]): void {
  if (found.length === 0) return;
  const byIdentity = new Map<string, FoundChange[]>();
  for (const f of found) {
    const list = byIdentity.get(f.identity) ?? [];
    list.push(f);
    byIdentity.set(f.identity, list);
  }
  const below = new Map<string, Entity>();
  for (const e of reg.byType(type)) {
    const key = identityKey(type, e);
    if (byIdentity.has(key) && !below.has(key)) below.set(key, e);
  }
  for (const [identity, changes] of byIdentity) {
    const base = below.get(identity);
    if (base === undefined) {
      for (const c of changes) {
        reg.warnings.push({
          entity: uidOf(c.entry),
          message: `change to ${type}: nothing of that identity to change, so it is left out`,
        });
      }
      continue;
    }
    changes.sort((a, b) => a.replacer.rank - b.replacer.rank);
    let current = base;
    const layers: ChangeLayer[] = [];
    for (const c of changes) {
      const below = current;
      if (c.replacer.shared) {
        const applied = applyChange(type, below, c.entry, reg.warnings);
        if (applied === undefined) continue;
        current = applied;
      }
      const needsLook = needsLookOf(c.entry, below);
      const { from, shared } = c.replacer;
      layers.push({ from, entry: c.entry, below, shared, needsLook });
    }
    if (layers.length > 0) reg.placeChange({ type, base, layers, placed: current });
  }
}

/**
 * Types where many entries share a name and source on purpose: each class has
 * its own "Ability Score Improvement", and two races can each have a subrace
 * of one name. For these `name|source` is not an entry's identity, so two
 * files' entries are never folded by it.
 */
const SHARED_UID_TYPES = new Set<EntityType>([
  'subrace',
  'subclass',
  'classFeature',
  'subclassFeature',
]);

/**
 * `entities` (one homebrew file's, of one type) without those an earlier file
 * already brought, by `name|source`; `seen` then gains this file's. Two files
 * holding one book (two compendiums that both carry it) would otherwise list
 * each of its entries twice, in pickers and source counts, while `get`
 * resolves only the first: the one imported first wins, as the import
 * preview says. Repeats within one file stay as they were.
 */
function laterCopiesOut(entities: Entity[], seen: Set<string>): Entity[] {
  const named = (e: Entity) => typeof e.name === 'string' && typeof e.source === 'string';
  const kept = entities.filter((e) => !named(e) || !seen.has(uidOf(e)));
  for (const e of kept) if (named(e)) seen.add(uidOf(e));
  return kept;
}

/** Finds the entity a lowercased `name|source` names in one list, or undefined. */
type CopyIndex = (uid: string) => Entity | undefined;

/**
 * Index a list for `_copy` lookups: the same answer as {@link byNameSource}
 * (the first entity in list order with that uid), in constant time instead of
 * a scan that computes every entity's uid on every lookup.
 *
 * An entity with a string name and source keeps that identity through
 * resolution (its own fields win over what it copies), so it is keyed once,
 * up front. One without them takes its identity from what it copies, which is
 * only known once its copy resolves, so those few are searched as they stand
 * at lookup time, as the scan did. The one difference: if such an entry comes
 * to share a uid with a named entry later in the list, the named one is found
 * first, where the scan found the earlier one. Likewise a named entry whose
 * `_copy._mod` sets its own name or source is keyed under the name it starts
 * with, so a copy of it by its new name is not found.
 */
function copyIndex(list: readonly Entity[]): CopyIndex {
  const byUid = new Map<string, Entity>();
  const unsettled: Entity[] = [];
  for (const e of list) {
    if (typeof e.name !== 'string' || typeof e.source !== 'string') {
      unsettled.push(e);
      continue;
    }
    const uid = uidOf(e);
    if (!byUid.has(uid)) byUid.set(uid, e);
  }
  return (uid) => byUid.get(uid) ?? unsettled.find((e) => uidOf(e) === uid);
}

/**
 * Two passes per type, so a file's `_copy` reaches every enabled file, not only
 * the ones merged before it (IMP-002).
 *
 * Files arrive oldest import first (`homebrewRepo.enabledSafe()`), and that
 * order is the precedence: the registry keeps the first entity per uid. When
 * each file resolved its copies before the next one was added, a file could
 * copy only from files imported earlier, so importing a file before the one
 * it depends on left its copies broken until it was imported again. Resolving
 * every file's copies over all of them first, then adding them in order,
 * keeps precedence purely by import time and makes copies independent of it.
 *
 * A copy looks in its own file first, then official data, then the other
 * homebrew in merge order: the same preference as before for every target
 * that used to resolve. Copy chains across files resolve through the
 * resolver's own fixed-point passes, and a cycle ends as unresolved warnings,
 * as it does within one file. Race `_versions` are still expanded after
 * resolution, so a copy cannot target another file's expanded version.
 *
 * This runs on every registry rebuild, so each lookup is a map hit rather
 * than a scan of the type's list (see {@link copyIndex}).
 *
 * Changes to the books (`replacers`) are taken out first: they are not
 * content, so no copy finds one, no name tie drops the entry they change, and
 * they are stacked on that entry once the type's content is in.
 */
function mergeHomebrewFiles(
  reg: EntityRegistry,
  homebrew: ReadonlyMap<string, Record<string, unknown>>,
  replacers: ReadonlyMap<string, Replacer> = new Map(),
): void {
  reg.sealOfficial();
  const files = [...homebrew];
  for (const type of HOMEBREW_TYPES) {
    const found: FoundChange[] = [];
    const perFile = files.map(([id, json]) => {
      const arr = json[type];
      const listed = Array.isArray(arr)
        ? arr.filter((e): e is Entity => typeof e === 'object' && e !== null)
        : [];
      const replacer = replacers.get(id);
      if (replacer === undefined) return listed;
      return listed.filter((e) => {
        if (!isChange(replacer, type, e)) return true;
        const identity = changeIdentity(type, e);
        if (identity === undefined) {
          reg.warnings.push({
            entity: uidOf(e),
            message: `change to ${type}: it keeps the name and source of what it changes, so it is left out`,
          });
        } else {
          found.push({ identity, replacer, entry: e });
        }
        return false;
      });
    });
    const all = perFile.flat();
    if (all.length === 0) {
      placeChanges(reg, type, found);
      continue;
    }
    // Official only: this type's homebrew is added below, after resolution.
    const official = copyIndex(reg.byType(type));
    const everyFile = copyIndex(all);
    const fileOf = new Map<Entity, CopyIndex>();
    for (const list of perFile) {
      const own = copyIndex(list);
      for (const e of list) fileOf.set(e, own);
    }
    reg.warnings.push(
      ...resolveCopies(
        all,
        (copy, self) => {
          const uid = `${String(copy.name)}|${String(copy.source)}`.toLowerCase();
          return fileOf.get(self)?.(uid) ?? official(uid) ?? everyFile(uid);
        },
        `homebrew ${type}`,
      ),
    );
    const seen = SHARED_UID_TYPES.has(type) ? undefined : new Set<string>();
    for (const listed of perFile) {
      const entities = seen === undefined ? listed : laterCopiesOut(listed, seen);
      if (entities.length === 0) continue;
      if (type === 'race' || type === 'subrace') {
        const versions = entities.flatMap((e) =>
          expandVersions(e, reg.warnings, type === 'subrace' ? raceTraitsOf(reg, e) : undefined),
        );
        reg.addAll(type, [...entities, ...versions]);
      } else {
        reg.addAll(type, entities);
      }
    }
    placeChanges(reg, type, found);
  }
}
